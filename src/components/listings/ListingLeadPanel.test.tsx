import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ListingLeadPanel } from '@/components/listings/ListingLeadPanel';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    CUSTOMER_ID,
    LEAD_ID,
    LISTING_ID,
    REVEAL_ID,
    TICKET_ID,
    leadBlockFixture,
    leadRevealFixture,
    listingLeadDetailFixture,
    listingLeadFixture,
    listingLeadTicketContextFixture,
} from '@/test/listing-fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { ListingLeadTicketContext } from '@/types/listings.types';

afterEach(() => vi.restoreAllMocks());

const auth = { status: 'authenticated' as const, admin: adminFixture({ timezone: 'Africa/Douala' }) };
const pathOf = (call: FetchCall) => new URL(call.url).pathname.replace(/^\/api\/v1/, '');

function show(tier: 1 | 2 | 3, context: ListingLeadTicketContext = listingLeadTicketContextFixture(), onChanged = vi.fn()) {
    renderWithProviders(
        <ListingLeadPanel ticketId={TICKET_ID} context={context} timeZone="Africa/Douala" onChanged={onChanged} />,
        { auth, permissions: { status: 'ready', held: heldFixture(tier) } },
    );
    return onChanged;
}

function stub(detail = listingLeadDetailFixture()) {
    return stubFetch((call) => {
        if (pathOf(call).endsWith('/refund')) {
            return successResponse({ revealId: REVEAL_ID, refundedCredits: 2, balanceAfter: 14, lead: listingLeadFixture() });
        }
        if (pathOf(call).includes('/reveal-blocks/')) {
            return successResponse({ listingId: LISTING_ID, customerId: CUSTOMER_ID, activeBlock: null });
        }
        return successResponse(detail);
    });
}

describe('the lead panel on a report ticket', () => {
    it('shows what the provider asked for, the named unlock, and the customer in full', async () => {
        stub();
        show(2);
        expect(screen.getByText('A refund')).toBeInTheDocument();
        expect(screen.getByText('Check this customer')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Plumbing repairs in Akwa' })).toHaveAttribute(
            'href',
            `/dashboard/listings/${LISTING_ID}`,
        );
        // The full phone the provider never sees, and the account's age at the lead.
        expect(await screen.findByText('+237677123431')).toBeInTheDocument();
        expect(screen.getAllByText('2 days before this lead').length).toBeGreaterThan(0);
        expect(screen.getByText('2 other leads across 2 providers')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Open the lead/ })).toHaveAttribute(
            'href',
            `/dashboard/listings/leads/${LEAD_ID}`,
        );
        expect(screen.getByText(/does not close this ticket/)).toBeInTheDocument();
    });

    it('refunds a named unlock with the note and this ticket’s id, then re-reads the ticket', async () => {
        const calls = stub();
        const onChanged = show(2);
        await userEvent.click(await screen.findByRole('button', { name: 'Refund 2 credits' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/keeps the contact/)).toBeInTheDocument();
        await userEvent.type(within(dialog).getByRole('textbox'), 'The customer was a test account');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Refund 2 credits' }));

        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        const post = calls.find((call) => pathOf(call).endsWith('/refund'))!;
        expect(pathOf(post)).toBe(`/listings/reveals/${REVEAL_ID}/refund`);
        expect(JSON.parse(post.body!)).toEqual({ note: 'The customer was a test account', ticketId: TICKET_ID });
    });

    it('⛔ offers Support no refund control at all — not even disabled — but does offer the block', async () => {
        stub();
        show(3);
        await screen.findByText('+237677123431');
        expect(screen.queryByRole('button', { name: /Refund/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Block this customer on this listing' })).toBeInTheDocument();
    });

    it('shows no refund button on an unlock already refunded', async () => {
        stub();
        show(
            1,
            listingLeadTicketContextFixture({
                namedReveals: [
                    leadRevealFixture({
                        refunded: true,
                        refund: {
                            at: '2026-11-07T10:00:00.000Z',
                            by: { id: null, source: 'admin', name: 'Brice N.' },
                            ticketId: TICKET_ID,
                            note: 'Duplicate',
                        },
                    }),
                ],
            }),
        );
        await screen.findByText('+237677123431');
        expect(screen.getByText('Refunded')).toBeInTheDocument();
        expect(screen.getByText(/Brice N\./)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Refund/ })).not.toBeInTheDocument();
    });

    it('blocks the customer on this listing with a reason and the ticket id (Support may)', async () => {
        const calls = stub();
        show(3);
        await userEvent.click(await screen.findByRole('button', { name: 'Block this customer on this listing' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/never why/)).toBeInTheDocument();
        await userEvent.type(within(dialog).getByRole('textbox'), 'Several numbers, never books');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Block customer' }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST' && pathOf(call).includes('/reveal-blocks/'))).toBe(true));
        const post = calls.find((call) => call.method === 'POST' && pathOf(call).includes('/reveal-blocks/'))!;
        expect(pathOf(post)).toBe(`/listings/${LISTING_ID}/reveal-blocks/${CUSTOMER_ID}`);
        expect(JSON.parse(post.body!)).toEqual({ reason: 'Several numbers, never books', ticketId: TICKET_ID });
    });

    it('lifts an active block with a DELETE', async () => {
        const calls = stub(listingLeadDetailFixture({ activeBlock: leadBlockFixture() }));
        show(3);
        expect(await screen.findByText('Blocked on this listing')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Lift the block' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lift block' }));
        await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    });

    it('without catalog.listings.read, shows only what the provider asked for — and reads nothing', () => {
        const calls = stub();
        show(
            3,
            listingLeadTicketContextFixture({ readable: false, lead: null, namedReveals: [], revealIds: [], listingId: null }),
        );
        expect(screen.getByText('A refund')).toBeInTheDocument();
        expect(screen.getByText(/Your level cannot read service listings/)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});
