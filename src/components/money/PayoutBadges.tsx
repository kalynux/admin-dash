import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';
import { PAYOUT_ORIGIN_LABELS } from '@/types/money.types';

/**
 * A payout's status.
 *
 * `pending` · `paid` · `rejected` on the platform today, but **a bounded string
 * on the wire, not a pinned enum** — wi-admin writes against none of jovi-mall's
 * vocabularies. So the variant is chosen by lookup with a neutral default and the
 * value is always rendered raw: adding a member is an additive, non-breaking
 * change on the platform, and a closed `switch` would break on a routine deploy.
 */
const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    pending: 'secondary',
    paid: 'default',
    rejected: 'destructive',
};

export function PayoutStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={STATUS_VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}

/**
 * Who opened the request.
 *
 * The distinction is operational rather than cosmetic: `auto_threshold` means the
 * platform's daily sweep opened it once the available balance reached the payout
 * threshold, so nobody asked for it and there is no requester to query.
 */
export function PayoutOriginBadge({ origin }: { origin: string | null | undefined }) {
    const label = humaniseEnum(origin);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant="outline" className="font-normal">
            {PAYOUT_ORIGIN_LABELS[origin as string] ?? label}
        </Badge>
    );
}
