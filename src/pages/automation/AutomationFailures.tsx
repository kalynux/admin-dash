import { useMemo, useState } from 'react';
import { Bot, RotateCw } from 'lucide-react';

import {
    CoverageNote,
    KindBalanceHint,
    ProjectionNotice,
    ReporterStatusNotice,
} from '@/components/automation/AutomationNotices';
import { WindowHoursSelect } from '@/components/automation/WindowHoursSelect';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { MaskedNotice } from '@/components/system/MaskedNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatRelative, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { scrubText } from '@/lib/scrub-secrets';
import { listAutomationFailures } from '@/services/automation.service';
import { useAdmin } from '@/store';
import {
    AUTOMATION_CHANNELS,
    AUTOMATION_FAILURE_KINDS,
    AUTOMATION_LIMIT_DEFAULT,
    AUTOMATION_WINDOW_HOURS_DEFAULT,
    AUTOMATION_WORKFLOW_ID_MAX_LENGTH,
    isAdminAutomationFailure,
    isDeveloperAutomationFailure,
    partitionByKind,
    type DeveloperAutomationFailure,
    type SupportAutomationFailure,
} from '@/types/automation.types';

const FILTER_KEYS = ['workflowId', 'kind', 'channel', 'windowHours', 'limit'] as const;

const FILTER_DEFAULTS = {
    windowHours: `${AUTOMATION_WINDOW_HOURS_DEFAULT}`,
    limit: `${AUTOMATION_LIMIT_DEFAULT}`,
} as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/** 1–200 on the wire; three named steps, for the same reason `windowHours` has six. */
const LIMIT_OPTIONS = ['50', '100', '200'] as const;

/** What each kind means, beside its own section. Mirrors the summary's copy deliberately. */
const KIND_COPY: Record<string, { title: string; blurb: string }> = {
    execution_failed: {
        title: 'Died outright',
        blurb: 'The workflow stopped — a send was refused, or a node threw. Expect two rows for one incident: a send failing inside the core kills the sub-workflow, which fails the adapter that called it, and both report.',
    },
    degraded_turn: {
        title: 'Degraded answers',
        blurb: 'The workflow succeeded and the customer still got a worse answer than they should have. n8n recorded every one of these as a success, which is why they are reported explicitly rather than counted from execution status.',
    },
};

/**
 * `GET /automation/failures` · **any of** `developer_tools.logs.read`, `system.automation.read`,
 * `support.automation.lookup` · direct read, not audited.
 *
 * ── One route, three answers — branch on `view` for copy, on the ROW for fields ──
 * The same ladder as the error journal, and for the same reason: the *server* grades the
 * response and names the grading in `data.view`. `ProjectionNotice` renders that name, because
 * without it a Support agent reading a three-field row cannot tell *"there is nothing more to
 * know"* from *"I am not being shown it"*. The union itself is narrowed on the row
 * (`isAdminAutomationFailure` tests `'workflowId' in entry`), never on `usePermissions().tier`
 * — `tier` and `status` are re-read from the database on every request, so a grant that
 * changed mid-session would have this screen reading fields the response does not carry.
 *
 * ── The two kinds are never merged, and the empty half is still rendered ─────
 * A wall of `degraded_turn` with no `execution_failed` is the signature of something *else*
 * being down; a wall of `execution_failed` is the bot. One merged feed destroys the only
 * diagnosis this surface offers, so `partitionByKind` splits them before the JSX sees them and
 * `KindBalanceHint` says what a one-sided window means.
 *
 * ── ⚠ Three filter traps, each stated in the contract ────────────────────────
 * `channel` **must offer `unknown`** — it is the stored default, and a died-outright report has
 * no envelope to read a channel from, so a Telegram/WhatsApp-only dropdown would hide the more
 * urgent half of the feed. `workflowId` takes the **id**, never the name. And an unrecognised
 * parameter name is *silently dropped* service-wide, which is why every key below is copied
 * from the endpoint's own table.
 *
 * ── No cursor and no `meta`, so a full page is a truncation ──────────────────
 * This is a monitoring surface over TTL'd rows: there is nothing to page to. `count` is the
 * size of *this* answer, so `count === limit` means the window held at least that many and the
 * rest were cut. Said on screen rather than left to look like the whole story.
 */
export function AutomationFailures() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin?.timezone);
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const { token, refresh } = useRefreshToken();

    const [stackOf, setStackOf] = useState<DeveloperAutomationFailure | null>(null);

    const query = useMemo(
        () => ({
            // ⚠ The id, never the name. `?workflowId=UP-wi-mall-core` answers `200` with an
            // empty feed, which reads exactly like a healthy workflow.
            workflowId: values.workflowId || undefined,
            kind: values.kind || undefined,
            channel: values.channel || undefined,
            windowHours: Number(values.windowHours) || AUTOMATION_WINDOW_HOURS_DEFAULT,
            limit: Number(values.limit) || AUTOMATION_LIMIT_DEFAULT,
        }),
        [values],
    );

    const path = withQuery('/automation/failures', { ...query });
    const feed = useAsyncData(`${path}#${token}`, (signal) =>
        listAutomationFailures(query, { signal }),
    );

    const data = feed.data;
    // Memoised on `data` rather than derived inline: `?? []` is a fresh identity every render,
    // which would make the partition below recompute on each one.
    const entries = useMemo<SupportAutomationFailure[]>(() => data?.entries ?? [], [data]);
    const sections = useMemo(() => partitionByKind(entries), [entries]);
    const countOfKind = (kind: string) => entries.filter((entry) => entry.kind === kind).length;
    const truncated = Boolean(data && data.count >= query.limit);

    return (
        <PageContainer
            title="Automation failures"
            description="What the customer bot reported about its own failures — the runs that died, and the answers that were worse than they should have been."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={refresh}
                    disabled={feed.isLoading || feed.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            {data ? <ProjectionNotice view={data.view} /> : null}

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    value={values.workflowId}
                    onChange={(next) => set({ workflowId: next }, { replace: true })}
                    label="Filter by workflow ID"
                    placeholder="Workflow ID"
                    maxLength={AUTOMATION_WORKFLOW_ID_MAX_LENGTH}
                />

                <FilterField label="Kind" htmlFor="filter-kind">
                    <Select
                        value={values.kind || ANY}
                        onValueChange={(next) => set({ kind: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="filter-kind" className="w-[170px]">
                            <SelectValue placeholder="Any kind" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any kind</SelectItem>
                            {AUTOMATION_FAILURE_KINDS.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                    {KIND_COPY[kind]?.title ?? kind}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                {/*
                  ⚠ `unknown` is offered and must stay offered. It is the stored default, and an
                  `execution_failed` report has no envelope to read a channel out of — so a
                  Telegram/WhatsApp-only dropdown hides most of the died-outright rows while
                  looking complete.
                */}
                <FilterField label="Channel" htmlFor="filter-channel">
                    <Select
                        value={values.channel || ANY}
                        onValueChange={(next) => set({ channel: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="filter-channel" className="w-[160px]">
                            <SelectValue placeholder="Any channel" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any channel</SelectItem>
                            {AUTOMATION_CHANNELS.map((channel) => (
                                <SelectItem key={channel} value={channel}>
                                    {channel === 'unknown' ? 'Unknown channel' : channel}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <WindowHoursSelect
                    value={values.windowHours}
                    onChange={(next) => set({ windowHours: next })}
                />

                <FilterField label="Rows" htmlFor="filter-rows">
                    <Select
                        value={values.limit || `${AUTOMATION_LIMIT_DEFAULT}`}
                        onValueChange={(next) => set({ limit: next })}
                    >
                        <SelectTrigger id="filter-rows" className="w-[130px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LIMIT_OPTIONS.map((limit) => (
                                <SelectItem key={limit} value={limit}>
                                    {limit} rows
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>
            </FilterBar>

            {data ? (
                <ReporterStatusNotice
                    configured={data.configured}
                    isEmpty={data.entries.length === 0}
                />
            ) : null}

            {data?.configured ? (
                <KindBalanceHint
                    executionFailed={countOfKind('execution_failed')}
                    degradedTurn={countOfKind('degraded_turn')}
                />
            ) : null}

            {truncated ? (
                <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
                    <p className="font-medium">
                        Showing the first {formatCount(query.limit)} reports — there may be more.
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                        {/* There is no cursor and no `meta` on this route, so "load more" does
                            not exist and a full page is the only signal of a cut. Silence here
                            would make a truncated feed read as a complete one. */}
                        This surface has no paging. Narrow the window or the workflow to see the
                        rest — or read the summary, which counts the whole window.
                    </p>
                </div>
            ) : null}

            <DataState
                isLoading={feed.isLoading}
                error={feed.error}
                isEmpty={entries.length === 0}
                onRetry={feed.reload}
                empty={
                    <EmptyState
                        icon={Bot}
                        title="Nothing reported in this window"
                        description="No failure reports match these filters. Read the coverage note below before treating that as a clean bill of health."
                    />
                }
            >
                <div className="space-y-6">
                    {sections.map((section) => (
                        <KindSection
                            key={section.kind}
                            kind={section.kind}
                            entries={section.rows}
                            timeZone={timeZone}
                            onShowStack={setStackOf}
                        />
                    ))}
                </div>
            </DataState>

            <CoverageNote />

            <Dialog open={Boolean(stackOf)} onOpenChange={(open) => !open && setStackOf(null)}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-sm">Stack trace</DialogTitle>
                        <DialogDescription>
                            {stackOf?.workflowName} · {stackOf?.nodeName ?? 'no node recorded'}
                        </DialogDescription>
                    </DialogHeader>
                    {stackOf ? <StackBody entry={stackOf} /> : null}
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}

function KindSection({
    kind,
    entries,
    timeZone,
    onShowStack,
}: {
    kind: string;
    entries: SupportAutomationFailure[];
    timeZone: string;
    onShowStack: (entry: DeveloperAutomationFailure) => void;
}) {
    const copy = KIND_COPY[kind];

    return (
        <section className="space-y-2">
            <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    {/* An unrecognised kind renders raw rather than being dropped or merged. */}
                    {copy?.title ?? humaniseEnum(kind) ?? kind}
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                        {kind}
                    </Badge>
                    <span className="text-muted-foreground text-xs font-normal">
                        {formatCount(entries.length)}{' '}
                        {entries.length === 1 ? 'report' : 'reports'}
                    </span>
                </h2>
                {copy ? <p className="text-muted-foreground mt-0.5 text-xs">{copy.blurb}</p> : null}
            </div>

            {entries.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                    None in this window.
                </p>
            ) : (
                <ul className="border-border divide-border divide-y rounded-lg border">
                    {entries.map((entry) => (
                        <li key={entry.id} className="space-y-1 px-4 py-3">
                            <FailureRow
                                entry={entry}
                                timeZone={timeZone}
                                onShowStack={onShowStack}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * One report, at whatever depth the row itself carries.
 *
 * ⚠ Narrowed on the **row**, not on the reader: a thin row renders thin however privileged the
 * viewer, and a rich one renders rich even if the local permission set has since changed. That
 * is what `isAdminAutomationFailure` / `isDeveloperAutomationFailure` test.
 */
function FailureRow({
    entry,
    timeZone,
    onShowStack,
}: {
    entry: SupportAutomationFailure;
    timeZone: string;
    onShowStack: (entry: DeveloperAutomationFailure) => void;
}) {
    const detailed = isAdminAutomationFailure(entry) ? entry : null;

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-normal">
                    {entry.channel === 'unknown' ? 'unknown channel' : entry.channel}
                </Badge>
                {detailed ? (
                    /* The NAME, because the id below is what identifies it. No prefix is
                       stripped and none is expected — one wired workflow carries none. */
                    <span className="truncate text-sm font-medium">{detailed.workflowName}</span>
                ) : null}
                <span className="text-muted-foreground/70 ml-auto text-xs">
                    {formatRelative(entry.occurredAt) ?? '—'} ·{' '}
                    {formatInstantInZone(entry.occurredAt, timeZone) ?? '—'}
                </span>
            </div>

            {detailed ? (
                <>
                    <p className="text-sm">
                        {detailed.nodeName ? (
                            <span className="font-mono text-xs">{detailed.nodeName}</span>
                        ) : (
                            <span className="text-muted-foreground text-xs">no node recorded</span>
                        )}
                        {detailed.errorMessage ? <> — {detailed.errorMessage}</> : null}
                    </p>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <CopyableValue
                            variant="id"
                            value={detailed.workflowId}
                            label="workflow ID"
                            truncate={false}
                        />
                        <span>execution {detailed.executionId ?? '—'}</span>
                        {/* `receivedAt` beside `occurredAt`: during a correlated outage the gap
                            between the two is itself information. */}
                        <span>
                            reported {formatInstantInZone(detailed.receivedAt, timeZone) ?? '—'}
                        </span>
                        {isDeveloperAutomationFailure(entry) ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => onShowStack(entry)}
                            >
                                Stack
                            </Button>
                        ) : null}
                    </div>
                </>
            ) : null}
        </>
    );
}

/**
 * The stack, scrubbed.
 *
 * A stack is free text from a third-party runtime — an n8n HTTP node throwing echoes whatever
 * it was sent, headers included — so it goes through the same net `SystemErrors` puts on its
 * own stacks, and the omission is disclosed rather than silent.
 */
function StackBody({ entry }: { entry: DeveloperAutomationFailure }) {
    const { text, matched } = scrubText(entry.errorStack ?? '');

    return (
        <div className="space-y-2 text-sm">
            {entry.errorStack ? (
                <pre className="bg-muted/50 max-h-96 overflow-auto rounded p-2 text-xs">{text}</pre>
            ) : (
                <p className="text-muted-foreground">
                    {/* Not a failure: the report carried no stack. The key is present with a
                        null value, which is this service's rule for absent data. */}
                    No stack was recorded on this report.
                </p>
            )}
            <MaskedNotice matched={matched} subject="the stack" />
            <p className="text-muted-foreground text-xs">
                Report reference {entry.requestId ?? '—'}
            </p>
        </div>
    );
}
