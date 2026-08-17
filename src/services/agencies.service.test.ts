import { describe, expect, it } from 'vitest';

import {
    countAgencies,
    deactivateAgency,
    listAgencies,
    listAgencyRoster,
    reactivateAgency,
    verifyAgency,
} from '@/services/agencies.service';
import { agencyFixture, rosterEntryFixture } from '@/test/agency-fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';

/** The last request's URL, parsed, so assertions read off `searchParams`. */
function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the agency directory', () => {
    it('asks for the documented defaults and nothing else', async () => {
        const calls = stubFetch(() =>
            successResponse([agencyFixture()], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            }),
        );

        await listAgencies();

        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/agencies');
        // Nothing is invented: an unfiltered call sends no parameters at all.
        expect([...url.searchParams.keys()]).toHaveLength(0);
    });

    it('never sends an empty search term', async () => {
        // An empty `?search=` is a 400 on this service, not "no filter" — so the
        // key has to disappear rather than be sent blank.
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listAgencies({ search: '' });

        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    it('sends `verified=false` rather than dropping it', async () => {
        /**
         * The contract is explicit that `false` means false. "Which agencies were
         * never verified?" is a real question and the only parameter that can ask
         * it — dropping a falsy value would silently turn it into "any".
         */
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listAgencies({ verified: false, autoAssign: false });

        const url = latest(calls);
        expect(url.searchParams.get('verified')).toBe('false');
        expect(url.searchParams.get('autoAssign')).toBe('false');
    });

    it('reports `pages: 0` on an empty list, not 1', async () => {
        // The contract's own rule. A synthesised `pages: 1` would render
        // "page 1 of 1" over nothing.
        const calls = stubFetch(() => successResponse([]));

        const page = await listAgencies();

        expect(page.meta.pages).toBe(0);
        expect(calls).toHaveLength(1);
    });

    it('coerces a string meta into numbers', async () => {
        const calls = stubFetch(() =>
            successResponse([agencyFixture()], {
                meta: { total: '1', page: '1', limit: '20', pages: '1' },
            }),
        );

        const page = await listAgencies();

        expect(page.meta.total).toBe(1);
        expect(page.meta.pages).toBe(1);
        expect(calls).toHaveLength(1);
    });

    it('counts with limit=1 and reads meta.total', async () => {
        const calls = stubFetch(() =>
            successResponse([agencyFixture()], {
                meta: { total: 42, page: 1, limit: 1, pages: 42 },
            }),
        );

        await expect(countAgencies()).resolves.toBe(42);
        expect(latest(calls).searchParams.get('limit')).toBe('1');
    });
});

describe('the roster', () => {
    it('sends primaryOnly only when it is on', async () => {
        /**
         * `primaryOnly=false` would be a filter for "contracts that do not
         * allocate", which is not what the control offers and not what the
         * endpoint means by the parameter.
         */
        const calls = stubFetch(() =>
            successResponse([rosterEntryFixture()], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            }),
        );

        await listAgencyRoster('6650bb22cc33dd44ee55ff66', { primaryOnly: undefined });
        expect(latest(calls).searchParams.has('primaryOnly')).toBe(false);

        await listAgencyRoster('6650bb22cc33dd44ee55ff66', { primaryOnly: true });
        expect(latest(calls).searchParams.get('primaryOnly')).toBe('true');
    });

    it('keeps a row whose agent is missing', async () => {
        // The join preserves it on purpose — a contract pointing at nothing is the
        // breakage an administrator opens this screen to find.
        stubFetch(() =>
            successResponse([rosterEntryFixture({ agent: null })], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            }),
        );

        const page = await listAgencyRoster('6650bb22cc33dd44ee55ff66');

        expect(page.data).toHaveLength(1);
        expect(page.data[0].agent).toBeNull();
    });
});

describe('the three writes', () => {
    it('sends no body at all when verifying', async () => {
        // The schema is strict — any field is a 400 — so `{}` would be wrong too.
        const calls = stubFetch(() => successResponse({ id: 'a', status: 'active' }));

        await verifyAgency('6650bb22cc33dd44ee55ff66');

        const call = calls[calls.length - 1];
        expect(call.method).toBe('POST');
        expect(call.body).toBeUndefined();
    });

    it('reads the cascade counts off meta, which api.post would discard', async () => {
        /**
         * The counts describe what the write *did* rather than what the agency now
         * *is*, so they are deliberately in `meta`. They appear on this response
         * and nowhere else — no later read reports them.
         */
        stubFetch(() =>
            successResponse(
                { id: '6650bb22cc33dd44ee55ff66', status: 'inactive' },
                {
                    meta: { products: 214, orderItems: 37 },
                    message: 'Agency deactivated. 214 product(s) suspended.',
                },
            ),
        );

        const result = await deactivateAgency('6650bb22cc33dd44ee55ff66', { reason: 'Fraud' });

        expect(result.counts).toEqual({ products: 214, orderItems: 37 });
        expect(result.message).toContain('214');
        expect(result.agency.status).toBe('inactive');
    });

    it('reports zero counts when the response carries no meta', async () => {
        /**
         * Reachable two ways: wi-admin coerces a missing count to zero, and
         * repeating either write on an agency already in the target state is a
         * silent no-op rather than the `409` the docs describe. The service
         * cannot tell them apart, so it must not crash — the notice does the
         * careful wording.
         */
        stubFetch(() => successResponse({ id: '6650bb22cc33dd44ee55ff66', status: 'active' }));

        const result = await reactivateAgency('6650bb22cc33dd44ee55ff66');

        expect(result.counts).toEqual({ products: 0, orderItems: 0 });
    });

    it('omits the reason key entirely when reactivating without one', async () => {
        // Omitting leaves a field unset; sending `''` clears it. There is nothing
        // to clear here, and the reason is optional on this direction alone.
        const calls = stubFetch(() => successResponse({ id: 'a', status: 'active' }));

        await reactivateAgency('6650bb22cc33dd44ee55ff66', {});

        expect(JSON.parse(calls[calls.length - 1].body ?? '{}')).toEqual({});
    });

    it('surfaces the platform status conflict with its undocumented details', async () => {
        /**
         * `DELIVERY_AGENCY_STATUS_CONFLICT` — note the prefix; a branch on
         * `AGENCY_STATUS_CONFLICT` would never fire. `details.currentStatus` is
         * undocumented and is the only thing separating "already approved by a
         * colleague" from "deactivated while you were reading".
         */
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: {
                    platformCode: 'DELIVERY_AGENCY_STATUS_CONFLICT',
                    currentStatus: 'inactive',
                },
            }),
        );

        await expect(verifyAgency('6650bb22cc33dd44ee55ff66')).rejects.toSatisfy(
            (error: unknown) =>
                error instanceof ApiError &&
                error.platformCode === 'DELIVERY_AGENCY_STATUS_CONFLICT' &&
                error.details?.currentStatus === 'inactive',
        );
    });
});
