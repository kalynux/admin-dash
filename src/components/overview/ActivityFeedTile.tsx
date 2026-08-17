import { ScrollText } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData, type AsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listAuditEntries, listOwnActivity, type AuditPage } from '@/services/audit.service';
import type { AuditEntry } from '@/types/audit.types';

/** Short enough to read at a glance; the whole trail is at `/dashboard/audit`. */
const FEED_ROWS = 6;

interface FeedProps {
    refreshToken: number;
    /** The operator's IANA zone, so timestamps read in their day. */
    timeZone: string;
}

/**
 * Colour by outcome, not by action.
 *
 * `attempted` is the interesting one: an intent whose outcome never landed — a
 * delegated call that crashed mid-flight — so the action may or may not have
 * happened on the platform. It is coloured like a problem because it is one, and
 * it is the same population `/system/health` counts as `danglingIntents`.
 */
function statusClass(status: string): string {
    if (status === 'failed') return 'text-destructive';
    if (status === 'denied' || status === 'attempted') return 'text-warning';
    return 'text-muted-foreground';
}

function ActivityRow({ entry, timeZone }: { entry: AuditEntry; timeZone: string }) {
    return (
        <li className="flex items-start justify-between gap-3 py-1.5">
            <div className="min-w-0 space-y-0.5">
                {/*
                  `actionSummary` is the catalog's one-line description, provided
                  so a feed reads without a lookup table. It is null for an action
                  that is no longer catalogued — hence the raw-action fallback,
                  which must never be blank.
                */}
                <p className="truncate text-xs leading-snug">
                    {entry.actionSummary ?? entry.action}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                    {entry.actor.displayName ?? entry.actor.kind}
                    {entry.target.label ? ` · ${entry.target.label}` : null}
                </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn('text-[11px] font-medium', statusClass(entry.status))}>
                    {entry.status}
                </span>
                <span
                    className="text-muted-foreground text-[11px]"
                    title={formatInstantInZone(entry.occurredAt, timeZone) ?? undefined}
                >
                    {formatRelative(entry.occurredAt)}
                </span>
            </div>
        </li>
    );
}

/**
 * The shared body, so the permitted feed and the permission-free one cannot
 * drift apart.
 */
function ActivityBody({
    query,
    timeZone,
    title,
    to,
    emptyText,
}: {
    query: AsyncData<AuditPage>;
    timeZone: string;
    title: string;
    to?: string;
    emptyText: string;
}) {
    const rows = query.data?.data ?? [];
    /**
     * Why the feed stops where it does. The contract asks for this explicitly —
     * without it a feed that ends at the retention boundary looks broken rather
     * than finished, and an empty feed is exactly when that matters most.
     */
    const oldest = formatRelative(query.data?.meta.oldestRetainedAt);

    return (
        <TileCard
            title={title}
            icon={ScrollText}
            to={to}
            query={query}
            isEmpty={query.data !== null && rows.length === 0}
            empty={
                <div className="space-y-1">
                    <p className="text-muted-foreground text-sm">{emptyText}</p>
                    <p className="text-muted-foreground text-xs">
                        This feed is scoped — an administrator sees the rows their level may read.
                        {oldest ? ` Records are retained from ${oldest}.` : null}
                    </p>
                </div>
            }
        >
            {(page) => (
                <>
                    <ul className="divide-y">
                        {page.data.map((entry) => (
                            <ActivityRow key={entry.id} entry={entry} timeZone={timeZone} />
                        ))}
                    </ul>
                    {oldest ? (
                        <p className="text-muted-foreground mt-2 border-t pt-2 text-[11px]">
                            Records retained from {oldest}.
                        </p>
                    ) : null}
                </>
            )}
        </TileCard>
    );
}

/**
 * `GET /audit` — the platform's action record, newest first.
 *
 * **Row-scoped, in the query.** A Support administrator sees rows whose subject
 * is a platform actor or record, plus anything they did themselves; internal
 * rows — administrators, sessions, approvals, exports, feature flags, workers,
 * maintenance windows — are invisible to them, and a row outside scope answers
 * `404` rather than `403`. So a short feed is not evidence of a quiet platform,
 * which is why the empty state says the feed is scoped instead of "nothing has
 * happened".
 */
export function ActivityFeedTile({ refreshToken, timeZone }: FeedProps) {
    const query = useAsyncData(`/audit?limit=${FEED_ROWS}#${refreshToken}`, (signal) =>
        listAuditEntries({ limit: FEED_ROWS, sort: '-occurredAt' }, { signal }),
    );

    return (
        <ActivityBody
            query={query}
            timeZone={timeZone}
            title="Recent activity"
            to="/dashboard/audit"
            emptyText="No administrator actions recorded in this window."
        />
    );
}

/**
 * `GET /administrators/me/activity` — **no permission required**.
 *
 * The fallback for anyone who cannot read the full trail, so this tile is never
 * simply missing. The service takes the same view: an audit trail people cannot
 * see their own entry in is one they have no way to challenge, which is why the
 * route carries no guard at all. Its query, response, pagination and sorting are
 * identical to `GET /audit`, which is what lets both share one body.
 */
export function OwnActivityTile({ refreshToken, timeZone }: FeedProps) {
    const query = useAsyncData(
        `/administrators/me/activity?limit=${FEED_ROWS}#${refreshToken}`,
        (signal) => listOwnActivity({ limit: FEED_ROWS, sort: '-occurredAt' }, { signal }),
    );

    return (
        <ActivityBody
            query={query}
            timeZone={timeZone}
            title="Your recent actions"
            emptyText="You have not performed any recorded actions yet."
        />
    );
}
