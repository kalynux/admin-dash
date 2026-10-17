import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { TransactionsModule } from '@/pages/money/TransactionsModule';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    SUPPORT_WITHHELD,
    TX_AGENT_ID,
    TX_PAYOUT_ID,
    codCollectionDetailFixture,
    debtRecoveryDetailFixture,
    TX_ORDER_ID,
    TX_PAYMENT_ID,
    TX_REFUND_ID,
    ledgerRowFixture,
    paymentDetailFixture,
    payoutRowFixture,
    refundDetailFixture,
    refundRowFixture,
    transactionMetaFixture,
    transactionRowFixture,
    transactionSummaryFixture,
} from '@/test/transaction-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { TransactionDetail, TransactionListMeta, TransactionRow } from '@/types/transactions.types';

/*
 * `/money/transactions` — transactions.md (BR-027, 2026-10-12).
 *
 * What the contract asks of this client, each pinned here:
 * - paging is a cursor sent back with the same filters and sort — no `page`;
 * - every filter goes to the service, the amount under its own comparison name
 *   and never as `n ± 1`, and what cannot be sent is held back and said so;
 * - the window the service used and what it withheld are always on screen;
 * - nothing is added up in the browser.
 */

const SUPPORT = heldFixture(3);
const ADMIN = heldFixture(2);

const LIST = '/dashboard/money/transactions';

interface Stub {
    pages?: { rows: TransactionRow[]; meta?: Partial<TransactionListMeta> }[];
    detail?: TransactionDetail | Response;
}

/** Answers the list page by page (in request order), the summary and the detail. */
function stubTransactions({ pages = [{ rows: [transactionRowFixture()] }], detail }: Stub = {}) {
    let served = 0;

    return stubFetch((call: FetchCall) => {
        const path = new URL(call.url, 'http://localhost').pathname;

        if (path.endsWith('/money/transactions/summary')) {
            return successResponse(transactionSummaryFixture());
        }
        if (/\/money\/transactions\/[a-z_]+\/[0-9a-f]+$/.test(path)) {
            if (detail instanceof Response) return detail;
            return successResponse(detail ?? paymentDetailFixture());
        }
        if (path.endsWith('/money/transactions')) {
            const page = pages[Math.min(served, pages.length - 1)];
            served += 1;
            return successResponse(page.rows, { meta: { ...transactionMetaFixture(page.meta) } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(held: ReadonlySet<string>, route = LIST) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/money/transactions/*" element={<TransactionsModule />} />
        </Routes>,
        {
            route,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
}

const paramsOf = (call: FetchCall) => new URL(call.url, 'http://localhost').searchParams;
const pathOf = (call: FetchCall) => new URL(call.url, 'http://localhost').pathname;

const listCalls = (calls: FetchCall[]) =>
    calls.filter((call) => pathOf(call).endsWith('/money/transactions'));
const summaryCalls = (calls: FetchCall[]) =>
    calls.filter((call) => pathOf(call).endsWith('/money/transactions/summary'));

describe('the list', () => {
    it('shows each movement with who, a signed amount, its status and its provider', async () => {
        stubTransactions({ pages: [{ rows: [transactionRowFixture(), payoutRowFixture()] }] });

        render(ADMIN);

        const payment = (await screen.findByRole('link', { name: 'Customer payment' })).closest(
            'tr',
        ) as HTMLElement;
        expect(within(payment).getByText('Awa N.')).toBeInTheDocument();
        expect(within(payment).getByText(/^\+.*20,000/)).toBeInTheDocument();
        expect(within(payment).getByText('Money in')).toBeInTheDocument();
        expect(within(payment).getByText('Succeeded')).toBeInTheDocument();
        // The source's own word stays beside the normalised one.
        expect(within(payment).getByText('SUCCEEDED')).toBeInTheDocument();
        expect(within(payment).getByText('MTN')).toBeInTheDocument();
        expect(within(payment).getByText('Order payment')).toBeInTheDocument();

        const payout = screen.getByRole('link', { name: 'Payout' }).closest('tr') as HTMLElement;
        expect(within(payout).getByText(/^−.*100,000/)).toBeInTheDocument();
        expect(within(payout).getByText('Money out')).toBeInTheDocument();
    });

    it('draws an internal movement with no sign — it neither arrived nor left', async () => {
        stubTransactions({ pages: [{ rows: [ledgerRowFixture()] }] });

        render(ADMIN);

        const row = (await screen.findByRole('link', { name: 'Earnings movement' })).closest(
            'tr',
        ) as HTMLElement;
        expect(within(row).getByText('Internal')).toBeInTheDocument();
        expect(within(row).queryByText(/^[+−]/)).not.toBeInTheDocument();
    });

    it('opens a row by kind AND id', async () => {
        stubTransactions({ pages: [{ rows: [refundRowFixture()] }] });

        render(ADMIN);

        expect(await screen.findByRole('link', { name: 'Refund' })).toHaveAttribute(
            'href',
            `/dashboard/money/transactions/refund/${TX_REFUND_ID}`,
        );
    });

    it('asks for a first page by limit and sort — no page number, no cursor, no dates', async () => {
        const calls = stubTransactions();

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });

        const params = paramsOf(listCalls(calls)[0]);
        expect([...params.keys()].sort()).toEqual(['limit', 'sort']);
        expect(params.get('sort')).toBe('-createdAt');
    });

    it('says which dates the service used when none were picked', async () => {
        stubTransactions();

        render(ADMIN);

        expect(await screen.findByText(/the last 366 days/)).toBeInTheDocument();
    });
});

describe('what the caller is not sent', () => {
    it('tells Support the list is partial, and names what is left out', async () => {
        expect(SUPPORT.has('money.payments.read')).toBe(true);
        expect(SUPPORT.has('money.earnings.read')).toBe(false);
        stubTransactions({
            pages: [{ rows: [transactionRowFixture()], meta: { withheld: SUPPORT_WITHHELD } }],
        });

        render(SUPPORT);

        const notice = (await screen.findByText(/partial for your access level/i)).closest(
            '[role="alert"]',
        ) as HTMLElement;
        expect(notice).toHaveTextContent(
            'Not included: plan purchase, credit top-up, earnings movement.',
        );
        expect(notice).toHaveTextContent(/platform.s own earnings movements are not included/i);
    });

    it('tells an Admin only that the platform’s own movements are left out', async () => {
        stubTransactions({
            pages: [
                {
                    rows: [transactionRowFixture()],
                    meta: { withheld: { kinds: [], platformAccounts: true } },
                },
            ],
        });

        render(ADMIN);

        const notice = (await screen.findByText(/partial for your access level/i)).closest(
            '[role="alert"]',
        ) as HTMLElement;
        expect(notice).not.toHaveTextContent(/Not included:/);
        expect(notice).toHaveTextContent(/platform.s own earnings movements/i);
    });

    it('says nothing when nothing was withheld', async () => {
        stubTransactions();

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });

        expect(screen.queryByText(/partial for your access level/i)).not.toBeInTheDocument();
    });
});

describe('filters go to the service', () => {
    it('sends "greater than" as amountGt — never as "at least n + 1"', async () => {
        const calls = stubTransactions();

        render(ADMIN, `${LIST}?amountOp=gt&amount=50000`);
        await screen.findByRole('link', { name: 'Customer payment' });

        const params = paramsOf(listCalls(calls)[0]);
        expect(params.get('amountGt')).toBe('50000');
        expect(params.has('amountMin')).toBe(false);
        expect(params.has('amount')).toBe(false);
        // The count is asked of the same filters.
        expect(paramsOf(summaryCalls(calls)[0]).get('amountGt')).toBe('50000');
    });

    it('sends "between" as two inclusive bounds', async () => {
        const calls = stubTransactions();

        render(ADMIN, `${LIST}?amountOp=between&amount=1000&amountTo=5000`);
        await screen.findByRole('link', { name: 'Customer payment' });

        const params = paramsOf(listCalls(calls)[0]);
        expect(params.get('amountMin')).toBe('1000');
        expect(params.get('amountMax')).toBe('5000');
    });

    it('sends a typed amount once the typing stops', async () => {
        const user = userEvent.setup();
        const calls = stubTransactions();

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });

        await user.type(screen.getByLabelText('Amount value'), '7500');

        await waitFor(() =>
            expect(listCalls(calls).some((call) => paramsOf(call).get('amount') === '7500')).toBe(
                true,
            ),
        );
        // Not one request per keystroke.
        expect(listCalls(calls).some((call) => paramsOf(call).get('amount') === '7')).toBe(false);
    });

    it('holds back an amount that is not a number, and says so under the box', async () => {
        const calls = stubTransactions();

        render(ADMIN, `${LIST}?amount=lots`);
        await screen.findByRole('link', { name: 'Customer payment' });

        expect(screen.getByText(/enter an amount in digits/i)).toBeInTheDocument();
        expect(paramsOf(listCalls(calls)[0]).has('amount')).toBe(false);
    });

    it('holds back a half-typed order id — it would be a 400 — and opens the box that holds it', async () => {
        const calls = stubTransactions();

        render(ADMIN, `${LIST}?orderId=${TX_ORDER_ID.slice(0, 9)}`);
        await screen.findByRole('link', { name: 'Customer payment' });

        expect(screen.getByLabelText('Order ID')).toHaveValue(TX_ORDER_ID.slice(0, 9));
        expect(screen.getByText(/24 characters/)).toBeInTheDocument();
        expect(paramsOf(listCalls(calls)[0]).has('orderId')).toBe(false);
    });

    it('sends role, provider, type and dates from the address', async () => {
        const calls = stubTransactions();

        render(
            ADMIN,
            `${LIST}?role=vendor,agent&provider=mtn&kind=payout&createdFrom=2026-10-01&createdTo=2026-10-11`,
        );
        await screen.findByRole('link', { name: 'Customer payment' });

        const params = paramsOf(listCalls(calls)[0]);
        expect(params.get('role')).toBe('vendor,agent');
        expect(params.get('provider')).toBe('mtn');
        expect(params.get('kind')).toBe('payout');
        expect(params.get('from')).toBe('2026-09-30T23:00:00.000Z');
        expect(params.get('to')).toBe('2026-10-11T23:00:00.000Z');
    });

    it('filters by type from the picker', async () => {
        const user = userEvent.setup();
        const calls = stubTransactions();

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });

        await user.click(screen.getByRole('button', { name: 'Type: Any type' }));
        await user.click(await screen.findByRole('checkbox', { name: 'Refund' }));

        await waitFor(() =>
            expect(listCalls(calls).some((call) => paramsOf(call).get('kind') === 'refund')).toBe(
                true,
            ),
        );
    });

    it('never forwards a type the service does not have', async () => {
        const calls = stubTransactions();

        render(ADMIN, `${LIST}?kind=invoice`);
        await screen.findByRole('link', { name: 'Customer payment' });

        expect(paramsOf(listCalls(calls)[0]).has('kind')).toBe(false);
    });
});

describe('paging by cursor', () => {
    const FIRST = transactionRowFixture();
    const SECOND = payoutRowFixture();

    it('loads the next page with the cursor and the same filters, and appends it', async () => {
        const user = userEvent.setup();
        const calls = stubTransactions({
            pages: [
                { rows: [FIRST], meta: { hasMore: true, nextCursor: 'cursor-2' } },
                { rows: [SECOND], meta: { hasMore: false, nextCursor: null } },
            ],
        });

        render(ADMIN, `${LIST}?direction=in,out`);
        await screen.findByRole('link', { name: 'Customer payment' });
        expect(screen.getByText('1 shown so far.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /load more/i }));

        expect(await screen.findByRole('link', { name: 'Payout' })).toBeInTheDocument();
        // Appended, not replaced — and the first page is not there twice.
        expect(screen.getAllByRole('link', { name: 'Customer payment' })).toHaveLength(1);

        const next = paramsOf(listCalls(calls)[1]);
        expect(next.get('cursor')).toBe('cursor-2');
        expect(next.get('direction')).toBe('in,out');
        expect(next.get('sort')).toBe('-createdAt');
        expect(next.has('page')).toBe(false);

        expect(screen.getByText('All 2 shown.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('offers no next page the service did not offer, however full the page', async () => {
        stubTransactions({
            pages: [
                {
                    rows: Array.from({ length: 20 }, (_, index) =>
                        transactionRowFixture({ id: String(index).padStart(24, '0') }),
                    ),
                    meta: { hasMore: false, nextCursor: null },
                },
            ],
        });

        render(ADMIN);

        expect(await screen.findByText('All 20 shown.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('drops the cursor and starts again when the sort changes', async () => {
        const user = userEvent.setup();
        const calls = stubTransactions({
            pages: [{ rows: [FIRST], meta: { hasMore: true, nextCursor: 'cursor-2' } }],
        });

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });

        await user.click(screen.getByRole('button', { name: 'Sort by Amount' }));

        await waitFor(() => expect(listCalls(calls)).toHaveLength(2));
        const next = paramsOf(listCalls(calls)[1]);
        expect(next.get('sort')).toBe('amount');
        // A cursor is refused under another sort.
        expect(next.has('cursor')).toBe(false);
    });
});

describe('the count and the totals', () => {
    it('shows the count the service gives, since the list has no total', async () => {
        stubTransactions();

        render(ADMIN);

        expect(await screen.findByText('14 transactions')).toBeInTheDocument();
    });

    it('prints each total as sent, and adds nothing up', async () => {
        const user = userEvent.setup();
        stubTransactions();

        render(ADMIN);
        await user.click(await screen.findByRole('button', { name: /totals by type/i }));

        const totals = screen.getByRole('table', { name: /totals for these filters/i });
        expect(within(totals).getByText(/180,000/)).toBeInTheDocument();
        expect(within(totals).getByText(/30,000/)).toBeInTheDocument();
        // The ledger cell has no currency: the bare figure, never "XAF".
        expect(within(totals).getByText('20,500')).toBeInTheDocument();
        // 180,000 − 30,000, 180,000 + 30,000 and the three together appear nowhere.
        expect(screen.queryByText(/150,000|210,000|230,500/)).not.toBeInTheDocument();
    });
});

describe('the detail', () => {
    it('shows a refund’s own details — it has no other screen', async () => {
        stubTransactions({ detail: refundDetailFixture() });

        render(ADMIN, `${LIST}/refund/${TX_REFUND_ID}`);

        expect(await screen.findByText('Refund details')).toBeInTheDocument();
        expect(screen.getByText('Fee kept by the platform').closest('div')?.parentElement).toHaveTextContent(
            /100/,
        );
        expect(screen.getByText(/4,900/)).toBeInTheDocument();
        expect(screen.getByText('support')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /open the/i })).not.toBeInTheDocument();
    });

    it('links a payment to the screen that already holds its full record', async () => {
        const calls = stubTransactions({ detail: paymentDetailFixture() });

        render(ADMIN, `${LIST}/payment/${TX_PAYMENT_ID}`);

        expect(await screen.findByRole('link', { name: /open the payment/i })).toHaveAttribute(
            'href',
            `/dashboard/money/payments/${TX_PAYMENT_ID}`,
        );
        expect(pathOf(calls[0])).toMatch(
            new RegExp(`/money/transactions/payment/${TX_PAYMENT_ID}$`),
        );
    });

    it('lists what else happened on the same order, each opening its own page', async () => {
        stubTransactions({ detail: paymentDetailFixture() });

        render(ADMIN, `${LIST}/payment/${TX_PAYMENT_ID}`);

        const related = await screen.findByRole('table', {
            name: /other transactions on the same order or booking/i,
        });
        expect(within(related).getByRole('link', { name: 'Refund' })).toHaveAttribute(
            'href',
            `/dashboard/money/transactions/refund/${TX_REFUND_ID}`,
        );
        // The order is named, and linked for someone who may open it.
        expect(screen.getByText('ORD-2026-000123')).toBeInTheDocument();
    });

    it('says where the rest are when the service capped the related set', async () => {
        const detail = paymentDetailFixture();
        stubTransactions({ detail: { ...detail, related: { ...detail.related, truncated: true } } });

        render(ADMIN, `${LIST}/payment/${TX_PAYMENT_ID}`);

        expect(await screen.findByRole('link', { name: /see all of them in the list/i })).toHaveAttribute(
            'href',
            `/dashboard/money/transactions?orderId=${TX_ORDER_ID}`,
        );
    });

    it('says a missing record is missing', async () => {
        stubTransactions({
            detail: errorResponse(404, 'NOT_FOUND', { category: 'not_found' }),
        });

        render(SUPPORT, `${LIST}/ledger_entry/${TX_PAYMENT_ID}`);

        expect(await screen.findByText('No such transaction')).toBeInTheDocument();
    });

    it('says a type outside the caller’s reads is outside their access — not that it is missing', async () => {
        stubTransactions({
            detail: errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                category: 'authorization',
                details: { required: ['money.earnings.read'] },
            }),
        });

        render(SUPPORT, `${LIST}/ledger_entry/${TX_PAYMENT_ID}`);

        expect(
            await screen.findByText('This type of transaction is outside your access'),
        ).toBeInTheDocument();
        expect(screen.queryByText('No such transaction')).not.toBeInTheDocument();
    });
});

describe('the two kinds the owner added (BR-030)', () => {
    it('shows cash paid at the door: goods and fee, who holds it, and the agent as a link', async () => {
        stubTransactions({ detail: codCollectionDetailFixture() });

        render(ADMIN, `${LIST}/cod_collection/66c0aabbccddeeff00112233`);

        expect(await screen.findByText('Cash collection details')).toBeInTheDocument();
        expect(screen.getByText('An order paid in cash')).toBeInTheDocument();
        // Scoped: 2,000 is also the tail of the 12,000 total.
        const fee = screen.getByText("Delivery fee").closest("div")?.parentElement as HTMLElement;
        expect(fee).toHaveTextContent(/2,000/);
        expect(fee).not.toHaveTextContent(/12,000/);
        expect(screen.getByText(/10,000/)).toBeInTheDocument();
        expect(screen.getByText(/some is still out/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Eric T.' })).toHaveAttribute(
            'href',
            `/dashboard/agents/${TX_AGENT_ID}`,
        );
        // Internal: the cash is with the agent, not the platform — no sign on it.
        expect(screen.queryByText(/^\+.*12,000/)).not.toBeInTheDocument();
    });

    it('shows a debt paid by a returned payout, with the payout as a link and no one who forgave it', async () => {
        stubTransactions({ detail: debtRecoveryDetailFixture() });

        render(ADMIN, `${LIST}/earnings_adjustment/66d0aabbccddeeff00112233`);

        expect(await screen.findByText('Refund-debt adjustment details')).toBeInTheDocument();
        expect(screen.getByText('A payout came back and paid the debt down')).toBeInTheDocument();
        expect(screen.getByText('It was rejected')).toBeInTheDocument();
        expect(screen.queryByText('Forgiven by')).not.toBeInTheDocument();

        const payout = screen.getByText('Payout').closest('div')?.parentElement as HTMLElement;
        expect(within(payout).getByRole('link')).toHaveAttribute(
            'href',
            `/dashboard/money/payouts/${TX_PAYOUT_ID}`,
        );
    });

    it('lists the two new types in the type picker, under their families', async () => {
        const user = userEvent.setup();
        stubTransactions();

        render(ADMIN);
        await screen.findByRole('link', { name: 'Customer payment' });
        await user.click(screen.getByRole('button', { name: 'Type: Any type' }));

        expect(await screen.findByRole('checkbox', { name: 'Cash paid at the door' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Refund-debt adjustment' })).toBeInTheDocument();
    });
});
