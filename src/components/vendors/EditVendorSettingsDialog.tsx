import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { updateVendorSettings } from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import type { UpdateVendorSettingsBody, VendorDetail } from '@/types/vendors.types';

const CANCEL_DAYS_MIN = 1;
const CANCEL_DAYS_MAX = 90;

/**
 * The server's own bounds, mirrored so a value it will refuse never leaves.
 *
 * ── Both numbers are modelled as strings, and neither uses `z.coerce` ─────────
 * The threshold has to be a string because **an empty box is meaningful**: it is
 * how the cap is cleared. A numeric field reports `NaN` for that input, and `NaN`
 * is neither "unchanged" nor "cleared".
 *
 * The day count follows it for a different reason: `z.coerce.number()` types the
 * schema's *input* as `unknown`, which breaks the symmetry `useForm` requires
 * between the values it holds and the values it validates. Parsing both at submit
 * keeps one rule for both fields and one place where a raw input becomes a number.
 */
const schema = z.object({
    autoRedirectOrdersToAgency: z.boolean(),
    autoRedirectThresholdAmount: z
        .string()
        .trim()
        .refine((value) => value === '' || Number.isFinite(Number(value)), 'Enter an amount')
        .refine((value) => value === '' || Number(value) >= 0, 'The cap cannot be negative'),
    autoCancelUnpaidDays: z
        .string()
        .trim()
        .refine((value) => Number.isInteger(Number(value)), 'Enter a whole number of days')
        .refine(
            (value) => Number(value) >= CANCEL_DAYS_MIN && Number(value) <= CANCEL_DAYS_MAX,
            `Between ${CANCEL_DAYS_MIN} and ${CANCEL_DAYS_MAX} days`,
        ),
});

type SettingsValues = z.infer<typeof schema>;

const SERVER_FIELDS = [
    'autoRedirectOrdersToAgency',
    'autoRedirectThresholdAmount',
    'autoCancelUnpaidDays',
] as const;

interface EditVendorSettingsDialogProps {
    vendor: VendorDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdated: () => void;
}

/**
 * `PATCH /vendors/:vendorId/settings` · `vendors.settings.manage`.
 *
 * ── Three fields, and the fourth is visibly missing ───────────────────────────
 * The read returns four settings; this writes three. `notifyDaysBeforeExpiry` is
 * rejected **by name** by the strict schema, so it is shown as read-only on the
 * detail rather than offered here — the rule that separates them is that a setting
 * is the administrator's when its effect lands on somebody other than the vendor
 * ([ADR-008 D-8](../../api-doc/admin/ADR-008-VENDOR-MANAGEMENT.md)), and an expiry
 * notice is a message to the vendor about the vendor.
 *
 * **Commission is not here and must never be added.** It lives on the billing
 * `PricingPlan` and moves only by assigning a plan. The permission's own catalogue
 * summary used to claim otherwise and was corrected.
 *
 * ── Only what changed is sent ─────────────────────────────────────────────────
 * The body is `.strict()` and an empty one is a `400 "Nothing to update"`, so this
 * diffs against the loaded record and submits the changed keys only. That is not
 * an optimisation: sending an unchanged value would write an audit row claiming a
 * change that did not happen, on a surface where every mutation is recorded.
 *
 * ── Clearing the cap ──────────────────────────────────────────────────────────
 * An empty amount sends `null`, which **removes the cap** — every order then
 * auto-dispatches while the switch is on. That is a widening of behaviour rather
 * than a narrowing, so the form says so beneath the field instead of leaving an
 * empty box to be read as "off".
 */
export function EditVendorSettingsDialog({
    vendor,
    open,
    onOpenChange,
    onUpdated,
}: EditVendorSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Order settings</DialogTitle>
                    <DialogDescription>
                        The three settings the platform owns, because their effect lands on somebody
                        other than this vendor.
                    </DialogDescription>
                </DialogHeader>

                {/* Unmounted on close by Radix, so every open re-reads the record. */}
                <SettingsForm
                    vendor={vendor}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onUpdated();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SettingsForm({
    vendor,
    onCancel,
    onDone,
}: {
    vendor: VendorDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const current = vendor.settings;

    const {
        register,
        control,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SettingsValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            autoRedirectOrdersToAgency: current.autoRedirectOrdersToAgency,
            autoRedirectThresholdAmount:
                current.autoRedirectThresholdAmount === null
                    ? ''
                    : String(current.autoRedirectThresholdAmount),
            autoCancelUnpaidDays: String(current.autoCancelUnpaidDays),
        },
    });

    /**
     * `useWatch`, not the `watch()` that `useForm` returns.
     *
     * The returned function cannot be memoized safely, so the React Compiler skips
     * the whole component when it sees one — a real cost for a hint line. `useWatch`
     * is an ordinary hook and subscribes to the same field.
     */
    const thresholdValue = useWatch({ control, name: 'autoRedirectThresholdAmount' });

    async function onSubmit(values: SettingsValues) {
        setFormError(null);

        const nextThreshold = values.autoRedirectThresholdAmount === ''
            ? null
            : Number(values.autoRedirectThresholdAmount);
        const nextDays = Number(values.autoCancelUnpaidDays);

        /**
         * The diff. Absent means "leave alone" on a strict body, so an unchanged
         * key is omitted rather than resent — see the header.
         */
        const body: UpdateVendorSettingsBody = {};
        if (values.autoRedirectOrdersToAgency !== current.autoRedirectOrdersToAgency) {
            body.autoRedirectOrdersToAgency = values.autoRedirectOrdersToAgency;
        }
        if (nextThreshold !== current.autoRedirectThresholdAmount) {
            body.autoRedirectThresholdAmount = nextThreshold;
        }
        if (nextDays !== current.autoCancelUnpaidDays) {
            body.autoCancelUnpaidDays = nextDays;
        }

        if (Object.keys(body).length === 0) {
            // The server would answer `400 "Nothing to update"`. Saying it here
            // costs no round trip and reads as an answer rather than a fault.
            notify.info('Nothing changed', {
                description: 'These settings already have those values.',
            });
            onDone();
            return;
        }

        try {
            await updateVendorSettings(vendor.id, body);
            notify.success('Vendor settings updated');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = Object.entries(fieldErrors)[0];
                if (named) {
                    setError(named[0] as (typeof SERVER_FIELDS)[number], { message: named[1] });
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            <AuthFormError error={formError} />

            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <Label htmlFor="auto-redirect">Auto-redirect orders to the agency</Label>
                    <p className="text-muted-foreground text-xs">
                        Shipments advance without the vendor confirming. The lever support needs
                        when a vendor goes dark.
                    </p>
                </div>
                <Controller
                    control={control}
                    name="autoRedirectOrdersToAgency"
                    render={({ field }) => (
                        <Switch
                            id="auto-redirect"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                        />
                    )}
                />
            </div>

            <FormField
                id="redirect-cap"
                label="Redirect cap (XAF)"
                error={errors.autoRedirectThresholdAmount?.message}
                hint={
                    thresholdValue === ''
                        ? 'Empty clears the cap — every order redirects while the switch above is on.'
                        : 'Orders above this value are not redirected automatically.'
                }
            >
                {(field) => (
                    <Input
                        inputMode="decimal"
                        placeholder="No cap"
                        {...field}
                        {...register('autoRedirectThresholdAmount')}
                    />
                )}
            </FormField>

            <FormField
                id="cancel-days"
                label="Cancel unpaid orders after (days)"
                error={errors.autoCancelUnpaidDays?.message}
                hint={`${CANCEL_DAYS_MIN}–${CANCEL_DAYS_MAX}. Drives a platform sweep; a long window keeps stock reserved against orders nobody will pay for.`}
            >
                {(field) => (
                    <Input
                        type="number"
                        min={CANCEL_DAYS_MIN}
                        max={CANCEL_DAYS_MAX}
                        {...field}
                        {...register('autoCancelUnpaidDays')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                The vendor&apos;s expiry-notice setting and their customer flags are theirs, and the
                commission rate lives on their billing plan. None of the three can be changed from
                here — the request refuses them by name rather than accepting and ignoring them.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Saving…" /> : 'Save settings'}
                </Button>
            </DialogFooter>
        </form>
    );
}
