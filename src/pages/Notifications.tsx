import { useMemo, useState } from 'react';
import { CheckCheck, Inbox, RotateCw } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { ListSkeleton } from '@/components/common/Loading';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { NotificationRow } from '@/components/notifications/NotificationRow';
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
import { useNotificationSources } from '@/hooks/use-notification-sources';
import {
    MAX_DAYS_DEFAULT,
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { notify } from '@/lib/notify';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listNotifications, markAllNotificationsRead } from '@/services/notifications.service';
import { useAdmin, useNotifications } from '@/store';
import {
    NOTIFICATION_SEVERITIES,
    NOTIFICATION_STATUS_FILTERS,
    type MarkAllReadBody,
    type NotificationListQuery,
    type NotificationStatusFilter,
} from '@/types/notifications.types';

/**
 * The administrator inbox.
 *
 * ── Two things this screen deliberately does not do ───────────────────────────
 * **It does not predict its own contents.** Holding `notifications.read` gets you
 * the inbox; *which rows are in it* is decided per row from the permission each
 * source declares, re-checked on every request. Two administrators at the same
 * level legitimately see different things, so an empty list is never explained
 * away as a permission problem — `/dashboard/notifications/sources` is where that
 * question gets a real answer.
 *
 * **It does not treat marking-read as an audited action.** Those five writes
 * record nothing by design, which is why nothing here warns before them.
 *
 * ── "All" is not all ──────────────────────────────────────────────────────────
 * `?status=all` maps to `{ archived_at: { $exists: false } }` in the repository —
 * read *and* unread, but never archived. `notifications.md`'s query table names
 * the value and says nothing; only ADR-013 states it. So the option reads **"Read
 * and unread"**: labelling it "All" over a filter that hides the archive is the
 * exact misreading a label should prevent.
 *
 * ── Mark-all is scoped, and that is the point ─────────────────────────────────
 * The endpoint takes the three narrowing filters and a `before` watermark
 * precisely because, in the contract's words, *"an unscoped 'mark everything
 * read' is a button that silently discards whatever arrived between the page
 * rendering and the click."*
 */

/** Every key this screen owns. `page` is managed separately by the hook. */
const FILTER_KEYS = ['status', 'type', 'severity', 'source', 'sort', 'from', 'to'] as const;

const SORT_DEFAULT = '-occurredAt';
const STATUS_DEFAULT: NotificationStatusFilter = 'unread';

/**
 * Both defaults are the *service's* defaults, so the ordinary view carries no
 * query string at all and "is anything filtered?" stays "are there any params".
 */
const FILTER_DEFAULTS = { status: STATUS_DEFAULT, sort: SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = '__any__';

const STATUS_LABELS: Record<NotificationStatusFilter, string> = {
    unread: 'Unread',
    read: 'Read',
    // Not "All". See the note above.
    all: 'Read and unread',
    archived: 'Archived',
};

/**
 * The three sortable keys, both directions.
 *
 * **No "most severe first" option exists, deliberately.** `severity` sorts the
 * stored *string*, so ascending yields `critical, info, warning` — critical does
 * come first, but by an accident of spelling rather than by urgency, and `info`
 * then precedes `warning`. Labelling it by severity order would describe an
 * ordering the database is not producing, so these say plainly what they do.
 */
const SORT_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '-occurredAt', label: 'Newest first' },
    { value: 'occurredAt', label: 'Oldest first' },
    // `createdAt` is in the sort allowlist but is **not** a field on the row —
    // `toNotificationDto` does not emit it. It is when the projector noticed
    // rather than when the thing happened, which is a real distinction and a
    // legitimate ordering; there is simply nothing on screen to read it off.
    { value: '-createdAt', label: 'Recorded, newest first' },
    { value: 'createdAt', label: 'Recorded, oldest first' },
    { value: 'severity', label: 'Severity (A–Z)' },
    { value: '-severity', label: 'Severity (Z–A)' },
];

/**
 * The options a `<Select>` offers, plus whatever the URL is actually carrying.
 *
 * A shared link may name a value this build has never heard of — a severity added
 * since, a source this transcription predates. The request sends it either way,
 * because the URL *is* the state, so the control has to show it or it misreports
 * what is filtered.
 */
function withUrlValue(options: readonly string[], current: string): readonly string[] {
    if (!current || options.includes(current)) return options;
    return [...options, current];
}

export function Notifications() {
    const { refresh, adjustUnread } = useNotifications();
    const admin = useAdmin();

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);
    const registry = useNotificationSources();

    const [isMarkingAll, setIsMarkingAll] = useState(false);

    /**
     * Whether the picked range is wider than this endpoint allows.
     *
     * `DateRangeFilter` *says so* inline but does not stop anything being sent —
     * it is a control, not a request builder. So the screen withholds the range
     * itself, leaving the last good page on screen underneath the inline message
     * instead of round-tripping a `400` into an error panel.
     */
    const span = dayStringRangeToInstants(values.from, values.to, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, MAX_DAYS_DEFAULT);

    const query = useMemo<NotificationListQuery>(
        () => ({
            status: (values.status || STATUS_DEFAULT) as NotificationStatusFilter,
            type: values.type || undefined,
            severity: values.severity || undefined,
            source: values.source || undefined,
            sort: values.sort || SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...(spanOverCap ? {} : resolveDayFilter(values.from, values.to, timeZone)),
        }),
        [values, page, timeZone, spanOverCap],
    );

    const path = withQuery('/notifications', { ...query });
    const inbox = useAsyncData(path, (signal) => listNotifications(query, { signal }));

    const rows = inbox.data?.data ?? [];
    const meta = inbox.data?.meta;

    /** Reload the page *and* the badge — one write moves both. */
    function reconcile() {
        inbox.reload();
        void refresh();
    }

    /**
     * The three filters `read-all` accepts. `status`, `sort` and the date range
     * are **not** among them: the endpoint's whole subject is unread, and its
     * body is strict.
     */
    const markScope = useMemo<MarkAllReadBody>(
        () => ({
            type: values.type || undefined,
            severity: values.severity || undefined,
            source: values.source || undefined,
        }),
        [values.type, values.severity, values.source],
    );

    const scopeIsNarrowed = Boolean(markScope.type || markScope.severity || markScope.source);

    async function markAll() {
        setIsMarkingAll(true);
        try {
            /**
             * The watermark: the newest instant on screen.
             *
             * `Math.max` over the rendered rows rather than `rows[0].occurredAt`,
             * because "newest" is only the first row under `-occurredAt` — under
             * any other sort the page is not in time order at all. Taking the
             * maximum is the correct reading of "the newest row you rendered"
             * whatever the ordering, and on a later page it resolves to something
             * *older* than page 1, which under-marks. Under-marking is safe;
             * over-marking is the harm the parameter exists to prevent.
             */
            const newest = rows.reduce<number>((latest, row) => {
                const at = Date.parse(row.occurredAt);
                return Number.isNaN(at) ? latest : Math.max(latest, at);
            }, 0);

            const result = await markAllNotificationsRead({
                ...markScope,
                ...(newest > 0 ? { before: new Date(newest).toISOString() } : {}),
            });

            // The server composes the sentence and counts the rows; re-deriving
            // either here would be a second copy of a claim only it can make.
            notify.success(result.message ?? `${result.marked} marked read`);
            reconcile();
        } catch (caught) {
            notify.apiError(caught);
        } finally {
            setIsMarkingAll(false);
        }
    }

    const severityOptions = withUrlValue(NOTIFICATION_SEVERITIES, values.severity);
    const typeOptions = withUrlValue(registry.typeOptions, values.type);
    const sourceOptions = withUrlValue(
        registry.sources.map((source) => source.id),
        values.source,
    );

    const status = (values.status || STATUS_DEFAULT) as NotificationStatusFilter;

    return (
        <PageContainer
            title="Notifications"
            description="Derived from what the platform has already committed. Nothing here creates a notification, and what you can see is decided per row."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={inbox.reload}
                        disabled={inbox.isLoading || inbox.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void markAll()}
                        disabled={isMarkingAll || rows.length === 0 || (meta?.unreadCount ?? 0) === 0}
                        // The scope is legible *before* the click, not only in the
                        // toast afterwards.
                        title={
                            scopeIsNarrowed
                                ? 'Marks read only the notifications matching these filters, up to the newest one shown.'
                                : 'Marks read everything up to the newest notification shown. Anything that arrives after this page loaded is left alone.'
                        }
                    >
                        <CheckCheck className="size-4" />
                        {scopeIsNarrowed ? 'Mark these read' : 'Mark all read'}
                    </Button>
                </>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <Select value={status} onValueChange={(value) => set({ status: value })}>
                    <SelectTrigger className="h-9 w-44" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {NOTIFICATION_STATUS_FILTERS.map((value) => (
                            <SelectItem key={value} value={value}>
                                {STATUS_LABELS[value]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.type || ANY}
                    onValueChange={(value) => set({ type: value === ANY ? null : value })}
                >
                    <SelectTrigger className="h-9 w-56" aria-label="Type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {/*
                          ⚠ Mono, and still not a value render — here and in the
                          source select below. These are option *labels*: the
                          string is the filter, not something identifying a row,
                          and a copy button inside a `SelectItem` would swallow
                          the click that selects it.
                        */}
                        <SelectItem value={ANY}>Any type</SelectItem>
                        {typeOptions.map((value) => (
                            <SelectItem key={value} value={value} className="font-mono text-xs">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.severity || ANY}
                    onValueChange={(value) => set({ severity: value === ANY ? null : value })}
                >
                    <SelectTrigger className="h-9 w-40" aria-label="Severity">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any severity</SelectItem>
                        {severityOptions.map((value) => (
                            <SelectItem key={value} value={value}>
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/*
                  The source select offers **only** what the registry answered:
                  `?source=` is a `z.enum` over the live registry ids, so a
                  hand-written option would be a `400` the day the two drifted.
                  Until the read lands there is no source filter to offer, which
                  is why this renders nothing rather than an empty select.
                */}
                {sourceOptions.length > 0 ? (
                    <Select
                        value={values.source || ANY}
                        onValueChange={(value) => set({ source: value === ANY ? null : value })}
                    >
                        <SelectTrigger className="h-9 w-56" aria-label="Source">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any source</SelectItem>
                            {sourceOptions.map((value) => (
                                <SelectItem key={value} value={value} className="font-mono text-xs">
                                    {value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}

                <DateRangeFilter
                    label="Occurred"
                    from={values.from}
                    to={values.to}
                    onChange={(range) => set({ from: range.from || null, to: range.to || null })}
                    timeZone={timeZone}
                    maxDays={MAX_DAYS_DEFAULT}
                />

                <Select
                    value={values.sort || SORT_DEFAULT}
                    onValueChange={(value) => set({ sort: value })}
                >
                    <SelectTrigger className="h-9 w-52" aria-label="Sort">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {meta ? (
                    <p className="text-muted-foreground ml-auto text-sm tabular-nums">
                        {meta.total} total · {meta.unreadCount} unread
                    </p>
                ) : null}
            </FilterBar>

            <DataState
                isLoading={inbox.isLoading}
                error={inbox.error}
                isEmpty={rows.length === 0}
                onRetry={inbox.reload}
                loading={<ListSkeleton rows={5} />}
                empty={
                    <EmptyState
                        icon={Inbox}
                        title={
                            status === 'unread'
                                ? 'Nothing unread'
                                : `No ${STATUS_LABELS[status].toLowerCase()} notifications`
                        }
                        description={
                            isFiltered
                                ? 'Nothing matches these filters. Notifications are derived from platform activity, and which of them reach you is decided per source.'
                                : 'Notifications are derived from platform activity. An empty list means none have been raised that you are entitled to see — the sources page says which those are.'
                        }
                    />
                }
            >
                <div className="overflow-hidden rounded-lg border">
                    {rows.map((notification) => (
                        <NotificationRow
                            key={notification.id}
                            notification={notification}
                            onRead={() => {
                                adjustUnread(-1);
                                inbox.reload();
                            }}
                            onUnread={() => {
                                adjustUnread(1);
                                inbox.reload();
                            }}
                            onArchiveChange={reconcile}
                        />
                    ))}
                </div>
            </DataState>

            {meta ? (
                <Pager
                    meta={meta}
                    noun="notifications"
                    isBusy={inbox.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
