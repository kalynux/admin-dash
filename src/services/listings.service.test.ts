import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    approveListing,
    blockListingCustomer,
    getListingContacts,
    getListingLead,
    isListingRecordGone,
    isListingStateMoved,
    liftListingCustomerBlock,
    listListingLeads,
    listListings,
    refundReveal,
    rejectListing,
    suspendListing,
    unsuspendListing,
} from '@/services/listings.service';
import { CUSTOMER_ID, LEAD_ID, LISTING_ID, REVEAL_ID, TICKET_ID } from '@/test/listing-fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

afterEach(() => vi.restoreAllMocks());

const path = (url: string) => new URL(url).pathname.replace(/^\/api\/v1/, '') + new URL(url).search;

describe('the reads', () => {
    it('lists with the query it is given, and reads one lead by its own path', async () => {
        const calls = stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));
        await listListings({ reviewState: 'pending_review', sort: 'submittedAt', page: 1, limit: 20 });
        await listListingLeads(LISTING_ID, { page: 2 });
        expect(path(calls[0].url)).toBe('/listings?reviewState=pending_review&sort=submittedAt&page=1&limit=20');
        expect(path(calls[1].url)).toBe(`/listings/${LISTING_ID}/leads?page=2`);

        stubFetch(() => successResponse({}));
        const lead = stubFetch(() => successResponse({}));
        await getListingLead(LEAD_ID);
        expect(path(lead[0].url)).toBe(`/listings/leads/${LEAD_ID}`);
    });

    it('reads the hidden contacts from their own route', async () => {
        const calls = stubFetch(() => successResponse({ listingId: LISTING_ID, published: null, pending: null }));
        await getListingContacts(LISTING_ID);
        expect(calls[0].method).toBe('GET');
        expect(path(calls[0].url)).toBe(`/listings/${LISTING_ID}/contacts`);
    });
});

describe('the review writes send exactly the strict bodies', () => {
    it('approve sends {}', async () => {
        const calls = stubFetch(() => successResponse({}));
        await approveListing(LISTING_ID);
        expect(path(calls[0].url)).toBe(`/listings/${LISTING_ID}/approve`);
        expect(JSON.parse(calls[0].body!)).toEqual({});
    });

    it('reject sends the trimmed reasons', async () => {
        const calls = stubFetch(() => successResponse({}));
        await rejectListing(LISTING_ID, ['  Phone in the description  ', 'Blurry photo']);
        expect(JSON.parse(calls[0].body!)).toEqual({ reasons: ['Phone in the description', 'Blurry photo'] });
    });

    it('suspend sends the note; put back sends no key for a blank note', async () => {
        const calls = stubFetch(() => successResponse({}));
        await suspendListing(LISTING_ID, ' Photos show a number ');
        await unsuspendListing(LISTING_ID, '   ');
        await unsuspendListing(LISTING_ID, 'Fixed');
        expect(JSON.parse(calls[0].body!)).toEqual({ note: 'Photos show a number' });
        expect(JSON.parse(calls[1].body!)).toEqual({});
        expect(JSON.parse(calls[2].body!)).toEqual({ note: 'Fixed' });
    });
});

describe('the lead writes', () => {
    it('refund sends the note, and the ticket id only when there is one', async () => {
        const calls = stubFetch(() => successResponse({ revealId: REVEAL_ID, refundedCredits: 2, balanceAfter: 10, lead: {} }));
        await refundReveal(REVEAL_ID, { note: 'Test account', ticketId: TICKET_ID });
        await refundReveal(REVEAL_ID, { note: 'Test account' });
        expect(path(calls[0].url)).toBe(`/listings/reveals/${REVEAL_ID}/refund`);
        expect(JSON.parse(calls[0].body!)).toEqual({ note: 'Test account', ticketId: TICKET_ID });
        expect(JSON.parse(calls[1].body!)).toEqual({ note: 'Test account' });
    });

    it('block POSTs a reason; lift DELETEs with a JSON body', async () => {
        const calls = stubFetch(() => successResponse({ listingId: LISTING_ID, customerId: CUSTOMER_ID, activeBlock: null }));
        await blockListingCustomer(LISTING_ID, CUSTOMER_ID, { reason: 'Drain pattern', ticketId: TICKET_ID });
        await liftListingCustomerBlock(LISTING_ID, CUSTOMER_ID);
        expect(calls[0].method).toBe('POST');
        expect(path(calls[0].url)).toBe(`/listings/${LISTING_ID}/reveal-blocks/${CUSTOMER_ID}`);
        expect(JSON.parse(calls[0].body!)).toEqual({ reason: 'Drain pattern', ticketId: TICKET_ID });
        expect(calls[1].method).toBe('DELETE');
        expect(JSON.parse(calls[1].body!)).toEqual({});
    });
});

describe('the refusals are read off details.platformCode', () => {
    async function refusal(status: number, code: string, platformCode?: string) {
        stubFetch(() =>
            errorResponse(status, code, platformCode ? { details: { platformCode } } : {}),
        );
        return approveListing(LISTING_ID).catch((error: unknown) => error);
    }

    it('treats each "someone acted first" code as the state having moved', async () => {
        for (const platformCode of [
            'LISTING_STATUS_CONFLICT',
            'LISTING_REVEAL_ALREADY_REFUNDED',
            'LISTING_REVEAL_BLOCK_EXISTS',
            'LISTING_REVEAL_BLOCK_NOT_FOUND',
        ]) {
            const error = await refusal(platformCode.endsWith('NOT_FOUND') ? 404 : 409, 'PLATFORM_OPERATION_REJECTED', platformCode);
            expect(isListingStateMoved(error), platformCode).toBe(true);
        }
    });

    it('never matches on error.code alone', async () => {
        // A wi-admin error.code that happens to share the name is not jovi-mall's verdict.
        const error = await refusal(409, 'LISTING_STATUS_CONFLICT');
        expect(isListingStateMoved(error)).toBe(false);
    });

    it('reads both 404s as gone', async () => {
        expect(isListingRecordGone(await refusal(404, 'NOT_FOUND'))).toBe(true);
        expect(isListingRecordGone(await refusal(404, 'PLATFORM_OPERATION_REJECTED', 'LISTING_NOT_FOUND'))).toBe(true);
    });
});
