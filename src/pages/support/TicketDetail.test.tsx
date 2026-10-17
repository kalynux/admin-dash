import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { TicketDetail } from '@/pages/support/TicketDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    productTicketDetailFixture,
    ticketAdminSnapshotFixture,
    ticketAttachmentFixture,
    ticketDetailFixture,
    ticketFollowerFixture,
    ticketFollowersFixture,
    unroutedFixture,
} from '@/test/support-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
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

    it('opens a customer as a search of the user directory, never as a record', async () => {
        detail({
            record: ticketDetailFixture({
                entity: {
                    type: 'CUSTOMER',
                    // A `customers._id` — the opener's PROFILE id, and not the
                    // user id that "Opened by" now shows and links.
                    id: '665f1c2a9b3e4a91c7d2e5f1',
                    vendorId: null,
                    label: null,
                },
            }),
        });

        await screen.findByText('665f1c2a9b3e4a91c7d2e5f1');
        expect(
            screen.getByRole('button', { name: /which records open from here/i }),
        ).toBeInTheDocument();
        // A customer id opens the user directory's SEARCH (BR-028 § 1), which
        // resolves it to the account — never `/users/:id`, where it is a 404.
        expect(screen.getByRole('link', { name: '665f1c2a9b3e4a91c7d2e5f1' })).toHaveAttribute(
            'href',
            '/dashboard/users?search=665f1c2a9b3e4a91c7d2e5f1',
        );
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

// ─── The people on the ticket (2026-10-10) ───────────────────────────────────

describe('who is involved', () => {
    it('says who opened the ticket — a person with a number, not a role', async () => {
        detail({ record: ticketDetailFixture({ followers: [] }) });

        const opener = await screen.findByRole('link', { name: 'Awa Ndiaye' });
        // A customer has no screen of their own here; the name opens the user.
        expect(opener).toHaveAttribute('href', '/dashboard/users/665f1c2a9b3e4a91c7d2e5f0');
        expect(screen.getByText('+237600000001')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy customer phone/i })).toBeInTheDocument();
    });

    /**
     * `name` is the contact person; the agency is `businessName`. And
     * `/agencies/:id` takes the PROFILE id, which is not the user id.
     */
    it('shows the party it was routed to by its business name, opened with the profile id', async () => {
        detail({ record: ticketDetailFixture({ followers: [] }) });

        expect(await screen.findByRole('link', { name: 'Rapide Livraison' })).toHaveAttribute(
            'href',
            '/dashboard/agencies/6650aa11bb22cc33dd44ee56',
        );
        expect(screen.getByText('Contact: Jean Mbarga')).toBeInTheDocument();
    });

    /**
     * ⚠ `assignedTo` is always an object on the wire — "nobody" is every field
     * `null`. A truthiness check rendered an empty party here.
     */
    it('reads an all-null routed-to block as nobody', async () => {
        detail({ record: ticketDetailFixture({ assignedTo: unroutedFixture(), followers: [] }) });

        expect(await screen.findByText('Not routed to a platform party')).toBeInTheDocument();
    });

    it('names the administrator who opened it, with no link to the user directory', async () => {
        detail({
            record: ticketDetailFixture({
                followers: [],
                assignedTo: unroutedFixture(),
                createdBy: {
                    role: 'admin',
                    userId: '66b0000000000000000000c3',
                    profileId: null,
                    name: 'Wi-Mall (automatic)',
                    businessName: null,
                    phone: null,
                    email: null,
                    administrator: ticketAdminSnapshotFixture({
                        id: '66b0000000000000000000c3',
                        name: 'Wi-Mall (automatic)',
                        tier: 1,
                    }),
                },
            }),
        });

        expect(await screen.findByText('Wi-Mall (automatic)')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Wi-Mall (automatic)' })).toBeNull();
        expect(screen.queryByText('No phone')).toBeNull();
    });

    it('keeps the opener on screen when the account resolves to nothing', async () => {
        detail({
            record: ticketDetailFixture({
                followers: [],
                createdBy: {
                    role: 'customer',
                    userId: '665f1c2a9b3e4a91c7d2e5f0',
                    profileId: null,
                    name: null,
                    businessName: null,
                    phone: null,
                    email: null,
                    administrator: null,
                },
            }),
        });

        expect(await screen.findByText('No name on record')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '665f1c2a9b3e4a91c7d2e5f0' })).toHaveAttribute(
            'href',
            '/dashboard/users/665f1c2a9b3e4a91c7d2e5f0',
        );
    });
});

describe('the followers', () => {
    const VENDOR_USER_ID = '6640aa11bb22cc33dd44ee01';

    /**
     * Counts reads of the ticket apart from its follower writes — the whole
     * point of the tests below is which of the two the screen makes.
     */
    function withFollowerWrites(options: {
        first?: TicketDetailRecord;
        afterWrite: TicketDetailRecord;
        onRead?: (count: number) => TicketDetailRecord;
        held?: ReadonlySet<string>;
    }) {
        const first = options.first ?? ticketDetailFixture();
        let reads = 0;

        const calls = stubFetch((call) => {
            const { pathname } = new URL(call.url, 'http://localhost');
            if (pathname.includes('/followers')) return successResponse(options.afterWrite);
            if (pathname === `/api/v1/support/tickets/${TICKET_ID}`) {
                reads += 1;
                return successResponse(options.onRead?.(reads) ?? first);
            }
            // The payout card reads on its own — not what is under test here.
            return errorResponse(404, 'NOT_FOUND', { category: 'not_found' });
        });

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/support/tickets/:ticketId" element={<TicketDetail />} />
            </Routes>,
            {
                route: `/dashboard/support/tickets/${TICKET_ID}`,
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: options.held ?? heldFixture(1) },
            },
        );

        return { calls, reads: () => reads };
    }

    async function removeVendor(user: ReturnType<typeof userEvent.setup>) {
        const list = await screen.findByRole('list', { name: 'Followers' });
        await user.click(within(list).getByRole('button', { name: /^remove/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /remove follower/i }));
    }

    it('lists them on the overview', async () => {
        detail();

        const list = await screen.findByRole('list', { name: 'Followers' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(within(list).getByText('Order party')).toBeInTheDocument();
    });

    /**
     * ⚠ Breaking, 2026-10-10: both follower writes answer the refreshed ticket
     * detail. The screen is replaced from that answer and the ticket is NOT
     * read again.
     */
    it('replaces the ticket from the answer to the write, without reading it again', async () => {
        const user = userEvent.setup();
        const afterWrite = ticketDetailFixture({
            followers: ticketFollowersFixture().filter(
                (follower) => follower.userId !== VENDOR_USER_ID,
            ),
        });
        const { calls, reads } = withFollowerWrites({ afterWrite });

        await removeVendor(user);

        await waitFor(() =>
            expect(
                within(screen.getByRole('list', { name: 'Followers' })).getAllByRole('listitem'),
            ).toHaveLength(2),
        );
        expect(screen.queryByText('Chez Paul')).toBeNull();
        expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
        expect(reads()).toBe(1);
    });

    /**
     * The written copy is held over the read it answered. A later load brings
     * the newer answer from the service and must win — a stale local list
     * cannot outlive the read that supersedes it.
     */
    it('drops the written copy as soon as the ticket is read again', async () => {
        const user = userEvent.setup();
        withFollowerWrites({
            afterWrite: ticketDetailFixture({ followers: [] }),
            // The second read says somebody has since added one back.
            onRead: (count) =>
                count === 1
                    ? ticketDetailFixture()
                    : ticketDetailFixture({
                          followers: [ticketFollowerFixture({ businessName: 'Marché Central' })],
                      }),
        });

        await removeVendor(user);
        expect(await screen.findByText('Nobody follows this ticket.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /refresh/i }));

        expect(await screen.findByText('Marché Central')).toBeInTheDocument();
        expect(screen.queryByText('Nobody follows this ticket.')).toBeNull();
    });

    /**
     * ⚠ Not gated on `availableActions`: Support, on a ticket it can neither
     * claim nor assign, still manages who follows it.
     */
    it('offers both controls to Support on a ticket it cannot claim or assign', async () => {
        withFollowerWrites({
            afterWrite: ticketDetailFixture(),
            first: ticketDetailFixture({
                availableActions: { claim: false, assignableTiers: [] },
            }),
            held: heldFixture(3),
        });

        const list = await screen.findByRole('list', { name: 'Followers' });
        expect(screen.getByRole('button', { name: /add follower/i })).toBeInTheDocument();
        expect(within(list).getByRole('button', { name: /^remove/i })).toBeInTheDocument();
        // …while the assignment controls are, correctly, absent.
        expect(screen.queryByRole('button', { name: /^claim$/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^assign$/i })).toBeNull();
    });
});
