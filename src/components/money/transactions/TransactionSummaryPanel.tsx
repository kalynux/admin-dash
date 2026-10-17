import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { TransactionDirectionBadge } from '@/components/money/transactions/TransactionCells';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatMoney } from '@/lib/format';
import { getTransactionSummary, transactionSummaryPath } from '@/services/transactions.service';
import {
    transactionKindLabel,
    transactionOutcomeLabel,
    type TransactionFilters,
} from '@/types/transactions.types';

/**
 * `GET /money/transactions/summary` — how many rows the current filters match,
 * and what they add up to, **cell by cell**.
 *
 * The list is cursor-paged and reports no total, so this is the only count there
 * is. It is asked once per set of filters, not once per page.
 *
 * ⛔ **Nothing is added up here.** Each line is one cell the service computed —
 * a type, a direction, a status and a currency — printed as sent. No grand
 * total, no "in minus out": that figure is not revenue (a refund is its own row,
 * a refund's amount is the gross, and cash arriving is a debt being settled), a
 * hold and its release are the same money twice, and two currencies do not add.
 */
export function TransactionSummaryPanel({ filters }: { filters: TransactionFilters }) {
    const [open, setOpen] = useState(false);

    const path = transactionSummaryPath(filters);
    const summary = useAsyncData(path, (signal) => getTransactionSummary(filters, { signal }));

    if (summary.error && !summary.data) {
        return (
            <p className="text-muted-foreground text-sm">
                The count for these filters could not be read.{' '}
                <button type="button" className="underline" onClick={summary.reload}>
                    Try again
                </button>
            </p>
        );
    }

    if (!summary.data) {
        return <p className="text-muted-foreground text-sm">Counting…</p>;
    }

    const { count, groups } = summary.data;

    return (
        <div className={summary.isRefreshing ? 'space-y-2 opacity-60' : 'space-y-2'}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(count)} {count === 1 ? 'transaction' : 'transactions'}
                </p>

                {groups.length > 0 ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground h-7 gap-1 px-2"
                        aria-expanded={open}
                        aria-controls="transaction-totals"
                        onClick={() => setOpen((current) => !current)}
                    >
                        {open ? (
                            <ChevronDown className="size-4" />
                        ) : (
                            <ChevronRight className="size-4" />
                        )}
                        Totals by type
                    </Button>
                ) : null}
            </div>

            {open && groups.length > 0 ? (
                <div id="transaction-totals" className="rounded-lg border">
                    <Table>
                        <caption className="sr-only">Totals for these filters, by type</caption>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="px-3">Type</TableHead>
                                <TableHead className="px-3">Direction</TableHead>
                                <TableHead className="px-3">Status</TableHead>
                                <TableHead className="px-3 text-right">Count</TableHead>
                                <TableHead className="px-3 text-right">
                                    <span className="inline-flex items-center gap-1">
                                        Amount
                                        <InfoHint label="About these totals">
                                            Each line is counted by the platform, for the filters
                                            above. They are not added together on purpose: money in
                                            minus money out is not what the platform earned, an
                                            earnings movement and its release are the same money
                                            twice, and different currencies do not add. A
                                            refund&rsquo;s amount is the full amount, before any fee
                                            kept.
                                        </InfoHint>
                                    </span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groups.map((group) => (
                                <TableRow
                                    key={`${group.kind}|${group.direction}|${group.outcome}|${group.currency ?? ''}`}
                                >
                                    <TableCell className="px-3 py-2 text-sm">
                                        {transactionKindLabel(group.kind)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                        <TransactionDirectionBadge direction={group.direction} />
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-sm">
                                        {transactionOutcomeLabel(group.outcome)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                                        {formatCount(group.count)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                                        {/* `currency: null` on ledger cells — printed bare, never as XAF. */}
                                        {formatMoney(group.amount, group.currency)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ) : null}
        </div>
    );
}
