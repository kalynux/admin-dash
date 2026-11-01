import { useState, type FormEvent } from 'react';

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatCount, formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { resolveErrorMessage } from '@/lib/errors';
import {
    cancelBooking,
    cancelBookingSession,
    completeBooking,
    recheckBookingPayment,
    recordBookingCash,
    resendBookingReminder,
    withdrawBookingProposal,
} from '@/services/bookings.service';
import { ApiError } from '@/types/api.types';
import {
    BOOKING_FAULT_COPY,
    BOOKING_FAULTS,
    BOOKING_STALE_REFUSALS,
    PLATFORM_CODE_BOOKING_ADMIN_COMPLETE_UNPAID,
    bookingDisplayName,
    canRecordCash,
    refundNeedsAPerson,
    type BookingCancelAck,
    type BookingDetail,
    type BookingFault,
    type BookingRecheckResult,
    type BookingReminderResult,
    type BookingSessionCancelResult,
    type BookingWriteResult,
} from '@/types/bookings.types';

/**
 * The seven booking writes, one dialog each, sharing one shell.
 *
 * All seven are **delegated**, so a refusal is `PLATFORM_OPERATION_REJECTED`
 * and the reason is `details.platformCode`; its sentence comes from
 * `errors.platform.*` through `resolveErrorMessage`. Two refusals are handled
 * here rather than just shown:
 *
 * - **"It moved"** (`BOOKING_STALE_REFUSALS` — already cancelled, already paid,
 *   no proposal any more, …): the dialog closes and the page re-reads, because a
 *   form that cannot succeed is worse than the fresh truth.
 * - **`BOOKING_ADMIN_COMPLETE_UNPAID`**: the page never offers Complete on an
 *   unpaid booking, so this is a race. The dialog says so and offers **Record
 *   cash** in place, when the booking can take one.
 *
 * Every success answers `{ booking, result }`; the page redraws from `booking`.
 */

export type BookingAction =
    | 'cancel'
    | 'cancel-session'
    | 'complete'
    | 'cash'
    | 'recheck'
    | 'withdraw'
    | 'remind';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** What each action asks for and says. */
const ACTION_COPY: Record<
    BookingAction,
    {
        title: (name: string) => string;
        description: string;
        submit: string;
        destructive?: boolean;
        /** `required` — 3 to 500 characters. `optional` — omitted when blank. */
        reason: 'required' | 'optional';
        reasonLabel: string;
        reasonHint: string;
        placeholder: string;
    }
> = {
    cancel: {
        title: (name) => `Cancel ${name}?`,
        description: 'The customer is told it was cancelled by Wi-Mall support. The shop’s cancellation policy does not apply.',
        submit: 'Cancel booking',
        destructive: true,
        reason: 'required',
        reasonLabel: 'Reason',
        reasonHint: '⚠ The customer and the shop both see this reason on their own booking screens. Write it for them.',
        placeholder: 'Why this booking is being cancelled',
    },
    'cancel-session': {
        title: (name) => `Cancel the whole class of ${name}?`,
        description: 'Every booking still on in this class is cancelled with the same reason and fault. Each customer is told it was cancelled by Wi-Mall support.',
        submit: 'Cancel every booking in the class',
        destructive: true,
        reason: 'required',
        reasonLabel: 'Reason',
        reasonHint: '⚠ Every customer in the class and the shop see this reason on their own booking screens. Write it for them.',
        placeholder: 'Why this class is being cancelled',
    },
    complete: {
        title: (name) => `Complete ${name} for the shop?`,
        description: 'It is completed at the booked price. The shop is paid when the ordinary hold ends, and the customer keeps their protection window.',
        submit: 'Complete booking',
        reason: 'required',
        reasonLabel: 'Reason',
        reasonHint: 'Kept for administrators — in the audit trail and the status history. The customer and the shop do not see it.',
        placeholder: 'Why you are completing it for the shop',
    },
    cash: {
        title: (name) => `Record a cash payment for ${name}?`,
        description: 'Records that the customer paid the shop in cash. The shop’s own rules apply.',
        submit: 'Record cash payment',
        reason: 'required',
        reasonLabel: 'How was it confirmed?',
        reasonHint: 'Kept for administrators. Say who confirmed the cash and how — for example, the shop on a call.',
        placeholder: 'How you know the customer paid',
    },
    recheck: {
        title: (name) => `Re-check the payment for ${name}?`,
        description: 'Asks the payment provider what happened to the payment that is still in progress. Nothing is charged.',
        submit: 'Re-check payment',
        reason: 'optional',
        reasonLabel: 'Note (optional)',
        reasonHint: 'Kept for administrators.',
        placeholder: 'For example, the ticket that asked',
    },
    withdraw: {
        title: (name) => `Withdraw the proposed new time on ${name}?`,
        description: 'The original time stands. Nobody is notified.',
        submit: 'Withdraw proposal',
        reason: 'optional',
        reasonLabel: 'Note (optional)',
        reasonHint: 'Kept for administrators.',
        placeholder: 'Why the proposal is stale',
    },
    remind: {
        title: (name) => `Resend the reminder for ${name}?`,
        description: 'Sends the customer their appointment reminder again. It carries no meeting link — the link reaches them through their booking when it opens.',
        submit: 'Resend reminder',
        reason: 'optional',
        reasonLabel: 'Note (optional)',
        reasonHint: 'Kept for administrators.',
        placeholder: 'For example, the ticket that asked',
    },
};

export function BookingActionDialog({
    action,
    booking,
    onOpenChange,
    onDone,
    onStale,
    onSwitch,
}: {
    /** `null` closes the dialog. */
    action: BookingAction | null;
    booking: BookingDetail;
    onOpenChange: (open: boolean) => void;
    /** A write succeeded — redraw from `write.booking`. */
    onDone: (write: BookingWriteResult<unknown>) => void;
    /** The booking moved under the dialog — re-read it. */
    onStale: () => void;
    /** Open another action in place (Complete → Record cash). */
    onSwitch: (action: BookingAction) => void;
}) {
    return (
        <Dialog open={action !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                {action ? (
                    // Keyed so switching action starts a fresh form.
                    <ActionForm
                        key={action}
                        action={action}
                        booking={booking}
                        onCancel={() => onOpenChange(false)}
                        onDone={onDone}
                        onStale={onStale}
                        onSwitch={onSwitch}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function ActionForm({
    action,
    booking,
    onCancel,
    onDone,
    onStale,
    onSwitch,
}: {
    action: BookingAction;
    booking: BookingDetail;
    onCancel: () => void;
    onDone: (write: BookingWriteResult<unknown>) => void;
    onStale: () => void;
    onSwitch: (action: BookingAction) => void;
}) {
    const copy = ACTION_COPY[action];
    const isCancel = action === 'cancel' || action === 'cancel-session';

    const [reason, setReason] = useState('');
    const [reasonError, setReasonError] = useState<string | null>(null);
    // ⛔ No fault is pre-selected: it decides who pays the fees.
    const [fault, setFault] = useState<BookingFault | null>(null);
    const [faultError, setFaultError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [unpaidRefusal, setUnpaidRefusal] = useState(false);

    function validate(): boolean {
        const trimmed = reason.trim();
        let ok = true;
        if (copy.reason === 'required' && trimmed.length < REASON_MIN) {
            setReasonError(`Give at least ${REASON_MIN} characters`);
            ok = false;
        } else if (trimmed.length > REASON_MAX) {
            setReasonError(`Use at most ${REASON_MAX} characters`);
            ok = false;
        } else {
            setReasonError(null);
        }
        if (isCancel && !fault) {
            setFaultError('Choose whose fault it is — it decides who pays the fees.');
            ok = false;
        } else {
            setFaultError(null);
        }
        return ok;
    }

    async function perform(): Promise<BookingWriteResult<unknown>> {
        switch (action) {
            case 'cancel':
                return cancelBooking(booking.id, { reason, fault: fault! });
            case 'cancel-session':
                return cancelBookingSession(booking.id, { reason, fault: fault! });
            case 'complete':
                return completeBooking(booking.id, reason);
            case 'cash':
                return recordBookingCash(booking.id, reason);
            case 'recheck':
                return recheckBookingPayment(booking.id, reason);
            case 'withdraw':
                return withdrawBookingProposal(booking.id, reason);
            case 'remind':
                return resendBookingReminder(booking.id, reason);
        }
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!validate()) return;
        setSubmitting(true);
        setFormError(null);
        setUnpaidRefusal(false);
        try {
            const write = await perform();
            announce(action, write);
            onDone(write);
        } catch (error) {
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, ['reason', 'fault'] as const);
                if (fields.reason || fields.fault) {
                    setReasonError(fields.reason ?? null);
                    setFaultError(fields.fault ?? null);
                    return;
                }
                const code = error.platformCode;
                if (code && BOOKING_STALE_REFUSALS.includes(code)) {
                    notify.warning('The booking changed while this was open', {
                        description: resolveErrorMessage(error),
                    });
                    onStale();
                    return;
                }
                if (code === PLATFORM_CODE_BOOKING_ADMIN_COMPLETE_UNPAID) setUnpaidRefusal(true);
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    const name = bookingDisplayName(booking);

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <DialogHeader>
                <DialogTitle>{copy.title(name)}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            {isCancel ? <CancelMoney booking={booking} session={action === 'cancel-session'} /> : null}
            {action === 'complete' && booking.status === 'no-show' ? (
                <p className="bg-muted/40 rounded-md border p-3 text-sm">
                    This booking is marked <strong className="font-medium">no-show</strong>. Completing it
                    decides it in the shop’s favour: the shop is paid and the customer is not refunded.
                </p>
            ) : null}

            {isCancel ? (
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Whose fault is it?</legend>
                    <RadioGroup
                        value={fault ?? ''}
                        onValueChange={(value) => {
                            setFault(value as BookingFault);
                            setFaultError(null);
                        }}
                        aria-invalid={faultError ? true : undefined}
                    >
                        {BOOKING_FAULTS.map((value) => (
                            <div key={value} className="flex items-start gap-2">
                                <RadioGroupItem
                                    value={value}
                                    id={`booking-fault-${value}`}
                                    aria-describedby={`booking-fault-${value}-fees`}
                                    className="mt-0.5"
                                />
                                <div className="grid gap-0.5">
                                    <Label htmlFor={`booking-fault-${value}`}>{BOOKING_FAULT_COPY[value].label}</Label>
                                    <p id={`booking-fault-${value}-fees`} className="text-muted-foreground text-xs">
                                        {BOOKING_FAULT_COPY[value].fees}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </RadioGroup>
                    {faultError ? <p className="text-destructive text-xs">{faultError}</p> : null}
                </fieldset>
            ) : null}

            <FormField
                id={`booking-${action}-reason`}
                label={copy.reasonLabel}
                error={reasonError ?? undefined}
                hint={copy.reasonHint}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder={copy.placeholder}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        {...field}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}
            {unpaidRefusal && canRecordCash(booking) ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onSwitch('cash')}>
                    Record cash payment instead
                </Button>
            ) : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    {isCancel ? 'Keep the booking' : 'Close'}
                </Button>
                <Button type="submit" variant={copy.destructive ? 'destructive' : 'default'} disabled={submitting}>
                    {submitting ? <InlineLoader /> : null}
                    {copy.submit}
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * What a cancel does to money, said before the button. ⛔ Nothing is computed:
 * the amounts are the payments as sent, and the fee split is jovi-mall's.
 *
 * Only a PAID booking is refunded, and everything still refundable goes back —
 * the first payment and any settled balance. ⚠ **"Opens", never "has been
 * refunded"**: the usual result is `requested`, with the request still sending,
 * so the money may not have arrived when the dialog closes (`bookings.md` § What
 * a cancel's refund did). ⛔ A cash booking sends nothing and must not be pointed
 * at *Raise a refund*: the shop hands the cash back and a ticket follows it up.
 */
function CancelMoney({ booking, session }: { booking: BookingDetail; session: boolean }) {
    const succeeded = booking.payments.filter((payment) => payment.status.toUpperCase() === 'SUCCEEDED');
    const paid = booking.requiresPayment && booking.paymentStatus === 'paid';

    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
            {session ? (
                <p>
                    <strong className="font-medium">
                        {formatCount(booking.sessionSeats.length + 1)} bookings
                    </strong>{' '}
                    are cancelled — this one and {formatCount(booking.sessionSeats.length)} other
                    {booking.sessionSeats.length === 1 ? '' : 's'} in the class. Each paid one is refunded the
                    way described below, from its own payment.
                </p>
            ) : null}
            {!paid ? (
                <p>
                    {booking.requiresPayment
                        ? 'Nothing was paid, so nothing is refunded.'
                        : 'This booking was free, so nothing is refunded.'}
                </p>
            ) : booking.paymentMethod === 'cash' ? (
                <p>
                    It was paid in cash, so <strong className="font-medium">no transfer is sent</strong>: the
                    shop hands the money back to the customer, and a high-priority ticket is raised to
                    follow that up.
                </p>
            ) : (
                <>
                    <p>
                        <strong className="font-medium">A refund opens at once</strong>, with no second approver,
                        for everything still refundable on this booking:
                    </p>
                    {succeeded.length > 0 ? (
                        <ul className="list-disc space-y-0.5 pl-5">
                            {succeeded.map((payment) => (
                                <li key={payment.id}>
                                    {formatMoney(payment.amount, payment.currency)}{' '}
                                    <span className="text-muted-foreground">
                                        ({payment.purpose === 'booking_balance' ? 'balance payment' : 'payment'})
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>The booked price is {formatMoney(booking.price, booking.currency)}.</p>
                    )}
                    <p className="text-muted-foreground text-xs">
                        This follows the same path as a customer’s own cancellation. The money may not have
                        arrived when this closes: the request usually carries on in the refund queue. This
                        page then says what happened, and what to do if the refund could not be opened.
                    </p>
                </>
            )}
        </div>
    );
}

/**
 * The toast, read off `result` where it says more than "done".
 *
 * On a cancel the server's `message` already follows what the refund did, so it
 * is shown as is; only its tone is decided here. ⚠ A toast goes away, so the page
 * also holds `manual` and `failed` in `BookingRefundNotice`.
 */
function announce(action: BookingAction, write: BookingWriteResult<unknown>) {
    if (action === 'cancel') {
        const refund = (write.result as BookingCancelAck | undefined)?.refund;
        const message = write.message ?? 'Booking cancelled';
        if (refund === 'failed') notify.error(message);
        else if (refund === 'manual') notify.warning(message);
        else notify.success(message);
        return;
    }
    if (action === 'cancel-session') {
        const result = write.result as BookingSessionCancelResult | undefined;
        const message = write.message ?? 'Class cancelled';
        const seats = result?.cancelled ?? [];
        if (seats.some((seat) => seat.refund === 'failed')) notify.error(message);
        else if ((result?.failed ?? []).length > 0 || seats.some((seat) => refundNeedsAPerson(seat.refund))) {
            notify.warning(message);
        } else notify.success(message);
        return;
    }
    if (action === 'recheck') {
        const result = write.result as BookingRecheckResult | undefined;
        if (result?.outcome === 'still_pending') {
            notify.info(write.message ?? 'The provider still has this payment in flight — nothing changed');
            return;
        }
    }
    if (action === 'remind') {
        const result = write.result as BookingReminderResult | undefined;
        if (result && !result.sent) {
            notify.warning(write.message ?? 'Nothing sent — this account has no customer profile to notify');
            return;
        }
    }
    notify.success(write.message ?? ACTION_COPY[action].submit);
}
