import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Truck } from 'lucide-react';

import { AgentStateAxesRow } from '@/components/agents/AgentStateAxes';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAgents } from '@/services/agents.service';
import { useAdmin } from '@/store';
import {
    AGENT_AVAILABILITY_STATES,
    AGENT_KYC_STATUSES,
    AGENT_MAX_RANGE_DAYS,
    AGENT_SORT_DEFAULT,
    AGENT_STATUSES,
    AGENT_WORKING_STATES,
    agentDisplayName,
    type Agent,
    type AgentListQuery,
} from '@/types/agents.types';

/**
 * `GET /agents` — the platform's delivery agents.
 *
 * ── Agents are platform identities, not agency rows ───────────────────────────
 * One agent can hold memberships in several agencies, so this directory is not a
 * roster: an agency's roster is on that agency's own screen. What is here is the
 * person.
 *
 * ── Six filters, one per axis, because the API refuses to collapse them ───────
 * `status` is admin-written, `availability` is agent-written, `working_state` is
 * system-derived, and `banned` / `trackingAllowed` are two more independent
 * facts. Offering a single "state" filter would mean choosing which of six
 * questions an operator is allowed to ask.
 *
 * ── What deliberately never appears on a row ──────────────────────────────────
 * `homeBase.label` (the area a person lives in), `vehicle.plate_number` (a licence
 * plate identifies someone off-platform), the device fingerprint, and any
 * coordinate. All four are detail-only, and the last is behind an explicit reveal
 * even there. A hundred-row directory is not a place to fan out a hundred
 * people's home areas.
 */

const FILTER_KEYS = [
    'search',
    'status',
    'kycStatus',
    'availability',
    'workingState',
    'banned',
    'trackingAllowed',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: AGENT_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * Read a tri-state boolean filter out of the URL.
 *
 * **`false` has to survive.** The contract is explicit that `false` means false
 * and is not a synonym for "unset", and "which agents are not allowed to be
 * tracked?" is a question only a real `false` can ask.
 */
function boolFilter(value: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

export function AgentsList() {
    const admin = useAdmin();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, AGENT_MAX_RANGE_DAYS);

    const query = useMemo<AgentListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            status: values.status || undefined,
            kycStatus: values.kycStatus || undefined,
            availability: values.availability || undefined,
            workingState: values.workingState || undefined,
            banned: boolFilter(values.banned),
            trackingAllowed: boolFilter(values.trackingAllowed),
            sort: values.sort || AGENT_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/agents', { ...query });
    const agents = useAsyncData(path, (signal) => listAgents(query, { signal }));

    const rows = agents.data?.data ?? [];
    const meta = agents.data?.meta;

    /**
     * `?sort=trustScore` is index-served only when `status`, `kycStatus` and
     * `banned` are **all** filtered. Unfiltered it is a blocking sort — allowed,
     * and bounded to one page, but worth saying so rather than leaving a slow
     * page unexplained.
     */
    const trustSortUnindexed =
        (values.sort || AGENT_SORT_DEFAULT).replace(/^-/, '') === 'trustScore' &&
        !(values.status && values.kycStatus && values.banned);

    const columns = useMemo<Column<Agent>[]>(
        () => [
            {
                id: 'agent',
                header: 'Agent',
                cell: (agent) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/agents/${agent.id}`}
                            className="font-medium hover:underline"
                        >
                            {agentDisplayName(agent)}
                        </Link>
                        {/*
                          Contact PII, and kept: a directory nobody can search by a
                          human identifier is unusable. It is not duplicated into
                          tooltips or exports.
                        */}
                        <p className="text-muted-foreground truncate text-xs">
                            {agent.email ?? agent.phone ?? 'No contact on file'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'state',
                header: 'State',
                /*
                  Six axes, drawn as one pill for a healthy agent and more as things
                  need attention. Availability and working state are in here rather
                  than in columns of their own precisely so a row does not carry six
                  values that are almost always benign — each badge names its own
                  axis on hover.
                */
                cell: (agent) => <AgentStateAxesRow agent={agent} />,
            },
            {
                id: 'capacity',
                header: 'Capacity',
                className: 'text-muted-foreground text-sm tabular-nums',
                /*
                  `operational.activeShipments` is the authoritative count the accept
                  path compare-and-sets on, not the recomputed one beside the working
                  state — those two can legitimately disagree for a moment.
                */
                cell: (agent) =>
                    `${formatCount(agent.operational.activeShipments)} / ${formatCount(
                        agent.operational.maxActiveShipments,
                    )}`,
            },
            {
                id: 'trustScore',
                header: 'Trust',
                sortKey: 'trustScore',
                className: 'text-muted-foreground text-sm tabular-nums',
                // `null` means never computed, which is not a score of zero.
                cell: (agent) => agent.trustScore ?? '—',
            },
            {
                id: 'createdAt',
                header: 'Joined',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (agent) => formatInstantInZone(agent.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground text-sm',
                cell: (agent) => formatInstantInZone(agent.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Agents"
            description="Delivery agents are platform identities, not agency rows — one agent can hold memberships in several agencies. Their six state axes are kept deliberately independent."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={agents.reload}
                    disabled={agents.isLoading || agents.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search agents"
                    placeholder="Name, email, phone or agent id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Account status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {AGENT_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.kycStatus || ANY}
                    onValueChange={(value) => set({ kycStatus: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Identity documents">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any KYC state</SelectItem>
                        {AGENT_KYC_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.availability || ANY}
                    onValueChange={(value) => set({ availability: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Availability">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any availability</SelectItem>
                        {AGENT_AVAILABILITY_STATES.map((state) => (
                            <SelectItem key={state} value={state} className="capitalize">
                                {state.replace(/_/g, ' ')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.workingState || ANY}
                    onValueChange={(value) => set({ workingState: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Working state">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any working state</SelectItem>
                        {AGENT_WORKING_STATES.map((state) => (
                            <SelectItem key={state} value={state} className="capitalize">
                                {state.replace(/_/g, ' ')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.banned || ANY}
                    onValueChange={(value) => set({ banned: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Platform ban">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any ban state</SelectItem>
                        <SelectItem value="true">Banned</SelectItem>
                        <SelectItem value="false">Not banned</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={values.trackingAllowed || ANY}
                    onValueChange={(value) =>
                        set({ trackingAllowed: value === ANY ? null : value })
                    }
                >
                    <SelectTrigger className="w-44" aria-label="Tracking">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any tracking state</SelectItem>
                        <SelectItem value="true">Tracking allowed</SelectItem>
                        <SelectItem value="false">Tracking not allowed</SelectItem>
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Joined"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={AGENT_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {meta && !agents.isLoading ? (
                <p
                    className="text-muted-foreground flex items-center gap-1 text-sm"
                    aria-live="polite"
                >
                    {formatCount(meta.total)} {meta.total === 1 ? 'agent' : 'agents'}
                    {isFiltered ? ' match these filters' : ''}
                    <InfoHint label="About sorting agents">
                        Agents can be ordered by join date, last update or trust score. Name is not
                        sortable — no index backs it, and ordering by an unindexed field means
                        paging that skips rows.
                    </InfoHint>
                </p>
            ) : null}

            {trustSortUnindexed ? (
                <p className="text-muted-foreground rounded-lg border px-3 py-2 text-xs">
                    Ordering by trust score is served from an index only when account status,
                    identity documents and ban state are all filtered. Without them this page is
                    sorted in memory — correct, but slower on a large roster.
                </p>
            ) : null}

            <DataTable
                caption="Delivery agents"
                columns={columns}
                rows={rows}
                rowKey={(agent) => agent.id}
                sort={values.sort || AGENT_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={agents.isLoading}
                isRefreshing={agents.isRefreshing}
                error={agents.error}
                onRetry={agents.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Truck}
                        title={isFiltered ? 'No agents match these filters' : 'No agents yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches a name, an email, a phone number or an agent id.'
                                : 'Delivery agents appear here as they join the platform.'
                        }
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
                    noun="agents"
                    isBusy={agents.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
