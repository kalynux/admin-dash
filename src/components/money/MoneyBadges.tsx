import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';

/**
 * Status badges for the earnings and settlement surfaces.
 *
 * Every vocabulary here is the **platform's**, validated by wi-admin as a bounded
 * string rather than a pinned enum. So each badge picks its variant by lookup
 * with a neutral default and always renders the raw value: adding a member is an
 * additive, non-breaking change upstream, and a closed `switch` would break on a
 * routine deploy.
 *
 * Each also accepts an **absent** value, because a badge cannot trust its caller:
 * several fields the contract declares non-optional arrive missing on older
 * documents (see `Order['paymentMethod']`), and a badge that throws takes down
 * the whole table rather than losing one cell.
 */

/** `held` · `released` · `reversed`. */
const ALLOCATION_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    held: 'secondary',
    released: 'default',
    reversed: 'destructive',
};

export function AllocationStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={ALLOCATION_VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}

/**
 * ⚠ **These keys are UPPERCASE**, matching the schema enum — `SUCCEEDED`, not
 * `succeeded`. `money.md`'s examples are lower-cased and would miss every row.
 */
const PAYMENT_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    SUCCEEDED: 'default',
    PENDING: 'secondary',
    INITIATED: 'secondary',
    FAILED: 'destructive',
    CANCELLED: 'outline',
    REFUNDED: 'outline',
};

export function PaymentStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={PAYMENT_VARIANTS[status as string] ?? 'outline'} className="uppercase">
            {label}
        </Badge>
    );
}

/**
 * ⚠ **Lowercase here**, unlike payments and unlike this collection's own
 * `gateway`, which is UPPERCASE. The mixed casing is real and lives on one
 * object.
 */
const REFUND_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    completed: 'default',
    pending: 'secondary',
    failed: 'destructive',
};

export function RefundStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={REFUND_VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}

/**
 * A ledger movement's kind.
 *
 * Rendered plainly rather than colour-coded: `hold` and `release` move money in
 * and out, but `reserve_hold` moves it **sideways** (pending → reserve), so a
 * two-colour scheme would have to put a third meaning on one of the two.
 */
export function LedgerEntryTypeBadge({ entryType }: { entryType: string | null | undefined }) {
    const label = humaniseEnum(entryType);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant="outline" className="capitalize">
            {label}
        </Badge>
    );
}
