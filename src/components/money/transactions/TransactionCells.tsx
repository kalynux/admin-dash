import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import {
    transactionDirectionLabel,
    transactionOutcomeLabel,
    transactionPartyScreen,
    transactionRoleLabel,
    type TransactionParty,
    type TransactionRow,
} from '@/types/transactions.types';

/*
 * The cells the Transactions list, the related-transactions table and the detail
 * page all draw, so a row reads the same wherever it appears.
 */

/**
 * Which way the money went, **from the platform's side**.
 *
 * An icon and a word, never colour alone. `internal` is muted: nothing entered
 * or left, so it must not read as either.
 */
export function TransactionDirectionBadge({ direction }: { direction: string }) {
    const Icon =
        direction === 'in' ? ArrowDownLeft : direction === 'out' ? ArrowUpRight : ArrowLeftRight;

    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1 font-normal whitespace-nowrap',
                direction === 'in' && 'text-success',
                direction === 'internal' && 'text-muted-foreground',
            )}
        >
            <Icon className="size-3" aria-hidden />
            {transactionDirectionLabel(direction)}
        </Badge>
    );
}

const OUTCOME_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    succeeded: 'default',
    pending: 'secondary',
    failed: 'destructive',
    reversed: 'outline',
    unknown: 'outline',
};

/**
 * The one word that means the same across every kind, with the source's own
 * status beneath it — `SUCCEEDED`, `paid`, `confirmed` and `completed` are four
 * spellings of one outcome, and the raw word is what the record's own screen and
 * the provider's dashboard will say.
 */
export function TransactionStatusCell({
    row,
}: {
    row: Pick<TransactionRow, 'outcome' | 'status'>;
}) {
    return (
        <div className="space-y-1">
            <Badge variant={OUTCOME_VARIANTS[row.outcome] ?? 'outline'}>
                {transactionOutcomeLabel(row.outcome)}
            </Badge>
            <p className="text-muted-foreground font-mono text-xs">{row.status}</p>
        </div>
    );
}

/**
 * The magnitude with the direction's sign. `internal` gets no sign and a muted
 * figure: neither `+` nor `−` is true of money that did not cross the platform's
 * edge.
 *
 * ⚠ `currency` can be `null` (a ledger entry whose account could not be read) —
 * `formatMoney` prints the bare number then, and never assumes XAF.
 */
export function TransactionAmount({
    row,
    className,
}: {
    row: Pick<TransactionRow, 'amount' | 'currency' | 'direction'>;
    className?: string;
}) {
    const sign = row.direction === 'in' ? '+' : row.direction === 'out' ? '−' : '';

    return (
        <span
            className={cn(
                'font-medium tabular-nums',
                row.direction === 'in' && 'text-success',
                row.direction === 'internal' && 'text-muted-foreground font-normal',
                className,
            )}
        >
            {sign}
            {formatMoney(row.amount, row.currency)}
        </span>
    );
}

/**
 * Who paid or was paid: the name over the role.
 *
 * The name links to the party's own screen for a vendor, an agency or an agent.
 * ⛔ A customer links nowhere — see `transactionPartyScreen`. `showId` adds the
 * copyable id, for the detail page; the list leaves it out to stay scannable.
 */
export function TransactionPartyCell({
    party,
    showId = false,
}: {
    party: TransactionParty;
    showId?: boolean;
}) {
    const can = useCan();
    const screen = transactionPartyScreen(party);
    const to = screen && can(screen.permission) ? screen.path : undefined;
    const isPlatform = party.role === 'platform' || party.role === 'platform_ai';

    return (
        <div className="min-w-0 space-y-0.5">
            {party.name ? (
                <CopyableValue variant="plain" value={party.name} label="name" to={to} />
            ) : isPlatform ? (
                <p className="text-sm">The platform</p>
            ) : (
                <NotSet>Name not found</NotSet>
            )}
            <p className="text-muted-foreground text-xs">{transactionRoleLabel(party.role)}</p>
            {showId && party.id ? (
                <CopyableValue
                    value={party.id}
                    label={`${transactionRoleLabel(party.role).toLowerCase()} ID`}
                    truncate={false}
                    to={party.name ? undefined : to}
                />
            ) : null}
        </div>
    );
}

/**
 * Aggregator, what was paid with, and how it travelled.
 *
 * All three are jovi-mall's open strings, rendered as sent. `null` on all three
 * is ordinary — cash and ledger rows have no provider at all.
 */
export function TransactionProviderCell({
    row,
}: {
    row: Pick<TransactionRow, 'gateway' | 'provider' | 'method'>;
}) {
    if (!row.gateway && !row.provider && !row.method) {
        return <span className="text-muted-foreground text-xs">—</span>;
    }

    return (
        <div className="space-y-0.5">
            <p className="text-sm">{row.provider ?? row.gateway ?? row.method}</p>
            <p className="text-muted-foreground text-xs">
                {[row.provider ? row.gateway : null, row.provider || row.gateway ? row.method : null]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
        </div>
    );
}
