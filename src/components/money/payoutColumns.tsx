import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { DestinationSummary } from '@/components/money/DestinationSummary';
import {
    PayoutOriginBadge,
    PayoutStatusBadge,
    PayoutTriageBadge,
    PayoutVerificationBadge,
} from '@/components/money/PayoutBadges';
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
        /*
          ⚠ **Its own column, and NOT folded into `ownerCell`** — BR-026 § 1.

          Two reasons, and the second is the one that would have bitten. It reads
          beside the owner because "who am I paying" and "has anybody checked
          them" are one question for a reviewer; but `ownerCell` is skipped
          entirely when `showOwner` is false, and the account page is exactly
          where a *verified* vendor's whole payout history would otherwise have
          rendered with no verdict at all. The backend made the same observation
          about its own mapper: leaving the field unhydrated there "would not have
          looked like a bug".

          ⚠ **No `sortKey`, and that is a refusal rather than an omission.** The
          verdict lives in `vendors`/`delivery_agencies`/`delivery_agents` while
          the queue pages over `payout_requests`, so a server-side sort or filter
          means a three-way `$lookup` that would widen the one narrow projection
          that keeps the payout number off this path. A header offering a sort the
          endpoint answers with a `400` is worse than no header, so this carries
          none — see the client-side filter on the queue instead.
        */
        {
            id: 'verification',
            header: 'Owner vetted',
            className: 'align-top',
            cell: (payout) => <PayoutVerificationBadge verification={payout.verification} />,
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (payout) => (
                <div className="space-y-1">
                    <span className="flex flex-wrap items-center gap-1">
                        <PayoutStatusBadge status={payout.status} />
                        {/*
                          Beside the status, never instead of it: an endorsed
                          payout is still `pending` — endorsement is a field, not
                          a state (ADR-024 D-6). Renders nothing when nobody has
                          reviewed it, because an un-endorsed request is an
                          ordinary one rather than an incomplete one.
                        */}
                        <PayoutTriageBadge triage={payout.triage} />
                    </span>

                    {/*
                      ⚠ **The failure reason, and it is not a rejection reason.**
                      `failed` means the gateway refused the transfer and **the
                      funds are still held** — the row is still open work. Shown
                      in the same slot as `rejectionReason` because only one of
                      the two can ever be the current story, and a `failed` row
                      with no sentence beside it reads like a closed one.
                    */}
                    {payout.status === 'failed' && payout.transferFailureReason ? (
                        <p className="text-muted-foreground max-w-[22ch] truncate text-xs">
                            {payout.transferFailureReason}
                        </p>
                    ) : payout.rejectionReason ? (
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
