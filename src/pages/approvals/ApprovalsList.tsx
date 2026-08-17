import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, RotateCw } from 'lucide-react';

import {
    ApproveApprovalDialog,
    RejectApprovalDialog,
} from '@/components/approvals/ApprovalDecisionDialogs';
import { ApprovalStatusBadge } from '@/components/approvals/ApprovalStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { approvalAffordances } from '@/lib/approval-actions';
import { formatCount, formatRelative } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listApprovals } from '@/services/approvals.service';
import { useAdmin, usePermissions } from '@/store';
import type { Approval, ApprovalListQuery } from '@/types/approvals.types';

/**
 * The four-eyes queue — actions one administrator requested and a **different**
 * one must commit.
 *
 * ── Seeing the queue is not being able to act on it ───────────────────────────
 * `approvals.read` gets you this list and says nothing about any row in it.
 * There is deliberately no `approvals.approve`: the approver must hold the
 * permission the *pending action* itself names, so the actionable column is
 * computed per row from the caller's held set. A single "may approve things"
 * grant would let someone commit an action they could not have performed
 * themselves, which turns four eyes into an escalation path.
 *
 * ── No sort, and `status` is sent explicitly ──────────────────────────────────
 * The queue is newest first and offers no `sort`. `status` defaults to `pending`
 * server-side, but this screen sends it anyway so the request says what it means
 * and a later change to that default cannot silently repoint the screen at every
 * approval ever made.
 */

const FILTER_KEYS = ['status', 'action', 'targetId'] as const;

/** Pending is the queue people mean when they say "the queue". */
const FILTER_DEFAULTS = { status: 'pending' } as const;

const STATUSES = ['pending', 'approved', 'rejected', 'expired', 'withdrawn'] as const;

const ANY = 'any';

/**
 * Nothing is offered until the permission set has actually loaded.
 *
 * `held` is `null` while `PermissionsProvider` is still resolving, and an
 * affordance drawn from an unknown set would be a guess. Failing closed for the
 * few frames before it arrives costs nothing.
 */
const NOTHING_HELD: ReadonlySet<string> = new Set();

export function ApprovalsList() {
    const admin = useAdmin();
    const { held } = usePermissions();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const query = useMemo<ApprovalListQuery>(
        () => ({
            status: values.status || undefined,
            action: values.action || undefined,
            targetId: values.targetId || undefined,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [values, page],
    );

    const path = withQuery('/approvals', { ...query });
    const approvals = useAsyncData(path, (signal) => listApprovals(query, { signal }));

    /**
     * The row a dialog is open for, and which one.
     *
     * One piece of state rather than two booleans and an id: the two dialogs are
     * mutually exclusive, and a shape that cannot represent "approve and reject
     * are both open for different rows" is better than one that can.
     */
    const [deciding, setDeciding] = useState<{
        approval: Approval;
        kind: 'approve' | 'reject';
    } | null>(null);

    const rows = approvals.data?.data ?? [];
    const meta = approvals.data?.meta;

    const columns = useMemo<Column<Approval>[]>(
        () => [
            {
                id: 'description',
                header: 'Request',
                cell: (row) => (
                    <div className="min-w-0">
                        {/*
                          `description` is written for the approver and is the
                          only field that explains a row without a lookup table.
                          Rendered verbatim.
                        */}
                        <Link
                            to={`/dashboard/approvals/${row.id}`}
                            className="font-medium hover:underline"
                        >
                            {row.description}
                        </Link>
                        <p className="text-muted-foreground truncate font-mono text-xs">
                            {row.action}
                        </p>
                    </div>
                ),
            },
            {
                id: 'requestedBy',
                header: 'Requested by',
                className: 'text-sm',
                cell: (row) => (
                    <div className="min-w-0">
                        <p>{row.requestedByTierLabel}</p>
                        <p className="text-muted-foreground truncate font-mono text-xs">
                            {row.requestedBy === admin.id ? 'You' : row.requestedBy}
                        </p>
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                cell: (row) => <ApprovalStatusBadge status={row.status} />,
            },
            {
                id: 'expiresAt',
                header: 'Expires',
                className: 'text-muted-foreground text-sm',
                cell: (row) => formatRelative(row.expiresAt) ?? '—',
            },
            {
                id: 'actions',
                header: '',
                /*
                  This column used to render the same verdict as two inert
                  badges — it told an operator they could approve, and then made
                  them open the row to do it. On a queue, acting *is* the job.

                  The verdict is unchanged: `approvalAffordances` is the same
                  function the detail screen asks, over the same held set, so the
                  two cannot disagree about what is offered. Only the affordance
                  is different.

                  Note there is no `approvals.approve` permission by design — an
                  approver must hold the permission the *pending action* names,
                  or four eyes becomes an escalation path. That is why this is
                  computed per row rather than gated with a single `<Can>`.
                */
                cell: (row) => {
                    const can = approvalAffordances(row, held ?? NOTHING_HELD, admin.id);

                    if (can.isOwnRequest && row.status === 'pending') {
                        return (
                            <span className="text-muted-foreground text-xs">
                                Your own request
                            </span>
                        );
                    }

                    if (!can.canApprove && !can.canReject) {
                        return <span className="text-muted-foreground text-xs">—</span>;
                    }

                    return (
                        <RowActions>
                            {can.canApprove ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeciding({ approval: row, kind: 'approve' })}
                                >
                                    Approve
                                </Button>
                            ) : null}
                            {can.canReject ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeciding({ approval: row, kind: 'reject' })}
                                >
                                    Reject
                                </Button>
                            ) : null}
                        </RowActions>
                    );
                },
            },
        ],
        [held, admin.id],
    );

    return (
        <PageContainer
            title="Approvals"
            description="Actions waiting for a second administrator. Newest first — this queue offers no other ordering."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={approvals.reload}
                    disabled={approvals.isLoading || approvals.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FilterBar>

            {meta && !approvals.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'request' : 'requests'}
                </p>
            ) : null}

            <DataTable
                caption="Approval queue"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={approvals.isLoading}
                isRefreshing={approvals.isRefreshing}
                error={approvals.error}
                onRetry={approvals.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={ClipboardCheck}
                        title={
                            values.status === 'pending'
                                ? 'Nothing is waiting for a second administrator'
                                : 'No requests match these filters'
                        }
                        description="Exactly four actions are queued rather than performed: promoting an administrator to Developer, suspending or reinstating a Developer, and marking a large payout as paid."
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={reset}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="requests"
                    isBusy={approvals.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {/*
              Mounted at page level, never inside the table.

              Both dialogs refetch rather than patching the row: an approval
              *performs* the pending action, so the outcome touches records this
              list does not hold, and the precondition is re-checked at approval
              time — the row may have moved underneath us, which is what
              `onStale` reports.
            */}
            {deciding?.kind === 'approve' ? (
                <ApproveApprovalDialog
                    approval={deciding.approval}
                    open
                    onOpenChange={(open) => !open && setDeciding(null)}
                    onDecided={() => {
                        setDeciding(null);
                        approvals.reload();
                    }}
                    onStale={() => {
                        setDeciding(null);
                        approvals.reload();
                    }}
                />
            ) : null}

            {deciding?.kind === 'reject' ? (
                <RejectApprovalDialog
                    approval={deciding.approval}
                    open
                    onOpenChange={(open) => !open && setDeciding(null)}
                    onDecided={() => {
                        setDeciding(null);
                        approvals.reload();
                    }}
                    onStale={() => {
                        setDeciding(null);
                        approvals.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
