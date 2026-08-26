import { describe, expect, it } from 'vitest';

import {
    assignTicket,
    claimTicket,
    createTicketNote,
    deleteTicketAttachment,
    listTickets,
    lookupTicketOrders,
    setTicketPriority,
    setTicketStatus,
} from '@/services/support.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

const TICKET_ID = '66a1b2c3d4e5f60718293a4b';

describe('the queue', () => {
    it('sends the queue narrowing, which cannot widen the scope', async () => {
        // `mine` and `unassigned` are conveniences, not permissions: both are
        // already subsets of every scope the service produces, so the
        // intersection is the point.
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listTickets({ queue: 'unassigned', status: 'open' });

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe('/api/v1/support/tickets');
        expect(url.searchParams.get('queue')).toBe('unassigned');
        expect(url.searchParams.get('status')).toBe('open');
    });

    it('honours pages: 0 on an empty queue rather than a phantom page one', async () => {
        stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));

        const page = await listTickets();

        expect(page.meta.pages).toBe(0);
    });
});

describe('the four writes that are split on purpose', () => {
    /**
     * Status, priority and the content edit are **three sub-resources rather
     * than three fields on one PATCH**: the permission and the audit row attach
     * to the action, and folding them into one body would produce one audit row
     * that cannot say which of them happened.
     */
    it('puts status on its own sub-resource', async () => {
        const calls = stubFetch(() => successResponse({}));

        await setTicketStatus(TICKET_ID, 'in_progress');

        const call = calls[calls.length - 1];
        expect(call.method).toBe('PATCH');
        expect(urlOf(call).pathname).toBe(`/api/v1/support/tickets/${TICKET_ID}/status`);
        expect(JSON.parse(call.body as string)).toEqual({ status: 'in_progress' });
    });

    it('puts priority on its own sub-resource', async () => {
        const calls = stubFetch(() => successResponse({}));

        await setTicketPriority(TICKET_ID, 'high');

        const call = calls[calls.length - 1];
        expect(urlOf(call).pathname).toBe(`/api/v1/support/tickets/${TICKET_ID}/priority`);
        expect(JSON.parse(call.body as string)).toEqual({ priority: 'high' });
    });

    it('assigns by administrator id alone — never a tier', async () => {
        // The target's tier is read from their own record, never from the
        // request: it decides, through the scope, who may subsequently see the
        // ticket. Sending `tier` is a 400.
        const calls = stubFetch(() => successResponse({}));

        await assignTicket(TICKET_ID, { administratorId: '66b0000000000000000000a1' });

        expect(JSON.parse(calls[calls.length - 1].body as string)).toEqual({
            administratorId: '66b0000000000000000000a1',
        });
    });

    it('claims with an empty body, on its own route', async () => {
        // Its own route rather than `assign` pointed at yourself: a different
        // audit action, no target, and open to every tier where assignment is
        // not.
        const calls = stubFetch(() => successResponse({}));

        await claimTicket(TICKET_ID);

        const call = calls[calls.length - 1];
        expect(call.method).toBe('POST');
        expect(urlOf(call).pathname).toBe(`/api/v1/support/tickets/${TICKET_ID}/claim`);
        expect(call.body).toBeUndefined();
    });

    it('surfaces TICKET_ALREADY_ASSIGNED rather than swallowing it', async () => {
        stubFetch(() => errorResponse(409, 'TICKET_ALREADY_ASSIGNED'));

        await expect(claimTicket(TICKET_ID)).rejects.toMatchObject({
            code: 'TICKET_ALREADY_ASSIGNED',
            status: 409,
        });
    });
});

describe('notes', () => {
    it('sends isPublic explicitly, including when it is false', async () => {
        /**
         * The defect this guards: jovi-mall names the field `visibility`
         * (defaulting to **public**) and its schema is non-strict, so `isPublic`
         * was stripped in transit and every note this service created was filed
         * public. The wire name stays `isPublic`; the gateway translates.
         *
         * `false` has to be on the wire — omitting it would put the decision
         * back in the hands of the default that caused the leak.
         */
        const calls = stubFetch(() => successResponse({}));

        await createTicketNote(TICKET_ID, { content: 'Chased the agency', isPublic: false });

        expect(JSON.parse(calls[calls.length - 1].body as string)).toEqual({
            content: 'Chased the agency',
            isPublic: false,
        });
    });
});

describe('the attachment delete', () => {
    it('is keyed on the attachment, not the ticket', async () => {
        // Mirrors jovi-mall's own route shape, because the attachment row is the
        // only thing that names its ticket — so the scope cannot be applied
        // first, it has to be reached.
        const calls = stubFetch(() => successResponse({}));

        await deleteTicketAttachment('66c1aabbccddeeff00112233');

        const call = calls[calls.length - 1];
        expect(call.method).toBe('DELETE');
        expect(urlOf(call).pathname).toBe(
            '/api/v1/support/tickets/attachments/66c1aabbccddeeff00112233',
        );
    });
});

describe('the reference lookups', () => {
    it('sends `search`, which the service forwards to jovi-mall as `q`', async () => {
        // The translation is not cosmetic: until Phase 4 step 21 the value went
        // under the wrong name and was ignored, so the type-ahead answered the
        // unfiltered first page while looking as though it had searched.
        const calls = stubFetch(() => successResponse([]));

        await lookupTicketOrders('JM-2026');

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe('/api/v1/support/tickets/reference/orders');
        expect(url.searchParams.get('search')).toBe('JM-2026');
        expect(url.searchParams.get('q')).toBeNull();
    });
});
