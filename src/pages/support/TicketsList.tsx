import { useMemo, useState } from 'react';
import { LifeBuoy, Plus, RotateCw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { ticketColumns } from '@/components/support/ticketColumns';
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
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listTickets } from '@/services/support.service';
import { useAdmin } from '@/store';
import {
    TICKET_MAX_RANGE_DAYS,
    TICKET_QUEUES,
    TICKET_SORT_DEFAULT,
    type TicketListQuery,
    type TicketQueue,
} from '@/types/support.types';

/**
 * `GET /support/tickets` — the queue.
 *
 * ── There is no "assigned to" filter, and that is deliberate ──────────────────
 * Whose queue an administrator may read is **the scope's decision**, made
 * server-side and folded into the query as a Mongo clause. A parameter that
 * could contradict it would be the one place the two disagree — so the service
 * offers none, and sending one is stripped rather than refused.
 *
 * What it offers instead is `queue`: `all` · `mine` · `unassigned`. Those
 * **narrow inside the scope and can never widen it**, so an Admin asking for
 * `unassigned` and a Support administrator asking for the same get the same
 * pool.
 *
 * ── The four vocabularies are jovi-mall's, so the filters are free text ───────
 * `status`, `type`, `priority` and `importance` are validated for shape and
 * never for membership: jovi-mall owns all four and grows them with the product
 * — its ticket-type list alone has 39 values. A copy here would be a second list
 * that goes stale silently, and the failure mode of drift is a filter that
 * matches nothing while looking correct. So these are typed, not picked, and an
 * unrecognised value returns an empty page rather than a `400`.
 *
 * ── `assignedAt` is not sortable ──────────────────────────────────────────────
 * It lives inside the assignment block, which is `null` for every unassigned
 * ticket — and unassigned is the entire pool, not a rare edge. Sorting a list
 * whose commonest state has no value for the sort key puts the queue in an order
 * nobody can predict.
 */

const FILTER_KEYS = [
    'search',
    'queue',
    'status',
    'type',
    'priority',
    'importance',
    'entityType',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: TICKET_SORT_DEFAULT, queue: 'all' } as const;

const QUEUE_LABELS: Record<TicketQueue, string> = {
    all: 'Everything I can see',
    mine: 'Assigned to me',
    unassigned: 'Unassigned pool',
};

export function TicketsList() {
    const admin = useAdmin();
    const [creating, setCreating] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    /** An over-cap span is a `400`, so the request is never made. */
    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, TICKET_MAX_RANGE_DAYS);

    const query = useMemo<TicketListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            search: values.search || undefined,
            queue: (values.queue || undefined) as TicketQueue | undefined,
            status: values.status || undefined,
            type: values.type || undefined,
            priority: values.priority || undefined,
            importance: values.importance || undefined,
            entityType: values.entityType || undefined,
            sort: values.sort || TICKET_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/support/tickets', { ...query });
    const tickets = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listTickets(query, { signal }),
    );

    const rows = tickets.data?.data ?? [];
    const meta = tickets.data?.meta;
    const columns = useMemo(() => ticketColumns({ timeZone }), [timeZone]);

    return (
        <PageContainer
            title="Tickets"
            description="Which tickets you see is decided by your level: your own, the unassigned pool, and — for an Admin — anything a Support administrator holds. A ticket outside that is simply not found."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={tickets.reload}
                        disabled={tickets.isLoading || tickets.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    {/*
                      Every tier holds `support.tickets.create` — Support is
                      where a Support administrator works, so the grant matrix on
                      this family is uniform and the narrowing happens per record
                      instead. The gate is here anyway: what is visible must be
                      reachable, and a tier that loses it must lose the button.
                    */}
                    <Can permission="support.tickets.create">
                        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                            <Plus className="size-4" />
                            New ticket
                        </Button>
                    </Can>
                </>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search tickets"
                    placeholder="Subject, or a 24-character ticket id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.queue || 'all'}
                    onValueChange={(value) => set({ queue: value })}
                >
                    <SelectTrigger className="w-52" aria-label="Queue">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TICKET_QUEUES.map((value) => (
                            <SelectItem key={value} value={value}>
                                {QUEUE_LABELS[value]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/*
                  Typed rather than picked. These four vocabularies belong to
                  jovi-mall and grow with the product; a hard-coded picker would
                  be a second list that goes stale while looking correct.
                */}
                <SearchInput
                    label="Status"
                    placeholder="Status"
                    value={values.status}
                    onChange={(next) => set({ status: next }, { replace: true })}
                />
                <SearchInput
                    label="Type"
                    placeholder="Type"
                    value={values.type}
                    onChange={(next) => set({ type: next }, { replace: true })}
                />
                <SearchInput
                    label="Priority"
                    placeholder="Priority"
                    value={values.priority}
                    onChange={(next) => set({ priority: next }, { replace: true })}
                />

                <DateRangeFilter
                    label="Opened"
                    from={values.createdFrom}
                    to={values.createdTo}
                    maxDays={TICKET_MAX_RANGE_DAYS}
                    timeZone={timeZone}
                    onChange={(next) =>
                        set({ createdFrom: next.from ?? null, createdTo: next.to ?? null })
                    }
                />
            </FilterBar>

            <DataTable
                caption="Support tickets you may see"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={tickets.isLoading}
                isRefreshing={tickets.isRefreshing}
                error={tickets.error}
                onRetry={tickets.reload}
                sort={values.sort || TICKET_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                empty={
                    <EmptyState
                        icon={LifeBuoy}
                        title={isFiltered ? 'No tickets match' : 'The queue is empty'}
                        description={
                            isFiltered
                                ? 'A status or type this platform does not use returns an empty page rather than an error — check the spelling before concluding there is nothing here.'
                                : 'Nothing is waiting in the queues you can see.'
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="tickets"
                    isBusy={tickets.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {creating ? (
                <CreateTicketDialog
                    open
                    onOpenChange={setCreating}
                    onCreated={() => {
                        setCreating(false);
                        // Re-read rather than trusting the create's answer:
                        // it is jovi-mall's raw shape, not this service's.
                        setReloadToken((token) => token + 1);
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
