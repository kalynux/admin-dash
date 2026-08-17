import { describe, expect, it } from 'vitest';

import {
    cancelOrder,
    dispatchOrder,
    listDisputedOrders,
    listOrders,
    refundOrder,
    resolveOrderDispute,
} from '@/services/orders.service';
import {
    orderFixture,
    orderListMetaFixture,
    refundResultFixture,
} from '@/test/order-fixtures';
import { stubFetch, successResponse } from '@/test/utils';

function url(calls: { url: string }[], index = calls.length - 1) {
    return new URL(calls[index].url, 'http://localhost');
}

describe('reading', () => {
    it('drops an empty search rather than sending one', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: orderListMetaFixture({ total: 0, pages: 0 }) }),
        );

        await listOrders({ search: '' });
        expect(url(calls).searchParams.has('search')).toBe(false);
    });

    /** `pages: 0` on an empty list is the contract's rule, not `1`. */
    it('passes through pages: 0 rather than normalising it', async () => {
        stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        const page = await listOrders();
        expect(page.meta.pages).toBe(0);
    });

    /**
     * The key is **omitted** when it does not apply, never sent as `false`. A
     * truthiness test over a coerced value would turn an absent key into a
     * rendered warning.
     */
    it('keeps searchMatchesTruncated only when the server actually set it', async () => {
        stubFetch(() =>
            successResponse([orderFixture()], {
                meta: { ...orderListMetaFixture(), searchMatchesTruncated: true },
            }),
        );
        expect((await listOrders()).meta.searchMatchesTruncated).toBe(true);

        stubFetch(() =>
            successResponse([orderFixture()], { meta: { ...orderListMetaFixture() } }),
        );
        expect((await listOrders()).meta.searchMatchesTruncated).toBeUndefined();
    });

    /** Its own path, not the directory with a filter. */
    it('reads the dispute queue from its own endpoint', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: orderListMetaFixture({ total: 0, pages: 0 }) }),
        );

        await listDisputedOrders({ sort: '-disputedAt' });
        expect(url(calls).pathname).toBe('/api/v1/orders/disputes');
        expect(url(calls).searchParams.get('sort')).toBe('-disputedAt');
    });
});

describe('the writes that answer a raw document', () => {
    /**
     * `cancel` and `dispute/resolve` answer jovi-mall's whole Mongoose order —
     * snake_case, and carrying the coordinates and raw input that the read
     * projection deliberately withholds. The service returns **no document at
     * all**, so rendering one is structurally impossible rather than merely
     * discouraged.
     */
    it('returns no document from a cancel, only the server message', async () => {
        stubFetch(() =>
            successResponse(
                {
                    _id: '6670aabbccddeeff00112233',
                    order_number: 'ORD-2026-008841',
                    delivery_address: { coordinates: [9.7043, 4.0611], raw_input: 'njonjo' },
                },
                { message: 'Order cancelled' },
            ),
        );

        const result = await cancelOrder('6670aabbccddeeff00112233', { reason: 'Customer asked' });
        expect(result).toEqual({ message: 'Order cancelled' });
        expect(Object.keys(result)).toEqual(['message']);
    });

    it('returns no document from a dispute resolution either', async () => {
        stubFetch(() =>
            successResponse(
                { _id: '6670aabbccddeeff00112233', payment_status: 'paid' },
                { message: 'Dispute resolved as won' },
            ),
        );

        const result = await resolveOrderDispute('6670aabbccddeeff00112233', {
            outcome: 'won',
        });
        expect(Object.keys(result)).toEqual(['message']);
    });

    /**
     * Dispatch answers `{ order: <raw doc>, shipmentsAssigned }`. Only the count
     * crosses the service boundary.
     */
    it('keeps only the count from a dispatch, never the order', async () => {
        stubFetch(() =>
            successResponse(
                {
                    order: { _id: '6670aabbccddeeff00112233', order_number: 'ORD-2026-008841' },
                    shipmentsAssigned: 2,
                },
                { message: 'Dispatched 2 shipment(s) to the delivery agency' },
            ),
        );

        const result = await dispatchOrder('6670aabbccddeeff00112233');
        expect(result.shipmentsAssigned).toBe(2);
        expect(result).not.toHaveProperty('order');
    });

    /** `shipmentsAssigned: 0` is a success, and the count must survive as `0`. */
    it('reports a zero dispatch as zero, not as a missing value', async () => {
        stubFetch(() =>
            successResponse(
                { order: null, shipmentsAssigned: 0 },
                { message: 'Nothing to dispatch — no shipment on this order was pending' },
            ),
        );

        const result = await dispatchOrder('6670aabbccddeeff00112233');
        expect(result.shipmentsAssigned).toBe(0);
        expect(result.message).toMatch(/nothing to dispatch/i);
    });
});

describe('the refund', () => {
    /**
     * Absent means the full remaining refundable balance, which is a different
     * request from `0` — so a blank amount must not become a key.
     */
    it('omits the amount rather than sending zero', async () => {
        const calls = stubFetch(() => successResponse(refundResultFixture()));

        await refundOrder('6670aabbccddeeff00112233', { reason: 'Parcel never arrived' });
        const body = JSON.parse(calls[0].body as string);
        expect(body).not.toHaveProperty('amount');
        expect(body.reason).toBe('Parcel never arrived');
    });

    it('sends the override only when it was actually acknowledged', async () => {
        const calls = stubFetch(() => successResponse(refundResultFixture()));

        await refundOrder('6670aabbccddeeff00112233', {
            amount: 1000,
            reason: 'Partial',
            overridePolicy: true,
        });
        const body = JSON.parse(calls[0].body as string);
        expect(body.amount).toBe(1000);
        expect(body.overridePolicy).toBe(true);
    });

    /** These figures exist here and nowhere else, so they must survive intact. */
    it('returns the result whole, including which gates were crossed', async () => {
        stubFetch(() =>
            successResponse(refundResultFixture(), { message: 'Refund completed — overridden' }),
        );

        const { result, message } = await refundOrder('6670aabbccddeeff00112233', {
            reason: 'Parcel never arrived',
        });
        expect(result.withinVendorPolicy).toBe(false);
        expect(result.overrides).toEqual(['RETURN_WINDOW_EXPIRED']);
        expect(message).toMatch(/overridden/i);
    });
});
