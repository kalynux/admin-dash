import { useMemo } from 'react';
import { Activity, RotateCw, Users } from 'lucide-react';

import {
    CoverageNote,
    KindBalanceHint,
    ReporterStatusNotice,
} from '@/components/automation/AutomationNotices';
import { WindowHoursSelect } from '@/components/automation/WindowHoursSelect';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatRelative, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getAutomationSummary } from '@/services/automation.service';
import { useAdmin } from '@/store';
import {
    AUTOMATION_WINDOW_HOURS_DEFAULT,
    partitionByKind,
    type AutomationFailureGroup,
} from '@/types/automation.types';

const FILTER_KEYS = ['windowHours'] as const;
const FILTER_DEFAULTS = { windowHours: `${AUTOMATION_WINDOW_HOURS_DEFAULT}` } as const;

/** What each kind means, said next to its own section rather than once at the top. */
const KIND_COPY: Record<string, { title: string; blurb: string }> = {
    execution_failed: {
        title: 'Died outright',
        blurb: 'The workflow stopped: a send was refused, or a node threw. Rare by construction — these workflows are built not to fail — so each one is worth reading.',
    },
    degraded_turn: {
        title: 'Degraded answers',
        blurb: 'The workflow succeeded and the customer still got a worse answer than they should have, because a fallback branch ran. n8n recorded these as successes.',
    },
};

/**
 * `GET /automation/summary` · **any of** `developer_tools.logs.read`, `system.automation.read`,
 * `support.automation.lookup` · direct read, not audited.
 *
 * ── ⚠ The one surface in this module that is NOT graded ──────────────────────
 * There is no `view` on this response and nothing is withheld from any rung: a count carries
 * no machine detail and no identifier. A Support administrator therefore sees **more** here —
 * the workflow name, its id, the distinct-customer count — than the failures feed will ever
 * show them, which is why this is the module's first child and where every level lands.
 *
 * ── `distinctCustomers` is the field this screen exists for ──────────────────
 * *47 reports from 12 customers* is a platform incident; *47 from 1* is one person retrying.
 * A list of rows cannot tell you which, and this is the only place the answer exists — it is
 * computed server-side from a salted digest that never leaves the service (ADR-022 D-5), so
 * there is no client-side way to derive it and no second opinion to check it against.
 *
 * ── The two kinds are never merged ───────────────────────────────────────────
 * One section each, both rendered even when one is empty, because *zero of one kind beside
 * forty-seven of the other* is itself the diagnosis. `partitionByKind` enforces that on the
 * way in rather than leaving it to the JSX.
 */
export function AutomationSummary() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin?.timezone);
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const { token, refresh } = useRefreshToken();

    const query = useMemo(
        () => ({ windowHours: Number(values.windowHours) || AUTOMATION_WINDOW_HOURS_DEFAULT }),
        [values.windowHours],
    );

    const path = withQuery('/automation/summary', { ...query });
    const summary = useAsyncData(`${path}#${token}`, (signal) =>
        getAutomationSummary(query, { signal }),
    );

    const data = summary.data;
    // Memoised on `data` rather than derived inline: `?? []` is a fresh identity every render,
    // which would make the partition below recompute on each one.
    const groups = useMemo<AutomationFailureGroup[]>(() => data?.groups ?? [], [data]);
    const sections = useMemo(() => partitionByKind(groups), [groups]);

    /**
     * Counted from the **reports**, not from the number of groups: one group of forty-seven and
     * forty-seven groups of one are the same shape to a group count and opposite things to an
     * operator. `KindBalanceHint` reads the reports.
     */
    const reportsOfKind = (kind: string) =>
        groups.filter((group) => group.kind === kind).reduce((total, g) => total + g.count, 0);

    return (
        <PageContainer
            title="Automation summary"
            description="How often the customer bot failed in this window, by workflow — and whether it happened to one customer or to many."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={refresh}
                    disabled={summary.isLoading || summary.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <WindowHoursSelect
                    value={values.windowHours}
                    onChange={(next) => set({ windowHours: next })}
                />
            </FilterBar>

            {data ? (
                <ReporterStatusNotice
                    configured={data.configured}
                    isEmpty={data.groups.length === 0}
                />
            ) : null}

            {data?.configured ? (
                <KindBalanceHint
                    executionFailed={reportsOfKind('execution_failed')}
                    degradedTurn={reportsOfKind('degraded_turn')}
                />
            ) : null}

            <DataState
                isLoading={summary.isLoading}
                error={summary.error}
                isEmpty={groups.length === 0}
                onRetry={summary.reload}
                empty={
                    <EmptyState
                        icon={Activity}
                        title="No failures grouped in this window"
                        /* Deliberately not "all healthy" — see `ReporterStatusNotice` above,
                           which is what distinguishes a quiet window from a deaf deployment. */
                        description="Nothing was reported over this period. Widen the window, and read the coverage note below before treating this as a clean bill of health."
                    />
                }
            >
                <div className="space-y-6">
                    {sections.map((section) => (
                        <KindSection
                            key={section.kind}
                            kind={section.kind}
                            groups={section.rows}
                            timeZone={timeZone}
                        />
                    ))}
                </div>
            </DataState>

            {data ? (
                <p className="text-muted-foreground text-xs">
                    {/* `since` as the service computed it, rather than re-deriving the boundary
                        from `windowHours` against the browser's clock — the two would disagree
                        by however far the two machines have drifted. */}
                    Counted from {formatInstantInZone(data.since, timeZone) ?? data.since} —
                    the last {formatCount(data.windowHours)} hours.
                </p>
            ) : null}

            <CoverageNote />
        </PageContainer>
    );
}

function KindSection({
    kind,
    groups,
    timeZone,
}: {
    kind: string;
    groups: AutomationFailureGroup[];
    timeZone: string;
}) {
    const copy = KIND_COPY[kind];
    const reports = groups.reduce((total, group) => total + group.count, 0);

    return (
        <section className="space-y-2">
            <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    {/* An unrecognised kind renders its raw string rather than being dropped:
                        adding an enum member is an additive change on this service. */}
                    {copy?.title ?? humaniseEnum(kind) ?? kind}
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                        {kind}
                    </Badge>
                    <span className="text-muted-foreground text-xs font-normal">
                        {formatCount(reports)} {reports === 1 ? 'report' : 'reports'}
                    </span>
                </h2>
                {copy ? <p className="text-muted-foreground mt-0.5 text-xs">{copy.blurb}</p> : null}
            </div>

            {groups.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                    None in this window.
                </p>
            ) : (
                <ul className="border-border divide-border divide-y rounded-lg border">
                    {groups.map((group) => (
                        <li
                            key={`${group.workflowId}-${group.kind}-${group.channel}`}
                            className="flex flex-wrap items-start justify-between gap-4 px-4 py-3"
                        >
                            <div className="min-w-0 space-y-1">
                                <p className="truncate text-sm font-medium">
                                    {/* The NAME is shown and the ID is what identifies it. The
                                        name has changed twice in a day; the id did not move
                                        through either rename. No `UP-` prefix is stripped or
                                        expected — one of these workflows does not carry one. */}
                                    {group.workflowName}
                                </p>
                                <CopyableValue
                                    variant="id"
                                    value={group.workflowId}
                                    label="workflow ID"
                                    truncate={false}
                                />
                                <p className="text-muted-foreground text-xs">
                                    <Badge
                                        variant="outline"
                                        className="mr-2 text-[10px] font-normal"
                                    >
                                        {group.channel}
                                    </Badge>
                                    last {formatRelative(group.lastOccurredAt) ?? '—'} ·{' '}
                                    {formatInstantInZone(group.lastOccurredAt, timeZone) ?? '—'}
                                </p>
                            </div>

                            <div className="shrink-0 text-right">
                                <p className="text-2xl font-semibold tabular-nums">
                                    {formatCount(group.count)}
                                </p>
                                <DistinctCustomers group={group} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * The reading, not just the number.
 *
 * Printing `12` beside `47` leaves the operator to do the division; saying which of the two
 * situations this is costs one line and is the entire reason the field is on the wire. The
 * one-customer case is called out because it is the one that looks like an incident on every
 * other screen in this module and is not.
 */
function DistinctCustomers({ group }: { group: AutomationFailureGroup }) {
    const oneCustomerRetrying = group.distinctCustomers === 1 && group.count > 1;

    return (
        <p className="text-muted-foreground mt-0.5 flex items-center justify-end gap-1.5 text-xs">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <span>
                {formatCount(group.distinctCustomers)}{' '}
                {group.distinctCustomers === 1 ? 'customer' : 'customers'}
                {oneCustomerRetrying ? ' — one person retrying' : null}
            </span>
        </p>
    );
}
