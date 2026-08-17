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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { resolveErrorMessage } from '@/lib/errors';
import { notify } from '@/lib/notify';
import { tStatic } from '@/i18n/runtime';
import {
    PLATFORM_CODE_ORDER_DISPUTE_NOT_ACTIVE,
    PLATFORM_CODE_ORDER_NOT_CANCELLABLE,
    cancelOrder,
    dispatchOrder,
    resolveOrderDispute,
} from '@/services/orders.service';
import { ApiError } from '@/types/api.types';
import {
    cancelCaveats,
    dispatchCaveats,
    orderDisplayName,
    type DispatchResult,
    type Order,
    type OrderDetail,
} from '@/types/orders.types';

/**
 * All the dispute dialog needs: an id to write against and a name to say.
 *
 * Deliberately narrower than `OrderDetail`, so the dispute **queue** can offer
 * the same action without first fetching a detail it does not otherwise want.
 * The list row already carries both fields, and `orderDisplayName` is typed for
 * exactly this shape. The other two dialogs still take `OrderDetail`, because
 * they genuinely read it — `cancelCaveats` and `dispatchCaveats` branch on
 * fields the list row does not have.
 */
type DisputedOrderRef = Pick<Order, 'id' | 'orderNumber'>;

/**
 * Three of the four order writes. The refund has a dialog of its own — it has a
 * verdict to fetch and two ceilings to explain before it can ask anything.
 *
 * All three are **delegated**, so a failure that is not a validation error carries
 * `details.platformCode`. That is what the branches read; `error.code` is
 * `PLATFORM_OPERATION_REJECTED` for every one of them and says nothing.
 *
 * ⚠ **None of these responses is read.** `cancel` and `dispute/resolve` answer
 * jovi-mall's raw Mongoose order document — snake_case, the whole document,
 * carrying `delivery_address.coordinates` and `.raw_input` that wi-admin's read
 * projection deliberately withholds. The service discards it; the dialogs refetch.
 *
 * ⚠ **The guards are never reproduced.** `dispatchCaveats` and `cancelCaveats`
 * return sentences to *display*, and the buttons stay enabled: ADR-010 D-3's six
 * guards are jovi-mall's, and a client-side copy is the parallel implementation
 * D-1 forbids. Being told "this will probably be refused" and then being allowed
 * to try is the honest shape.
 */

const REASON_MIN = 3;
const REASON_MAX = 500;

const requiredReason = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, `Give at least ${REASON_MIN} characters`)
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

/** Dispatch's reason is optional — bounded when given, absent when not. */
const optionalReason = z.object({
    reason: z
        .string()
        .trim()
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type ReasonValues = { reason: string };

const SERVER_FIELDS = ['reason', 'outcome', 'amount', 'overridePolicy'] as const;

/**
 * Copy for the one order refusal whose sentence is built from `details`.
 *
 * Every other one — already cancelled, cancel-requires-refund, wrong type,
 * payment required, dispute hold, no active dispute — is answered from
 * `errors.platform.*` and needs no code here. This case stays because the
 * platform names *which* status blocked the cancel, and naming it is worth more
 * than the generic line the catalog would otherwise give.
 *
 * Returns `null` when there is nothing better to say, and the caller falls back
 * to the catalog.
 */
function platformMessage(error: ApiError): string | null {
    if (error.platformCode !== PLATFORM_CODE_ORDER_NOT_CANCELLABLE) return null;

    const details = error.details ?? {};
    const named = (key: string) =>
        typeof details[key] === 'string' ? (details[key] as string) : null;

    const fulfilment = named('fulfillmentStatus');
    if (fulfilment) return tStatic('errors.contexts.orders.cancelBlockedByFulfilment', { status: fulfilment });

    const payment = named('paymentStatus');
    if (payment) return tStatic('errors.contexts.orders.cancelBlockedByPayment', { status: payment });

    // jovi-mall's own sentence, which is more specific than anything generic.
    return named('reason');
}

// ─── Resolve a dispute ────────────────────────────────────────────────────────

/**
 * `POST /orders/:orderId/dispute/resolve` · `orders.disputes.resolve` (`financial`).
 *
 * `won` and `lost` are **from the platform's point of view**, which is the whole
 * ambiguity worth designing out — the dialog says what each one does rather than
 * offering two words and hoping.
 */
export function ResolveDisputeDialog({
    order,
    open,
    onOpenChange,
    onDone,
}: {
    order: DisputedOrderRef;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Resolve the dispute on {orderDisplayName(order)}</DialogTitle>
                    <DialogDescription>
                        This decides who is paid, and it is audited.
                    </DialogDescription>
                </DialogHeader>
                <ResolveForm
                    order={order}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function ResolveForm({
    order,
    onCancel,
    onDone,
}: {
    order: DisputedOrderRef;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [outcome, setOutcome] = useState<'won' | 'lost'>('won');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    async function confirm() {
        setSubmitting(true);
        setFormError(null);
        try {
            const { message } = await resolveOrderDispute(order.id, { outcome });
            notify.success(message ?? `Dispute resolved as ${outcome}`);
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_ORDER_DISPUTE_NOT_ACTIVE) {
                    // Not a fault: somebody got there first. Close and refetch so the
                    // screen shows what is actually true now.
                    notify.warning('Nothing to resolve', {
                        description: resolveErrorMessage(error),
                    });
                    onDone();
                    return;
                }
                const copy = platformMessage(error);
                if (copy) {
                    setFormError(new ApiError({ ...error, message: copy }));
                    return;
                }
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="dispute-outcome">Outcome</Label>
                <Select value={outcome} onValueChange={(value) => setOutcome(value as 'won' | 'lost')}>
                    <SelectTrigger id="dispute-outcome">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="won">Won by the platform</SelectItem>
                        <SelectItem value="lost">Lost by the platform</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                    {outcome === 'won'
                        ? 'The hold is lifted and the payment goes back to paid. Nothing is refunded.'
                        : 'The order is refunded, returned or cancelled, and escrow is reversed across every actor on it.'}
                </p>
            </div>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="button" onClick={confirm} disabled={submitting}>
                    {submitting ? <InlineLoader /> : null}
                    Resolve as {outcome}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

/**
 * `POST /orders/:orderId/cancel` · `orders.intervene`.
 *
 * Six guards spanning three collections, and two audiences notified — the customer
 * and the vendor. An administrator is exempt from exactly one of them, the
 * **vendor's cancellation policy**: a return window is the vendor's promise to
 * their customer and the platform is not party to it. Everything else binds an
 * administrator exactly as it binds a customer.
 */
export function CancelOrderDialog({
    order,
    open,
    onOpenChange,
    onDone,
}: {
    order: OrderDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cancel {orderDisplayName(order)}?</DialogTitle>
                    <DialogDescription>
                        The customer and the vendor are both notified.
                    </DialogDescription>
                </DialogHeader>
                <CancelForm
                    order={order}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function CancelForm({
    order,
    onCancel,
    onDone,
}: {
    order: OrderDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ReasonValues>({
        resolver: zodResolver(requiredReason),
        defaultValues: { reason: '' },
    });

    const caveats = cancelCaveats(order);

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            const { message } = await cancelOrder(order.id, { reason: values.reason });
            notify.success(message ?? 'Order cancelled');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
                const copy = platformMessage(error);
                if (copy) {
                    setFormError(new ApiError({ ...error, message: copy }));
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/*
              Shown, never enforced. The guards are the platform's and are
              re-evaluated at write time; a client-side gate would be a second copy
              of a rule about money.
            */}
            {caveats.length > 0 ? (
                <div className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm">
                    <p className="font-medium">The platform may refuse this.</p>
                    <ul className="list-disc space-y-1 pl-4">
                        {caveats.map((caveat) => (
                            <li key={caveat}>{caveat}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <FormField
                id="cancel-order-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Recorded on the order's timeline and in the audit trail. Both the customer and the vendor are told the order was cancelled."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this order is being cancelled"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Keep the order
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Cancel order
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * `POST /orders/:orderId/dispatch` · `orders.intervene`.
 *
 * Mints shipments and starts the auto-assignment broadcast — the unblock for an
 * order the vendor never dispatched and whose auto-redirect never fired.
 *
 * **`shipmentsAssigned: 0` is a `200`, not a failure.** The caller renders it as
 * an outcome; see `DispatchResultNotice`.
 */
export function DispatchOrderDialog({
    order,
    open,
    onOpenChange,
    onDone,
}: {
    order: OrderDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: DispatchResult) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Dispatch {orderDisplayName(order)}?</DialogTitle>
                    <DialogDescription>
                        Hands the order to its delivery agency and starts the assignment broadcast.
                    </DialogDescription>
                </DialogHeader>
                <DispatchForm
                    order={order}
                    onCancel={() => onOpenChange(false)}
                    onDone={(result) => {
                        onOpenChange(false);
                        onDone(result);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function DispatchForm({
    order,
    onCancel,
    onDone,
}: {
    order: OrderDetail;
    onCancel: () => void;
    onDone: (result: DispatchResult) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ReasonValues>({
        resolver: zodResolver(optionalReason),
        defaultValues: { reason: '' },
    });

    const caveats = dispatchCaveats(order);

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            // Omitted rather than sent empty — the body is strict and the field is
            // optional, so an empty string would be a value nobody meant to send.
            const result = await dispatchOrder(
                order.id,
                values.reason ? { reason: values.reason } : {},
            );
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
                const copy = platformMessage(error);
                if (copy) {
                    setFormError(new ApiError({ ...error, message: copy }));
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-muted-foreground text-sm">
                One shipment is minted per pending item and offered down the agency&apos;s ranking.
                If the vendor&apos;s own dispatch beat you to it, the platform answers{' '}
                <em>nothing to dispatch</em> rather than an error.
            </p>

            {caveats.length > 0 ? (
                <div className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm">
                    <p className="font-medium">The platform may refuse this.</p>
                    <ul className="list-disc space-y-1 pl-4">
                        {caveats.map((caveat) => (
                            <li key={caveat}>{caveat}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <FormField
                id="dispatch-order-reason"
                label="Reason (optional)"
                error={errors.reason?.message}
                hint="The timeline records that an administrator dispatched this, in its own words — describing it as auto-dispatched would misstate the exact fact a delivery dispute asks about."
            >
                {(field) => (
                    <Textarea
                        rows={2}
                        maxLength={REASON_MAX}
                        placeholder="Why this is being dispatched by hand"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Dispatch
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * What a dispatch did, held on screen until dismissed.
 *
 * **`shipmentsAssigned: 0` is a success**, and the count exists on that write's
 * response and nowhere else — no later read says "this action created them rather
 * than the vendor's own dispatch".
 */
export function DispatchResultNotice({
    result,
    onDismiss,
}: {
    result: DispatchResult;
    onDismiss: () => void;
}) {
    const nothingToDo = result.shipmentsAssigned === 0;

    return (
        <div
            className={
                nothingToDo
                    ? 'rounded-lg border px-3 py-2 text-sm'
                    : 'border-success/30 bg-success/10 rounded-lg border px-3 py-2 text-sm'
            }
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <p className="font-medium">
                        {result.message ??
                            (nothingToDo
                                ? 'Nothing to dispatch'
                                : `Dispatched ${result.shipmentsAssigned} shipment(s)`)}
                    </p>
                    {nothingToDo ? (
                        <p className="text-muted-foreground">
                            No shipment on this order was pending. The usual cause is that the
                            vendor&apos;s auto-redirect dispatched it a moment earlier — this is an
                            outcome, not a failure.
                        </p>
                    ) : null}
                </div>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    Dismiss
                </Button>
            </div>
        </div>
    );
}
