import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    AllocationStatusBadge,
    LedgerEntryTypeBadge,
} from '@/components/money/MoneyBadges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getAllocation } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    MONEY_EMBEDDED_LIMIT,
    type EarningsAllocation,
    type EarningsAllocationDetail,
    type EarningsLedgerEntry,
} from '@/types/money.types';

/**
 * `GET /money/earnings/allocations/:allocationId` · `money.earnings.read`.
 *
 * The allocation, **what it actually moved**, and its siblings on the same sale.
 *
 * ── Two blocks that exist nowhere else ────────────────────────────────────────
 * `movements` is what the allocation *did*, as opposed to what it *says*. A
 * `held` allocation with no movements is a real and alarming state: money was
 * allocated and never entered anybody's balance. That gets a callout, not an
 * empty table.
 *
 * `siblings` is every allocation cut from the same sale, this one included — the
 * only place a split is visible as a whole. *Do the parts sum to the gross?* is a
 * question no other endpoint on this service can ask.
 *
 * Both are capped at 50, ascending and unpaged, so a full page may be truncation
 * and the screen says so.
 */
export function AllocationDetail() {
    const { allocationId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const allocation = useAsyncData(`/money/earnings/allocations/${allocationId}`, (signal) =>
        getAllocation(allocationId, { signal }),
    );

    if (allocation.isLoading) {
        return (
            <PageContainer title="Allocation">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!allocation.data) {
        return (
            <PageContainer title="Allocation">
                <div className="space-y-4">
                    <ErrorState
                        error={allocation.error}
                        onRetry={allocation.reload}
                        deniedTitle="No such allocation"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = allocation.data;

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Allocated to ${record.beneficiary.name ?? record.beneficiary.type}`}
        >
            <div className="space-y-4">
                <BackLink />

                <SplitCard allocation={record} timeZone={timeZone} />
                <ReleaseCard allocation={record} timeZone={timeZone} />
                <MovementsCard allocation={record} timeZone={timeZone} />
                <SiblingsCard allocation={record} timeZone={timeZone} />
            </div>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/allocations"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to allocations
        </Link>
    );
}

function SplitCard({
    allocation,
    timeZone,
}: {
    allocation: EarningsAllocationDetail;
    timeZone: string;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>The split</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Beneficiary">
                        <span className="flex flex-wrap items-center gap-2">
                            {/* `null` for the platform's own commission row. */}
                            {allocation.beneficiary.name ?? 'The platform'}
                            <span className="text-muted-foreground text-xs capitalize">
                                {allocation.beneficiary.type}
                            </span>
                        </span>
                    </Definition>

                    <Definition label="Status">
                        <AllocationStatusBadge status={allocation.status} />
                    </Definition>

                    <Definition label="Their share">
                        <span className="font-medium tabular-nums">
                            {formatMoney(allocation.amount, allocation.currency)}
                        </span>
                    </Definition>

                    <Definition
                        label="Cut from"
                        hint={
                            <InfoHint label="About the snapshots">
                                The split&rsquo;s inputs, frozen at the moment it ran. The share
                                alone says what this beneficiary got; with the gross and the rate
                                it says whether that was <em>right</em>.
                            </InfoHint>
                        }
                    >
                        <span className="tabular-nums">
                            {formatMoney(allocation.snapshots.gross, allocation.currency)} at{' '}
                            {allocation.snapshots.commissionPercent}%
                        </span>
                    </Definition>

                    <Definition label="Source">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="capitalize">
                                {humaniseEnum(allocation.source.type) ?? '—'}
                            </span>
                            {allocation.source.id ? (
                                <span className="text-muted-foreground font-mono text-xs break-all">
                                    {allocation.source.id}
                                </span>
                            ) : null}
                        </span>
                    </Definition>

                    <Definition label="Allocated">
                        {formatInstantInZone(allocation.createdAt, timeZone) ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/** The four timestamps and two cash fields that are the whole answer to "why not paid". */
function ReleaseCard({
    allocation,
    timeZone,
}: {
    allocation: EarningsAllocationDetail;
    timeZone: string;
}) {
    const { release } = allocation;
    const stuck = release.requiresCashSettlement && !release.cashSettledAt;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Release
                    <InfoHint label="About release">
                        Why this money has or has not reached the beneficiary. Nothing else on the
                        service carries these four timestamps — an allocation waits for its hold
                        window to elapse, and a cash-on-delivery one waits for the cash to
                        physically arrive as well.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {stuck ? (
                    <div className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
                        <p className="font-medium">The cash has not arrived.</p>
                        <p className="text-muted-foreground">
                            This sale was paid in cash on delivery, and the platform has not
                            physically received it — so the beneficiary cannot be paid however long
                            the hold window has run. This is what a stuck remittance looks like from
                            the earnings side.
                        </p>
                    </div>
                ) : null}

                <DefinitionList>
                    <Definition label="Sale completed">
                        {formatInstantInZone(release.completedAt, timeZone) ?? (
                            <NotSet>Not completed</NotSet>
                        )}
                    </Definition>

                    <Definition
                        label="Hold ends"
                        hint={
                            <InfoHint label="About the hold window">
                                The sale&rsquo;s completion plus the platform&rsquo;s hold period.
                                Empty means the sale never completed at all, rather than that the
                                window is unknown.
                            </InfoHint>
                        }
                    >
                        {formatInstantInZone(release.holdReleaseAt, timeZone) ?? (
                            <NotSet>The sale never completed</NotSet>
                        )}
                    </Definition>

                    <Definition label="Released">
                        {formatInstantInZone(release.releasedAt, timeZone) ?? (
                            <NotSet>Not released</NotSet>
                        )}
                    </Definition>

                    <Definition label="Reversed">
                        {formatInstantInZone(release.reversedAt, timeZone) ?? (
                            <NotSet>Not reversed</NotSet>
                        )}
                    </Definition>

                    <Definition label="Paid in cash">
                        {release.requiresCashSettlement ? 'Yes' : 'No'}
                    </Definition>

                    <Definition label="Cash received">
                        {release.requiresCashSettlement ? (
                            (formatInstantInZone(release.cashSettledAt, timeZone) ?? (
                                <Badge variant="destructive" className="font-normal">
                                    Not yet
                                </Badge>
                            ))
                        ) : (
                            <span className="text-muted-foreground italic">
                                Does not apply — this sale was not paid in cash
                            </span>
                        )}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function MovementsCard({
    allocation,
    timeZone,
}: {
    allocation: EarningsAllocationDetail;
    timeZone: string;
}) {
    const { movements, status } = allocation;

    /*
     * The alarming case this endpoint exists to expose: the allocation says money
     * was assigned, and the ledger says nothing ever moved.
     */
    const unmoved = movements.length === 0 && status === 'held';

    const columns: Column<EarningsLedgerEntry>[] = [
        {
            id: 'createdAt',
            header: 'When',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
        {
            id: 'entryType',
            header: 'Movement',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    <LedgerEntryTypeBadge entryType={row.entryType} />
                    <p className="text-muted-foreground font-mono text-xs">{row.reasonCode}</p>
                </div>
            ),
        },
        {
            id: 'owner',
            header: 'Whose balance',
            className: 'align-top text-sm',
            cell: (row) => (
                <span className="capitalize">{row.owner.name ?? row.owner.type}</span>
            ),
        },
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            className: 'align-top font-medium tabular-nums',
            cell: (row) => formatCount(row.amount),
        },
        {
            id: 'balancesAfter',
            header: 'Balances after',
            className: 'text-muted-foreground align-top text-sm tabular-nums',
            cell: (row) =>
                `Pending ${formatCount(row.balancesAfter.pending)} · Available ${formatCount(
                    row.balancesAfter.available,
                )}`,
        },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    What it moved
                    <InfoHint label="About movements">
                        The ledger entries this allocation produced — what it <em>did</em>, as
                        opposed to what it says. Oldest first, and capped at{' '}
                        {MONEY_EMBEDDED_LIMIT}.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {unmoved ? (
                    <div className="border-destructive/40 bg-destructive/10 flex gap-2 rounded-md border p-3 text-sm">
                        <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                        <div>
                            <p className="font-medium">
                                This allocation is held and has moved nothing.
                            </p>
                            <p className="text-muted-foreground">
                                Money was assigned to this beneficiary and never entered anybody's
                                balance. That is not an empty list — it is a state worth reporting,
                                because the allocation and the ledger disagree.
                            </p>
                        </div>
                    </div>
                ) : null}

                <DataTable
                    caption="Ledger entries produced by this allocation"
                    columns={columns}
                    rows={movements}
                    rowKey={(row) => row.id}
                    isLoading={false}
                    empty={
                        <EmptyState
                            title="No ledger entries"
                            description="This allocation has produced no movement yet."
                        />
                    }
                />

                {movements.length >= MONEY_EMBEDDED_LIMIT ? (
                    <p className="text-muted-foreground text-xs">
                        Showing the first {formatCount(MONEY_EMBEDDED_LIMIT)} movements. There may
                        be more.
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}

/** Every allocation cut from the same sale — the only view of a split as a whole. */
function SiblingsCard({
    allocation,
    timeZone,
}: {
    allocation: EarningsAllocationDetail;
    timeZone: string;
}) {
    const { siblings } = allocation;

    const columns: Column<EarningsAllocation>[] = [
        {
            id: 'beneficiary',
            header: 'Beneficiary',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    {row.id === allocation.id ? (
                        <span className="font-medium">
                            {row.beneficiary.name ?? 'The platform'}{' '}
                            <Badge variant="secondary" className="ml-1 font-normal">
                                This one
                            </Badge>
                        </span>
                    ) : (
                        <Link
                            to={`/dashboard/money/allocations/${row.id}`}
                            className="font-medium hover:underline"
                        >
                            {row.beneficiary.name ?? 'The platform'}
                        </Link>
                    )}
                    <p className="text-muted-foreground text-xs capitalize">
                        {row.beneficiary.type}
                    </p>
                </div>
            ),
        },
        {
            id: 'amount',
            numeric: true,
            header: 'Share',
            className: 'align-top font-medium tabular-nums',
            cell: (row) => formatMoney(row.amount, row.currency),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => <AllocationStatusBadge status={row.status} />,
        },
        {
            id: 'createdAt',
            header: 'Allocated',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    The whole split
                    <InfoHint label="About siblings">
                        Every allocation cut from this same sale, including this one. A prepaid
                        order produces a platform commission row and a vendor net row; a delivery
                        adds the agency and the agent. This is the only place the split is visible
                        as a whole — and the only way to ask whether the parts sum to the gross.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <DataTable
                    caption="Every allocation cut from this sale"
                    columns={columns}
                    rows={siblings}
                    rowKey={(row) => row.id}
                    isLoading={false}
                    empty={
                        <EmptyState
                            title="No sibling allocations"
                            description="Nothing else was cut from this sale."
                        />
                    }
                />

                {/*
                  The sum is deliberately not computed here. The gross is a frozen
                  snapshot and the shares are the platform's arithmetic; adding
                  them up in the client would be a second opinion about a split
                  this service does not own. The figures sit side by side so an
                  operator can do it, which is the question worth asking.
                */}
                {siblings.length >= MONEY_EMBEDDED_LIMIT ? (
                    <p className="text-muted-foreground text-xs">
                        Showing the first {formatCount(MONEY_EMBEDDED_LIMIT)} allocations. There may
                        be more.
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}
