import { describe, expect, it } from 'vitest';

import {
    chargeAgencyClaim,
    getAgencyClaim,
    getAgencyClaimEligibility,
    listAgencyClaims,
} from '@/services/agency-claims.service';
import { stubFetch, successResponse } from '@/test/utils';
import { claimCeiling, claimIneligibleReason } from '@/types/agency-claims.types';

/*
 * Every `/agency-claims` schema is `.strict()` upstream — the list, the
 * eligibility query and the charge body — so an unknown key is a `400`. These
 * pin that the service builds literals.
 */

describe('the damage-claim service', () => {
    it('lists with only the documented keys', async () => {
        const calls = stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 10, pages: 0 } }));
        await listAgencyClaims({ vendorId: 'v1', page: 2, limit: 10 });
        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/agency-claims$/);
        expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'page', 'vendorId']);
    });

    it('asks the eligibility for one parcel, and sends no refund id it was not given', async () => {
        const calls = stubFetch(() => successResponse({ eligible: false }));
        await getAgencyClaimEligibility({ shipmentId: 's1' });
        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/agency-claims\/eligibility$/);
        expect([...url.searchParams.keys()]).toEqual(['shipmentId']);
    });

    it('reads one claim by id', async () => {
        const calls = stubFetch(() => successResponse({ id: 'c1' }));
        await getAgencyClaim('c1');
        expect(new URL(calls[0].url, 'http://localhost').pathname).toMatch(/\/agency-claims\/c1$/);
    });

    it('charges with a trimmed note and no blank refund id', async () => {
        const calls = stubFetch(() => successResponse({ id: 'c1' }, { status: 201 }));
        await chargeAgencyClaim({ shipmentId: 's1', itemCount: 1, amount: 5000, note: '  Cracked  ' });
        expect(calls[0].method).toBe('POST');
        expect(JSON.parse(calls[0].body!)).toEqual({ shipmentId: 's1', itemCount: 1, amount: 5000, note: 'Cracked' });
    });
});

describe('the claim wording', () => {
    const at = (iso: string | null) => (iso ? '22 Oct 2026' : null);

    it('shows the ceiling as maxPerItem × items', () => {
        expect(claimCeiling(5000, 3)).toBe(15000);
    });

    it('names when the window closed', () => {
        expect(
            claimIneligibleReason({ reason: 'outside_window', windowEndsAt: '2026-10-22T09:00:00Z', windowDays: 2 }, at),
        ).toBe('The agency’s 2-day damage-claim window closed on 22 Oct 2026.');
    });

    it('prints an unknown reason raw rather than inventing one', () => {
        expect(claimIneligibleReason({ reason: 'parcel_returned', windowEndsAt: null, windowDays: 0 }, at)).toBe(
            'parcel returned',
        );
    });
});
