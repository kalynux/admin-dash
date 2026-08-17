import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { DestinationSummary } from '@/components/money/DestinationSummary';
import { PayoutOriginBadge, PayoutStatusBadge } from '@/components/money/PayoutBadges';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import type { CanPredicate } from '@/store';
import type { Payout } from '@/types/money.types';

/**
 * The payout row, defined once and shared by the queue and an account's Payouts
 * tab.
 *
 * `GET /money/payouts` and `GET /accounts/:ownerType/:ownerId/payouts` are the
 * same rows through the same repository and the same masked projection, so two
 * column definitions would be two places for one to drift. The only difference is
 * whether the owner is worth a column — on an account it is already the subject
 * of the page — so that is the parameter.
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * `createdAt`, `amount` and `resolvedAt`, matching the endpoint's allowlist
 * exactly. Anything else is a `400` naming the permitted set, so a header that
 * cannot sort carries no `sortKey` rather than a control that fails.
 */
export function payoutColumns({
    timeZone,
    can,
    showOwner = true,
    rowAction,
}: {
    timeZone: string;
    can: CanPredicate;
    /** The account view already names the owner in its header. */
    showOwner?: boolean;
    /** A trailing actions cell. Omitted means no column at all — see below. */
    rowAction?: (payout: Payout) => ReactNode;
}): Column<Payout>[] {
    const columns: Column<Payout>[] = [
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            sortKey: 'amount',
            className: 'align-top',
            cell: (payout) => (
                <div className="min-w-0 space-y-1">
                    <Link
                        to={`/dashboard/money/payouts/${payout.id}`}
                        className="font-medium tabular-nums hover:underline"
                    >
                        {formatMoney(payout.amount, payout.currency)}
                    </Link>
                    <div>
                        <PayoutOriginBadge origin={payout.origin} />
                    </div>
                </div>
            ),
        },
    ];

    if (showOwner) {
        columns.push({
            id: 'owner',
            header: 'Owner',
            className: 'align-top',
            cell: (payout) => ownerCell(payout, can),
        });
    }

    columns.push(
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (payout) => (
                <div className="space-y-1">
                    <PayoutStatusBadge status={payout.status} />
                    {payout.rejectionReason ? (
                        <p className="text-muted-foreground max-w-[22ch] truncate text-xs">
                            {payout.rejectionReason}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'destination',
            header: 'Destination',
            className: 'align-top text-sm',
            cell: (payout) => <DestinationSummary destination={payout.destination} />,
        },
        {
            id: 'createdAt',
            header: 'Requested',
            sortKey: 'createdAt',
            className: 'text-muted-foreground align-top text-sm',
            // Nullable despite the doc example — `toIso` returns null for an
            // absent date, and this is the default sort key.
            cell: (payout) => formatInstantInZone(payout.createdAt, timeZone) ?? '—',
        },
        {
            id: 'resolvedAt',
            header: 'Resolved',
            sortKey: 'resolvedAt',
            className: 'text-muted-foreground align-top text-sm',
            cell: (payout) =>
                payout.resolvedAt ? (
                    formatInstantInZone(payout.resolvedAt, timeZone)
                ) : (
                    /* Not "unknown": nobody has resolved it. */
                    <NotSet>Not resolved</NotSet>
                ),
        },
    );

    // Opt-in, so the account view's embedded payout table stays read-only and
    // does not grow an empty `Actions` header it never fills.
    if (rowAction) {
        columns.push({ id: 'actions', header: '', className: 'align-top', cell: rowAction });
    }

    return columns;
}

/**
 * The beneficiary, linked into its own directory where that is reachable.
 *
 * `money.payouts.read` does not imply `vendors.read`, so the name renders either
 * way and only the link is conditional — the same rule the order columns follow.
 *
 * A plain cell renderer rather than a component: this file's export is a column
 * builder, and a capitalised sibling would make it neither a component module nor
 * a plain one.
 */
function ownerCell(payout: Payout, can: CanPredicate) {
    const { type, id, name } = payout.owner;
    const label = name ?? id ?? 'Unknown owner';

    const directory =
        type === 'vendor'
            ? can('vendors.read') && id
                ? `/dashboard/vendors/${id}`
                : null
            : type === 'agency'
              ? can('agencies.read') && id
                  ? `/dashboard/agencies/${id}`
                  : null
              : type === 'agent'
                ? can('agents.read') && id
                    ? `/dashboard/agents/${id}`
                    : null
                : null;

    return (
        <div className="min-w-0 space-y-0.5">
            {directory ? (
                <Link to={directory} className="font-medium hover:underline">
                    {label}
                </Link>
            ) : (
                <span className="font-medium">{label}</span>
            )}
            <p className="text-muted-foreground text-xs capitalize">{type}</p>
        </div>
    );
}
