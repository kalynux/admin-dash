import { useMemo, useState } from 'react';
import { Info, RotateCw, ScrollText } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Field, ScrubbedJson, ScrubbedText } from '@/components/system/ScrubbedFields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatInstantInZone, formatRelative } from '@/lib/format';
import { resolveTimeZone } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { listSystemErrors } from '@/services/system.service';
import { useAdmin, usePermissions } from '@/store';
import { ApiError } from '@/types/api.types';
import {
    ERROR_CATEGORIES,
    ERROR_QUERY_TOO_BROAD_CODE,
    LOG_SOURCES,
    type AdminErrorEntry,
    type DeveloperErrorEntry,
    type SupportErrorEntry,
    type SystemErrorsPage,
} from '@/types/system.types';

const FILTER_KEYS = ['requestId', 'code', 'category', 'source', 'since'] as const;
const ANY = 'any';

/** What each rung includes, said on screen rather than left to be inferred. */
const VIEW_COPY: Record<string, string> = {
    support:
        'You are seeing the support view: what the caller was shown, plus the reference and the category. The internal diagnosis, the unmasked details and the stack are not included — this is everything at this level, not a truncated version of more.',
    admin: 'You are seeing the admin view: the operational diagnosis and the unmasked details, for every category including the masked ones. The stack is not included.',
    developer: 'You are seeing the developer view: the complete record, including the stack and the cause chain.',
};

function isAdminEntry(entry: SupportErrorEntry): entry is AdminErrorEntry {
    return 'masked' in entry;
}

function isDeveloperEntry(entry: SupportErrorEntry): entry is DeveloperErrorEntry {
    return 'raw' in entry;
}

/**
 * The platform error journal — one route, three answers.
 *
 * ── Branch on `view`, never on the caller's tier ─────────────────────────────
 * This is the service's only `any`-mode guard: three different permissions reach it and the
 * *server* decides the projection. So the union is narrowed on `data.view`, which is what the
 * response actually contains. Deriving it from `usePermissions().tier` would have the client
 * reading fields that are not there the moment a grant changes mid-session — and `tier` and
 * `status` are re-read from the database on every request, so that is a real window.
 *
 * **`view` is rendered.** The contract's reason is precise: without it a Support agent reading a
 * thin row cannot tell *"there is nothing more to know"* from *"I am not being shown it"*, and
 * would escalate a resolved incident.
 *
 * ── Page off `nextBefore`, never off the row count ───────────────────────────
 * `before` is a cursor rather than an offset, because the capped collection evicts from the
 * front. And the support-level row filter runs in wi-admin **after** the platform returned the
 * page — so a support caller can get three rows against `limit=100` with more still to come.
 * Stopping on a short page would silently hide rows.
 *
 * ── The narrow-query rule comes from the held set, not the tier ──────────────
 * A caller who holds `support.errors.lookup` and neither of the other two must supply a
 * `requestId`, or a `code` *and* a `since`. That is derived from `held` because `if (tier === 3)`
 * is banned in this codebase — and because the permission, not the level, is what the service
 * actually keys on.
 */
export function SystemErrors() {
    const admin = useAdmin();
    const { held } = usePermissions();
    const { token, refresh } = useRefreshToken();
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS);

    const timeZone = resolveTimeZone(admin?.timezone);

    /**
     * Does this administrator have to narrow the query before it is legal?
     *
     * True only when `support.errors.lookup` is the *sole* grant reaching this route. Holding
     * either of the wider two lifts the requirement, which mirrors what the service checks.
     */
    const mustNarrow = useMemo(() => {
        if (!held) return false;
        return (
            held.has('support.errors.lookup') &&
            !held.has('system.errors.read') &&
            !held.has('developer_tools.logs.read')
        );
    }, [held]);

    const queryIsNarrowEnough =
        !mustNarrow || Boolean(values.requestId) || Boolean(values.code && values.since);

    const query = useMemo(
        () => ({
            requestId: values.requestId || undefined,
            code: values.code || undefined,
            category: values.category || undefined,
            source: values.source || undefined,
            since: values.since ? new Date(values.since).toISOString() : undefined,
            limit: 100,
        }),
        [values],
    );

    /**
     * Pages accumulate rather than replace, because this is a cursor feed.
     *
     * Kept in state and fetched imperatively rather than through `useAsyncData`, which fires on
     * mount and on every key change — appending would be impossible and "load more" would reset.
     */
    const [pages, setPages] = useState<SystemErrorsPage[]>([]);
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [detail, setDetail] = useState<SupportErrorEntry | null>(null);
    const [fetchedKey, setFetchedKey] = useState<string | null>(null);

    const requestKey = `${JSON.stringify(query)}#${token}`;

    async function load(before?: string) {
        setLoading(true);
        setError(null);
        try {
            const page = await listSystemErrors({ ...query, before });
            setPages((current) => (before ? [...current, page] : [page]));
        } catch (caught) {
            setError(caught);
            if (!before) setPages([]);
        } finally {
            setLoading(false);
        }
    }

    // Fetch on the first render and whenever the query or the refresh token moves. Adjusted
    // during render rather than in an effect, matching this repo's rule; the request itself is
    // fired from the handler below, so nothing sets state synchronously here.
    if (fetchedKey !== requestKey && queryIsNarrowEnough) {
        setFetchedKey(requestKey);
        void load();
    }

    const latest = pages[pages.length - 1];
    const entries = pages.flatMap((page) => page.entries as SupportErrorEntry[]);
    const view = latest?.view ?? '';
    const tooBroad = error instanceof ApiError && error.code === ERROR_QUERY_TOO_BROAD_CODE;

    return (
        <PageContainer
            title="Error journal"
            description="What failed on the platform, at the depth your level allows."
            actions={
                <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            {view ? (
                <div className="bg-muted/40 flex gap-2.5 rounded-lg border p-3 text-sm">
                    <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                    <p className="text-muted-foreground">
                        {VIEW_COPY[view] ?? `Projection: ${view}.`}
                    </p>
                </div>
            ) : null}

            {mustNarrow ? (
                <div
                    className={cn(
                        'rounded-lg border p-3 text-sm',
                        queryIsNarrowEnough
                            ? 'text-muted-foreground'
                            : 'border-warning/40 bg-warning/10',
                    )}
                >
                    <p className={queryIsNarrowEnough ? '' : 'font-medium'}>
                        This search has to be narrow: give a request reference, or an error code
                        together with a start date.
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                        A support conversation always starts with a reference or a symptom, so
                        requiring one costs nothing — and an open feed would name a route group, a
                        role and a timestamp for every failure on the platform.
                    </p>
                </div>
            ) : null}

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    value={values.requestId}
                    onChange={(next) => set({ requestId: next }, { replace: true })}
                    label="Search by request reference"
                    placeholder="Request reference"
                    maxLength={200}
                />

                <SearchInput
                    value={values.code}
                    onChange={(next) => set({ code: next }, { replace: true })}
                    label="Search by error code"
                    placeholder="Error code"
                    maxLength={100}
                />

                <FilterField label="Category" htmlFor="filter-category">
                    <Select
                        value={values.category || ANY}
                        onValueChange={(next) => set({ category: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="filter-category" className="w-[170px]">
                            <SelectValue placeholder="Any category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any category</SelectItem>
                            {ERROR_CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>
                                    {category}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Source" htmlFor="filter-source">
                    <Select
                        value={values.source || ANY}
                        onValueChange={(next) => set({ source: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="filter-source" className="w-[150px]">
                            <SelectValue placeholder="Durable store" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Durable store</SelectItem>
                            {LOG_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>
                                    {source === 'ring' ? 'In-memory buffer' : 'Durable store'}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                {/*
                  A single day, not a range — `?since=` has no other end — so this
                  is a native date input rather than the `DateRangeFilter` every
                  other list carries. It still wears the same title and the same
                  `h-9` as its neighbours.
                */}
                <FilterField label="From" htmlFor="filter-since">
                    <input
                        id="filter-since"
                        type="date"
                        value={values.since}
                        onChange={(event) => set({ since: event.target.value || null })}
                        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    />
                </FilterField>
            </FilterBar>

            {tooBroad ? (
                <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
                    <p className="font-medium">{(error as ApiError).message}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                        {/* 400, not 403. The permission is held and the request is simply too
                            broad, so this belongs on the form rather than in a refusal state. */}
                        You do hold the permission for this search — it just has to be narrower.
                    </p>
                </div>
            ) : null}

            <DataState
                isLoading={isLoading && pages.length === 0}
                error={tooBroad ? undefined : error}
                isEmpty={entries.length === 0}
                onRetry={() => void load()}
                empty={
                    <EmptyState
                        icon={ScrollText}
                        title={
                            queryIsNarrowEnough
                                ? 'No errors match'
                                : 'Narrow the search to begin'
                        }
                        description={
                            queryIsNarrowEnough
                                ? 'Nothing in the journal matches these filters.'
                                : 'Give a request reference, or an error code and a start date.'
                        }
                    />
                }
            >
                <ul className="border-border divide-border divide-y rounded-lg border">
                    {entries.map((entry, index) => (
                        <li key={`${entry.requestId}-${entry.at}-${index}`}>
                            <button
                                type="button"
                                onClick={() => setDetail(entry)}
                                className="hover:bg-muted/40 flex w-full flex-col gap-1 px-4 py-3 text-left"
                            >
                                <span className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="font-mono text-[11px]">
                                        {entry.code}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] font-normal">
                                        {entry.category}
                                    </Badge>
                                    <span className="text-muted-foreground text-xs">
                                        {entry.statusCode} · {entry.method ?? '—'}{' '}
                                        {entry.routeGroup ?? ''}
                                    </span>
                                    <span className="text-muted-foreground/70 ml-auto text-xs">
                                        {formatRelative(entry.at)}
                                    </span>
                                </span>
                                <span className="text-sm">{entry.message}</span>
                                {/*
                                  * ⚠ No copy button on the code or the reference *here*. The
                                  * row is a `<button>` and a nested button is invalid nesting;
                                  * both are copyable one click away, in the detail dialog.
                                  */}
                                <span className="text-muted-foreground font-mono text-[11px]">
                                    {entry.requestId ?? 'no reference'}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </DataState>

            {latest?.nextBefore ? (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        disabled={isLoading}
                        onClick={() => void load(latest.nextBefore ?? undefined)}
                    >
                        Load more
                    </Button>
                </div>
            ) : null}

            {latest ? (
                <p className="text-muted-foreground text-xs">
                    Read from the{' '}
                    {latest.sourceUsed === 'ring' ? 'in-memory buffer' : 'durable store'}
                    {latest.sourceReason ? ` — ${latest.sourceReason}` : ''}.{' '}
                    {latest.meta?.warning}
                </p>
            ) : null}

            <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        {/*
                          * ⚠ The code and the reference are copyable **here and not on the
                          * row**, and the reason is structural rather than aesthetic: the row
                          * is itself a `<button>`, and a button inside a button is nesting the
                          * browser reparents — the copy control would end up outside the row it
                          * belongs to. Opening the entry is one click and this is where an
                          * operator is standing when they quote a code into a ticket anyway.
                          *
                          * `variant="plain"` because an error code is a whole word, not an id:
                          * `PAYMENT_GATEWAY_TIMEOUT` truncated to `PAYMEN…MEOUT` is unquotable.
                          * `mono={false}` so the title's own `font-mono text-sm` survives —
                          * the component's mono is `text-xs` and would shrink the heading.
                          *
                          * ⚠ Radix names the dialog from this element, so the accessible name
                          * becomes "PAYMENT_GATEWAY_TIMEOUT Copy error code". Left as it is
                          * deliberately: the extra clause announces the control rather than
                          * misdescribing the dialog, and the alternative — a second copy of the
                          * code two lines below its own heading — is worse to read.
                          */}
                        <DialogTitle className="font-mono text-sm">
                            {detail ? (
                                <CopyableValue
                                    variant="plain"
                                    mono={false}
                                    value={detail.code}
                                    label="error code"
                                />
                            ) : null}
                        </DialogTitle>
                    </DialogHeader>
                    {detail ? (
                        <div className="space-y-3 text-sm">
                            <p className="text-muted-foreground text-xs">
                                {formatInstantInZone(detail.at, timeZone)} ·{' '}
                                {detail.statusCode} · {detail.category}
                            </p>

                            <Field label="Reference">
                                {/*
                                  * Never truncated: this is the cross-service join — the same
                                  * value travels as `X-Request-Id` into the platform's logs and
                                  * into Platform logs' own filter — and half of it joins
                                  * nothing. The `—` stays rather than `NotSet`, because every
                                  * other `Field` on this dialog says `—` for an absent value.
                                  */}
                                {detail.requestId ? (
                                    <CopyableValue
                                        value={detail.requestId}
                                        label="request reference"
                                        truncate={false}
                                    />
                                ) : (
                                    '—'
                                )}
                            </Field>
                            <Field label="Shown to the caller">{detail.message}</Field>
                            <Field label="What to tell them">{detail.hint}</Field>
                            <Field label="Caller">
                                {detail.actorRole ?? 'anonymous or signed out'}
                            </Field>
                            <Field label="Route">
                                {detail.method ?? '—'} {detail.routeGroup ?? '—'}
                            </Field>

                            {isAdminEntry(detail) ? (
                                <>
                                    <Field label="Full path">{detail.path ?? '—'}</Field>
                                    <Field label="Internal diagnosis">
                                        <ScrubbedText
                                            value={detail.internalMessage}
                                            subject="the internal diagnosis"
                                        />
                                        {detail.masked ? (
                                            <span className="text-muted-foreground block text-xs">
                                                The caller saw a substituted message; this is what
                                                the code actually threw.
                                            </span>
                                        ) : null}
                                    </Field>
                                    <Field label="Details">
                                        <ScrubbedJson value={detail.details ?? null} />
                                    </Field>
                                </>
                            ) : null}

                            {isDeveloperEntry(detail) ? (
                                <>
                                    <Field label="Cause">
                                        <ScrubbedText
                                            value={detail.causeMessage}
                                            subject="the cause"
                                        />
                                    </Field>
                                    <Field label="Stack">
                                        <ScrubbedText
                                            value={detail.stack}
                                            subject="the stack"
                                            mono
                                        />
                                    </Field>
                                </>
                            ) : null}
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}
