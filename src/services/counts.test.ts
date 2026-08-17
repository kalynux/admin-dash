import { describe, expect, it } from 'vitest';

import {
    countAgencies,
    countAgents,
    countDisputedOrders,
    countHeldShipments,
    countMatching,
    countOrdersCreated,
    countShipmentsCreated,
    countUnassignedShipments,
    countUsers,
    countVendors,
} from '@/services/counts';
import { stubFetch, successResponse } from '@/test/utils';

/** One row back, a real total in `meta` — the shape every count endpoint returns. */
function stubCount(total: number) {
    return stubFetch(() =>
        successResponse([{ id: 'x' }], {
            meta: { total, page: 1, limit: 1, pages: total > 0 ? total : 0 },
        }),
    );
}

describe('countMatching', () => {
    it('asks for one row and reads meta.total, not the rows it got back', async () => {
        const calls = stubCount(8841);

        await expect(countMatching('/shipments')).resolves.toBe(8841);
        expect(calls[0].url).toContain('limit=1');
    });

    it('forces limit=1 even if a caller passes their own', async () => {
        const calls = stubCount(12);

        // Merging would let a call site pull a page of records to read a number
        // off it, which is the thing this module exists to avoid.
        await countMatching('/users', { limit: 100 });
        expect(calls[0].url).toContain('limit=1');
        expect(calls[0].url).not.toContain('limit=100');
    });

    it('reports zero for an empty list, honouring pages: 0', async () => {
        stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 1, pages: 0 } }),
        );

        await expect(countMatching('/orders/disputes')).resolves.toBe(0);
    });

    it('serialises a false flag rather than dropping it', async () => {
        const calls = stubCount(3);

        // `false` means false on this service — dropping it would silently widen
        // the filter to "any".
        await countMatching('/shipments', { held: false });
        expect(calls[0].url).toContain('held=false');
    });
});

describe('the named counts hit the documented path and filter', () => {
    it.each([
        ['users', countUsers, '/users'],
        ['vendors', countVendors, '/vendors'],
        ['agencies', countAgencies, '/agencies'],
        ['agents', countAgents, '/agents'],
        ['disputes', countDisputedOrders, '/orders/disputes'],
    ] as const)('%s', async (_label, read, path) => {
        const calls = stubCount(1);
        await read();
        expect(calls[0].url).toContain(path);
    });

    it('narrows unassigned shipments with the documented boolean flag', async () => {
        const calls = stubCount(41);

        await expect(countUnassignedShipments()).resolves.toBe(41);
        expect(calls[0].url).toContain('unassigned=true');
        // `assignmentState` is a separate axis and the API refuses to collapse
        // the two, so this must not become a status filter.
        expect(calls[0].url).not.toContain('status=');
    });

    it('narrows held shipments with its own flag', async () => {
        const calls = stubCount(2);

        await countHeldShipments();
        expect(calls[0].url).toContain('held=true');
        expect(calls[0].url).not.toContain('unassigned');
    });

    it('sends a half-open instant range for a day, never a date-only value', async () => {
        const window = { from: '2026-08-14T23:00:00.000Z', to: '2026-08-15T23:00:00.000Z' };
        const calls = stubCount(318);

        await countOrdersCreated(window);
        const query = new URL(calls[0].url).searchParams;
        expect(query.get('from')).toBe(window.from);
        expect(query.get('to')).toBe(window.to);
    });

    it('sends the same range shape for shipments', async () => {
        const window = { from: '2026-08-14T23:00:00.000Z', to: '2026-08-15T23:00:00.000Z' };
        const calls = stubCount(274);

        await countShipmentsCreated(window);
        expect(calls[0].url).toContain('/shipments');
        expect(new URL(calls[0].url).searchParams.get('to')).toBe(window.to);
    });
});
