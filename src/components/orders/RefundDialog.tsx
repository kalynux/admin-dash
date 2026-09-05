import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Definition, DefinitionList } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_ORDER_DISPUTE_HOLD,
    PLATFORM_CODE_REFUND_ALREADY_FULLY_REFUNDED,
    PLATFORM_CODE_REFUND_AMOUNT_EXCEEDS_MAX,
    PLATFORM_CODE_REFUND_GATEWAY_NOT_SUPPORTED,
    PLATFORM_CODE_REFUND_ORDER_IS_COD,
    PLATFORM_CODE_REFUND_POLICY_OVERRIDE_REQUIRED,
    getRefundEligibility,
    refundOrder,
} from '@/services/orders.service';
import { ApiError } from '@/types/api.types';
import {
    orderDisplayName,
    type OrderDetail,
    type RefundEligibility,
    type RefundResult,
} from '@/types/orders.types';

/**
 * `POST /orders/:orderId/refund` · `orders.refund` (`financial`).
 *
 * ── The eligibility read happens on open, not on mount ────────────────────────
 * `GET /refund-eligibility` is gated on **`orders.refund`**, not `orders.read` —
 * its answer is a ceiling on money leaving the platform, not a record. So the
 * detail screen must not fetch it, and a Support administrator never sees the
 * affordance that would.
 *
 * ── Two ceilings, and they are not the same number ────────────────────────────
 * The outer `maxRefundable` / `remaining` is the **platform's money invariant**
 * and is never waivable. The inner `vendorPolicy` is the **vendor's commercial
 * terms**, which `overridePolicy` waives — the return window, the refund
 * percentage. They are rendered as two separate statements, because merging them
 * into one figure is how a refund gets confirmed against the wrong limit.
 *
 * ── Two blockers explained before the button, not after ───────────────────────
 * `gatewayRefundSupported: false` (only Stripe implements a refund API; NotchPay
 * and MyCoolPay are placeholders) and `isCod: true` each disable submit with the
 * reason stated. Both are **expected outcomes, not faults** — and discovering
 * either after the press leaves a `pending` RefundTransaction behind and an
 * operator who believes money moved.
 *
 * Disabling on those two is reading a **server-stated verdict**, not
 * reimplementing a rule — the same class as disabling shipment cancel outside
 * `assigned`. It is not a client-side policy copy.
 *
 * ── Why a lost answer is not offered a retry ──────────────────────────────────
 * The pipeline is *pending row → gateway call **outside any transaction** →
 * atomic finalize*. A `502`/`503` therefore means the refund may or may not have
 * completed, and there is no reconciliation read to ask. "Try again" is the wrong
 * affordance; "reload and check" is the honest one. This is the one place the
 * phase overrides `isRetryable`, which returns `true` for `external_service`
 * everywhere else and is right to.
 */

const REASON_MIN = 3;
const REASON_MAX = 500;
const AMOUNT_MAX = 1_000_000_000;

/**
 * The amount is a **string** and is parsed at submit.
 *
 * Blank means "the full remaining refundable balance", so it has to stay
 * distinguishable from `0` — a coerced number schema would turn a cleared field
 * into a request to refund nothing.
 */
const refundSchema = z.object({
    amount: z
        .string()
        .trim()
        .refine((value) => value === '' || Number.isFinite(Number(value)), 'Enter a number')
        .refine((value) => value === '' || Number(value) > 0, 'The amount must be more than zero')
        .refine(
            (value) => value === '' || Number(value) <= AMOUNT_MAX,
            'That is larger than the platform will accept',
        ),
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, `Give at least ${REASON_MIN} characters`)
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
    overridePolicy: z.boolean(),
});

type RefundValues = z.infer<typeof refundSchema>;

const SERVER_FIELDS = ['amount', 'reason', 'overridePolicy'] as const;

/** De-underscore only. The tokens' casing and naming differ between doc sets. */
function readableGate(value: string): string {
    return value.replace(/_/g, ' ').toLowerCase();
}

export function RefundDialog({
    order,
    open,
    onOpenChange,
    onDone,
}: {
    order: OrderDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: RefundResult, message: string | undefined) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Refund {orderDisplayName(order)}</DialogTitle>
                    <DialogDescription>
                        This moves money through a payment gateway and reverses escrow across every
                        actor on the order.
                    </DialogDescription>
                </DialogHeader>
                {/*
                  A child of `DialogContent`, which Radix unmounts on close — so the
                  eligibility read fires on each open and never shows a stale
                  ceiling from a different order.
                */}
                <RefundForm
                    order={order}
                    onCancel={() => onOpenChange(false)}
                    onDone={(result, message) => {
                        onOpenChange(false);
                        onDone(result, message);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function RefundForm({
    order,
    onCancel,
    onDone,
}: {
    order: OrderDetail;
    onCancel: () => void;
    onDone: (result: RefundResult, message: string | undefined) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [ambiguous, setAmbiguous] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);

    const eligibility = useAsyncData(`/orders/${order.id}/refund-eligibility`, (signal) =>
        getRefundEligibility(order.id, { signal }),
    );

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<RefundValues>({
        resolver: zodResolver(refundSchema),
        defaultValues: { amount: '', reason: '', overridePolicy: false },
    });

    // `useWatch`, not `useForm`'s `watch()` — the latter cannot be memoized, so the
    // React Compiler skips the whole component. Same fix as the other dialogs.
    const overridePolicy = useWatch({ control, name: 'overridePolicy' });
    const verdict = eligibility.data;
    const overrides = verdict?.overrides ?? [];
    const needsOverride = overrides.length > 0;

    /**
     * Submit is refused for reasons the **server stated**, never for a rule this
     * client decided. Each one is explained above the field, not after the press.
     */
    const gatewayBlocked = verdict?.gatewayRefundSupported === false;
    const codBlocked = verdict?.isCod === true;
    const cannotSubmit =
        !verdict ||
        gatewayBlocked ||
        codBlocked ||
        Boolean(blocked) ||
        (needsOverride && !overridePolicy);

    async function onSubmit(values: RefundValues) {
        setFormError(null);
        setAmbiguous(null);
        try {
            const { result, message } = await refundOrder(order.id, {
                // Omitted rather than sent as 0 — absent means the full remaining
                // refundable balance, and that is not the same request.
                ...(values.amount ? { amount: Number(values.amount) } : {}),
                reason: values.reason,
                ...(values.overridePolicy ? { overridePolicy: true } : {}),
            });
            onDone(result, message);
        } catch (error) {
            if (error instanceof ApiError) {
                /*
                  The gateway call happens outside any transaction, so a lost answer
                  is genuinely ambiguous — the refund may or may not have completed.
                  No retry: reload and check.
                */
                if (error.isDependencyUnavailable) {
                    setAmbiguous(
                        'We did not get an answer from the payment gateway. This refund may or may not have completed — reload the order and check before trying again.',
                    );
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.amount) {
                    setError('amount', { message: fieldErrors.amount });
                    return;
                }
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }

                switch (error.platformCode) {
                    case PLATFORM_CODE_REFUND_POLICY_OVERRIDE_REQUIRED: {
                        /*
                          The ceiling was computed for the full balance while the
                          operator typed a different amount, so this can arrive even
                          when `overrides` was empty. `details` may have been
                          scrubbed — only `platformCode` is guaranteed — so fall
                          back to the eligibility read's own list, then to a generic
                          acknowledgement.
                        */
                        const named = error.details?.overrides;
                        const gates = Array.isArray(named)
                            ? named.map(String)
                            : overrides;
                        setValue('overridePolicy', false);
                        setError('overridePolicy', {
                            message: gates.length
                                ? `This refund crosses the vendor's terms: ${gates
                                      .map(readableGate)
                                      .join(', ')}. Tick the box to override them.`
                                : "This refund goes beyond the vendor's terms. Tick the box to override them.",
                        });
                        // Re-read, so the two ceilings on screen match what the
                        // server just evaluated.
                        eligibility.reload();
                        return;
                    }
                    case PLATFORM_CODE_REFUND_AMOUNT_EXCEEDS_MAX:
                        setError('amount', {
                            message:
                                'That is more than is left to refund. This is a money invariant — no override waives it.',
                        });
                        eligibility.reload();
                        return;
                    case PLATFORM_CODE_REFUND_ORDER_IS_COD:
                        setBlocked(
                            'This is a cash-on-delivery order. The money never went through a gateway, so there is nothing here to reverse.',
                        );
                        return;
                    case PLATFORM_CODE_REFUND_GATEWAY_NOT_SUPPORTED:
                        setBlocked(
                            'This order’s payment gateway has no refund API. That is an expected outcome, not a fault — only Stripe implements one today.',
                        );
                        return;
                    case PLATFORM_CODE_REFUND_ALREADY_FULLY_REFUNDED:
                        notify.warning('Nothing left to refund', {
                            description: 'This order has already been fully refunded.',
                        });
                        onCancel();
                        return;
                    case PLATFORM_CODE_ORDER_DISPUTE_HOLD:
                        setBlocked(
                            'This order is frozen by a payment dispute. Resolve the dispute as lost instead — that refunds it through the dispute pipeline.',
                        );
                        return;
                    default:
                        break;
                }
            }
            setFormError(error);
        }
    }

    if (eligibility.isLoading) {
        return <InlineLoader label="Asking what may be refunded…" />;
    }

    if (!verdict) {
        /*
          Without the ceilings this dialog is a blind money button. Submit stays
          off until the verdict arrives — a deliberate product decision, not a
          missing branch.
        */
        return (
            <div className="space-y-4">
                <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                    Could not read what may be refunded — {resolveErrorMessage(eligibility.error)}.
                    A refund cannot be offered without its ceilings.
                </p>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Close
                    </Button>
                    <Button type="button" onClick={eligibility.reload}>
                        Try again
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Ceilings verdict={verdict} />

            {gatewayBlocked ? (
                <Blocker>
                    This order was paid through <strong>{verdict.gateway ?? 'a gateway'}</strong>,
                    which has no refund API. Only Stripe implements one today, so there is no
                    refund path for this payment — an expected outcome, not a fault.
                </Blocker>
            ) : null}

            {codBlocked ? (
                <Blocker>
                    This is a cash-on-delivery order. The money never went through a gateway, so
                    there is nothing to reverse here — the cash chain is settled through the
                    remittance surface instead.
                </Blocker>
            ) : null}

            {blocked ? <Blocker>{blocked}</Blocker> : null}

            {!verdict.eligible && !gatewayBlocked && !codBlocked ? (
                <Blocker>
                    The platform reports nothing refundable on this order
                    {verdict.reasonCode ? (
                        <>
                            {' '}
                            (<code className="font-mono text-xs">{verdict.reasonCode}</code>)
                        </>
                    ) : null}
                    .
                </Blocker>
            ) : null}

            <FormField
                id="refund-amount"
                label="Amount"
                error={errors.amount?.message}
                hint={
                    <>
                        Blank refunds the full remaining refundable balance —{' '}
                        {formatMoney(verdict.remaining, verdict.currency)} —{' '}
                        <strong>not</strong> the vendor&apos;s policy cap.
                    </>
                }
            >
                {(field) => (
                    <Input
                        inputMode="decimal"
                        placeholder="Leave blank to refund everything remaining"
                        autoComplete="off"
                        {...field}
                        {...register('amount')}
                    />
                )}
            </FormField>

            <FormField
                id="refund-reason"
                label="Reason"
                error={errors.reason?.message}
                hint={
                    <>
                        Stored by the platform on the refund record <em>and</em> in this
                        service&apos;s audit trail — the vendor will ask, and this is what answers
                        them.
                    </>
                }
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this order is being refunded"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            {needsOverride ? (
                <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2">
                    <p className="text-sm font-medium">
                        This crosses the vendor&apos;s own terms.
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-sm">
                        {overrides.map((gate) => (
                            <li key={gate}>
                                {readableGate(gate)}{' '}
                                <code className="text-muted-foreground font-mono text-xs">
                                    {gate}
                                </code>
                            </li>
                        ))}
                    </ul>
                    <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                            checked={overridePolicy}
                            onCheckedChange={(checked) =>
                                setValue('overridePolicy', checked === true, {
                                    shouldValidate: true,
                                })
                            }
                            aria-label="Override the vendor's terms"
                        />
                        <span>
                            I am overriding those terms. This does not waive any money
                            invariant — an amount above the remaining balance is refused
                            regardless.
                        </span>
                    </label>
                    {errors.overridePolicy ? (
                        <p className="text-destructive text-sm">
                            {errors.overridePolicy.message}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {ambiguous ? (
                <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
                    <p className="font-medium">The outcome is unknown.</p>
                    <p>{ambiguous}</p>
                </div>
            ) : null}

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    {ambiguous ? 'Close and reload' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={isSubmitting || cannotSubmit || Boolean(ambiguous)}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Refund
                </Button>
            </DialogFooter>
        </form>
    );
}

/** The two ceilings, as two statements. Never merged into one number. */
function Ceilings({ verdict }: { verdict: RefundEligibility }) {
    return (
        <div className="space-y-3">
            <section className="rounded-lg border p-3">
                <h3 className="text-sm font-medium">What the platform will permit</h3>
                <p className="text-muted-foreground mb-2 text-xs">
                    A money invariant. No override waives it.
                </p>
                <DefinitionList>
                    <Definition label="Refundable at most">
                        {formatMoney(verdict.maxRefundable, verdict.currency)}
                    </Definition>
                    <Definition label="Still refundable">
                        {formatMoney(verdict.remaining, verdict.currency)}
                    </Definition>
                    <Definition label="Gateway">
                        <span className="flex flex-wrap items-center gap-2">
                            {verdict.gateway ?? 'Not recorded'}
                            <Badge variant="outline">
                                {verdict.gatewayRefundSupported
                                    ? 'Refunds supported'
                                    : 'No refund API'}
                            </Badge>
                        </span>
                    </Definition>
                </DefinitionList>
            </section>

            <section className="rounded-lg border p-3">
                <h3 className="text-sm font-medium">What the vendor&apos;s terms allow</h3>
                <p className="text-muted-foreground mb-2 text-xs">
                    Commercial terms, reported rather than enforced — these are what an override
                    waives.
                </p>
                <DefinitionList>
                    <Definition label="Their ceiling">
                        {formatMoney(
                            verdict.vendorPolicy.maxRefundable,
                            verdict.vendorPolicy.currency,
                        )}
                    </Definition>
                    <Definition label="Still allowed by them">
                        {formatMoney(
                            verdict.vendorPolicy.remaining,
                            verdict.vendorPolicy.currency,
                        )}
                    </Definition>
                    {/* The three `<code>` renders in this dialog — this one, the
                        platform's `reasonCode`, and the override gate names — stay
                        bare. They are vocabulary, not values: an operator reads
                        them, never pastes them. */}
                    {verdict.vendorPolicy.reasonCode ? (
                        <Definition label="Their reason">
                            <code className="font-mono text-xs">
                                {verdict.vendorPolicy.reasonCode}
                            </code>
                        </Definition>
                    ) : null}
                    {verdict.vendorPolicy.refundProcessingDays !== null ? (
                        <Definition label="Processing time">
                            {verdict.vendorPolicy.refundProcessingDays} days
                        </Definition>
                    ) : null}
                    {verdict.vendorPolicy.returnShippingPayer ? (
                        <Definition label="Return shipping paid by">
                            <span className="capitalize">
                                {verdict.vendorPolicy.returnShippingPayer}
                            </span>
                        </Definition>
                    ) : null}
                </DefinitionList>
            </section>
        </div>
    );
}

function Blocker({ children }: { children: React.ReactNode }) {
    return (
        <p className="border-destructive/30 bg-destructive/10 rounded-lg border px-3 py-2 text-sm">
            {children}
        </p>
    );
}

/**
 * What a refund did, held on screen until dismissed.
 *
 * **These figures exist on this write's response and nowhere else.** No later read
 * reports `withinVendorPolicy` or which gates were crossed, because the policy they
 * were evaluated against is one the vendor may edit tomorrow.
 */
export function RefundResultNotice({
    result,
    message,
    onDismiss,
}: {
    result: RefundResult;
    message: string | undefined;
    onDismiss: () => void;
}) {
    return (
        <div className="border-success/30 bg-success/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{message ?? 'Refund completed'}</p>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    Dismiss
                </Button>
            </div>

            <DefinitionList>
                <Definition label="Reference">
                    {/*
                      ⚠ The one value on this screen that exists nowhere else. It
                      arrives on this write's response and no later read reports
                      it, so an operator who does not copy it before dismissing
                      this notice has lost it. `plain`: it is `rf_66739911`, the
                      refund's own reference and not an ObjectId — and a partial
                      one reconciles against nothing.
                    */}
                    <CopyableValue
                        variant="plain"
                        mono
                        value={result.refundId}
                        label="refund reference"
                    />
                </Definition>
                <Definition label="Amount">
                    {formatMoney(result.amount, result.currency)}
                </Definition>
                <Definition label="Refunded in total">
                    {formatMoney(result.totalRefunded, result.currency)}
                </Definition>
                <Definition label="Fully refunded">
                    {result.fullyRefunded ? 'Yes' : 'No'}
                </Definition>
                <Definition label="Within the vendor's terms">
                    {result.withinVendorPolicy ? 'Yes' : 'No — overridden'}
                </Definition>
            </DefinitionList>

            {result.overrides.length > 0 ? (
                <p className="text-xs">
                    Gates crossed: {result.overrides.map(readableGate).join(', ')}. This is the only
                    record of which ones — the vendor&apos;s terms may change tomorrow.
                </p>
            ) : null}
        </div>
    );
}
