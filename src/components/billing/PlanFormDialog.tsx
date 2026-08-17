import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { InfoHint } from '@/components/ui/info-hint';
import { pickFieldErrors } from '@/lib/field-errors';
import { resolveErrorMessage } from '@/lib/errors';
import { notify } from '@/lib/notify';
import { createPlan, updatePlan } from '@/services/billing.service';
import { ApiError } from '@/types/api.types';
import {
    PLAN_ROLES,
    PLATFORM_CODE_PLAN_CODE_EXISTS,
    PLATFORM_CODE_PLAN_NOT_FOUND,
    type CreatePlanBody,
    type Plan,
    type UpdatePlanBody,
} from '@/types/billing.types';

/**
 * Create or edit a pricing tier.
 *
 * ── One form, two verbs, and the difference is what is editable ───────────────
 * `PATCH` refuses `role` and `code` outright, so on an edit both render
 * **read-only** rather than being omitted: an operator still needs to see which
 * tier they are changing, and hiding the two immutable fields makes the form look
 * like it lost them.
 *
 * ── The limits are FLAT in the request and NESTED in the response ─────────────
 * The body is `.strict()`, so sending `{ limits: {...} }` — the shape the DTO
 * hands back — is a `400`. The mapping is done explicitly below rather than by
 * spreading a form object, for the same reason `MarkPaidDialog` builds its body
 * literally: a spread is how a stray key reaches a strict schema.
 *
 * ── `null` clears, an omitted key leaves alone — on five keys only ────────────
 * `termDays`, `maxActiveProducts`, `maxStorageBytes`, `commissionPercent` and
 * `maxUnterminatedShipments` accept `null`. `null` on anything else is a `400`,
 * which is why the empty-string → `null` conversion below is applied to those
 * five and to nothing else.
 */

const CODE_PATTERN = /^[a-z0-9_-]+$/;

/**
 * An optional number that an empty box clears.
 *
 * `''` becomes `null` — which the API reads as *clear this limit* — and any other
 * value must parse as a non-negative number.
 */
const clearableNumber = z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
        message: 'Enter a number, or leave it empty to clear the limit',
    });

const schema = z.object({
    role: z.enum(PLAN_ROLES),
    code: z
        .string()
        .trim()
        .toLowerCase()
        .min(2, 'Use at least 2 characters')
        .max(40, 'Use at most 40 characters')
        .regex(CODE_PATTERN, 'Lower-case letters, digits, hyphen and underscore only'),
    name: z.string().trim().min(2, 'Use at least 2 characters').max(80, 'Use at most 80 characters'),
    price: z.coerce.number().min(0, 'A price cannot be negative'),
    currency: z
        .string()
        .trim()
        .toUpperCase()
        .length(3, 'A currency code is exactly three characters')
        .or(z.literal('')),
    /** Required, and `>= 1` when set — `0` is a 400 the doc does not mention. */
    termDays: z
        .string()
        .trim()
        .transform((value) => (value === '' ? null : Number(value)))
        .refine((value) => value === null || (Number.isInteger(value) && value >= 1), {
            message: 'Enter at least 1 day, or leave it empty for a tier that never expires',
        }),
    creditAllowance: z.coerce.number().int().min(0, 'Cannot be negative'),
    maxActiveProducts: clearableNumber,
    maxStorageMb: clearableNumber,
    commissionPercent: clearableNumber.refine(
        (value) => value === null || (value >= 0 && value <= 100),
        { message: 'A commission is a percentage between 0 and 100' },
    ),
    maxUnterminatedShipments: clearableNumber,
    liveTrackingEnabled: z.boolean(),
    isActive: z.boolean(),
});

type PlanFormValues = z.input<typeof schema>;
type PlanFormOutput = z.output<typeof schema>;

const SERVER_FIELDS = [
    'code',
    'name',
    'price',
    'currency',
    'termDays',
    'creditAllowance',
    'commissionPercent',
] as const;

interface PlanFormDialogProps {
    /** Absent on a create. */
    plan?: Plan;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

export function PlanFormDialog({ plan, open, onOpenChange, onSaved }: PlanFormDialogProps) {
    const editing = plan !== undefined;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editing ? 'Edit this plan' : 'Create a plan'}</DialogTitle>
                    <DialogDescription>
                        {editing
                            ? 'The role and code are fixed once a tier exists. Everything else moves, including the commission every future order is split on.'
                            : 'A tier belongs to exactly one role and carries only the limits that role uses.'}
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <PlanForm
                    plan={plan}
                    onSaved={onSaved}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function PlanForm({
    plan,
    onSaved,
    onCancel,
}: {
    plan?: Plan;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const editing = plan !== undefined;
    const [formError, setFormError] = useState<unknown>(null);

    const {
        control,
        register,
        handleSubmit,
        setError,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<PlanFormValues, unknown, PlanFormOutput>({
        resolver: zodResolver(schema),
        defaultValues: {
            role: (plan?.role as (typeof PLAN_ROLES)[number]) ?? 'vendor',
            code: plan?.code ?? '',
            name: plan?.name ?? '',
            price: String(plan?.price ?? 0) as never,
            currency: plan?.currency ?? '',
            termDays: plan?.termDays === null || plan === undefined ? '' : String(plan.termDays),
            creditAllowance: String(plan?.creditAllowance ?? 0) as never,
            maxActiveProducts: numberField(plan?.limits.maxActiveProducts),
            maxStorageMb: numberField(
                plan?.limits.maxStorageBytes == null
                    ? null
                    : Math.round(plan.limits.maxStorageBytes / 1_000_000),
            ),
            commissionPercent: numberField(plan?.limits.commissionPercent),
            maxUnterminatedShipments: numberField(plan?.limits.maxUnterminatedShipments),
            liveTrackingEnabled: plan?.limits.liveTrackingEnabled ?? false,
            isActive: plan?.isActive ?? true,
        },
    });

    // `useWatch`, not `useForm`'s `watch()` — the latter cannot be memoized, so
    // the React Compiler skips the whole component when it sees one. Same
    // reasoning (and the same fix) as `AgentWriteDialogs`.
    const role = useWatch({ control, name: 'role' });
    const liveTrackingEnabled = useWatch({ control, name: 'liveTrackingEnabled' });
    const isActive = useWatch({ control, name: 'isActive' });

    async function onSubmit(values: PlanFormOutput) {
        setFormError(null);

        /*
         * Built key by key. The five limits are TOP-LEVEL here even though the
         * response nests them under `limits`, and the schema is strict — a
         * spread of the form object would send `maxStorageMb`, which is this
         * form's unit rather than the API's, and be a 400.
         */
        const limits = {
            maxActiveProducts: values.maxActiveProducts,
            maxStorageBytes:
                values.maxStorageMb === null ? null : Math.round(values.maxStorageMb * 1_000_000),
            commissionPercent: values.commissionPercent,
            maxUnterminatedShipments: values.maxUnterminatedShipments,
            liveTrackingEnabled: values.liveTrackingEnabled,
            isActive: values.isActive,
        };

        try {
            if (plan) {
                const body: UpdatePlanBody = {
                    name: values.name,
                    price: values.price,
                    termDays: values.termDays,
                    creditAllowance: values.creditAllowance,
                    ...limits,
                    // `role` and `code` are refused by the schema — never sent.
                    ...(values.currency ? { currency: values.currency } : {}),
                };
                const result = await updatePlan(plan.id, body);
                notify.success(result.message ?? 'Plan updated');
            } else {
                const body: CreatePlanBody = {
                    role: values.role,
                    code: values.code,
                    name: values.name,
                    price: values.price,
                    termDays: values.termDays,
                    creditAllowance: values.creditAllowance,
                    ...limits,
                    ...(values.currency ? { currency: values.currency } : {}),
                };
                const result = await createPlan(body);
                notify.success(result.message ?? 'Plan created');
            }

            onSaved();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_PLAN_CODE_EXISTS) {
                    setError('code', { message: resolveErrorMessage(error) });
                    return;
                }

                if (error.platformCode === PLATFORM_CODE_PLAN_NOT_FOUND) {
                    /*
                       Almost always means the plan was archived: this service's
                       read returns archived rows and the platform's write does
                       not see them.

                       The banner below passes `context="billingPlanForm"`, which
                       is where this code's wording differs from everywhere else:
                       an archived tier cannot be *edited* here, while the shared
                       sentence says it cannot be *assigned*.
                    */
                    setFormError(error);
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = SERVER_FIELDS.find((field) => fieldErrors[field]);
                if (named) {
                    setError(named as keyof PlanFormValues, { message: fieldErrors[named] });
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} context="billingPlanForm" />

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="plan-role">Role</Label>
                    {editing ? (
                        /*
                          Read-only rather than omitted: PATCH refuses it, and a
                          form that dropped the field would look like it lost it.
                        */
                        <Input id="plan-role" value={plan.role} readOnly disabled />
                    ) : (
                        <Select
                            value={role}
                            onValueChange={(next) =>
                                setValue('role', next as (typeof PLAN_ROLES)[number])
                            }
                        >
                            <SelectTrigger id="plan-role">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PLAN_ROLES.map((role) => (
                                    <SelectItem key={role} value={role} className="capitalize">
                                        {role}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-code">Code</Label>
                    <Input
                        id="plan-code"
                        {...register('code')}
                        readOnly={editing}
                        disabled={editing}
                        placeholder="vendor_growth"
                    />
                    {errors.code ? (
                        <p className="text-destructive text-sm">{errors.code.message}</p>
                    ) : editing ? (
                        <p className="text-muted-foreground text-xs">
                            A code is fixed once the tier exists.
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-name">Name</Label>
                    <Input id="plan-name" {...register('name')} />
                    {errors.name ? (
                        <p className="text-destructive text-sm">{errors.name.message}</p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-price">Price</Label>
                    <Input id="plan-price" inputMode="decimal" {...register('price')} />
                    {errors.price ? (
                        <p className="text-destructive text-sm">{errors.price.message}</p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-currency">Currency</Label>
                    <Input id="plan-currency" {...register('currency')} placeholder="XAF" />
                    {errors.currency ? (
                        <p className="text-destructive text-sm">{errors.currency.message}</p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-term" className="flex items-center gap-1">
                        Term in days
                        <InfoHint label="About the term">
                            Leave empty for a tier that never expires — the free default works
                            that way. Otherwise it must be at least one day.
                        </InfoHint>
                    </Label>
                    <Input id="plan-term" inputMode="numeric" {...register('termDays')} />
                    {errors.termDays ? (
                        <p className="text-destructive text-sm">{errors.termDays.message}</p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-credits">Credit allowance</Label>
                    <Input
                        id="plan-credits"
                        inputMode="numeric"
                        {...register('creditAllowance')}
                    />
                    {errors.creditAllowance ? (
                        <p className="text-destructive text-sm">
                            {errors.creditAllowance.message}
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-commission" className="flex items-center gap-1">
                        Commission %
                        <InfoHint label="About commission">
                            <strong>The multiplier every future order&rsquo;s split uses.</strong>{' '}
                            Changing it changes what this tier&rsquo;s subscribers are charged on
                            every sale from now on. Existing splits keep their own frozen rate.
                        </InfoHint>
                    </Label>
                    <Input
                        id="plan-commission"
                        inputMode="decimal"
                        {...register('commissionPercent')}
                    />
                    {errors.commissionPercent ? (
                        <p className="text-destructive text-sm">
                            {errors.commissionPercent.message}
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-products">Active listings</Label>
                    <Input
                        id="plan-products"
                        inputMode="numeric"
                        {...register('maxActiveProducts')}
                    />
                    <p className="text-muted-foreground text-xs">Empty means not limited.</p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-storage" className="flex items-center gap-1">
                        Storage (MB)
                        <InfoHint label="About storage">
                            Unlike the other limits, empty is <strong>not unlimited</strong> — the
                            platform applies its own default cap instead.
                        </InfoHint>
                    </Label>
                    <Input id="plan-storage" inputMode="numeric" {...register('maxStorageMb')} />
                    <p className="text-muted-foreground text-xs">
                        Empty means the platform default applies.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="plan-shipments">Concurrent shipments</Label>
                    <Input
                        id="plan-shipments"
                        inputMode="numeric"
                        {...register('maxUnterminatedShipments')}
                    />
                    <p className="text-muted-foreground text-xs">
                        Delivery tiers only. Empty means not limited.
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                    <Switch
                        id="plan-tracking"
                        checked={liveTrackingEnabled}
                        onCheckedChange={(next) => setValue('liveTrackingEnabled', next)}
                    />
                    <Label htmlFor="plan-tracking">Live tracking included</Label>
                </div>

                <div className="flex items-center gap-2">
                    <Switch
                        id="plan-active"
                        checked={isActive}
                        onCheckedChange={(next) => setValue('isActive', next)}
                    />
                    <Label htmlFor="plan-active" className="flex items-center gap-1">
                        Purchasable
                        <InfoHint label="About purchasability">
                            An inactive tier is defined but cannot be bought or assigned — a real
                            state, and not the same as archiving it.
                        </InfoHint>
                    </Label>
                </div>
            </div>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <InlineLoader label="Saving…" />
                    ) : editing ? (
                        'Save changes'
                    ) : (
                        'Create plan'
                    )}
                </Button>
            </DialogFooter>
        </form>
    );
}

/** An absent limit is an empty box, which submits back as `null` to clear it. */
function numberField(value: number | null | undefined): string {
    return value === null || value === undefined ? '' : String(value);
}
