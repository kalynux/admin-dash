import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listBookingActivity } from '@/services/bookings.service';
import {
    BOOKING_AUDIT_ACTION_LABELS,
    BOOKING_AUDIT_ACTIONS,
    BOOKING_MAX_RANGE_DAYS,
} from '@/types/bookings.types';

/**
 * `GET /bookings/:bookingId/activity` · `bookings.read` **+** `audit.read`.
 *
 * What **administrators** did to this booking: the seven `bookings.*` writes
 * and its payout pause/resume. Not the booking's own history — that is the
 * status history on the Overview, and it includes the customer, the shop and
 * the system. `BookingDetail` omits the tab without both permissions.
 */
export function BookingActivityPanel({
    bookingId,
    timeZone,
    reloadToken,
}: {
    bookingId: string;
    timeZone: string;
    reloadToken: number;
}) {
    return (
        <AuditActivityPanel
            read={(query, options) => listBookingActivity(bookingId, query, options)}
            basePath={`/bookings/${bookingId}/activity`}
            actions={BOOKING_AUDIT_ACTIONS}
            actionLabels={BOOKING_AUDIT_ACTION_LABELS}
            actionPrefix="bookings."
            maxRangeDays={BOOKING_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this booking"
            emptyTitle="No administrator has acted on this booking"
            emptyDescription="This feed records cancellations, completions, cash payments, payment re-checks, withdrawn proposals, resent reminders and payout pauses made by administrators. The booking's own status history is on the Overview."
        />
    );
}
