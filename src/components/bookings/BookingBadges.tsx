import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    bookingEarningsCopy,
    bookingPaymentStatusLabel,
    bookingStatusLabel,
} from '@/types/bookings.types';

/**
 * A booking's two status axes and where the shop's money stands.
 *
 * All three vocabularies are jovi-mall's (or derived from it) and open, so no
 * lookup is closed: an unknown value renders as itself in the neutral tone.
 * Only the tones that carry a consequence are assigned.
 */

const SUCCESS = 'border-success/30 bg-success/10 text-success';
const WARNING = 'border-warning/30 bg-warning/10 text-warning';
const DANGER = 'border-destructive/30 bg-destructive/10 text-destructive';

const STATUS_TONE: Record<string, string> = {
    confirmed: SUCCESS,
    completed: SUCCESS,
    pending: WARNING,
    'no-show': WARNING,
    cancelled: DANGER,
};

const PAYMENT_TONE: Record<string, string> = {
    paid: SUCCESS,
    pending: WARNING,
    refund_pending: WARNING,
    refunded: WARNING,
    failed: DANGER,
    disputed: DANGER,
};

/**
 * `waiting` on a paid no-show is the case an administrator must decide, but the
 * badge cannot know the status — the detail says so beside it.
 */
const EARNINGS_TONE: Record<string, string> = {
    released: SUCCESS,
    holding: WARNING,
    waiting: WARNING,
    paused: DANGER,
    reversed: DANGER,
};

function Tone({ value, label, tone, className }: { value: string; label: string; tone: Record<string, string>; className?: string }) {
    return (
        <Badge variant="outline" className={cn(tone[value], className)} title={value}>
            {label}
        </Badge>
    );
}

export function BookingStatusBadge({ status, className }: { status: string; className?: string }) {
    return <Tone value={status} label={bookingStatusLabel(status)} tone={STATUS_TONE} className={className} />;
}

export function BookingPaymentBadge({ status, className }: { status: string; className?: string }) {
    return (
        <Tone value={status} label={bookingPaymentStatusLabel(status)} tone={PAYMENT_TONE} className={className} />
    );
}

export function BookingEarningsBadge({ state, className }: { state: string; className?: string }) {
    return (
        <Tone value={state} label={bookingEarningsCopy(state).label} tone={EARNINGS_TONE} className={className} />
    );
}
