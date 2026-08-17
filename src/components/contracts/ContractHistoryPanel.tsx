import { useMemo, useState } from 'react';
import { History } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAgencyContractHistory } from '@/services/agencies.service';
import { listAgentContractHistory } from '@/services/agents.service';
import {
    CONTRACT_ACTOR_ROLES,
    CONTRACT_EVENT_MAX_RANGE_DAYS,
    CONTRACT_EVENT_SORT_DEFAULT,
    type ContractEvent,
    type ContractEventQuery,
} from '@/types/contracts.types';

interface ContractHistoryPanelProps {
    /** Which side of the relationship this panel is mounted on. */
    side: 'agency' | 'agent';
    /** The agency id or the agent id, matching `side`. */
    ownerId: string;
    timeZone: string;
}

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * `GET /{agencies,agents}/:id/contract-history` — **what everyone did** to this
 * party's relationships.
 *
 * ── Not the activity feed, and the difference matters ─────────────────────────
 * This is jovi-mall's own record, and `actorRole` is `agent`, `agency`, `admin`
 * *or* `system` — an agency approving a join request, an agent withdrawing one, a
 * nightly job deactivating a stale contract. The `/activity` tab beside it is the
 * **audit** trail and shows only what administrators did.
 *
 * They are two endpoints rather than one merged feed because they live in two
 * databases reached by two clients, where a merged page total would be a sum of
 * two counts and `meta.pages` a lie.
 *
 * The consequence for permissions: this needs `agencies.read` / `agents.read`
 * **alone**. It is not audit data, so the audit read scope does not apply and no
 * `audit.read` is required — which is why this panel is not gated where the
 * activity tab is.
 *
 * ── Filters live in local state, not the URL ──────────────────────────────────
 * The detail screen's query string belongs to the record. Two lists on one screen
 * with parameters in one query string makes a shared link ambiguous about which
 * list it was describing. Same rule the catalogue and activity panels follow.
 */
export function ContractHistoryPanel({ side, ownerId, timeZone }: ContractHistoryPanelProps) {
    const [type, setType] = useState('');
    const [actorRole, setActorRole] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);

    const span = dayStringRangeToInstants(from, to, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, CONTRACT_EVENT_MAX_RANGE_DAYS);

    const query = useMemo<ContractEventQuery>(() => {
        const range = spanOverCap ? {} : resolveDayFilter(from, to, timeZone);
        return {
            type: type.trim() || undefined,
            actorRole: actorRole || undefined,
            sort: CONTRACT_EVENT_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [type, actorRole, from, to, page, timeZone, spanOverCap]);

    const basePath = side === 'agency' ? '/agencies' : '/agents';
    const path = withQuery(`${basePath}/${ownerId}/contract-history`, { ...query });

    const history = useAsyncData(path, (signal) =>
        side === 'agency'
            ? listAgencyContractHistory(ownerId, query, { signal })
            : listAgentContractHistory(ownerId, query, { signal }),
    );

    const rows = history.data?.data ?? [];
    const meta = history.data?.meta;
    const isFiltered = Boolean(type || actorRole || from || to);

    function clear() {
        setType('');
        setActorRole('');
        setFrom('');
        setTo('');
        setPage(1);
    }

    const columns = useMemo<Column<ContractEvent>[]>(
        () => [
            {
                id: 'occurredAt',
                header: 'When',
                className: 'text-muted-foreground text-sm whitespace-nowrap',
                cell: (event) => formatInstantInZone(event.occurredAt, timeZone) ?? '—',
            },
            {
                id: 'type',
                header: 'Event',
                // Rendered raw. The vocabulary is jovi-mall's, ~24 values, and it has
                // already drifted against its own schema once — so no lookup table.
                cell: (event) => <span className="font-mono text-xs">{event.type}</span>,
            },
            {
                id: 'transition',
                header: 'Status change',
                className: 'text-muted-foreground text-sm',
                cell: (event) =>
                    event.fromStatus || event.toStatus ? (
                        <span className="whitespace-nowrap">
                            {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                        </span>
                    ) : (
                        '—'
                    ),
            },
            {
                id: 'actor',
                header: 'Who',
                cell: (event) =>
                    event.actorRole ? (
                        <Badge variant="outline" className="capitalize">
                            {event.actorRole}
                        </Badge>
                    ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                    ),
            },
            {
                id: 'counterparty',
                header: side === 'agency' ? 'Agent' : 'Agency',
                className: 'text-muted-foreground font-mono text-xs',
                cell: (event) => (side === 'agency' ? event.agentId : event.agencyId),
            },
            {
                id: 'reason',
                header: 'Reason',
                className: 'text-muted-foreground text-sm',
                cell: (event) => event.reason ?? '—',
            },
        ],
        [timeZone, side],
    );

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">Contract history</h2>
                <p className="text-muted-foreground text-sm">
                    What everyone did to{' '}
                    {side === 'agency' ? "this agency's" : "this agent's"} relationships — the
                    agency, the agent, an administrator or the platform itself. Administrator
                    actions alone are on the Activity tab.
                </p>
            </div>

            <FilterBar isFiltered={isFiltered} onClear={clear}>
                {/*
                  A free-text box, not a dropdown. The event vocabulary is jovi-mall's
                  and this service validates it as a bounded string precisely because a
                  pinned copy would go stale — so an invented dropdown here would be a
                  list that can silently stop matching.
                */}
                <div className="space-y-1.5">
                    <Label htmlFor={`contract-event-type-${ownerId}`} className="text-xs">
                        Event type
                    </Label>
                    <Input
                        id={`contract-event-type-${ownerId}`}
                        className="w-56"
                        maxLength={60}
                        placeholder="e.g. CONTRACT_APPROVED"
                        autoComplete="off"
                        value={type}
                        onChange={(event) => {
                            setType(event.target.value);
                            setPage(1);
                        }}
                    />
                </div>

                <Select
                    value={actorRole || ANY}
                    onValueChange={(value) => {
                        setActorRole(value === ANY ? '' : value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-40" aria-label="Acted by">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Anyone</SelectItem>
                        {CONTRACT_ACTOR_ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="capitalize">
                                {role}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Occurred"
                    from={from}
                    to={to}
                    timeZone={timeZone}
                    maxDays={CONTRACT_EVENT_MAX_RANGE_DAYS}
                    onChange={(range) => {
                        setFrom(range.from);
                        setTo(range.to);
                        setPage(1);
                    }}
                />
            </FilterBar>

            {meta && !history.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'event' : 'events'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <DataTable
                caption="Contract history"
                columns={columns}
                rows={rows}
                rowKey={(event) => event.id}
                isLoading={history.isLoading}
                isRefreshing={history.isRefreshing}
                error={history.error}
                onRetry={history.reload}
                loadingRows={5}
                empty={
                    <EmptyState
                        icon={History}
                        title={
                            isFiltered ? 'No events match these filters' : 'No contract history yet'
                        }
                        description={
                            isFiltered
                                ? 'Try a wider date range, or clear the filters.'
                                : 'Events appear here as contracts are proposed, approved, paused and ended.'
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="events"
                    isBusy={history.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
