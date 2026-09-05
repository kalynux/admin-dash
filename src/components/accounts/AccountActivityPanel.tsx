import { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { listOwnerAccountActivity } from '@/services/accounts.service';
import {
    ACCOUNT_ACTIVITY_CATEGORY_LABELS,
    type AccountActivityItem,
    type AccountOwnerType,
} from '@/types/accounts.types';

interface AccountActivityPanelProps {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
}

/**
 * `GET /accounts/:ownerType/:ownerId/activity` — one party's money movements.
 *
 * Generic over the owner kind because `accounts.service.ts` already is: the mount
 * takes `vendor | agency | agent` and answers the same five-ledger merge for each.
 *
 * ── The only cursor-paged list on the service, and it does not page like one ───
 * It merges five collections — plan purchases, credit top-ups, credit
 * transactions, the earnings ledger and payout requests — so it cannot be
 * offset-paged honestly: no `total`, no `pages`, no sorting, no filters.
 *
 * Two behaviours that look like bugs and are not, both from the server refusing to
 * split a group of rows sharing a timestamp:
 *
 * 1. **a page can come back longer than the limit asked for**, and
 * 2. **the last page can come back empty** with `hasMore: false`.
 *
 * So "is there more" is read from `meta.hasMore` and nowhere else. Deriving it
 * from `data.length === limit` would stop early on a tie-extended page and loop
 * forever on an empty final one — which is precisely why `Pager` is not used here.
 *
 * ── Why this appends rather than replaces ─────────────────────────────────────
 * A cursor feed has no page numbers to go back to. Keeping the accumulated rows
 * and adding to them is the only navigation the shape supports; a "previous"
 * button would need a cursor the server never issues.
 *
 * ── Why there is no filter bar ────────────────────────────────────────────────
 * There is nothing to send. The query schema is strict and accepts `before` and
 * `limit` only — not even a category. Rendering a filter that had to be applied
 * client-side would be filtering the rows this screen happens to hold rather than
 * the feed, which is a different and wrong answer.
 *
 * ── Cash on delivery is not in here, for any owner ────────────────────────────
 * The merge covers billing and earnings. An agency's or an agent's cash chain is
 * `cod.*`'s, behind its own permissions — so "nothing has moved" here never means
 * "no cash has moved".
 */
export function AccountActivityPanel({
    ownerType,
    ownerId,
    timeZone,
}: AccountActivityPanelProps) {
    /**
     * The cursor for the page currently being read, and everything read before it.
     *
     * `older` is the accumulator rather than a flat row list so a re-read of the
     * same cursor (a retry) replaces its own page instead of duplicating it.
     */
    const [cursor, setCursor] = useState<string | null>(null);
    const [older, setOlder] = useState<AccountActivityItem[]>([]);

    const path = withQuery(`/accounts/${ownerType}/${ownerId}/activity`, {
        before: cursor ?? undefined,
        limit: PAGE_SIZE_DEFAULT,
    });

    const feed = useAsyncData(path, (signal) =>
        listOwnerAccountActivity(
            ownerType,
            ownerId,
            { before: cursor ?? undefined, limit: PAGE_SIZE_DEFAULT },
            { signal },
        ),
    );

    const meta = feed.data?.meta;

    /**
     * Everything read so far, oldest page last.
     *
     * The `?? []` lives **inside** the memo rather than beside it: a fresh literal
     * in the dependency array changes identity on every render, which defeats the
     * memo and is what `react-hooks/exhaustive-deps` warns about.
     */
    const rows = useMemo(() => [...older, ...(feed.data?.data ?? [])], [older, feed.data]);

    function loadMore() {
        if (!meta?.nextCursor) return;
        setOlder(rows);
        setCursor(meta.nextCursor);
    }

    const columns = useMemo<Column<AccountActivityItem>[]>(
        () => [
            {
                id: 'createdAt',
                header: 'When',
                className: 'text-muted-foreground align-top text-sm',
                cell: (item) => formatInstantInZone(item.createdAt, timeZone) ?? '—',
            },
            {
                id: 'description',
                header: 'Movement',
                className: 'align-top',
                cell: (item) => (
                    <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium">{item.description}</p>
                        <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[11px]">
                                {ACCOUNT_ACTIVITY_CATEGORY_LABELS[item.category] ?? item.category}
                            </Badge>
                            {/*
                              Unenumerated in both services — rendered raw, never
                              switched on.

                              Mono, but not a `CopyableValue`: this is the row's
                              kind (`plan_purchase`, `credit_topup`), a vocabulary
                              rather than an identifier. The feed carries no
                              opaque value at all — `item.id` is a merge key the
                              server invents and names nothing an operator can
                              look up.
                            */}
                            <span className="text-muted-foreground font-mono text-xs">
                                {item.type}
                            </span>
                        </div>
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                className: 'align-top text-sm',
                cell: (item) => (
                    <div className="space-y-0.5">
                        {/*
                          The magnitude is always positive and the sign lives in
                          `direction`, from the OWNER's point of view. Rendering a
                          bare number would make a payout and an earning look the
                          same, so the arrow carries the meaning the data does.
                        */}
                        <p
                            className={cn(
                                'font-medium tabular-nums',
                                item.direction === 'in' && 'text-success',
                            )}
                        >
                            {item.direction === 'in' ? '+' : item.direction === 'out' ? '−' : ''}
                            {item.unit === 'credit'
                                ? `${formatCount(item.amount)} credits`
                                : formatMoney(item.amount, item.currency)}
                        </p>
                        {/* A top-up is the one row that is money AND credits. */}
                        {item.credits !== null && item.unit !== 'credit' ? (
                            <p className="text-muted-foreground text-xs">
                                {formatCount(item.credits)} credits received
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (item) => (
                    <div className="space-y-1">
                        <Badge variant="outline" className="capitalize">
                            {item.status}
                        </Badge>
                        {item.gateway ? (
                            <p className="text-muted-foreground text-xs">{item.gateway}</p>
                        ) : null}
                    </div>
                ),
            },
        ],
        [timeZone],
    );

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
                Plans, credits, earnings and payouts, newest first.
                <InfoHint label="About this feed">
                    Five separate ledgers merged into one, which is why it has no page numbers, no
                    sorting and no filters — there is no single ordering to page through. Cash on
                    delivery is deliberately not in here: that chain lives behind its own
                    permissions, so an empty feed never means no cash has moved.
                </InfoHint>
            </p>

            <DataTable
                caption={`Money movements on this ${ownerType}'s account`}
                columns={columns}
                rows={rows}
                rowKey={(item) => item.id}
                isLoading={feed.isLoading}
                isRefreshing={feed.isRefreshing}
                error={feed.error}
                onRetry={feed.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={Receipt}
                        title="Nothing has moved on this account"
                        description={`No plan purchase, credit movement, earning or payout has been recorded for this ${ownerType}.`}
                    />
                }
            />

            {/*
              Driven by `hasMore` alone — see the header. A tie-extended page can be
              longer than the limit and the final page can be empty, so row counts
              say nothing about whether there is more.
            */}
            {meta?.hasMore && meta.nextCursor ? (
                <Button variant="outline" size="sm" onClick={loadMore} disabled={feed.isRefreshing}>
                    Load older movements
                </Button>
            ) : rows.length > 0 ? (
                <p className="text-muted-foreground text-xs">That is the whole history.</p>
            ) : null}
        </div>
    );
}
