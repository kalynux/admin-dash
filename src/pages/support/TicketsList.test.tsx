import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketsList } from '@/pages/support/TicketsList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { ticketFixture } from '@/test/support-fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';

const ORDER_ID = '6670aabbccddeeff00112233';

function stubTickets(rows = [ticketFixture()]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/support/tickets')) {
            return successResponse(rows, {
                meta: { total: rows.length, page: 1, limit: 20, pages: rows.length > 0 ? 1 : 0 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(route: string) {
    return renderWithProviders(<TicketsList />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held: heldFixture(3), tier: 3 },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

/**
 * `search` reads a ticket's OWN id and nothing else (`support.md`): the id of the
 * order, shipment or person a ticket is about matches nothing there. `entityId`
 * is the filter that answers that question, and until BR-028 nothing on this
 * screen sent it.
 */
describe('finding the tickets about a record', () => {
    it('sends ?entityId= from the address', async () => {
        const calls = stubTickets();
        list(`/dashboard/support/tickets?entityId=${ORDER_ID}`);

        await screen.findByRole('button', { name: /clear about-record filter/i });
        expect(latest(calls).searchParams.get('entityId')).toBe(ORDER_ID);
    });

    it('offers it when a searched id is no ticket’s own', async () => {
        const calls = stubTickets([]);
        // Upper-cased on purpose: the search box is case-insensitive and
        // `entityId` is an exact match on an id stored lower-case.
        list(`/dashboard/support/tickets?search=${ORDER_ID.toUpperCase()}`);

        await userEvent.click(
            await screen.findByRole('button', { name: 'Tickets about this record' }),
        );

        await waitFor(() => {
            expect(latest(calls).searchParams.get('entityId')).toBe(ORDER_ID);
            expect(latest(calls).searchParams.has('search')).toBe(false);
        });
    });

    it('does not offer it for a subject search that found nothing', async () => {
        stubTickets([]);
        list('/dashboard/support/tickets?search=refund');

        expect(await screen.findByText(/no tickets match/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Tickets about this record' })).toBeNull();
    });

    it('drops the filter from its chip', async () => {
        const calls = stubTickets();
        list(`/dashboard/support/tickets?entityId=${ORDER_ID}`);

        await userEvent.click(
            await screen.findByRole('button', { name: /clear about-record filter/i }),
        );

        await waitFor(() => expect(latest(calls).searchParams.has('entityId')).toBe(false));
    });
});
