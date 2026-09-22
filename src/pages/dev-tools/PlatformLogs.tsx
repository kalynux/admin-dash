import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, RotateCw, ScrollText } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { LogEntryDialog } from '@/components/system/LogEntryDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { resolveTimeZone } from '@/lib/datetime';
import { formatRelative } from '@/lib/format';
import { logEntryHeadline, readLogEntry, type LogEntryView } from '@/lib/log-entry';
import { scrubText } from '@/lib/scrub-secrets';
import { cn } from '@/lib/utils';
import { listPlatformLogs } from '@/services/system.service';
import { useAdmin } from '@/store';
import { LOG_LEVELS, LOG_QUERY_MAX, LOG_SOURCES, type PlatformLogsPage } from '@/types/system.types';

const FILTER_KEYS = ['level', 'q', 'requestId', 'source'] as const;
const ANY = 'any';

const LEVEL_TONE: Record<string, string> = {
    fatal: 'border-destructive/40 text-destructive',
    error: 'border-destructive/40 text-destructive',
    warn: 'border-warning/40 text-warning',
};

/**
 * The **platform's** logs — wi-admin has pino and no sinks, and `/system/logs` is reserved for
 * its own, unbuilt.
 *
 * ── Three things that are easy to misread, so all three are on screen ────────
 * - **`level` is at-or-above, never equal-to.** Choosing `warn` includes errors and fatals.
 * - **`sourceUsed` may not be what was asked for.** The service defaults to the durable store and
 *   silently falls back to the in-memory ring, saying why in `sourceReason`. A reader who does
 *   not see that is reading a different store than they requested.
 * - **Log lines are free text and can carry personal data** — an email in an SMTP failure, a
 *   phone number in a send error. The scrubber removes credential *shapes*, never personal data,
 *   deliberately: redacting all of it would destroy the endpoint's reason to exist. That is why
 *   this is tier-1 only, and the warning travels on the response.
 *
 * ── ⚠ On an error line, `msg` is only the code ───────────────────────────────
 * jovi-mall's error handler writes `msg` as `"internal 500 INTERNAL_SERVER_ERROR"` and keeps the
 * failure itself in `httpError` and `err` — see `lib/log-entry.ts`. Until 2026-09-21 this screen
 * rendered `msg` alone, so an operator could see *that* something failed and never *what*, with
 * nothing to click. Each row now carries the thrown message under the code, cut to three lines,
 * and opens the whole entry in `LogEntryDialog`.
 *
 * `q` is bounded at 100 characters as a **pattern-length defence** rather than a UI nicety: the
 * term is escaped and applied literally, and an unbounded one would be a scan amplifier against a
 * collection with no text index.
 *
 * Paging is off `nextBefore` — a cursor, because the capped collection evicts from the front and
 * an offset would yield duplicates and gaps.
 */
export function PlatformLogs() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin?.timezone);
    const { token, refresh } = useRefreshToken();
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS);
    const [opened, setOpened] = useState<LogEntryView | null>(null);

    const query = useMemo(
        () => ({
            level: values.level || undefined,
            q: values.q || undefined,
            requestId: values.requestId || undefined,
            source: values.source || undefined,
            limit: 100,
        }),
        [values],
    );

    const [pages, setPages] = useState<PlatformLogsPage[]>([]);
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [fetchedKey, setFetchedKey] = useState<string | null>(null);

    const requestKey = `${JSON.stringify(query)}#${token}`;

    async function load(before?: string) {
        setLoading(true);
        setError(null);
        try {
            const page = await listPlatformLogs({ ...query, before });
            setPages((current) => (before ? [...current, page] : [page]));
        } catch (caught) {
            setError(caught);
            if (!before) setPages([]);
        } finally {
            setLoading(false);
        }
    }

    if (fetchedKey !== requestKey) {
        setFetchedKey(requestKey);
        void load();
    }

    const latest = pages[pages.length - 1];
    const entries = pages.flatMap((page) => page.entries.map(readLogEntry));

    /**
     * One scrub per line, done here rather than in the row, so the page-level
     * tally and the rendered text come from the same pass. A per-row notice would
     * put a hundred disclosures on a hundred-row page, which is noise rather than
     * disclosure — the count belongs in the banner that is already the
     * read-this-first box. Both texts a row shows are counted; the dialog
     * discloses its own fields beside each one.
     */
    const scrubbedRows = entries.map((entry) => ({
        msg: scrubText(entry.msg),
        headline: scrubText(logEntryHeadline(entry) ?? ''),
    }));
    const maskedLineCount = scrubbedRows.filter(
        (row) => row.msg.matched.length > 0 || row.headline.matched.length > 0,
    ).length;

    return (
        <PageContainer
            title="Platform logs"
            description="jovi-mall's log lines, from its durable store or its in-memory buffer."
            actions={
                <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3 text-sm">
                <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="text-muted-foreground">
                    {latest?.meta?.warning ??
                        'Log lines are free text and can contain personal data.'}{' '}
                    The scrubber removes credential shapes, never personal data — redacting all of
                    it would destroy what these are for. Treat what you read here accordingly.
                    {maskedLineCount > 0 ? (
                        <>
                            {' '}
                            <strong className="text-foreground">
                                {maskedLineCount} line{maskedLineCount === 1 ? '' : 's'} on this
                                page had a credential-shaped value masked by this dashboard.
                            </strong>{' '}
                            That is a second check over the platform's own scrubber — personal data
                            is still not masked, deliberately.
                        </>
                    ) : null}
                </p>
            </div>

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    value={values.q}
                    onChange={(next) => set({ q: next }, { replace: true })}
                    label="Search log text"
                    placeholder="Text to find"
                    maxLength={LOG_QUERY_MAX}
                />

                <SearchInput
                    value={values.requestId}
                    onChange={(next) => set({ requestId: next }, { replace: true })}
                    label="Search by request reference"
                    placeholder="Request reference"
                    maxLength={200}
                />

                <FilterField label="Level" htmlFor="filter-level">
                    <Select
                        value={values.level || ANY}
                        onValueChange={(next) => set({ level: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="filter-level" className="w-[190px]">
                            <SelectValue placeholder="Any level" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any level</SelectItem>
                            {LOG_LEVELS.map((level) => (
                                <SelectItem key={level} value={level}>
                                    {level} and above
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
                        <SelectTrigger id="filter-source" className="w-[160px]">
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
            </FilterBar>

            <DataState
                isLoading={isLoading && pages.length === 0}
                error={error}
                isEmpty={entries.length === 0}
                onRetry={() => void load()}
                empty={
                    <EmptyState
                        icon={ScrollText}
                        title="No log lines match"
                        description="Nothing in the selected store matches these filters."
                    />
                }
            >
                <ul className="border-border divide-border divide-y rounded-lg border">
                    {entries.map((entry, index) => {
                        const level = entry.level;
                        const scrubbed = scrubbedRows[index];
                        return (
                            <li key={`${entry.at}-${index}`} className="space-y-1 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={cn('text-[10px] font-normal', LEVEL_TONE[level])}
                                    >
                                        {level || 'log'}
                                    </Badge>
                                    <span className="text-muted-foreground/70 text-xs">
                                        {formatRelative(entry.at)}
                                    </span>
                                    {entry.requestId ? (
                                        /*
                                         * The one value on this screen worth a copy button, and
                                         * the reason is two controls up: `X-Request-Id` is the
                                         * cross-service join, and "Search by request reference"
                                         * is a filter on this very page. Retyping a UUID off a
                                         * log row into that box is the workflow this replaces.
                                         *
                                         * ⚠ Never truncated. It is shown whole today and the
                                         * filter matches the whole thing — a head-and-tail
                                         * ellipsis would make the displayed value un-typeable
                                         * for anyone whose clipboard is unavailable.
                                         *
                                         * `mono={false}` and the mono class on the wrapper
                                         * instead: the component's own mono is `text-xs`, and
                                         * inheriting keeps this row at the 11px it renders at
                                         * today rather than nudging every log row taller.
                                         */
                                        <CopyableValue
                                            value={entry.requestId}
                                            label="request reference"
                                            truncate={false}
                                            mono={false}
                                            className="text-muted-foreground ml-auto font-mono text-[11px]"
                                        />
                                    ) : null}
                                </div>
                                {/*
                                  * ⚠ The line itself gets no copy button, and not only because
                                  * a log line is prose rather than a value: what is rendered
                                  * here is the *scrubbed* text. A copy would either hand over
                                  * `Bearer [secret-removed]` — a string that is not what the
                                  * platform logged — or put the credential the scrubber just
                                  * caught onto the clipboard. Neither is worth an affordance.
                                  *
                                  * The text is the button that opens the whole entry, and the
                                  * reference's copy control stays OUTSIDE it, above: a button
                                  * inside a button is nesting the browser reparents, and the
                                  * copy would land outside the row it belongs to.
                                  */}
                                <button
                                    type="button"
                                    aria-haspopup="dialog"
                                    onClick={() => setOpened(entry)}
                                    className="group focus-visible:ring-ring w-full rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
                                >
                                    <span className="block text-sm [overflow-wrap:anywhere]">
                                        {scrubbed?.msg.text ?? ''}
                                    </span>
                                    {scrubbed?.headline.text ? (
                                        <span className="text-muted-foreground mt-1 line-clamp-3 font-mono text-xs [overflow-wrap:anywhere]">
                                            {scrubbed.headline.text}
                                        </span>
                                    ) : null}
                                    <span className="text-muted-foreground group-hover:text-foreground mt-1 inline-flex items-center gap-0.5 text-xs group-hover:underline">
                                        Show full entry
                                        <ChevronRight className="size-3.5" aria-hidden />
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </DataState>

            <LogEntryDialog entry={opened} timeZone={timeZone} onClose={() => setOpened(null)} />

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
                    <strong>
                        {latest.sourceUsed === 'ring' ? 'in-memory buffer' : 'durable store'}
                    </strong>
                    {latest.sourceReason ? ` — ${latest.sourceReason}` : ''}.{' '}
                    {latest.meta?.ring?.scopeNote
                        ? String(latest.meta.ring.scopeNote)
                        : 'The in-memory buffer is process-local, so it describes the instance that answered.'}
                </p>
            ) : null}
        </PageContainer>
    );
}
