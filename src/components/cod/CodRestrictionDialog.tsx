import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import { PLATFORM_CODE_PROFILE_NOT_FOUND } from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import {
    COD_RESTRICTION_REASON_MAX,
    COD_RESTRICTION_REASON_MIN,
    PLATFORM_CODE_COD_RESTRICTION_UNCHANGED,
    codRestrictionAuthor,
    type CodRestriction,
    type CodRestrictionBody,
    type CodRestrictionReport,
} from '@/types/cod-restriction.types';

/** The two subjects a restriction exists for. There is no third. */
export type CodRestrictionSubject = 'customer' | 'agency';

/** Which way the switch is being thrown. The direction is the route, never a field. */
export type CodRestrictionDirection = 'restrict' | 'lift';

/**
 * The three routes of one mount, bound to one id by the screen that owns it.
 * Both mounts answer the same body, so one dialog serves both.
 */
export interface CodRestrictionActions {
    read: () => Promise<CodRestrictionReport>;
    restrict: (
        body: CodRestrictionBody,
    ) => Promise<{ report: CodRestrictionReport; message: string | undefined }>;
    lift: (
        body: CodRestrictionBody,
    ) => Promise<{ report: CodRestrictionReport; message: string | undefined }>;
}

const schema = z.object({
    reason: z
        .string()
        .trim()
        .min(COD_RESTRICTION_REASON_MIN, `Give a reason of at least ${COD_RESTRICTION_REASON_MIN} characters`)
        .max(COD_RESTRICTION_REASON_MAX, `Use at most ${COD_RESTRICTION_REASON_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

/**
 * What each subject is told in the dialog. The sentences are the changelog's
 * § 1, shortened — and they describe **the switch**, never whether a given
 * basket or shipment will be allowed cash: jovi-mall decides that, every time.
 */
const COPY: Record<
    CodRestrictionSubject,
    {
        party: string;
        restrictEffect: string;
        restrictUntouched: string;
        liftEffect: string;
        restrictPlaceholder: string;
        liftPlaceholder: string;
    }
> = {
    customer: {
        party: 'the customer',
        restrictEffect:
            'This customer will no longer be able to place a cash-on-delivery order, on the website or in the bot.',
        restrictUntouched:
            'Orders already placed, parcels on their way and the cash owed on them are not affected, and every other payment method still works. The account is not suspended, and nobody is notified.',
        liftEffect:
            'This customer will be offered cash on delivery again wherever the usual rules allow it.',
        restrictPlaceholder: 'Refused three parcels without a reason',
        liftPlaceholder: 'Customer explained; the parcels were damaged',
    },
    agency: {
        party: 'the agency',
        restrictEffect:
            'This agency will receive no new cash-on-delivery shipments: a vendor cannot dispatch one to it, even by forcing it, and customers stop being offered cash on delivery for baskets it would carry.',
        restrictUntouched:
            'Parcels it already holds run to the end, its cash hand-overs (collections, deposits, remittances) and prepaid deliveries carry on, and its own COD setting and cash limit are not rewritten. Nobody is notified.',
        liftEffect:
            'This agency will take cash-on-delivery shipments again, on exactly the settings it had configured.',
        restrictPlaceholder: 'Three remittances short in two weeks',
        liftPlaceholder: 'Shortfalls settled; reviewed with the agency',
    },
};

/**
 * `PUT …/cod-restriction` and `POST …/cod-restriction/lift`, on either mount.
 *
 * ── A reason both ways, and it cannot be skipped ──────────────────────────────
 * Restricting needs one because it is a person's decision each time — nothing
 * sets this automatically. Lifting needs one because jovi-mall **erases** the
 * restriction, its reason and its author, so what is typed here is the only
 * record of why it ended. That is unlike Restore and Reactivate, which take none.
 *
 * ── The body is `{ reason }` and nothing else ─────────────────────────────────
 * Strict server-side; the direction is the route. No boolean is sent.
 *
 * ── Three outcomes that are not "show an error and let them retry" ────────────
 * - **`409 COD_RESTRICTION_UNCHANGED`** — the page was stale: a colleague got
 *   there first, or it was double-submitted. The restriction is re-read and the
 *   page is handed what is actually stored, including *their* reason.
 * - **`502` / `503`** — jovi-mall did not answer and wi-admin never retries a
 *   write, so it **may** have happened. The state is re-read before the button
 *   is offered again: if the change is in place the dialog says so and closes;
 *   if it is not, it says nothing changed; and if even the read fails, the
 *   submit button is withheld until a check succeeds.
 * - **`404 AUTH_PROFILE_NOT_FOUND`** — customer mount only: the account has no
 *   customer profile, so there is nothing to restrict. The switch is hidden on
 *   such accounts; this is the race.
 *
 * ⛔ The reason is internal. The hint under the field says so, because the
 * person typing it is the one most likely to paste it into a message.
 */
export function CodRestrictionDialog({
    subject,
    subjectName,
    direction,
    current,
    actions,
    timeZone,
    open,
    onOpenChange,
    onSettled,
}: {
    subject: CodRestrictionSubject;
    subjectName: string;
    direction: CodRestrictionDirection;
    /** The stored restriction, shown when lifting — it is about to be erased. */
    current: CodRestriction | null;
    actions: CodRestrictionActions;
    timeZone: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with whatever the service now reports, on every path that learned it. */
    onSettled: (report: CodRestrictionReport) => void;
}) {
    const copy = COPY[subject];
    const restricting = direction === 'restrict';

    const [formError, setFormError] = useState<unknown>(null);
    /**
     * What a `502`/`503` left behind once the re-read was attempted:
     * `not-applied` — read back, nothing changed, trying again is safe;
     * `unconfirmed` — the read failed too, so the state is unknown.
     */
    const [aftermath, setAftermath] = useState<'not-applied' | 'unconfirmed' | null>(null);
    const [checking, setChecking] = useState(false);

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    function close(next: boolean) {
        if (!next) {
            form.reset();
            setFormError(null);
            setAftermath(null);
        }
        onOpenChange(next);
    }

    function settle(report: CodRestrictionReport) {
        close(false);
        onSettled(report);
    }

    /** The page was stale. Show what is stored — theirs, not ours. */
    async function settleStale(conflict: ApiError) {
        let report: CodRestrictionReport;
        try {
            report = await actions.read();
        } catch {
            // The 409 is still the more useful thing to show: it says why.
            setFormError(conflict);
            return;
        }

        if (report.restricted && report.restriction) {
            notify.info(
                restricting
                    ? `Cash on delivery was already restricted by ${codRestrictionAuthor(report.restriction)}.`
                    : `Cash on delivery is restricted — by ${codRestrictionAuthor(report.restriction)}.`,
                { description: 'Nothing was changed. The page now shows what is recorded.' },
            );
        } else {
            notify.info(
                restricting
                    ? 'Cash on delivery is not restricted.'
                    : 'The restriction had already been lifted.',
                { description: 'Nothing was changed. The page now shows what is recorded.' },
            );
        }
        settle(report);
    }

    /**
     * jovi-mall did not answer. Read the state back before offering the button:
     * a write is never retried automatically, so it may have landed.
     */
    async function confirmAfterNoAnswer(noAnswer: unknown) {
        let report: CodRestrictionReport;
        try {
            report = await actions.read();
        } catch {
            setFormError(noAnswer);
            setAftermath('unconfirmed');
            return;
        }

        if (report.restricted === restricting) {
            notify.success(
                restricting
                    ? 'Cash on delivery is restricted'
                    : 'The restriction is lifted',
                {
                    description:
                        'The platform did not confirm the request, but the change is in place — checked just now.',
                },
            );
            settle(report);
            return;
        }

        setFormError(noAnswer);
        setAftermath('not-applied');
        // The page may be older than this read; hand it over without closing.
        onSettled(report);
    }

    async function onSubmit(values: Values) {
        setFormError(null);
        setAftermath(null);
        try {
            const write = restricting ? actions.restrict : actions.lift;
            const { report, message } = await write({ reason: values.reason });
            notify.success(
                message ??
                    (restricting
                        ? `Cash on delivery restricted for this ${subject}`
                        : `Cash on delivery restriction lifted for this ${subject}`),
                { description: 'Recorded in the activity trail. Nobody was notified.' },
            );
            settle(report);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_COD_RESTRICTION_UNCHANGED) {
                    await settleStale(error);
                    return;
                }
                if (error.platformCode === PLATFORM_CODE_PROFILE_NOT_FOUND) {
                    notify.warning('This account has no customer profile', {
                        description:
                            'The restriction lives on the customer profile, so there is nothing to restrict here.',
                    });
                    close(false);
                    return;
                }
                if (error.status === 502 || error.status === 503) {
                    await confirmAfterNoAnswer(error);
                    return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    async function checkAgain() {
        setChecking(true);
        try {
            await confirmAfterNoAnswer(formError);
        } finally {
            setChecking(false);
        }
    }

    const busy = form.formState.isSubmitting || checking;

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {restricting
                            ? `Restrict cash on delivery for ${subjectName}?`
                            : `Lift the cash-on-delivery restriction on ${subjectName}?`}
                    </DialogTitle>
                    <DialogDescription>
                        {restricting ? copy.restrictEffect : copy.liftEffect}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {restricting ? (
                        <p className="bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                            {copy.restrictUntouched}
                        </p>
                    ) : (
                        <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
                            {current ? (
                                <>
                                    <p>
                                        Restricted by {codRestrictionAuthor(current)},{' '}
                                        {formatInstantInZone(current.restrictedAt, timeZone) ??
                                            current.restrictedAt}
                                    </p>
                                    {current.reason ? (
                                        <p className="text-muted-foreground">“{current.reason}”</p>
                                    ) : null}
                                </>
                            ) : null}
                            <p className="text-muted-foreground text-xs">
                                Lifting erases the restriction, its reason and who set it. Nothing
                                else changes and nobody is notified — the activity trail becomes
                                the only record that it existed.
                            </p>
                        </div>
                    )}

                    <FormField
                        id={`cod-restriction-${direction}-reason`}
                        label={restricting ? 'Reason' : 'Reason for lifting'}
                        error={form.formState.errors.reason?.message}
                        hint={
                            restricting
                                ? `Internal — never shown to ${copy.party}. Kept on the restriction and in the activity trail. ${COD_RESTRICTION_REASON_MIN}–${COD_RESTRICTION_REASON_MAX} characters.`
                                : `Internal — never shown to ${copy.party}. Kept only in the activity trail. ${COD_RESTRICTION_REASON_MIN}–${COD_RESTRICTION_REASON_MAX} characters.`
                        }
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={COD_RESTRICTION_REASON_MAX}
                                placeholder={
                                    restricting ? copy.restrictPlaceholder : copy.liftPlaceholder
                                }
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {aftermath === 'unconfirmed' ? (
                        <div
                            role="alert"
                            className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">
                                {restricting
                                    ? 'The restriction may or may not have been set.'
                                    : 'The restriction may or may not have been lifted.'}
                            </p>
                            <p className="text-muted-foreground">
                                The platform did not answer, nothing retries it automatically, and
                                the current state could not be read either. Check again before
                                sending it a second time.
                            </p>
                        </div>
                    ) : null}
                    {aftermath === 'not-applied' ? (
                        <div
                            role="alert"
                            className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">Nothing changed.</p>
                            <p className="text-muted-foreground">
                                The platform did not answer, and the state was read back just now:{' '}
                                {restricting
                                    ? 'cash on delivery is still not restricted.'
                                    : 'the restriction is still in place.'}{' '}
                                You can send it again.
                            </p>
                        </div>
                    ) : null}
                    {formError && !aftermath ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => close(false)}>
                            Cancel
                        </Button>
                        {aftermath === 'unconfirmed' ? (
                            <Button type="button" disabled={busy} onClick={checkAgain}>
                                {checking ? <InlineLoader /> : null}
                                Check again
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                variant={restricting ? 'destructive' : 'default'}
                                disabled={busy}
                            >
                                {form.formState.isSubmitting ? <InlineLoader /> : null}
                                {restricting ? 'Restrict cash on delivery' : 'Lift restriction'}
                            </Button>
                        )}
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
