import { Link } from 'react-router-dom';

import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { TierBadge } from '@/components/layout/TierBadge';
import { Badge } from '@/components/ui/badge';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import type { Ticket } from '@/types/support.types';

/**
 * The queue row.
 *
 * ── Two fields that read like each other and are not ──────────────────────────
 * `assignedTo` is **the platform actor the ticket was routed to** — a vendor, an
 * agency, an agent. `assignment` is **the administrator handling it**. Rendering
 * one under a heading meant for the other is the mistake this surface most
 * invites, so they get two columns with two headings.
 *
 * ── `assignment: null` is the unassigned pool ─────────────────────────────────
 * A real, common and actionable state — every system ticket starts there and
 * every tier may work it — so it renders as a claimable state rather than as
 * missing data.
 *
 * ── The tier is shown, deliberately ───────────────────────────────────────────
 * `tier` travels on this surface and is dropped from every projection a
 * customer, vendor, agency or agent sees. It is what the queue is grouped and
 * filtered by, and hiding it would hide the thing the scope rules are about.
 */
export function ticketColumns({ timeZone }: { timeZone: string }): Column<Ticket>[] {
    return [
        {
            id: 'subject',
            header: 'Ticket',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    <Link
                        to={`/dashboard/support/tickets/${row.id}`}
                        className="text-sm font-medium hover:underline"
                    >
                        {row.subject}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                        {/* jovi-mall's vocabulary — render raw, never switch on it. */}
                        {humaniseEnum(row.type) ?? row.type}
                        {row.entity?.type ? ` · ${humaniseEnum(row.entity.type)}` : ''}
                        {row.trackingNumber ? ` · ${row.trackingNumber}` : ''}
                    </p>
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Status',
            sortKey: 'status',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    <Badge variant="outline">{humaniseEnum(row.status) ?? row.status}</Badge>
                    {row.terminalAt ? (
                        <p className="text-muted-foreground text-xs">
                            Closed {formatInstantInZone(row.terminalAt, timeZone)}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'priority',
            header: 'Priority',
            sortKey: 'priority',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    <Badge variant="outline">{humaniseEnum(row.priority) ?? row.priority}</Badge>
                    {row.priorityLocked ? (
                        /*
                          Once an administrator sets a priority the requester can
                          no longer change it. Worth marking, because it is the
                          one edit on this surface that is one-way in effect.
                        */
                        <p className="text-muted-foreground text-xs">locked</p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'assignment',
            header: 'Held by',
            className: 'align-top text-sm',
            cell: (row) =>
                row.assignment ? (
                    <div className="space-y-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                            {/* No avatar exists on this service — initials from `name`. */}
                            {row.assignment.admin.name ?? row.assignment.admin.id}
                            <TierBadge tier={row.assignment.admin.tier as 1 | 2 | 3} />
                        </span>
                        <p className="text-muted-foreground text-xs">
                            {row.assignment.assignedBy
                                ? `by ${row.assignment.assignedBy.name ?? 'an administrator'}`
                                : /* No `assignedBy` means it was CLAIMED, and the
                                     absence is meaningful — the tier-2 rule reads
                                     `assignedBy.tier` to decide where it may go next. */
                                  'claimed'}
                        </p>
                    </div>
                ) : (
                    <Badge variant="secondary">Unassigned</Badge>
                ),
        },
        {
            id: 'assignedTo',
            header: 'Raised for',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) =>
                row.assignedTo ? (
                    <span className="capitalize">{row.assignedTo.role}</span>
                ) : (
                    <NotSet />
                ),
        },
        {
            id: 'createdAt',
            header: 'Opened',
            sortKey: 'createdAt',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone),
        },
    ];
}
