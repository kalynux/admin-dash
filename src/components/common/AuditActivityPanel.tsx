import { useMemo, useState } from 'react';
import { History } from 'lucide-react';

import { AuditStatusBadge } from '@/components/audit/AuditStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useAuditActionVocabulary } from '@/hooks/use-audit-actions';
import { dayStringRangeToInstants, rangeExceedsMaxDays, resolveDayFilter } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import type { AuditPage } from '@/services/audit.service';
import { AUDIT_STATUSES, type AuditEntry } from '@/types/audit.types';

/**
 * `GET /<domain>/:id/activity` — **what administrators have done to one record.**
 *
 * ── Why this is shared rather than copied ─────────────────────────────────────
 * Five domains expose the same feed against the same audit shape: users, vendors,
 * agencies, agents, orders and shipments. The first two were written separately
 * and, once the domain nouns are normalised, differed in prose, one Tailwind
 * width and the empty state — nothing else. Six copies of that is six places for
 * the `platformCode` fallback or the `pages: 0` rule to drift.
 *
 * What stays per-domain is what genuinely differs: the request, the action
 * vocabulary its `?action=` filter offers, the labels for those actions, and the
 * sentences explaining what this particular feed is **not**. Those are props.
 *
 * ── What every one of these feeds is not ──────────────────────────────────────
 * It is never the subject's own activity. A vendor's orders, an agent's
 * deliveries and a customer's tickets live in other domains behind other
 * permissions, and assembling them here would let one `*.read` reach data those
 * permissions exist to gate. Each call site says so in `emptyDescription`, so
 * nobody reads "no activity" as "nothing has happened".
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * Every one of these endpoints needs its domain read **and** `audit.read`, in
 * `all` mode. This component does not check it; the detail screen refuses to
 * render the tab at all without both, which is the honest shape — a tab that only
 * ever shows a refusal is worse than no tab.
 *
 * ── Filters are local state, not the URL ──────────────────────────────────────
 * Unlike a directory's filters. The URL already identifies the record, which is
 * the part worth sharing: a colleague sent this link wants the account, not the
 * sender's half-applied action filter.
 *
 * Note the span cap is a **prop**. These feeds cap at 366 days; `GET /audit`
 * itself caps at 92, and sharing one constant between them would silently widen
 * the tighter of the two.
 */

/** The query these feeds accept. Identical across all six. */
export interface AuditActivityQuery {
    action?: string;
    status?: string;
    page?: number;
    limit?: number;
    from?: string;
    to?: string;
}

export interface AuditActivityPanelProps {
    /**
     * The request. A domain service function, already bound to its record id.
     *
     * Kept separate from `basePath` below on purpose: the service owns the URL
     * and its `encodeURIComponent`ing, and this component owns only the cache
     * key. Handing it a path to fetch would put a second URL builder here.
     */
    read: (query: AuditActivityQuery, options: { signal: AbortSignal }) => Promise<AuditPage>;
    /**
     * The request path **without a query string** — used only to build the
     * `useAsyncData` key, which must be a string and must change with the query.
     */
    basePath: string;
    /** The actions this feed's `?action=` filter offers, from the domain's types. */
    actions: readonly string[];
    /** Labels for those actions. A name missing from the map renders raw. */
    actionLabels: Readonly<Record<string, string>>;
    /**
     * Backfill the `?action=` options from `GET /audit/actions`, **by name prefix**.
     *
     * ── Why a prefix and not the catalog's `target` ───────────────────────────
     * Every one of these endpoints builds its `?action=` enum as
     * `AUDIT_ACTION_NAMES.filter(a => a.startsWith(p))` — verified in each
     * module's validator. Filtering by the catalog's `target` instead would offer
     * actions the endpoint cannot accept: `billing.subscriptions.assign_vendor`
     * carries `target: 'vendor'` and genuinely appears on the vendor feed, but
     * that feed's own filter cannot select it, so offering it is a guaranteed
     * `400` on a row already on screen.
     *
     * `''` for the two administrator feeds, whose routes validate against the
     * full `ListAuditQuerySchema` and so accept all eighty names.
     *
     * ── Opt-in, and branched on `undefined` rather than truthiness ────────────
     * `''` is a meaningful value. Omitting the prop entirely makes this component
     * issue **no catalog request at all**, which is what keeps the call sites
     * that have not adopted it — and their tests — unchanged.
     */
    actionPrefix?: string;
    /**
     * Backfill by the catalog's `target` instead of by name prefix.
     *
     * ⚠ Only legal where the endpoint validates `?action=` against the **whole**
     * catalog, which on this dashboard means the two administrator feeds. There
     * the narrowing is a usability choice rather than a constraint, and `target`
     * is the axis that expresses *"things done to an administrator"* — a question
     * no prefix can ask, because those actions live in several families.
     *
     * Never pass this alongside `actionPrefix`: on a prefix-derived endpoint it
     * would offer actions the server refuses.
     */
    actionTarget?: string;
    /** This endpoint's own `maxDays` cap. */
    maxRangeDays: number;
    /** The operator's zone, from their profile — never the browser's. */
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
    caption: string;
    emptyTitle: string;
    /** What this feed records, and what it deliberately does not. */
    emptyDescription: string;
    /**
     * The action the `?action=` filter starts on. Defaults to no filter.
     *
     * Exists so a screen can open this feed already answering a specific
     * question — the payout detail's *"see who has revealed this"* lands here
     * filtered to the disclosure action. Read once, as the initial state: this
     * is a starting point, not a controlled value, so the operator can clear it
     * like any other filter.
     */
    initialAction?: string;
}

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * The audit vocabulary, whole — now shared with the trail via `audit.types`.
 *
 * `queued` cannot occur on most of these feeds — dual control applies to three
 * actions and none of them are in these domains — but the filter offers the
 * server's enum rather than a subset this client decided. The server pins it;
 * second-guessing it is how a filter stops matching a row already on screen.
 *
 * The tone map moved to `AuditStatusBadge` for the same reason: two surfaces
 * rendering the same five values must not be able to disagree about which of
 * them is a warning.
 */
const ACTIVITY_STATUSES = AUDIT_STATUSES;

export function AuditActivityPanel({
    read,
    basePath,
    actions,
    actionLabels,
    actionPrefix,
    actionTarget,
    maxRangeDays,
    timeZone,
    reloadToken,
    caption,
    emptyTitle,
    emptyDescription,
    initialAction,
}: AuditActivityPanelProps) {
    const vocabulary = useAuditActionVocabulary({
        prefix: actionPrefix,
        target: actionTarget,
        enabled: actionPrefix !== undefined || actionTarget !== undefined,
    });

    /**
     * The declared list first, then anything the catalog adds.
     *
     * Union rather than replacement, in that order, for two reasons: the select
     * is populated on first paint instead of appearing a beat later, and a
     * catalog that fails to load leaves exactly the behaviour this panel shipped
     * with. The catalog is the thing that stops the list going stale; the static
     * list is the thing that stops the filter disappearing.
     */
    const offeredActions = useMemo(() => {
        if (vocabulary.actions.length === 0) return actions;
        return [...new Set([...actions, ...vocabulary.actions])];
    }, [actions, vocabulary.actions]);

    /**
     * Hand-written labels win over the catalog's `summary`.
     *
     * A summary is a sentence — *"Mark a payout request as paid — records that
     * money has left the platform"* — which is right for a feed row and unusable
     * as a 70-character `<SelectItem>`. So the short domain phrase wins where one
     * exists, and the summary fills in for catalogued actions nobody wrote one
     * for.
     */
    const offeredLabels = useMemo(
        () => ({ ...vocabulary.labels, ...actionLabels }),
        [vocabulary.labels, actionLabels],
    );

    const [action, setAction] = useState<string>(initialAction ?? ANY);
    const [status, setStatus] = useState<string>(ANY);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);

    const span = dayStringRangeToInstants(from, to, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, maxRangeDays);

    const query = useMemo<AuditActivityQuery>(
        () => ({
            action: action === ANY ? undefined : action,
            status: status === ANY ? undefined : status,
            page,
            limit: PAGE_SIZE_DEFAULT,
            // An over-cap range is a `400`; send no range rather than one that
            // will be refused. `DateRangeFilter` says so inline at the same time.
            ...(spanOverCap ? {} : resolveDayFilter(from, to, timeZone)),
        }),
        [action, status, page, from, to, timeZone, spanOverCap],
    );

    const path = withQuery(basePath, { ...query });
    const activity = useAsyncData(`${path}#${reloadToken}`, (signal) => read(query, { signal }));

    const rows = activity.data?.data ?? [];
    const meta = activity.data?.meta;
    const isFiltered = action !== ANY || status !== ANY || Boolean(from || to);

    function clear() {
        setAction(ANY);
        setStatus(ANY);
        setFrom('');
        setTo('');
        setPage(1);
    }

    const columns = useMemo<Column<AuditEntry>[]>(
        () => [
            {
                id: 'occurredAt',
                header: 'When',
                className: 'text-muted-foreground align-top text-sm',
                cell: (entry) => formatInstantInZone(entry.occurredAt, timeZone) ?? '—',
            },
            {
                id: 'action',
                header: 'Action',
                className: 'align-top',
                cell: (entry) => (
                    <div className="min-w-0">
                        <p className="text-sm font-medium">
                            {/* An action the catalog no longer describes still renders — a
                                closed lookup here would blank a row on a routine deploy. */}
                            {offeredLabels[entry.action] ?? entry.action}
                        </p>
                        {entry.actionSummary ? (
                            <p className="text-muted-foreground text-xs">{entry.actionSummary}</p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'actor',
                header: 'By',
                className: 'align-top',
                cell: (entry) => (
                    <div className="min-w-0">
                        {/*
                          ⚠ Left as text by the A2 sweep, and this one is a
                          judgement rather than an oversight. The cell is a
                          three-way fallback: a display name (not a value), an
                          email (a value), or the actor *kind* (an enum). One
                          `CopyableValue` here would have to claim a single
                          `label` — the accessible name is "Copy {label}" — for
                          a string that is a person's name on most rows. Naming
                          it "email" would be wrong two thirds of the time, and
                          branching on which field survived would put the
                          fallback rule in two places.

                          It costs little: every one of the six screens that
                          mounts this panel is a record page whose own header
                          already carries the copyable identity, and this column
                          answers "who", not "which address".
                        */}
                        <p className="truncate text-sm">
                            {entry.actor.displayName ?? entry.actor.email ?? entry.actor.kind}
                        </p>
                        {/* The level held **at the time**, not the level now. */}
                        {entry.actor.tier !== null ? (
                            <p className="text-muted-foreground text-xs">
                                Tier {entry.actor.tier} at the time
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Outcome',
                className: 'align-top',
                cell: (entry) => (
                    <div className="space-y-1">
                        <AuditStatusBadge status={entry.status} />
                        {/* On a failed delegated write this is the only handle on why.

                            Mono but not copyable: both are registry codes from
                            a closed catalogue — `errors.md` here,
                            `details.platformCode` from jovi-mall there — which
                            the sweep's rules put with the enums and the badges,
                            not with the ids. */}
                        {entry.outcome.platformCode ? (
                            <p className="text-muted-foreground font-mono text-xs">
                                {entry.outcome.platformCode}
                            </p>
                        ) : entry.outcome.code ? (
                            <p className="text-muted-foreground font-mono text-xs">
                                {entry.outcome.code}
                            </p>
                        ) : null}
                    </div>
                ),
            },
        ],
        [timeZone, offeredLabels],
    );

    return (
        <div className="space-y-4">
            <FilterBar isFiltered={isFiltered} onClear={clear}>
                {/*
                  A feed may legitimately offer no action vocabulary: the actor
                  half of the administrator feeds spans all 21 permission
                  families, so any list this client could hard-code would be a
                  filter that silently omits most of what it filters over. An
                  empty list means "no filter", not "a filter with one option".
                */}
                {offeredActions.length > 0 ? (
                    <Select
                        value={action}
                        onValueChange={(value) => {
                            setAction(value);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-56" aria-label="Action">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any action</SelectItem>
                            {offeredActions.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {offeredLabels[name] ?? name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}

                <Select
                    value={status}
                    onValueChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-40" aria-label="Outcome">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any outcome</SelectItem>
                        {ACTIVITY_STATUSES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="When"
                    from={from}
                    to={to}
                    timeZone={timeZone}
                    maxDays={maxRangeDays}
                    onChange={(range) => {
                        setFrom(range.from);
                        setTo(range.to);
                        setPage(1);
                    }}
                />
            </FilterBar>

            <DataTable
                caption={caption}
                columns={columns}
                rows={rows}
                rowKey={(entry) => entry.id}
                isLoading={activity.isLoading}
                isRefreshing={activity.isRefreshing}
                error={activity.error}
                onRetry={activity.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={History}
                        title={isFiltered ? 'Nothing matches these filters' : emptyTitle}
                        description={emptyDescription}
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={clear}>
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
                    isBusy={activity.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {/* Why the feed stops where it does, rather than looking broken at the boundary. */}
            {meta?.oldestRetainedAt ? (
                <p className="text-muted-foreground text-xs">
                    The trail is kept for {meta.retentionDays ?? '—'} days. The oldest entry still
                    held is from {formatInstantInZone(meta.oldestRetainedAt, timeZone)}.
                </p>
            ) : null}
        </div>
    );
}
