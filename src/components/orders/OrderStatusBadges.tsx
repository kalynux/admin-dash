import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OrderFulfillmentStatus, OrderPaymentStatus } from '@/types/orders.types';

/**
 * The two order status axes, and they are the platform's.
 *
 * `paymentStatus` and `fulfillmentStatus` are validated by **format, not
 * membership** — jovi-mall owns both state machines and extends them without
 * asking. So neither badge maps its value through a closed lookup: an unrecognised
 * status renders as itself, in the neutral tone, because adding an enum member is
 * an additive, non-breaking change and a closed reading would blank a badge on a
 * routine deploy.
 *
 * The vocabulary is jovi-mall's **verbatim**, including `AWAITING_PAYMENT`, which
 * really is stored in SCREAMING_SNAKE beside snake_case values. Softening it would
 * mean the word on the screen no longer matched the word in the API, the filter
 * and the audit trail.
 */

/** Only the tones that carry a consequence are assigned. Everything else is neutral. */
const PAYMENT_TONE: Record<string, string> = {
    paid: 'border-success/30 bg-success/10 text-success',
    refunded: 'border-warning/30 bg-warning/10 text-warning',
    partially_paid: 'border-warning/30 bg-warning/10 text-warning',
    disputed: 'border-destructive/30 bg-destructive/10 text-destructive',
    failed: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const FULFILLMENT_TONE: Record<string, string> = {
    fulfilled: 'border-success/30 bg-success/10 text-success',
    delivered: 'border-success/30 bg-success/10 text-success',
    cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
    returned: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/**
 * `AWAITING_PAYMENT` is the one value that reads badly unstyled, and it is not a
 * translation — the token is preserved, only its case is normalised for reading.
 *
 * Accepts an absent value because **a badge cannot trust its caller**: several
 * fields the contract declares non-optional arrive missing on older documents
 * (see `Order['paymentMethod']`), and a component that crashes on one takes the
 * whole table down with it rather than losing one cell.
 */
function readable(status: string | null | undefined): string | null {
    return humaniseEnum(status)?.toLowerCase() ?? null;
}

/** The shared shell. `null` renders as an explicit gap, never as an empty badge. */
function StatusBadge({
    status,
    tone,
    className,
}: {
    status: string | null | undefined;
    tone: Record<string, string>;
    className?: string;
}) {
    const label = readable(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge
            variant="outline"
            className={cn('capitalize', tone[status as string], className)}
            title={status as string}
        >
            {label}
        </Badge>
    );
}

export function PaymentStatusBadge({
    status,
    className,
}: {
    status: OrderPaymentStatus | null | undefined;
    className?: string;
}) {
    return <StatusBadge status={status} tone={PAYMENT_TONE} className={className} />;
}

export function FulfillmentStatusBadge({
    status,
    className,
}: {
    status: OrderFulfillmentStatus | null | undefined;
    className?: string;
}) {
    return <StatusBadge status={status} tone={FULFILLMENT_TONE} className={className} />;
}
