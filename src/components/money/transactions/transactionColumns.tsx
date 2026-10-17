import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import type { Column } from '@/components/common/DataTable';
import {
    TransactionAmount,
    TransactionDirectionBadge,
    TransactionPartyCell,
    TransactionProviderCell,
    TransactionStatusCell,
} from '@/components/money/transactions/TransactionCells';
import { formatInstantInZone } from '@/lib/format';
import {
    transactionKindLabel,
    transactionPath,
    transactionReasonLabel,
    type TransactionRow,
} from '@/types/transactions.types';

/**
 * The Transactions table's columns — shared by the list and by the detail
 * page's related-transactions table, so a row reads the same in both.
 *
 * `sortable` puts the two wire sort keys on their headers. The related table
 * passes `false`: it is a fixed, oldest-first set the service already ordered.
 */
export function transactionColumns(
    timeZone: string,
    { sortable }: { sortable: boolean },
): Column<TransactionRow>[] {
    return [
        {
            id: 'createdAt',
            header: 'Date',
            sortKey: sortable ? 'createdAt' : undefined,
            className: 'text-muted-foreground align-top text-sm whitespace-nowrap',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
        {
            id: 'kind',
            header: 'Transaction',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    {/* The link is the cell, not the row — see `DataTable`. */}
                    <Link
                        to={transactionPath(row)}
                        className="text-sm font-medium whitespace-nowrap hover:underline"
                    >
                        {transactionKindLabel(row.kind)}
                    </Link>
                    <div>
                        <TransactionDirectionBadge direction={row.direction} />
                    </div>
                </div>
            ),
        },
        {
            id: 'party',
            header: 'Who',
            className: 'align-top',
            cell: (row) => <TransactionPartyCell party={row.party} />,
        },
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            sortKey: sortable ? 'amount' : undefined,
            className: 'align-top whitespace-nowrap',
            cell: (row) => <TransactionAmount row={row} />,
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => <TransactionStatusCell row={row} />,
        },
        {
            id: 'provider',
            header: 'Provider',
            className: 'align-top',
            cell: (row) => <TransactionProviderCell row={row} />,
        },
        {
            id: 'reason',
            header: 'Reason',
            className: 'align-top text-sm',
            cell: (row) => (
                <div className="max-w-[260px] space-y-0.5">
                    <p>{transactionReasonLabel(row.reason.code)}</p>
                    {row.reason.text ? (
                        <p className="text-muted-foreground text-xs break-words">
                            {row.reason.text}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'reference',
            header: 'Reference',
            className: 'align-top',
            cell: (row) =>
                row.reference ? (
                    // `plain`: matched character for character against a provider's report.
                    <CopyableValue variant="plain" mono value={row.reference} label="reference" />
                ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                ),
        },
    ];
}
