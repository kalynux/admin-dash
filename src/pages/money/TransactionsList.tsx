import { useMemo } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { TransactionFilterBar } from '@/components/money/transactions/TransactionFilterBar';
import { TransactionSummaryPanel } from '@/components/money/transactions/TransactionSummaryPanel';
import { transactionColumns } from '@/components/money/transactions/transactionColumns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { useCursorFeed } from '@/hooks/use-cursor-feed';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT } from '@/lib/query';
import {
    TRANSACTION_FILTER_DEFAULTS,
    TRANSACTION_FILTER_KEYS,
    resolveTransactionFilters,
} from '@/lib/transaction-filters';
import { listTransactions, transactionsPath } from '@/services/transactions.service';
import { useAdmin } from '@/store';
import {
    TRANSACTION_MAX_RANGE_DAYS,
    transactionKindLabel,
    transactionRowKey,
    type TransactionListMeta,
    type TransactionListQuery,
    type TransactionRow,
    type TransactionWindow,
    type TransactionWithheld,
} from '@/types/transactions.types';

/**
 * `GET /money/transactions` — every money movement on the platform, newest
 * first, with one filter per column (BR-027, 2026-10-12).
 *
 * Eleven kinds of record in one row shape: customer payments, plan purchases,
 * credit top-ups, refunds, hand-settled delivery-fee refunds, payouts, cash paid
 * at the door, COD deposits, COD remittances, earnings-ledger entries and the two
 * refund-debt movements that write no ledger entry (BR-027, BR-030).
 *
 * ── Open to every level, and graded by the service ────────────────────────────
 * The route has no permission of its own: it opens on any one of five existing
 * reads, and each kind is sent only to a caller who can already read that kind
 * elsewhere. Support is sent seven kinds; only a holder of
 * `money.earnings.platform.read` (a Developer) is sent the platform's own rows.
 * ⛔ **Nothing here checks a level** — `meta.withheld` says what was left out
 * and this screen repeats it, so a partial list never looks whole.
 *
 * ── Every filter is the service's ─────────────────────────────────────────────
 * Nothing is filtered, sorted or summed in the browser: the rows on screen are a
 * few pages of a much longer answer, and filtering those would be answering a
 * different question. The query is strict, so what cannot be sent (a half-typed
 * id, a malformed amount) is held back and said so under its box.
 *
 * ── A cursor, and always a date window ────────────────────────────────────────
 * No page numbers and no total — eleven collections are merged, and only a cursor
 * walks a merge exactly. The count comes from `/summary`. With no dates chosen
 * the service applies the last 366 days and reports the window it used; that is
 * the one way this list is shorter than "everything", so it is always shown.
 */
export function TransactionsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const query = useListQueryState(TRANSACTION_FILTER_KEYS, TRANSACTION_FILTER_DEFAULTS);
    const { values } = query;

    const { filters, sort, issues } = useMemo(
        () => resolveTransactionFilters(values, timeZone),
        [values, timeZone],
    );

    const listQuery: TransactionListQuery = { ...filters, sort, limit: PAGE_SIZE_DEFAULT };

    const feed = useCursorFeed<TransactionRow, TransactionListMeta>(
        transactionsPath(listQuery),
        (cursor, signal) => listTransactions({ ...listQuery, cursor }, { signal }),
    );

    const columns = useMemo(() => transactionColumns(timeZone, { sortable: true }), [timeZone]);

    const hasRows = feed.rows.length > 0;
    const datesChosen = values.createdFrom !== '' || values.createdTo !== '';

    return (
        <PageContainer
            title="Transactions"
            description="Every money movement on the platform — paid in, paid out and moved internally."
        >
            <div className="space-y-4">
                <TransactionFilterBar query={query} issues={issues} timeZone={timeZone} />

                {issues.created ? (
                    <p role="status" className="text-destructive text-sm">
                        These dates were not applied. {issues.created}
                    </p>
                ) : null}

                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                    <TransactionSummaryPanel filters={filters} />
                    <WindowNote
                        window={feed.meta?.window ?? null}
                        datesChosen={datesChosen}
                        timeZone={timeZone}
                    />
                </div>

                <WithheldNotice withheld={feed.meta?.withheld ?? null} />

                <DataTable
                    caption="Transactions"
                    columns={columns}
                    rows={feed.rows}
                    rowKey={transactionRowKey}
                    sort={sort}
                    onSortChange={(next) => query.set({ sort: next })}
                    isLoading={feed.isLoading}
                    isRefreshing={feed.isRefreshing}
                    // A failed further page must not replace the rows already read.
                    error={hasRows ? undefined : feed.error}
                    onRetry={feed.reload}
                    empty={
                        <EmptyState
                            icon={ArrowLeftRight}
                            title="No transactions match"
                            description={
                                query.isFiltered
                                    ? 'Nothing matches these filters in the dates shown.'
                                    : 'Nothing has moved in the dates shown.'
                            }
                        />
                    }
                />

                {hasRows && feed.error ? (
                    <ErrorState error={feed.error} onRetry={feed.reload} />
                ) : null}

                {hasRows ? (
                    <div className="flex flex-wrap items-center gap-3">
                        {feed.hasMore ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={feed.loadMore}
                                disabled={feed.isRefreshing}
                            >
                                Load more
                            </Button>
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                            {feed.hasMore
                                ? `${formatCount(feed.rows.length)} shown so far.`
                                : `All ${formatCount(feed.rows.length)} shown.`}
                        </p>
                    </div>
                ) : null}
            </div>
        </PageContainer>
    );
}

/**
 * The date window the service actually used — its own answer, not the dates
 * picked. With none picked it is the last 366 days, and saying so is what stops
 * "nothing found" being read as "never happened".
 */
function WindowNote({
    window,
    datesChosen,
    timeZone,
}: {
    window: TransactionWindow | null;
    datesChosen: boolean;
    timeZone: string;
}) {
    if (!window) return null;

    const from = formatInstantInZone(window.from, timeZone);
    const to = formatInstantInZone(window.to, timeZone);
    if (!from || !to) return null;

    return (
        <p className="text-muted-foreground flex items-center gap-1 text-sm">
            {from} to {to}
            {datesChosen ? null : ` — the last ${TRANSACTION_MAX_RANGE_DAYS} days`}
            <InfoHint label="About the dates and what is listed">
                A date range always applies, up to {TRANSACTION_MAX_RANGE_DAYS} days at a time. To
                look further back, choose earlier dates. Not on this list: credits, which are not
                money, and one rare charge — when a refund charges a vendor more than their share
                of a sale and they had no share on that sale at all. That charge is on the
                order&rsquo;s money split.
            </InfoHint>
        </p>
    );
}

/**
 * What the caller was not sent. Without it a Support administrator's list would
 * look complete while leaving three kinds out.
 */
function WithheldNotice({ withheld }: { withheld: TransactionWithheld | null }) {
    if (!withheld) return null;

    const kinds = withheld.kinds.map((kind) => transactionKindLabel(kind).toLowerCase());
    if (kinds.length === 0 && !withheld.platformAccounts) return null;

    return (
        <Alert>
            <AlertTitle>This list is partial for your access level</AlertTitle>
            <AlertDescription>
                {kinds.length > 0 ? (
                    <p>
                        Not included: {kinds.join(', ')}. Your access does not cover{' '}
                        {kinds.length === 1 ? 'this type' : 'these types'}.
                    </p>
                ) : null}
                {withheld.platformAccounts ? (
                    <p>The platform&rsquo;s own earnings movements are not included.</p>
                ) : null}
            </AlertDescription>
        </Alert>
    );
}
