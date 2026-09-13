import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, ScrollText, ShieldAlert, X } from 'lucide-react';

import { AuditStatusBadge } from '@/components/audit/AuditStatusBadge';
import { AuditTargetLink } from '@/components/audit/AuditTargetLink';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAsyncData } from '@/hooks/use-async-data';
import { useAuditActionVocabulary } from '@/hooks/use-audit-actions';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    MAX_DAYS_AUDIT,
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAuditEntries } from '@/services/audit.service';
import { useAdmin, usePermissions } from '@/store';
import {
    AUDIT_STATUSES,
    AUDIT_TARGET_TYPES,
    type AuditEntry,
    type AuditListQuery,
} from '@/types/audit.types';
import { PERMISSION_FAMILIES } from '@/types/permissions.types';

/**
 * `GET /audit` — the record of every administrator action, searchable.
 *
 * ── What this is that the nine activity panels are not ────────────────────────
 * Every other audit surface on this dashboard is a *slice* keyed to one record:
 * this vendor's rows, this payout's rows. This is the whole trail, which is the
 * only place four questions can be asked at all — what did this administrator do
 * today, what happened under one request id, which sensitive money actions ran
 * last week, and what was refused and why.
 *
 * ── Support sees a narrower feed, and is told so ──────────────────────────────
 * `audit.read` is held by all three levels, but the rows a Support administrator
 * may see are narrowed **per row, in the query**: platform actors and records,
 * plus anything they did themselves. Rows classed `internal` — administrators,
 * sessions, approvals, exports, feature flags, workers, maintenance windows — are
 * invisible to them, because without that narrowing this feed would be a side
 * door onto the administrator directory the grant table withholds. A short feed
 * is therefore not evidence of a quiet platform, and the empty state says so
 * rather than leaving the reader to conclude it.
 *
 * ── Filters an operator browses by, and filters they arrive at ────────────────
 * `actorId`, `targetId` and `correlationId` are identifiers, not vocabularies.
 * Nobody types a 24-hex id into a box; they get there by clicking a row. So those
 * three are honoured from the URL and *set* by navigation, and each shows as a
 * removable chip so a filtered-by-id view is legible and clearable. The rest are
 * real controls.
 *
 * ── One sort key, deliberately ────────────────────────────────────────────────
 * `occurredAt` only. A trail is a chronology, and sorting it by actor or action
 * would scan the largest collection in the database for an ordering nobody reads
 * a trail in — so only that column carries a `sortKey`, and a second one would be
 * a `400` naming the permitted set.
 *
 * ── The span cap here is 92 days, not 366 ─────────────────────────────────────
 * Every other feed in this app caps at 366. `MAX_DAYS_AUDIT` is the tighter one
 * and must not be replaced by the shared default.
 *
 * ── Almost none of this table's `font-mono` is a copyable value ───────────────
 * The Action column's second line is an **action name** and the Result column's
 * is an **error code**: both are vocabulary you filter on, not handles you
 * paste, and both are already reachable as filters. The one genuine value in a
 * row is the resource id, and it is `AuditTargetLink` that renders it — so the
 * affordance lives there, once, rather than in this column definition.
 */

/** Every key this screen owns. `page` is managed separately by the hook. */
const FILTER_KEYS = [
    'search',
    'action',
    'actionFamily',
    'status',
    'targetType',
    'sensitiveOnly',
    'from',
    'to',
    'sort',
    // Identifier filters — no control, honoured from the URL. See the note above.
    'actorId',
    'targetId',
    'correlationId',
] as const;

const SORT_DEFAULT = '-occurredAt';

const FILTER_DEFAULTS = { sort: SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function AuditTrail() {
    const admin = useAdmin();
    const { tier } = usePermissions();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    // The whole catalog: `GET /audit` validates `?action=` against every one of
    // the eighty names, so there is no prefix or target to narrow by here.
    const vocabulary = useAuditActionVocabulary();

    /**
     * Whether the picked range is wider than this endpoint allows.
     *
     * `DateRangeFilter` *says so* inline but does not stop anything being sent —
     * it is a control, not a request builder. So the screen has to withhold the
     * range itself, or the first over-cap pick round-trips a `400` and replaces
     * the table with an error panel. Withholding it instead leaves the last good
     * page on screen underneath the inline message.
     */
    const span = dayStringRangeToInstants(values.from, values.to, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, MAX_DAYS_AUDIT);

    const query = useMemo<AuditListQuery>(
        () => ({
            // `buildQuery` drops empty strings, and an empty `?search=` is a 400
            // rather than "no filter" — so `|| undefined` is belt over braces.
            search: values.search || undefined,
            action: values.action || undefined,
            actionFamily: values.actionFamily || undefined,
            status: values.status || undefined,
            targetType: values.targetType || undefined,
            actorId: values.actorId || undefined,
            targetId: values.targetId || undefined,
            correlationId: values.correlationId || undefined,
            // Only ever `true` or absent. `buildQuery` serialises `false` because
            // it is a real value elsewhere, and `sensitiveOnly=false` is a filter
            // nobody asked for.
            sensitiveOnly: values.sensitiveOnly === 'true' ? true : undefined,
            sort: values.sort || SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            // An over-cap range is a 400; send no range rather than one that will
            // be refused. `DateRangeFilter` says so inline at the same time.
            ...(spanOverCap ? {} : resolveDayFilter(values.from, values.to, timeZone)),
        }),
        [values, page, timeZone, spanOverCap],
    );

    const path = withQuery('/audit', { ...query });
    const trail = useAsyncData(path, (signal) => listAuditEntries(query, { signal }));

    const rows = trail.data?.data ?? [];
    const meta = trail.data?.meta;

    const columns = useMemo<Column<AuditEntry>[]>(
        () => [
            {
                id: 'occurredAt',
                header: 'When',
                // The endpoint's allowlist has exactly one entry. No other column
                // may carry a `sortKey`.
                sortKey: 'occurredAt',
                className: 'text-muted-foreground align-top text-sm whitespace-nowrap',
                cell: (entry) => formatInstantInZone(entry.occurredAt, timeZone) ?? '—',
            },
            {
                id: 'action',
                header: 'Action',
                className: 'align-top',
                cell: (entry) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/audit/${entry.id}`}
                            className="font-medium hover:underline"
                        >
                            {/* The catalog's own summary, falling back to the raw
                                name — an action the catalog no longer describes
                                still renders, because a closed lookup would blank
                                a row on a routine deploy. */}
                            {entry.actionSummary ?? vocabulary.labels[entry.action] ?? entry.action}
                        </Link>
                        <p className="text-muted-foreground truncate font-mono text-xs">
                            {entry.action}
                        </p>
                    </div>
                ),
            },
            {
                id: 'actor',
                header: 'Actor',
                className: 'align-top',
                cell: (entry) => (
                    <div className="min-w-0">
                        <p className="truncate text-sm">
                            {entry.actor.displayName ?? entry.actor.email ?? entry.actor.kind}
                        </p>
                        {/* The level held **at the time**, not the level now. */}
                        {entry.actor.tier !== null ? (
                            <p className="text-muted-foreground text-xs">
                                Tier {entry.actor.tier} at the time
                            </p>
                        ) : (
                            <p className="text-muted-foreground text-xs capitalize">
                                {entry.actor.kind}
                            </p>
                        )}
                    </div>
                ),
            },
            {
                id: 'target',
                header: 'Resource',
                className: 'align-top text-sm',
                cell: (entry) => (
                    <AuditTargetLink
                        type={entry.target.type}
                        id={entry.target.id}
                        label={entry.target.label}
                    />
                ),
            },
            {
                id: 'status',
                header: 'Result',
                className: 'align-top',
                cell: (entry) => (
                    <div className="space-y-1">
                        <AuditStatusBadge status={entry.status} />
                        {/* On a failed delegated write the platform's own code is
                            the only handle on *why*. */}
                        {entry.outcome.platformCode ?? entry.outcome.code ? (
                            <p className="text-muted-foreground font-mono text-xs">
                                {entry.outcome.platformCode ?? entry.outcome.code}
                            </p>
                        ) : null}
                        {entry.sensitive ? (
                            <Badge variant="outline" className="gap-1 text-[11px]">
                                <ShieldAlert className="size-3" />
                                Sensitive
                            </Badge>
                        ) : null}
                    </div>
                ),
            },
        ],
        [timeZone, vocabulary.labels],
    );

    /** The three identifier filters, as removable chips. */
    const pinned = (
        [
            { key: 'actorId', label: 'Actor' },
            { key: 'targetId', label: 'Resource id' },
            { key: 'correlationId', label: 'Request' },
        ] as const
    ).filter(({ key }) => Boolean(values[key]));

    return (
        <PageContainer
            title="Audit trail"
            description="Every administrator action: who did it, to what, and how it ended. Newest first — a trail is a chronology, so time is the only ordering offered."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={trail.reload}
                    disabled={trail.isLoading || trail.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search the trail"
                    placeholder="Action, actor, resource"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                {/*
                  No action select until the catalog arrives. An empty list here
                  means "we do not yet know the vocabulary", and offering a filter
                  built from a guess is how a client starts sending 400s.
                */}
                {vocabulary.actions.length > 0 ? (
                    <Select
                        value={values.action || ANY}
                        onValueChange={(value) => set({ action: value === ANY ? null : value })}
                    >
                        <SelectTrigger className="w-64" aria-label="Action">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any action</SelectItem>
                            {vocabulary.actions.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {vocabulary.labels[name] ?? name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}

                {/*
                  Families come from the pinned catalog, not from the actions the
                  server happened to send: `actionFamily` validates against
                  `PERMISSION_FAMILIES`, and the families *represented in the
                  action catalog* are a strict subset of those 20. Deriving the
                  options from the catalog would quietly drop the families whose
                  actions are all still unbuilt.
                */}
                <Select
                    value={values.actionFamily || ANY}
                    onValueChange={(value) => set({ actionFamily: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Family">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any family</SelectItem>
                        {PERMISSION_FAMILIES.map((family) => (
                            <SelectItem key={family} value={family}>
                                {family}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Result">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any result</SelectItem>
                        {AUDIT_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.targetType || ANY}
                    onValueChange={(value) => set({ targetType: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Resource type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any resource</SelectItem>
                        {AUDIT_TARGET_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                                {type.replace(/_/g, ' ')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="When"
                    from={values.from}
                    to={values.to}
                    timeZone={timeZone}
                    // 92 here, not the 366 every other feed allows.
                    maxDays={MAX_DAYS_AUDIT}
                    onChange={(range) => set({ from: range.from || null, to: range.to || null })}
                />

                <div className="flex items-center gap-2">
                    <Switch
                        id="audit-sensitive-only"
                        checked={values.sensitiveOnly === 'true'}
                        onCheckedChange={(checked) =>
                            set({ sensitiveOnly: checked ? 'true' : null })
                        }
                    />
                    <Label htmlFor="audit-sensitive-only" className="text-sm font-normal">
                        Sensitive only
                    </Label>
                </div>
            </FilterBar>

            {pinned.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    {/* These do hold real ids, and they still do not get a copy
                        button: a chip is one control that removes a filter, and a
                        second icon button inside it competes with the X for the
                        same few pixels. The id is in the address bar, and the row
                        it came from renders it as a value. */}
                    {pinned.map(({ key, label }) => (
                        <Badge key={key} variant="secondary" className="gap-1 py-1 pr-1 pl-2">
                            <span className="text-muted-foreground">{label}:</span>
                            <span className="max-w-[16rem] truncate font-mono text-xs">
                                {values[key]}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Clear ${label.toLowerCase()} filter`}
                                className="size-5"
                                onClick={() => set({ [key]: null })}
                            >
                                <X className="size-3" />
                            </Button>
                        </Badge>
                    ))}
                </div>
            ) : null}

            {meta && !trail.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'entry' : 'entries'}
                </p>
            ) : null}

            <DataTable
                caption="Audit trail"
                columns={columns}
                rows={rows}
                rowKey={(entry) => entry.id}
                sort={values.sort || SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={trail.isLoading}
                isRefreshing={trail.isRefreshing}
                error={trail.error}
                onRetry={trail.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={ScrollText}
                        title={isFiltered ? 'Nothing matches these filters' : 'Nothing on record'}
                        description={
                            tier === 3
                                ? 'Your view of the trail covers platform activity — users, vendors, agencies, agents, orders, shipments and the cash chain — plus anything you did yourself. Actions on this service’s own machinery are not shown, so a short feed here is not the same as a quiet platform.'
                                : 'Every administrator action is recorded before it answers, so an empty result means nothing matched — not that something went unrecorded.'
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
                    noun="entries"
                    isBusy={trail.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {/* Why the feed stops where it does, rather than looking broken at the boundary. */}
            {meta?.oldestRetainedAt ? (
                <p className="text-muted-foreground text-xs">
                    The trail is kept for {meta.retentionDays ?? '—'} days. The oldest entry still
                    held is from {formatInstantInZone(meta.oldestRetainedAt, timeZone)}. Rows leave
                    only once they have been exported <em>and</em> aged — never for age alone.
                </p>
            ) : null}
        </PageContainer>
    );
}
