import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { TicketDetail } from '@/pages/support/TicketDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    productTicketDetailFixture,
    ticketAttachmentFixture,
    ticketDetailFixture,
} from '@/test/support-fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { TicketDetail as TicketDetailRecord } from '@/types/support.types';

const TICKET_ID = '66a1b2c3d4e5f60718293a4b';

/**
 * Answers the reads this screen can make, and throws on anything else.
 *
 * The throw is itself an assertion: the notes and attachment tabs are lazy —
 * Radix unmounts an inactive `TabsContent` — so a read fired on mount would fail
 * the test rather than pass unnoticed.
 */
function detail(
    options: { record?: TicketDetailRecord; held?: ReadonlySet<string>; id?: string } = {},
) {
    const { record = ticketDetailFixture(), held = heldFixture(1), id = TICKET_ID } = options;

    const calls = stubFetch((call) => {
        if (call.url.includes('/attachments')) {
            return successResponse([ticketAttachmentFixture()]);
        }
        if (call.url.includes('/notes')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.url.includes(`/support/tickets/${TICKET_ID}`)) return successResponse(record);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <Routes>
            <Route path="/dashboard/support/tickets/:ticketId" element={<TicketDetail />} />
        </Routes>,
        {
            route: `/dashboard/support/tickets/${id}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );

    return calls;
}

describe('the record', () => {
    it('refuses a non-hex id without issuing a request', async () => {
        const calls = detail({ id: 'not-an-id' });

        expect(await screen.findByText(/not a valid ticket id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

// ─── § D1 · what the ticket is about ─────────────────────────────────────────

describe('the “About” field', () => {
    /**
     * ⚠ `entity.label` and `entity.vendorId` are resolved on the **detail
     * only** — a queue row carries both as `null`. That asymmetry is why the
     * link lives on this screen and nowhere else.
     */
    it('opens the order it names, by its order number', async () => {
        detail();

        const link = await screen.findByRole('link', { name: 'ORD-2026-008841' });
        expect(link).toHaveAttribute('href', '/dashboard/orders/6670aabbccddeeff00112233');
        // The label never replaces the id — the contract says so, and the id is
        // the value an operator pastes into a search box.
        expect(screen.getByRole('button', { name: /copy order id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ **The ask this phase was blocked on.** A product's route needs two ids
     * and the ticket carries one; `entity.vendorId` arrived at BR-016 § 7 and is
     * the whole of what unblocks it.
     */
    it('opens a product through the vendor the detail now carries', async () => {
        detail({ record: productTicketDetailFixture() });

        expect(await screen.findByRole('link', { name: 'Plantain — 1 kg' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/6650aa11bb22cc33dd44ee55/products/66601122334455667788990a',
        );
    });

    it('explains which types cannot open, rather than leaving a bare id', async () => {
        detail({
            record: ticketDetailFixture({
                entity: {
                    type: 'CUSTOMER',
                    id: '665f1c2a9b3e4a91c7d2e5f0',
                    vendorId: null,
                    label: null,
                },
            }),
        });

        await screen.findByText('665f1c2a9b3e4a91c7d2e5f0');
        expect(
            screen.getByRole('button', { name: /which records open from here/i }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /665f1c2a/ })).not.toBeInTheDocument();
    });
});

// ─── § D2 · the attachments tab ──────────────────────────────────────────────

describe('the attachments tab', () => {
    it('reads nothing until it is opened', async () => {
        const calls = detail();

        await screen.findByRole('tab', { name: /overview/i });
        expect(calls.some((call) => call.url.includes('/attachments'))).toBe(false);
    });

    it('is omitted without the attachment read permission', async () => {
        detail({ held: new Set(['support.tickets.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('tab', { name: /attachments/i })).not.toBeInTheDocument();
    });
});
