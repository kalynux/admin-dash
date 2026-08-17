import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { COD_EMBEDDED_LIMIT, type CodCashMovement } from '@/types/cod.types';

/**
 * The cash-ledger rows a remittance or deposit produced.
 *
 * ── Shared, because these two really are one thing ────────────────────────────
 * Both details embed the same `CodCashMovement[]` from the same mapper. The only
 * difference is how many owners are involved, which is a prop.
 *
 * ── It is **not** `AccountCashLedgerPanel`, and must not become it ────────────
 * That one pages a real endpoint whose rows nest `ref: { type, id }` and take
 * their owner from the path. These are an embedded, capped array with a **flat**
 * `refType`/`refId` and an explicit owner. Same underlying collection, two
 * mappers — and unifying them would force a renderer to branch on the shape of a
 * value rather than on which endpoint it came from.
 *
 * ── Two things the copy has to carry ──────────────────────────────────────────
 * These are **oldest first**, unlike every other feed in this application, and
 * they are **capped at ten with no way to page**. Both are stated rather than
 * left to be discovered.
 */
export function CashMovementsPanel({
    movements,
    currency,
    timeZone,
    /** A deposit's two rows span two owners; a remittance's one does not. */
    showOwner = false,
    /** What an empty list means on *this* record — it differs by status. */
    emptyDescription,
}: {
    movements: CodCashMovement[];
    currency: string | null;
    timeZone: string;
    showOwner?: boolean;
    emptyDescription: string;
}) {
    const columns: Column<CodCashMovement>[] = [
        {
            id: 'createdAt',
            header: 'When',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
        {
            id: 'entryType',
            header: 'Entry',
            className: 'align-top',
            cell: (row) => (
                <Badge variant="outline" className="capitalize">
                    {humaniseEnum(row.entryType) ?? '—'}
                </Badge>
            ),
        },
    ];

    if (showOwner) {
        columns.push({
            id: 'owner',
            header: 'Whose liability',
            className: 'align-top text-sm capitalize',
            cell: (row) => row.ownerType,
        });
    }

    columns.push(
        {
            id: 'amount',
            numeric: true,
            header: 'Change',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p
                        className={cn(
                            'font-medium tabular-nums',
                            row.amount < 0 && 'text-success',
                        )}
                    >
                        {row.amount > 0 ? '+' : row.amount < 0 ? '−' : ''}
                        {formatMoney(Math.abs(row.amount), currency)}
                    </p>
                    {/*
                      Named in words. On a liability a positive number is worse
                      rather than better, which no colour conveys on its own.
                    */}
                    <p className="text-muted-foreground text-xs">
                        {row.amount > 0
                            ? 'Raises what they owe'
                            : row.amount < 0
                              ? 'Discharges what they owe'
                              : 'No change'}
                    </p>
                </div>
            ),
        },
        {
            id: 'balanceAfter',
            numeric: true,
            header: 'Owed after',
            className: 'align-top font-medium tabular-nums',
            cell: (row) => formatMoney(row.balanceAfter, currency),
        },
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Cash movements
                    <InfoHint label="About cash movements">
                        What this record actually moved on the cash ledger.{' '}
                        <strong>Oldest first</strong>, unlike every other feed here, because these
                        are the steps of one settlement in the order they happened — and capped at{' '}
                        {COD_EMBEDDED_LIMIT}. The amounts carry no currency of their own; they
                        inherit the record&rsquo;s.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <DataTable
                    caption="Cash-ledger movements produced by this record"
                    columns={columns}
                    rows={movements}
                    rowKey={(row) => row.id}
                    isLoading={false}
                    empty={<EmptyState title="Nothing has moved" description={emptyDescription} />}
                />

                {movements.length >= COD_EMBEDDED_LIMIT ? (
                    <p className="text-muted-foreground text-xs">
                        Showing the first {formatCount(COD_EMBEDDED_LIMIT)} movements. There may be
                        more.
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}
