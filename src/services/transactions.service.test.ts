import { describe, expect, it } from 'vitest';

import {
    getTransaction,
    getTransactionSummary,
    listTransactions,
    transactionSummaryPath,
    transactionsPath,
} from '@/services/transactions.service';
import {
    TX_PAYMENT_ID,
    paymentDetailFixture,
    transactionMetaFixture,
    transactionRowFixture,
    transactionSummaryFixture,
} from '@/test/transaction-fixtures';
import { stubFetch, successResponse } from '@/test/utils';

/*
 * `/money/transactions` (BR-027). Both query schemas are `.strict()`, so what is
 * pinned is the exact set of parameters that leaves this client: no `page`, no
 * blank key, no paging on the summary — each of which is a `400`.
 */

const paramsOf = (url: string) => new URL(url, 'http://localhost').searchParams;
const pathOf = (url: string) => new URL(url, 'http://localhost').pathname;

describe('the list', () => {
    it('asks for a page by limit and cursor — never by page number', async () => {
        const calls = stubFetch(() =>
            successResponse([transactionRowFixture()], { meta: { ...transactionMetaFixture() } }),
        );

        await listTransactions({ limit: 20, sort: '-createdAt', cursor: 'WyItY3JlYXRlZEF0Il0' });

        const params = paramsOf(calls[0].url);
        expect(pathOf(calls[0].url)).toMatch(/\/money\/transactions$/);
        expect([...params.keys()].sort()).toEqual(['cursor', 'limit', 'sort']);
        expect(params.get('cursor')).toBe('WyItY3JlYXRlZEF0Il0');
        expect(params.has('page')).toBe(false);
    });

    it('sends "is any of" as one comma list', () => {
        const params = paramsOf(
            transactionsPath({ kind: ['payment', 'refund'], role: ['vendor'], provider: ['MTN'] }),
        );

        expect(params.getAll('kind')).toEqual(['payment,refund']);
        expect(params.get('role')).toBe('vendor');
        expect(params.get('provider')).toBe('MTN');
    });

    it('sends each amount comparison under its own name', () => {
        const params = paramsOf(transactionsPath({ amountGt: 500, amountMax: 9000 }));

        expect(params.get('amountGt')).toBe('500');
        expect(params.get('amountMax')).toBe('9000');
        expect(params.has('amount')).toBe(false);
        expect(params.has('amountMin')).toBe(false);
    });

    it('sends an amount of zero — it is a filter, not an absence', () => {
        expect(paramsOf(transactionsPath({ amount: 0 })).get('amount')).toBe('0');
    });

    it('sends no key at all for a filter that is not set or is empty', () => {
        const params = paramsOf(transactionsPath({ kind: [], reference: undefined }));

        expect([...params.keys()]).toEqual([]);
    });

    it('keeps the window and what was withheld from meta', async () => {
        stubFetch(() =>
            successResponse([transactionRowFixture()], {
                meta: {
                    ...transactionMetaFixture({
                    nextCursor: 'next',
                    hasMore: true,
                    withheld: { kinds: ['ledger_entry'], platformAccounts: true },
                }),
                },
            }),
        );

        const page = await listTransactions();

        expect(page.data).toHaveLength(1);
        expect(page.meta.hasMore).toBe(true);
        expect(page.meta.nextCursor).toBe('next');
        expect(page.meta.window?.from).toBe('2025-10-11T10:00:00.000Z');
        expect(page.meta.withheld).toEqual({ kinds: ['ledger_entry'], platformAccounts: true });
    });

    it('never infers a next page the service did not offer', async () => {
        // A full page with no meta: twenty rows say nothing about a twenty-first.
        stubFetch(() =>
            successResponse(
                Array.from({ length: 20 }, (_, index) =>
                    transactionRowFixture({ id: String(index).padStart(24, '0') }),
                ),
            ),
        );

        const page = await listTransactions({ limit: 20 });

        expect(page.meta.hasMore).toBe(false);
        expect(page.meta.nextCursor).toBeNull();
        expect(page.meta.window).toBeNull();
        expect(page.meta.withheld).toBeNull();
    });

    it('does not report more when the service says so but sends no cursor to ask with', async () => {
        stubFetch(() =>
            successResponse([], { meta: { ...transactionMetaFixture({ hasMore: true, nextCursor: null }) } }),
        );

        expect((await listTransactions()).meta.hasMore).toBe(false);
    });
});

describe('the summary', () => {
    it('takes the filters alone — limit, cursor and sort are each a 400 there', () => {
        const params = paramsOf(transactionSummaryPath({ direction: ['in'], amountMin: 1000 }));

        expect([...params.keys()].sort()).toEqual(['amountMin', 'direction']);
    });

    it('reads the count and the cells as sent', async () => {
        const calls = stubFetch(() => successResponse(transactionSummaryFixture()));

        const summary = await getTransactionSummary({ outcome: ['failed'] });

        expect(pathOf(calls[0].url)).toMatch(/\/money\/transactions\/summary$/);
        expect(summary.count).toBe(14);
        expect(summary.groups).toHaveLength(3);
        // A ledger cell carries no currency, and none is invented for it.
        expect(summary.groups[2].currency).toBeNull();
    });
});

describe('the detail', () => {
    it('reads one record by kind AND id', async () => {
        const calls = stubFetch(() => successResponse(paymentDetailFixture()));

        const detail = await getTransaction('payment', TX_PAYMENT_ID);

        expect(pathOf(calls[0].url)).toMatch(
            new RegExp(`/money/transactions/payment/${TX_PAYMENT_ID}$`),
        );
        expect(detail.recordPath).toBe(`/money/payments/${TX_PAYMENT_ID}`);
        expect(detail.record).toBeNull();
    });
});
