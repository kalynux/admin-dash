import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { DeliveryFeeRefundsModule } from '@/pages/money/DeliveryFeeRefundsModule';
import { OrderDetail } from '@/pages/orders/OrderDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    deliveryFeeRefundFixture,
    settledDeliveryFeeRefundFixture,
} from '@/test/money-fixtures';
import { orderDetailFixture } from '@/test/order-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { DeliveryFeeRefund } from '@/types/money.types';
import type { OrderDetail as OrderDetailShape } from '@/types/orders.types';

/*
 * `/money/delivery-fee-refunds` — money.md § delivery-fee refunds, and the
 * order detail's `deliveryFee` block (jovi-mall ADR-A11 W-E2, 2026-10-04).
 *
 * The contract's three asks of this client, each pinned here:
 * - the Settle button reads `settleable` and `orders.refund` — Support sees the
 *   queue and never the button;
 * - the settle body is a strict literal (no `amount`, no blank strings);
 * - the three refusals are read off `details.platformCode`, each with its own
 *   way on.
 */

const REFUND_ID = '6700aabbccddeeff00112233';
const ORDER_ID = '6670aabbccddeeff00112233';
const META = { total: 1, page: 1, limit: 20, pages: 1 };

const SUPPORT = heldFixture(3);
const ADMIN = heldFixture(2);

function stubQueue(
    rows: DeliveryFeeRefund[] = [deliveryFeeRefundFixture()],
    write?: (call: FetchCall) => Response | undefined,
) {
    return stubFetch((call: FetchCall) => {
        const answered = write?.(call);
        if (answered) return answered;
        if (call.method === 'GET' && call.url.includes(`/money/delivery-fee-refunds/${REFUND_ID}`)) {
            return successResponse(rows[0]);
        }
        if (call.method === 'GET' && call.url.includes('/money/delivery-fee-refunds')) {
            return successResponse(rows, { meta: { ...META, total: rows.length } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(held: ReadonlySet<string>, path = '/dashboard/money/delivery-fee-refunds') {
    return renderWithProviders(
        <Routes>
            <Route
                path="/dashboard/money/delivery-fee-refunds/*"
                element={<DeliveryFeeRefundsModule />}
            />
        </Routes>,
        {
            route: path,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
}

const settleWrites = (calls: FetchCall[]) =>
    calls.filter((call) => call.method === 'POST' && call.url.includes('/settle'));

function rejected(platformCode: string, details: Record<string, unknown> = {}) {
    return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
        category: 'conflict',
        details: { platformCode, ...details },
    });
}

async function openSettle(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^settle$/i }));
    return screen.findByRole('dialog');
}

describe('the queue', () => {
    it('asks for what is still owed by default, and says so on the row', async () => {
        const calls = stubQueue();

        render(ADMIN);

        expect(await screen.findByText('Owed — pay by hand')).toBeInTheDocument();
        const query = new URL(calls[0].url, 'http://localhost').searchParams;
        expect(query.get('status')).toBe('manual_required');
    });

    it('shows Support the queue and no Settle button — they lack orders.refund', async () => {
        expect(SUPPORT.has('money.payments.read')).toBe(true);
        expect(SUPPORT.has('orders.refund')).toBe(false);
        stubQueue();

        render(SUPPORT);

        expect(await screen.findByText('Owed — pay by hand')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^settle$/i })).not.toBeInTheDocument();
    });

    it('offers Settle to an administrator holding orders.refund', async () => {
        expect(ADMIN.has('orders.refund')).toBe(true);
        stubQueue();

        render(ADMIN);

        expect(await screen.findByRole('button', { name: /^settle$/i })).toBeInTheDocument();
    });

    it('offers no Settle on a row that is not settleable, whatever the permission', async () => {
        stubQueue([settledDeliveryFeeRefundFixture()]);

        render(ADMIN);

        expect(await screen.findByText('Mobile money')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^settle$/i })).not.toBeInTheDocument();
    });
});

describe('settling', () => {
    it('pre-selects no method, then sends a strict literal and re-reads the queue', async () => {
        const calls = stubQueue(undefined, (call) =>
            call.method === 'POST'
                ? successResponse(
                      { refund: settledDeliveryFeeRefundFixture(), remainder: null },
                      { message: 'Delivery-fee refund marked settled' },
                  )
                : undefined,
        );
        const user = userEvent.setup();

        render(ADMIN);
        const dialog = await openSettle(user);

        // A claim about where money went is never defaulted.
        for (const radio of within(dialog).getAllByRole('radio')) {
            expect(radio).not.toBeChecked();
        }
        expect(within(dialog).getByRole('button', { name: /record as paid/i })).toBeDisabled();
        // The operator-facing note is shown, and labelled as internal.
        expect(within(dialog).getByText(/never tell the customer/i)).toBeInTheDocument();

        await user.click(within(dialog).getByRole('radio', { name: /mobile money/i }));
        await user.type(within(dialog).getByLabelText(/transfer reference/i), 'MP241004.1234');
        await user.click(within(dialog).getByRole('button', { name: /record as paid/i }));

        await waitFor(() => expect(settleWrites(calls)).toHaveLength(1));
        expect(settleWrites(calls)[0].url).toContain(
            `/money/delivery-fee-refunds/${REFUND_ID}/settle`,
        );
        // `.strict()`: no `amount`, and the blank note is omitted, not sent as "".
        expect(JSON.parse(settleWrites(calls)[0].body ?? '{}')).toEqual({
            method: 'mobile_money',
            reference: 'MP241004.1234',
        });
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(1),
        );
    });

    it('replaces the form with a reload when the row is no longer settleable', async () => {
        stubQueue(undefined, (call) =>
            call.method === 'POST' ? rejected('DELIVERY_FEE_REFUND_NOT_SETTLEABLE') : undefined,
        );
        const user = userEvent.setup();

        render(ADMIN);
        const dialog = await openSettle(user);
        await user.click(within(dialog).getByRole('radio', { name: /^cash/i }));
        await user.click(within(dialog).getByRole('button', { name: /record as paid/i }));

        expect(await within(dialog).findByText(/no longer owed/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /reload/i })).toBeInTheDocument();
        expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    });

    it('offers "covered by the order refund" when paying would pay twice', async () => {
        const calls = stubQueue(undefined, (call) => {
            if (call.method !== 'POST') return undefined;
            const body = JSON.parse(call.body ?? '{}') as { method: string };
            return body.method === 'covered_by_order_refund'
                ? successResponse({ refund: settledDeliveryFeeRefundFixture(), remainder: null })
                : rejected('DELIVERY_FEE_REFUND_ALREADY_COVERED', { stillReturnable: 0 });
        });
        const user = userEvent.setup();

        render(ADMIN);
        const dialog = await openSettle(user);
        await user.click(within(dialog).getByRole('radio', { name: /bank transfer/i }));
        await user.click(within(dialog).getByRole('button', { name: /record as paid/i }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already returned/i);
        await user.click(
            within(dialog).getByRole('button', { name: /settle as covered by the order refund/i }),
        );
        expect(
            within(dialog).getByRole('radio', { name: /covered by a refund of the whole order/i }),
        ).toBeChecked();

        // The switch selects; it does not submit on the operator's behalf.
        expect(settleWrites(calls)).toHaveLength(1);
        await user.click(within(dialog).getByRole('button', { name: /record as covered/i }));

        await waitFor(() => expect(settleWrites(calls)).toHaveLength(2));
        expect(JSON.parse(settleWrites(calls)[1].body ?? '{}')).toEqual({
            method: 'covered_by_order_refund',
        });
    });

    it('says the money is still owed when nothing covered it, and clears the choice', async () => {
        stubQueue(undefined, (call) =>
            call.method === 'POST' ? rejected('DELIVERY_FEE_REFUND_NOT_COVERED') : undefined,
        );
        const user = userEvent.setup();

        render(ADMIN);
        const dialog = await openSettle(user);
        const covered = within(dialog).getByRole('radio', {
            name: /covered by a refund of the whole order/i,
        });
        await user.click(covered);
        await user.click(within(dialog).getByRole('button', { name: /record as covered/i }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent(/still owed\./i);
        await waitFor(() => expect(covered).not.toBeChecked());
    });
});

describe('the detail', () => {
    const DETAIL = `/dashboard/money/delivery-fee-refunds/${REFUND_ID}`;

    it('announces a remainder still owed, with a link to the new row', async () => {
        const remainder = deliveryFeeRefundFixture({ id: '6702aabbccddeeff00112233', amount: 500 });
        stubQueue(undefined, (call) =>
            call.method === 'POST'
                ? successResponse(
                      { refund: settledDeliveryFeeRefundFixture(), remainder },
                      {
                          message:
                              'Partly covered by a refund of the whole order — the rest is still owed',
                      },
                  )
                : undefined,
        );
        const user = userEvent.setup();

        render(ADMIN, DETAIL);
        const dialog = await openSettle(user);
        await user.click(
            within(dialog).getByRole('radio', { name: /covered by a refund of the whole order/i }),
        );
        await user.click(within(dialog).getByRole('button', { name: /record as covered/i }));

        expect(await screen.findByText(/part of it is still owed/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open it/i })).toHaveAttribute(
            'href',
            `/dashboard/money/delivery-fee-refunds/${remainder.id}`,
        );
    });

    it('offers no Settle on an automatic row, and says the gateway handled it', async () => {
        stubQueue([
            deliveryFeeRefundFixture({
                status: 'completed',
                settleable: false,
                note: null,
                refundTransactionIds: ['66d0aabbccddeeff00112233'],
            }),
        ]);

        render(ADMIN, DETAIL);

        expect(await screen.findByText(/the payment gateway, automatically/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^settle$/i })).not.toBeInTheDocument();
    });
});

describe('the order detail', () => {
    function stubOrder(order: OrderDetailShape) {
        return stubFetch((call: FetchCall) => {
            if (call.method === 'GET' && call.url.includes(`/orders/${ORDER_ID}`)) {
                return successResponse(order);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function renderOrder(held: ReadonlySet<string>) {
        return renderWithProviders(
            <Routes>
                <Route path="/dashboard/orders/:orderId" element={<OrderDetail />} />
            </Routes>,
            {
                route: `/dashboard/orders/${ORDER_ID}`,
                auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
                permissions: { held },
            },
        );
    }

    const owing = () =>
        orderDetailFixture({
            deliveryPayer: 'customer',
            deliveryPayerReason: 'cap_fallback',
            priceBreakdown: { base: 25000, delivery: 2500, tax: 0, discount: 0, total: 27500 },
            deliveryFee: {
                payments: { checkout: null, deliveryTopUps: [], deliveryTopUpsPaid: 0 },
                proposals: [],
                refunds: [deliveryFeeRefundFixture()],
                owedManually: 1500,
                returned: 0,
            },
        });

    it('names who paid delivery and why, and never mentions the removed flag', async () => {
        stubOrder(owing());

        renderOrder(ADMIN);

        expect(await screen.findByText('The customer')).toBeInTheDocument();
        expect(screen.getByText(/broken the delivery-cost cap/i)).toBeInTheDocument();
        expect(screen.queryByText(/free delivery$/i)).not.toBeInTheDocument();
    });

    it('calls out money owed by hand, and the tab offers Settle to orders.refund', async () => {
        stubOrder(owing());
        const user = userEvent.setup();

        renderOrder(ADMIN);

        expect(await screen.findByText(/must be sent by hand/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /review and settle/i }));
        expect(await screen.findByRole('button', { name: /^settle$/i })).toBeInTheDocument();
    });

    it('shows Support the call to action and the ledger, never the button', async () => {
        stubOrder(owing());
        const user = userEvent.setup();

        renderOrder(SUPPORT);

        await user.click(await screen.findByRole('button', { name: /^review$/i }));
        expect(await screen.findByText('Owed — pay by hand')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^settle$/i })).not.toBeInTheDocument();
    });

    it('shows no call to action when nothing is owed', async () => {
        stubOrder(orderDetailFixture());

        renderOrder(ADMIN);

        await screen.findByText('The shop');
        expect(screen.queryByText(/must be sent by hand/i)).not.toBeInTheDocument();
    });
});
