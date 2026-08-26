import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { formatInstantInZone, formatRelative, humaniseEnum } from '@/lib/format';
import { isPlatformActor } from '@/types/actor.types';
import type { Subscription } from '@/types/billing.types';
import type { CanPredicate } from '@/store';

/**
 * The subscription row, shared by the cross-owner list and a plan's own
 * subscriber tab.
 *
 * The only difference between the two is whether the plan is worth a column — on
 * a plan's subscribers it is the subject of the page — so that is the parameter.
 */
export function subscriptionColumns({
    timeZone,
    can,
    showPlan = true,
    rowAction,
    detailLink = false,
}: {
    timeZone: string;
    can: CanPredicate;
    showPlan?: boolean;
    /** A trailing actions cell. Omitted means no column at all. */
    rowAction?: (row: Subscription) => ReactNode;
    /**
     * Offer a link to `GET /billing/subscriptions/:subscriptionId`.
     *
     * Opt-in rather than always-on because the single-term read exists for a
     * specific job — linking a colleague to one term, and giving a
     * `paymentReference` quoted in a ticket somewhere to point — and a row that
     * already shows everything but the reference does not need it.
     */
    detailLink?: boolean;
}): Column<Subscription>[] {
    const columns: Column<Subscription>[] = [
        {
            id: 'owner',
            header: 'Owner',
            className: 'align-top',
            cell: (row) => ownerCell(row, can),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => (
                <Badge variant={row.status === 'active' ? 'default' : 'outline'}>
                    {humaniseEnum(row.status) ?? '—'}
                </Badge>
            ),
        },
    ];

    if (showPlan) {
        columns.push({
            id: 'plan',
            header: 'Plan',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    <Link
                        to={`/dashboard/billing/${row.plan.id}`}
                        className="text-sm font-medium hover:underline"
                    >
                        {/*
                          `name` is null when the plan lookup found nothing — a
                          dangling reference. `code` is denormalised on the
                          subscription row, so it answers even then.
                        */}
                        {row.plan.name ?? row.plan.code ?? 'Unknown plan'}
                    </Link>
                    {row.plan.name === null && row.plan.code ? (
                        <p className="text-muted-foreground text-xs">
                            The tier itself is missing — only its code survives on this term.
                        </p>
                    ) : null}
                </div>
            ),
        });
    }

    columns.push(
        {
            id: 'startedAt',
            header: 'Started',
            sortKey: 'startedAt',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) =>
                formatInstantInZone(row.startedAt, timeZone) ?? (
                    /* null while pending_activation — queued, not started. */
                    <NotSet>Not started</NotSet>
                ),
        },
        {
            id: 'expiresAt',
            header: 'Expires',
            sortKey: 'expiresAt',
            className: 'align-top text-sm',
            cell: (row) => expiryCell(row, timeZone),
        },
        {
            id: 'assignedBy',
            header: 'Assigned by',
            className: 'align-top text-sm',
            cell: (row) =>
                row.assignedBy ? (
                    <span>
                        {row.assignedBy.name ?? 'Not recorded'}
                        {!isPlatformActor(row.assignedBy) ? (
                            <span className="text-muted-foreground"> · administrator</span>
                        ) : null}
                    </span>
                ) : (
                    /* Nobody did: a self-service purchase, or the lazy free default. */
                    <NotSet>Not assigned</NotSet>
                ),
        },
    );

    if (rowAction || detailLink) {
        columns.push({
            id: 'actions',
            header: '',
            className: 'align-top',
            cell: (row) => (
                <div className="flex items-center justify-end gap-2">
                    {detailLink ? (
                        <Link
                            to={`/dashboard/billing/subscriptions/${row.id}`}
                            className="text-sm font-medium hover:underline"
                        >
                            View term
                        </Link>
                    ) : null}
                    {rowAction?.(row)}
                </div>
            ),
        });
    }

    return columns;
}

function ownerCell(row: Subscription, can: CanPredicate) {
    const { type, id, name } = row.owner;

    const directory =
        type === 'vendor' && can('vendors.read')
            ? `/dashboard/vendors/${id}`
            : type === 'agency' && can('agencies.read')
              ? `/dashboard/agencies/${id}`
              : type === 'agent' && can('agents.read')
                ? `/dashboard/agents/${id}`
                : null;

    // `name` is null, never "" — an owner with no business name on record.
    const label = name ?? id;

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

/**
 * When the term ends.
 *
 * **`null` is the never-expiring free tier**, not "unknown" — which is also why
 * the `expiringBefore` filter never matches one.
 */
function expiryCell(row: Subscription, timeZone: string) {
    if (row.expiresAt === null) {
        return <span className="text-muted-foreground">Never expires</span>;
    }

    const absolute = formatInstantInZone(row.expiresAt, timeZone);
    const relative = formatRelative(row.expiresAt);

    return (
        <div className="space-y-0.5">
            <p>{absolute}</p>
            {relative ? <p className="text-muted-foreground text-xs">{relative}</p> : null}
        </div>
    );
}
