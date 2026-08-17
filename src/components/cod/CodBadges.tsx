import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';

/**
 * Badges for the cash-on-delivery surfaces.
 *
 * Every vocabulary here is the platform's and **unpinned on this side**, so each
 * badge picks its variant by lookup with a neutral default and renders the raw
 * value. A closed `switch` would break on a routine deploy — `deposit_not_confirmed`
 * arrived on the discrepancy type after the two-sided deposit flow shipped, and
 * nothing suggests it is the last addition.
 */

/** `declared` · `confirmed` · `rejected` — shared by remittances and deposits. */
const SETTLEMENT_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    declared: 'secondary',
    confirmed: 'default',
    rejected: 'destructive',
};

export function CodSettlementStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={SETTLEMENT_VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}

const DISCREPANCY_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    open: 'destructive',
    resolved: 'default',
    written_off: 'secondary',
};

export function DiscrepancyStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant={DISCREPANCY_VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}

/**
 * Where an agent handed the cash.
 *
 * **This is not decoration.** `platform` means the deposit skipped the agency and
 * an administrator may resolve it; `agency` — the normal route — means the agency
 * resolves it and this dashboard cannot, whatever permissions the caller holds.
 * So the badge is emphasised rather than muted.
 */
export function DepositRecipientBadge({ recipient }: { recipient: string | null | undefined }) {
    // Neither branch is a safe default for an absent value: each asserts who the
    // cash went to, and that is exactly what decides whether an action exists.
    if (recipient === 'platform') return <Badge variant="default">Paid to the platform</Badge>;
    if (recipient === 'agency') return <Badge variant="secondary">Paid to the agency</Badge>;
    return <NotSet>Recipient not recorded</NotSet>;
}

/**
 * Who raised a discrepancy.
 *
 * `agent` is worth distinguishing: **that is how an agent disputes**, and a
 * dispute deserves reading differently from a system-detected break.
 */
export function RaisedByBadge({ raisedBy }: { raisedBy: string | null | undefined }) {
    const label = humaniseEnum(raisedBy);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge
            variant={raisedBy === 'agent' ? 'outline' : 'secondary'}
            className="font-normal capitalize"
        >
            {raisedBy === 'system' ? 'Detected automatically' : `Raised by the ${label}`}
        </Badge>
    );
}

/**
 * An agent's trust score against its ceiling.
 *
 * The score is `0…100` and bounds how much cash one person may carry. It is shown
 * plainly rather than as a bar: the number is what the platform acts on, and a
 * proportion would invite reading it as a percentage of the ceiling, which it is
 * not.
 */
export function TrustScoreBadge({ score }: { score: number }) {
    const variant = score >= 80 ? 'outline' : score >= 50 ? 'secondary' : 'destructive';

    return (
        <Badge variant={variant} className="tabular-nums">
            {score} / 100
        </Badge>
    );
}
