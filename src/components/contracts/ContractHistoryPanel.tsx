import { useMemo, useState } from 'react';
import { History } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PartyValue } from '@/components/common/PartyValue';
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
import { resolvePartyName } from '@/lib/party';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAgencyContractHistory } from '@/services/agencies.service';
import { listAgentContractHistory } from '@/services/agents.service';
import { useCan } from '@/store';
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
    const can = useCan();
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
                /*
                  ⚠ The role badge and nothing else. `event.actorUserId` is on the
                  row and is **not rendered anywhere in this panel** — deliberately
                  so, per the contract: read the role, not the id, because an
                  `admin` row's id belongs to the wi-admin database and resolves to
                  nothing in the platform's. Putting it on screen is a decision
                  about what this column says, not a copy affordance, so it is left
                  to whoever revisits this column next. If it does land here it
                  takes a `CopyableValue` and no name — it cannot be resolved to
                  one for at least one of its two sources.
                */
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
                className: 'text-muted-foreground',
                /*
                  ⚠ Not shortened, though this is a table. The rest of the sweep
                  lets a dense row take the head-and-tail form, and this column is
                  the exception that proves why the rule is about *supplementary*
                  ids: here the id is not beside an identifier, it **is** the only
                  one the row has. Every row in this column is 24 hex characters
                  and nothing else, and taking fourteen of them away attacks the
                  exact complaint — "the table shows only ids" — from the wrong
                  end.

                  ⚠ **The two sides of this column are not symmetrical, and the
                  asymmetry is the payload's.** BR-016 § 1 was granted and every
                  row now carries `agent: { id, name }` — batched after
                  `skip`/`limit`, so it touches one page however deep the history
                  goes. But it names the **agent**, on both feeds, including the
                  one whose own path already names them. So the agency side of
                  this panel gets a name and the agent side still shows the
                  agency's id: there is no `agency` decoration to read, and there
                  is no batch-by-ids route to invent one from.

                  ⚠ **`name`, not `businessName` — an agent is a person.** Sourced
                  as `name` so `PartyValue` can never label it as a business; the
                  sibling decoration on the agent's own contracts feed carries
                  `businessName` because an agency *is* one, and mixing the two is
                  the BR-006 confusion in the other direction.

                  ⚠ `agent: null` means **the agent record is gone** — a broken
                  state the row is kept to show. It renders as the id alone, which
                  is what `PartyValue` does with an identifier-only party, and
                  never as a fabricated label.

                  ⚠ Not shortened, though this is a table: on the agent side the
                  id is not beside an identifier, it **is** the only thing the row
                  has, and taking fourteen characters off it attacks the exact
                  complaint — "the table shows only ids" — from the wrong end.

                  The link is gated on the permission that destination requires:
                  what is visible must be reachable, and a link that lands on a
                  denial is worse than no link.
                */
                cell: (event) => {
                    const value = side === 'agency' ? event.agentId : event.agencyId;
                    const reachable = side === 'agency' ? can('agents.read') : can('agencies.read');
                    const base = side === 'agency' ? 'agents' : 'agencies';
                    const to = value && reachable ? `/dashboard/${base}/${value}` : undefined;

                    // Only the agent half is decorated — see the note above.
                    const name = side === 'agency' ? (event.agent?.name ?? null) : null;

                    return (
                        <PartyValue
                            party={resolvePartyName([{ source: 'name', value: name }], {
                                source: 'id',
                                value,
                            })}
                            id={value}
                            idLabel={side === 'agency' ? 'agent ID' : 'agency ID'}
                            to={to}
                        />
                    );
                },
            },
            {
                id: 'reason',
                header: 'Reason',
                className: 'text-muted-foreground text-sm',
                cell: (event) => event.reason ?? '—',
            },
        ],
        [timeZone, side, can],
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
