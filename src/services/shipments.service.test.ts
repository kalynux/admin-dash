import { describe, expect, it } from 'vitest';

import {
    countHeldShipments,
    countUnassignedShipments,
    listShipmentOffers,
    listShipments,
} from '@/services/shipments.service';
import {
    offerFixture,
    shipmentFixture,
    shipmentListMetaFixture,
} from '@/test/shipment-fixtures';
import { stubFetch, successResponse } from '@/test/utils';

function url(calls: { url: string }[], index = calls.length - 1) {
    return new URL(calls[index].url, 'http://localhost');
}

describe('the directory', () => {
    it('drops an empty search rather than sending one', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: shipmentListMetaFixture({ total: 0, pages: 0 }) }),
        );

        await listShipments({ search: '' });
        expect(url(calls).searchParams.has('search')).toBe(false);
    });

    /** `false` means false — it is not a synonym for "unset". */
    it('sends held=false rather than dropping it', async () => {
        const calls = stubFetch(() =>
            successResponse([shipmentFixture()], { meta: shipmentListMetaFixture() }),
        );

        await listShipments({ held: false });
        expect(url(calls).searchParams.get('held')).toBe('false');
    });

    it('passes through pages: 0 rather than normalising it', async () => {
        stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        expect((await listShipments()).meta.pages).toBe(0);
    });

    it('keeps searchMatchesTruncated only when the server actually set it', async () => {
        stubFetch(() =>
            successResponse([shipmentFixture()], {
                meta: { ...shipmentListMetaFixture(), searchMatchesTruncated: true },
            }),
        );
        expect((await listShipments()).meta.searchMatchesTruncated).toBe(true);

        stubFetch(() =>
            successResponse([shipmentFixture()], { meta: { ...shipmentListMetaFixture() } }),
        );
        expect((await listShipments()).meta.searchMatchesTruncated).toBeUndefined();
    });
});

describe('the offer trail', () => {
    /**
     * `api.get`, not `api.list`: the controller answers a **bare array** through
     * `sendSuccess`, so there is no envelope `meta`. `api.list` would synthesise
     * one whose `total` equals the page length — which is exactly the 50-cap lie
     * this surface must not tell.
     */
    it('unwraps a bare array with no meta', async () => {
        stubFetch(() => successResponse([offerFixture(), offerFixture({ id: 'b' })]));

        const offers = await listShipmentOffers('6671aabbccddeeff00112233');
        expect(Array.isArray(offers)).toBe(true);
        expect(offers).toHaveLength(2);
    });

    it('asks for the offers path without pagination parameters', async () => {
        const calls = stubFetch(() => successResponse([]));

        await listShipmentOffers('6671aabbccddeeff00112233');
        const target = url(calls);
        expect(target.pathname).toBe('/api/v1/shipments/6671aabbccddeeff00112233/offers');
        expect(target.searchParams.has('page')).toBe(false);
        expect(target.searchParams.has('limit')).toBe(false);
    });
});

describe('the counts', () => {
    /**
     * `(options?)` only, so the overview can pass them by reference to
     * `CountTile` — a leading query parameter would serialise the `AbortSignal`
     * into the URL.
     */
    it('are callable the way CountTile calls them', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 41, page: 1, limit: 1, pages: 41 } }),
        );

        const controller = new AbortController();
        expect(await countUnassignedShipments({ signal: controller.signal })).toBe(41);

        const target = url(calls);
        expect(target.searchParams.get('unassigned')).toBe('true');
        expect(target.searchParams.get('limit')).toBe('1');
        expect(target.search).not.toContain('signal');
    });

    /** Held and unassigned are different questions: a held shipment can have an agent. */
    it('asks for held separately from unassigned', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 3, page: 1, limit: 1, pages: 3 } }),
        );

        expect(await countHeldShipments()).toBe(3);
        expect(url(calls).searchParams.get('held')).toBe('true');
        expect(url(calls).searchParams.has('unassigned')).toBe(false);
    });
});
