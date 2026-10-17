/**
 * `/money/transactions` — every money movement on the platform in one list
 * (BR-027, 2026-10-12). Three direct reads, none audited.
 *
 * Contract: [transactions.md](../../api-doc/admin/api/transactions.md).
 *
 * ── No permission of its own ──────────────────────────────────────────────────
 * The routes open on any ONE of `money.payments.read` · `money.payouts.read` ·
 * `cod.deposits.read` · `cod.remittances.read` · `money.earnings.read`, and each
 * **kind** is then sent only to a caller holding that kind's existing reads. So
 * the answer is graded: Support is sent seven of the eleven kinds, and only a
 * holder of `money.earnings.platform.read` (tier 1) is sent the platform's own
 * rows. `meta.withheld` says what was left out.
 *
 * ── Paged by cursor, and the query is strict ──────────────────────────────────
 * `limit` + `cursor`; there is no `page`, no `total` and no `pages`. An unknown
 * parameter is a `400`, so these functions build the query from the declared
 * filters and nothing else. A cursor is valid only under the sort it was issued
 * for.
 */

import { withQuery, type QueryParams } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    TransactionDetail,
    TransactionFilters,
    TransactionListMeta,
    TransactionListQuery,
    TransactionPage,
    TransactionRow,
    TransactionSummary,
} from '@/types/transactions.types';

const BASE = '/money/transactions';

/** "Is any of" travels as one comma list — `?kind=payment,refund`. */
const list = (values: readonly string[] | undefined): string | undefined =>
    values && values.length > 0 ? values.join(',') : undefined;

/**
 * Field by field, never a spread: the schema is strict, so a key that rode in on
 * a wider object would turn a good request into a `400`.
 */
function filterParams(filters: TransactionFilters): QueryParams {
    return {
        kind: list(filters.kind),
        group: list(filters.group),
        direction: list(filters.direction),
        role: list(filters.role),
        outcome: list(filters.outcome),
        status: list(filters.status),
        gateway: list(filters.gateway),
        provider: list(filters.provider),
        method: list(filters.method),
        reasonCode: list(filters.reasonCode),
        partyId: filters.partyId,
        amount: filters.amount,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        amountGt: filters.amountGt,
        amountLt: filters.amountLt,
        reference: filters.reference,
        orderId: filters.orderId,
        bookingId: filters.bookingId,
        from: filters.from,
        to: filters.to,
    };
}

/** The request path for one page — also the fetch key, so the two cannot drift. */
export function transactionsPath(query: TransactionListQuery = {}): string {
    return withQuery(BASE, {
        ...filterParams(query),
        sort: query.sort,
        limit: query.limit,
        cursor: query.cursor,
    });
}

/** `/summary` takes the filters alone — `limit`, `cursor` and `sort` are each a `400` there. */
export function transactionSummaryPath(filters: TransactionFilters = {}): string {
    return withQuery(`${BASE}/summary`, filterParams(filters));
}

/**
 * One page. Send `meta.nextCursor` back as `cursor` **with the same filters and
 * the same sort** for the next one; `meta.hasMore` is the only word on whether
 * there is one.
 */
export async function listTransactions(
    query: TransactionListQuery = {},
    options: RequestOptions = {},
): Promise<TransactionPage> {
    const { data, meta } = await api.mutate<TransactionRow[] | null, Partial<TransactionListMeta>>(
        'GET',
        transactionsPath(query),
        undefined,
        options,
    );
    const rows = data ?? [];

    return {
        data: rows,
        meta: {
            limit: meta?.limit ?? rows.length,
            nextCursor: meta?.nextCursor ?? null,
            // Never inferred from the row count: without the service's word there is no next page.
            hasMore: meta?.hasMore === true && Boolean(meta.nextCursor),
            sort: meta?.sort ?? null,
            window: meta?.window ?? null,
            withheld: meta?.withheld ?? null,
        },
    };
}

/**
 * Counts and sums for the same filters — one cell per kind · direction · outcome
 * · currency. ⛔ The service nets nothing and neither may a caller: never add
 * cells across currencies, and never add an `internal` cell to anything.
 */
export async function getTransactionSummary(
    filters: TransactionFilters = {},
    options: RequestOptions = {},
): Promise<TransactionSummary> {
    const summary = await api.get<Partial<TransactionSummary> | null>(
        transactionSummaryPath(filters),
        options,
    );

    return {
        count: summary?.count ?? 0,
        groups: summary?.groups ?? [],
        window: summary?.window ?? null,
        withheld: summary?.withheld ?? null,
    };
}

/**
 * One row, its record, and every other transaction on the same order or booking.
 *
 * ⚠ Unlike the list, a kind the caller may not read is a **`403`** here, and a
 * platform ledger row below tier 1 is a **`404`**.
 */
export async function getTransaction(
    kind: string,
    id: string,
    options: RequestOptions = {},
): Promise<TransactionDetail> {
    return api.get<TransactionDetail>(
        `${BASE}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
        options,
    );
}
