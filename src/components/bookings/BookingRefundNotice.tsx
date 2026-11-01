import { Link } from 'react-router-dom';
import { AlertTriangle, Undo2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import {
    bookingDetailPath,
    canRaiseBookingRefund,
    isBookingCancelRefund,
    refundNeedsAPerson,
    type BookingDetail,
    type BookingRefundFollowUp,
    type BookingSessionCancelResult,
} from '@/types/bookings.types';

/**
 * A cancelled booking whose refund needs a person (`bookings.md` § What a cancel's
 * refund did). Shown to every tier: Support answers "where is my money" and must
 * see this too. The buttons follow their own permissions.
 *
 * ⛔ **`failed` is the loud one**: no ticket and no flag exist, so this notice is
 * the only trace of it anywhere. ⛔ **No Raise a refund on a cash booking**
 * (`canRaiseBookingRefund`).
 */
const FOLLOW_UP_COPY: Record<
    BookingRefundFollowUp,
    { title: string; why: string; online: string; cash: string; loud: boolean }
> = {
    failed: {
        title: 'The refund did not run',
        why: 'The booking is cancelled, but the refund step failed before recording anything. No ticket and no flag exist, so nobody else will notice.',
        online: 'Raise the refund yourself.',
        cash: 'It was paid in cash: arrange with the shop for the money to go back to the customer.',
        loud: true,
    },
    manual: {
        title: 'This refund has to be made by hand',
        why: 'No refund request could be opened for this cancelled booking. A high-priority ticket was raised against it.',
        online: 'Follow the ticket, and raise the refund: it either opens the request or says why not.',
        cash: 'It was paid in cash, so there is no transfer to send: the shop hands the money back, and the ticket follows that up.',
        loud: false,
    },
    unflagged: {
        title: 'A refund is owed and nothing says it is being handled',
        why: 'This booking is cancelled and still reads paid, with no refund request. A ticket may have been raised against it; check.',
        online: 'Raise the refund: it either opens the request or says why not.',
        cash: 'It was paid in cash: arrange with the shop for the money to go back to the customer.',
        loud: true,
    },
};

export function BookingRefundNotice({
    booking,
    followUp,
    onRaise,
}: {
    booking: BookingDetail;
    followUp: BookingRefundFollowUp;
    onRaise: () => void;
}) {
    const can = useCan();
    const copy = FOLLOW_UP_COPY[followUp];
    const online = canRaiseBookingRefund(booking);

    return (
        <div
            role={copy.loud ? 'alert' : 'status'}
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm',
                copy.loud ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10',
            )}
        >
            <div className="flex items-start gap-2">
                <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', copy.loud ? 'text-destructive' : 'text-warning')} />
                <div className="space-y-0.5">
                    <p className="font-medium">{copy.title}</p>
                    <p>{copy.why}</p>
                    <p>{online ? copy.online : copy.cash}</p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {followUp !== 'failed' && can('support.tickets.read') ? (
                    <Button variant="outline" size="sm" asChild>
                        <Link to={`/dashboard/support/tickets?entityId=${encodeURIComponent(booking.id)}`}>
                            Tickets about this booking
                        </Link>
                    </Button>
                ) : null}
                {online && can('orders.refund.request') ? (
                    <Button variant="outline" size="sm" onClick={onRaise}>
                        <Undo2 className="size-4" />
                        Raise a refund
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

/**
 * What a session cancel did, seat by seat. It exists on that one response and
 * nowhere else: the cancelled seats leave `sessionSeats` on the re-read, so this
 * is the only list of them left. Lists every seat somebody must look at: a refund
 * that needs a person, a refund the service did not report, a seat not cancelled.
 */
export function BookingSessionNotice({
    result,
    onDismiss,
}: {
    result: BookingSessionCancelResult;
    onDismiss: () => void;
}) {
    const failedRefunds = result.cancelled.filter((seat) => seat.refund === 'failed');
    const manualRefunds = result.cancelled.filter((seat) => seat.refund === 'manual');
    const notReported = result.cancelled.filter((seat) => !isBookingCancelRefund(seat.refund));
    const byHand = result.cancelled.filter((seat) => refundNeedsAPerson(seat.refund)).length;

    if (byHand === 0 && notReported.length === 0 && result.failed.length === 0) return null;

    return (
        <div
            role={failedRefunds.length > 0 ? 'alert' : 'status'}
            className={cn(
                'space-y-2 rounded-md border p-3 text-sm',
                failedRefunds.length > 0 ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10',
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                    {formatCount(result.cancelled.length)} booking{result.cancelled.length === 1 ? '' : 's'} cancelled
                    {byHand > 0 ? `; ${formatCount(byHand)} refund${byHand === 1 ? '' : 's'} must be handled by hand` : ''}
                </p>
                <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label="Dismiss" onClick={onDismiss}>
                    <X className="size-3.5" />
                </Button>
            </div>
            <SeatList
                seats={failedRefunds}
                says="The refund did not run, and no ticket or flag exists. Open each one and handle it by hand:"
            />
            <SeatList seats={manualRefunds} says="No refund request could be opened; follow the ticket raised on each:" />
            <SeatList seats={notReported} says="The platform did not say what happened to these refunds. Open each one to check:" />
            <SeatList
                seats={result.failed}
                says="These could not be cancelled and are still on. Run Cancel whole class again to pick them up:"
            />
        </div>
    );
}

function SeatList({
    seats,
    says,
}: {
    seats: { bookingId: string; bookingNumber: string | null; code?: string }[];
    says: string;
}) {
    if (seats.length === 0) return null;
    return (
        <div>
            <p>{says}</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                {seats.map((seat) => (
                    <li key={seat.bookingId}>
                        <Link to={bookingDetailPath(seat.bookingId)} className="font-medium hover:underline">
                            {seat.bookingNumber ?? seat.bookingId}
                        </Link>
                        {seat.code ? <span className="text-muted-foreground ml-1 text-xs">({seat.code})</span> : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
