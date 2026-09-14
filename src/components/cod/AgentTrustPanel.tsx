import { useState } from 'react';

import { trustEventColumns } from '@/components/cod/TrustEventsTable';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
} from '@/lib/datetime';
import { withQuery } from '@/lib/query';
import { listTrustEvents } from '@/services/cod.service';
import { useCan } from '@/store';
import {
    COD_MAX_RANGE_DAYS,
    TRUST_EVENT_SORT_DEFAULT,
    TRUST_EVENT_TYPES,
    type TrustEventQuery,
} from '@/types/cod.types';

/**
 * `GET /cod/agents/:agentId/trust-events` ·
 * `cod.holders.read` **+** `agents.read`, `all` mode.
 *
 * Why this agent's cash ceiling moved. **There is no cross-agent trust feed** — a
 * platform-wide list of score movements is a report rather than a screen — so this
 * is a panel on the agent and never a module of its own.
 *
 * ── The composite guard is not decoration ────────────────────────────────────
 * These rows are a named person's conduct record. Gating on the cash permission
 * alone would make this a second door onto the agent directory, which is exactly
 * what the second permission closes. The **adjustment** beside it is gated
 * separately on `cod.trust.adjust` and needs neither of these: moving the score
 * does not read the history.
 *
 * ── The filters live in local state, not the URL ─────────────────────────────
 * The detail URL belongs to the record, following the rule the vendor catalogue
 * set: a link to this agent should open this agent, not this agent narrowed to
 * somebody's half-finished filter.
 */
export function AgentTrustPanel({
    agentId,
    timeZone,
    reloadToken,
}: {
    agentId: string;
    timeZone: string;
    reloadToken: number;
}) {
    const can = useCan();

    const [eventType, setEventType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);

    const dayRange = dayStringRangeToInstants(from, to, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, COD_MAX_RANGE_DAYS) : false;

    const query: TrustEventQuery = {
        eventType: eventType || undefined,
        sort: TRUST_EVENT_SORT_DEFAULT,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(from, to, timeZone)),
    };

    /*
     * Keyed on the path **and** the reload token, so a trust adjustment made from
     * the tab above re-reads this feed. `useAsyncData` keys on a string rather
     * than on the fetcher, so this is the only way the panel hears about a write.
     */
    const path = withQuery(`/cod/agents/${agentId}/trust-events`, { ...query });
    const events = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listTrustEvents(agentId, query, { signal }),
    );

    const meta = events.data?.meta;
    const isFiltered = Boolean(eventType || from || to);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Trust history
                    <InfoHint label="About the trust history">
                        Every movement of this agent&rsquo;s conduct score, newest first. The score
                        is <strong>0 to 100</strong> and bounds how much cash one person may carry.
                        Each row records the score as it stood immediately after — an audit
                        snapshot, not a recomputation, so a row and today&rsquo;s score can
                        legitimately disagree.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <FilterBar
                    isFiltered={isFiltered}
                    onClear={() => {
                        setEventType('');
                        setFrom('');
                        setTo('');
                        setPage(1);
                    }}
                >
                    <FilterField label="Kind" htmlFor="trust-event-type">
                        <Select
                            value={eventType || 'any'}
                            onValueChange={(next) => {
                                setEventType(next === 'any' ? '' : next);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger id="trust-event-type" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">Any kind</SelectItem>
                                {TRUST_EVENT_TYPES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value.replace(/_/g, ' ')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <DateRangeFilter
                        label="When"
                        from={from}
                        to={to}
                        onChange={(next) => {
                            setFrom(next.from);
                            setTo(next.to);
                            setPage(1);
                        }}
                        timeZone={timeZone}
                        maxDays={COD_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                <DataTable
                    caption="Movements of this agent's trust score"
                    columns={trustEventColumns({ timeZone, can })}
                    rows={events.data?.data ?? []}
                    rowKey={(row) => row.id}
                    isLoading={events.isLoading}
                    isRefreshing={events.isRefreshing}
                    error={events.error}
                    onRetry={events.reload}
                    loadingRows={4}
                    empty={
                        <EmptyState
                            title="Nothing has moved this score"
                            description={
                                isFiltered
                                    ? 'No movement matches these filters.'
                                    : 'This agent has taken no penalty and been given no adjustment.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="movements"
                        isBusy={events.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}
