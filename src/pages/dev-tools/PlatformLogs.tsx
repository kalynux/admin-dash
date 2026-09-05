import { useMemo, useState } from 'react';
import { AlertTriangle, RotateCw, ScrollText } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
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
import { formatRelative } from '@/lib/format';
import { scrubText } from '@/lib/scrub-secrets';
import { cn } from '@/lib/utils';
import { listPlatformLogs } from '@/services/system.service';
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
 * `q` is bounded at 100 characters as a **pattern-length defence** rather than a UI nicety: the
 * term is escaped and applied literally, and an unbounded one would be a scan amplifier against a
 * collection with no text index.
 *
 * Paging is off `nextBefore` — a cursor, because the capped collection evicts from the front and
 * an offset would yield duplicates and gaps.
 */
export function PlatformLogs() {
    const { token, refresh } = useRefreshToken();
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS);

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
    const entries = pages.flatMap((page) => page.entries);

    /**
     * One scrub per line, done here rather than in the row, so the page-level
     * tally and the rendered text come from the same pass. A per-row notice would
     * put a hundred disclosures on a hundred-row page, which is noise rather than
     * disclosure — the count belongs in the banner that is already the
     * read-this-first box.
     */
    const scrubbedMessages = entries.map((entry) => scrubText(String(entry.msg ?? '')));
    const maskedLineCount = scrubbedMessages.filter((line) => line.matched.length > 0).length;

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

                <Select
                    value={values.level || ANY}
                    onValueChange={(next) => set({ level: next === ANY ? null : next })}
                >
                    <SelectTrigger className="w-[190px]" aria-label="Level">
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

                <Select
                    value={values.source || ANY}
                    onValueChange={(next) => set({ source: next === ANY ? null : next })}
                >
                    <SelectTrigger className="w-[160px]" aria-label="Source">
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
                        const level = String(entry.level ?? '');
                        return (
                            <li key={`${String(entry.at)}-${index}`} className="space-y-1 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={cn('text-[10px] font-normal', LEVEL_TONE[level])}
                                    >
                                        {level || 'log'}
                                    </Badge>
                                    <span className="text-muted-foreground/70 text-xs">
                                        {formatRelative(String(entry.at))}
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
                                            value={String(entry.requestId)}
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
                                  */}
                                <p className="text-sm break-words">
                                    {scrubbedMessages[index]?.text ?? ''}
                                </p>
                            </li>
                        );
                    })}
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
