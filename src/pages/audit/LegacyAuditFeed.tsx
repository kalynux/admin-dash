import { useMemo } from 'react';
import { History, Info } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { MAX_DAYS_DEFAULT, resolveDayFilter, resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listLegacyAudit } from '@/services/audit.service';
import { useAdmin } from '@/store';
import { ApiError } from '@/types/api.types';
import type { LegacyAuditEntry, LegacyAuditListQuery } from '@/types/audit.types';

/**
 * `GET /audit/legacy` — administrative actions still performed **on jovi-mall**.
 *
 * ── Its own destination, and its own shape ────────────────────────────────────
 * This is a second router on the `/audit` prefix that answers the same question
 * against a different database with a different vocabulary, and the whole module
 * is deleted at cutover. Its rows are **not** `AuditEntry`: no catalogued action,
 * no subject class, no sensitivity flag, and an actor from an entirely separate
 * identity space. Coercing them into the real shape would mean lying about those
 * fields or filling them with nulls a reader then has to special-case — and
 * either way a compliance row and a stop-gap row stop being distinguishable at a
 * glance, which is the one thing this feed must not do.
 *
 * ── `platform_admin` is not one of ours ───────────────────────────────────────
 * A wi-admin administrator holds no jovi-mall `users` row at all and no mapping
 * between the two exists. `actor.label` is rendered **server-side** precisely so
 * a client cannot accidentally present these as an administrator's actions, so it
 * is displayed as given and `actor.userId` is never linked into
 * `/dashboard/administrators`.
 *
 * ── The feature-flag 404 is not a denial ──────────────────────────────────────
 * `AUDIT_LEGACY_FEED_DISABLED` is a `404` so the route can pretend not to exist
 * while it is being retired. Handing that to `ErrorState` would render "Not
 * available to you", because a 404 is the scope denial everywhere else on this
 * service — which would be actively misleading here. So it is branched on by
 * code, before the generic path, and rendered as an explanation with no retry.
 */

const FILTER_KEYS = ['actorUserId', 'action', 'resourceType', 'source', 'from', 'to'] as const;
const FILTER_DEFAULTS = {} as const;
const ANY = 'any';

export function LegacyAuditFeed() {
    const admin = useAdmin();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    const query = useMemo<LegacyAuditListQuery>(
        () => ({
            actorUserId: values.actorUserId || undefined,
            action: values.action || undefined,
            resourceType: values.resourceType || undefined,
            source: values.source || undefined,
            page,
            limit: PAGE_SIZE_DEFAULT,
            // This endpoint coerces dates leniently, unlike the strict instants
            // elsewhere — but there is one date code path in this app and sending
            // instants is correct input for a lenient parser.
            ...resolveDayFilter(values.from, values.to, timeZone),
        }),
        [values, page, timeZone],
    );

    const path = withQuery('/audit/legacy', { ...query });
    const feed = useAsyncData(path, (signal) => listLegacyAudit(query, { signal }));

    const rows = feed.data?.data ?? [];
    const meta = feed.data?.meta;

    const isDisabled =
        feed.error instanceof ApiError && feed.error.code === 'AUDIT_LEGACY_FEED_DISABLED';

    const columns = useMemo<Column<LegacyAuditEntry>[]>(
        () => [
            {
                id: 'occurredAt',
                header: 'When',
                className: 'text-muted-foreground align-top text-sm whitespace-nowrap',
                cell: (row) => formatInstantInZone(row.occurredAt, timeZone) ?? '—',
            },
            {
                id: 'what',
                header: 'What',
                className: 'align-top',
                cell: (row) =>
                    row.kind === 'request' ? (
                        <div className="min-w-0">
                            <p className="font-mono text-xs break-all">
                                {row.request.method} {row.request.path}
                            </p>
                            {/*
                              Never synthesise an action for these: the middleware
                              recorded what was called, not what it meant.
                            */}
                            <p className="text-muted-foreground text-xs">
                                Request only — no action was named.
                            </p>
                        </div>
                    ) : (
                        <div className="min-w-0">
                            {/* jovi-mall's own verb, rendered raw. It is not in
                                this service's catalog and has no summary. */}
                            <p className="font-mono text-xs break-all">{row.action ?? '—'}</p>
                            {row.resource ? (
                                <p className="text-muted-foreground text-xs break-all">
                                    {row.resource.type} · {row.resource.id}
                                </p>
                            ) : null}
                        </div>
                    ),
            },
            {
                id: 'actor',
                header: 'Who',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0">
                        {/* Server-rendered, so a client cannot present this row as
                            a wi-admin administrator's action. Never linked. */}
                        <p className="text-sm">{row.actor.label}</p>
                        {row.actor.name ? (
                            <p className="text-muted-foreground truncate text-xs">
                                {row.actor.name}
                                {row.actor.role ? ` · ${row.actor.role}` : null}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'result',
                header: 'Result',
                className: 'align-top text-sm',
                cell: (row) => (
                    <div className="space-y-1">
                        <Badge variant="outline" className={statusTone(row.request.statusCode)}>
                            {row.request.statusCode ?? '—'}
                        </Badge>
                        {row.request.durationMs !== null ? (
                            <p className="text-muted-foreground text-xs">
                                {formatCount(row.request.durationMs)} ms
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'changes',
                header: 'Changed',
                className: 'align-top text-sm',
                cell: (row) => <LegacyChanges changes={row.changes} bodyKeys={row.bodyKeys} />,
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Legacy feed (jovi-mall)"
            description="Administrative actions still performed on the platform rather than through this service. A different database, a different vocabulary — and no text search or sorting, because this endpoint offers neither."
        >
            {/*
              Every page says what this feed *is*, so a dashboard cannot render it
              as the compliance record by omission.
            */}
            <div className="bg-muted/40 flex items-start gap-2 rounded-lg border p-3 text-sm">
                <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                    <p>
                        <strong>This is not the wi-admin trail.</strong> These rows were recorded
                        by jovi-mall&rsquo;s own middleware, in its own vocabulary, and the actors
                        are platform accounts — <em>not</em> administrators of this service. The
                        two are separate identity spaces with no mapping between them.
                    </p>
                    {meta?.unportedEndpoints !== null && meta?.unportedEndpoints !== undefined ? (
                        <p className="text-muted-foreground">
                            {meta.unportedEndpoints === 0
                                ? 'The legacy surface is fully ported — this feed is due for deletion.'
                                : `${formatCount(meta.unportedEndpoints)} legacy endpoints remain unported. When that reaches zero, this feed and the shim behind it are deleted.`}
                        </p>
                    ) : null}
                </div>
            </div>

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                {/*
                  Free text, not a select: jovi-mall's verbs are its own
                  vocabulary and no catalog of them exists for this client to
                  offer. The server takes 1–100 characters.
                */}
                <Input
                    aria-label="Action"
                    placeholder="Action, e.g. DELIVERY_AGENCY_DEACTIVATED"
                    maxLength={100}
                    className="w-72"
                    defaultValue={values.action}
                    onBlur={(event) => set({ action: event.target.value.trim() || null })}
                />

                <Input
                    aria-label="Resource type"
                    placeholder="Resource type"
                    maxLength={60}
                    className="w-44"
                    defaultValue={values.resourceType}
                    onBlur={(event) => set({ resourceType: event.target.value.trim() || null })}
                />

                <Select
                    value={values.source || ANY}
                    onValueChange={(value) => set({ source: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Row kind">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any kind</SelectItem>
                        <SelectItem value="service">Named action</SelectItem>
                        <SelectItem value="request">Request only</SelectItem>
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="When"
                    from={values.from}
                    to={values.to}
                    timeZone={timeZone}
                    // No documented cap on this endpoint, unlike `GET /audit`.
                    maxDays={MAX_DAYS_DEFAULT}
                    onChange={(range) => set({ from: range.from || null, to: range.to || null })}
                />
            </FilterBar>

            {isDisabled ? (
                <EmptyState
                    icon={History}
                    title="The legacy feed is switched off"
                    description="The audit.legacy_feed flag has been turned off, which is how this endpoint is retired ahead of deleting the module. The wi-admin trail itself is unaffected."
                    action={
                        <Button variant="outline" size="sm" asChild>
                            <a href="/dashboard/audit">Open the wi-admin trail</a>
                        </Button>
                    }
                />
            ) : (
                <>
                    <DataTable
                        caption="Legacy platform actions"
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.id}
                        isLoading={feed.isLoading}
                        isRefreshing={feed.isRefreshing}
                        error={feed.error}
                        onRetry={feed.reload}
                        loadingRows={6}
                        empty={
                            <EmptyState
                                icon={History}
                                title={
                                    isFiltered
                                        ? 'Nothing matches these filters'
                                        : 'No legacy actions on record'
                                }
                                description="Only actions taken on jovi-mall directly appear here. Anything done through this dashboard is in the wi-admin trail instead."
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
                            isBusy={feed.isRefreshing}
                            onPageChange={setPage}
                        />
                    ) : null}
                </>
            )}
        </PageContainer>
    );
}

/**
 * `changes` and `bodyKeys`, which say different things.
 *
 * `changes` is the redacted diff, on `service` rows only. `bodyKeys` is **key
 * names only** — jovi-mall never stores request-body values, because the legacy
 * surface accepts KYC documents, ticket bodies and delivery codes, and a
 * redaction list over that is a list somebody must keep complete forever against
 * endpoints nobody is porting.
 */
function LegacyChanges({
    changes,
    bodyKeys,
}: {
    changes: Record<string, unknown> | null;
    bodyKeys: string[];
}) {
    const pairs = Object.entries(changes ?? {});

    if (pairs.length === 0 && bodyKeys.length === 0) {
        return <span className="text-muted-foreground">—</span>;
    }

    return (
        <div className="space-y-1">
            {pairs.map(([field, value]) => (
                <p key={field} className="text-xs">
                    <span className="font-medium">{field}</span>{' '}
                    <span className="text-muted-foreground">{describeChange(value)}</span>
                </p>
            ))}

            {bodyKeys.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                    Body fields: <span className="font-mono">{bodyKeys.join(', ')}</span>{' '}
                    <span className="italic">(names only — values are never stored)</span>
                </p>
            ) : null}
        </div>
    );
}

/**
 * `{ from, to }` is the documented shape, but the field is typed loosely enough
 * that assuming it would be a guess. Render the pair when it is one, and fall
 * back to the raw value otherwise rather than showing nothing.
 */
function describeChange(value: unknown): string {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if ('from' in record || 'to' in record) {
            return `${format(record.from)} → ${format(record.to)}`;
        }
    }
    return format(value);
}

function format(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function statusTone(status: number | null): string {
    if (status === null) return '';
    if (status >= 500) return 'border-destructive/30 bg-destructive/10 text-destructive';
    if (status >= 400) return 'border-warning/30 bg-warning/10 text-warning';
    return 'border-success/30 bg-success/10 text-success';
}
