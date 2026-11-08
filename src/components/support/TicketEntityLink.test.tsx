import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { TicketEntityLink } from '@/components/support/TicketEntityLink';
import { ticketEntityFixture } from '@/test/support-fixtures';
import { renderWithProviders } from '@/test/utils';
import { TICKET_ENTITY_TYPES } from '@/types/support.types';
import type { TicketEntityRef } from '@/types/support.types';

function show(entity: TicketEntityRef | null, held?: ReadonlySet<string>) {
    renderWithProviders(<TicketEntityLink entity={entity} />, {
        permissions: held ? { held } : undefined,
    });
}

/** The link's `href`, or `null` when the value did not render as one. */
function href(name: RegExp | string): string | null {
    return screen.queryByRole('link', { name })?.getAttribute('href') ?? null;
}

describe('the seven types that open a record', () => {
    it('routes an order to the order detail', () => {
        show(ticketEntityFixture({ label: 'ORD-2026-008841' }));
        expect(href('ORD-2026-008841')).toBe('/dashboard/orders/6670aabbccddeeff00112233');
    });

    it('routes a shipment to the shipment detail', () => {
        show(ticketEntityFixture({ type: 'SHIPMENT', id: '6671aabbccddeeff00112233' }));
        expect(href('6671aabbccddeeff00112233')).toBe(
            '/dashboard/shipments/6671aabbccddeeff00112233',
        );
    });

    /**
     * ⚠ **The whole point of BR-016 § 7.** A product's route needs two ids and
     * the ticket carries one; `entity.vendorId` is what supplies the other.
     */
    it('routes a product through its vendor', () => {
        show(
            ticketEntityFixture({
                type: 'PRODUCT',
                id: '66601122334455667788990a',
                vendorId: '6650aa11bb22cc33dd44ee55',
                label: 'Plantain — 1 kg',
            }),
        );
        expect(href('Plantain — 1 kg')).toBe(
            '/dashboard/vendors/6650aa11bb22cc33dd44ee55/products/66601122334455667788990a',
        );
    });

    it.each([
        ['VENDOR', '/dashboard/vendors/'],
        ['AGENCY', '/dashboard/agencies/'],
        ['AGENT', '/dashboard/agents/'],
        ['USER', '/dashboard/users/'],
    ])('routes %s to its directory', (type, prefix) => {
        const id = '665f1c2a9b3e4a91c7d2e5f0';
        show(ticketEntityFixture({ type, id }));
        expect(href(id)).toBe(`${prefix}${id}`);
    });
});

describe('a product whose vendor did not resolve', () => {
    /**
     * ⚠ An ordinary state, not a fault. The lookup does not filter `deletedAt`,
     * so a soft-deleted listing still resolves — but a hard-deleted one is
     * served with no `vendorId`, and a catalogue complaint is exactly the ticket
     * that tends to end in a deletion. The row still shows what it names.
     */
    it('renders the id with no link rather than guessing a vendor', () => {
        show(
            ticketEntityFixture({
                type: 'PRODUCT',
                id: '66601122334455667788990a',
                vendorId: null,
            }),
        );

        expect(screen.getByText('66601122334455667788990a')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy product id/i })).toBeInTheDocument();
    });
});

describe('a customer opens a search, never a record', () => {
    /**
     * A `customers._id` is not a `users._id`, so `/dashboard/users/<id>` is a 404
     * on every ticket while looking like a working link — that has not changed.
     * What changed on 2026-10-12 (BR-028 § 1) is that the user directory's SEARCH
     * resolves a customer id to its account, and tries it as a user id too, which
     * matters because nothing guarantees which of the two a ticket carries.
     */
    it('searches the user directory for the id', () => {
        show(ticketEntityFixture({ type: 'CUSTOMER', id: '665f1c2a9b3e4a91c7d2e5f0' }));

        expect(screen.getByRole('link', { name: '665f1c2a9b3e4a91c7d2e5f0' })).toHaveAttribute(
            'href',
            '/dashboard/users?search=665f1c2a9b3e4a91c7d2e5f0',
        );
    });

    it('never routes it to the user detail page', () => {
        show(ticketEntityFixture({ type: 'CUSTOMER', id: '665f1c2a9b3e4a91c7d2e5f0' }));

        for (const link of screen.getAllByRole('link')) {
            expect(link.getAttribute('href')).not.toMatch(/\/dashboard\/users\/[0-9a-f]{24}/);
        }
    });
});

describe('a booking opens its own screen (2026-10-27)', () => {
    /** `bookings.md` § Tickets: the label is the booking number, and the id stays beside it. */
    it('routes a booking to the booking detail under its number', () => {
        show(ticketEntityFixture({ type: 'BOOKING', id: '6690aabbccddeeff00112233', label: 'BKG-2026-000117' }));
        expect(href('BKG-2026-000117')).toBe('/dashboard/bookings/6690aabbccddeeff00112233');
        expect(screen.getByText('6690aabbccddeeff00112233')).toBeInTheDocument();
    });

    it('gates it on bookings.read', () => {
        show(
            ticketEntityFixture({ type: 'BOOKING', id: '6690aabbccddeeff00112233', label: 'BKG-2026-000117' }),
            new Set(['support.tickets.read']),
        );
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('BKG-2026-000117')).toBeInTheDocument();
    });
});

describe('a listing lead (2026-11-07)', () => {
    const id = '6720aabbccddeeff00112233';

    it('opens the lead page, which shows the customer in full', () => {
        show(ticketEntityFixture({ type: 'LISTING_LEAD', id }));
        expect(href(id)).toBe(`/dashboard/listings/leads/${id}`);
    });

    it('gates it on catalog.listings.read', () => {
        show(ticketEntityFixture({ type: 'LISTING_LEAD', id }), new Set(['support.tickets.read']));
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('the two types that do not open', () => {

    it('renders DELIVERY as a value, having no screen', () => {
        show(ticketEntityFixture({ type: 'DELIVERY', id: '6670aabbccddeeff00112233' }));
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    /**
     * ⚠ The documented shape, not missing data: jovi-mall requires `entityId`
     * for every type **except** `OTHER`. `<NotSet />` would file a deliberate
     * answer under "not recorded".
     */
    it('says an OTHER ticket names nothing in particular', () => {
        show(ticketEntityFixture({ type: 'OTHER', id: null }));

        expect(screen.getByText(/nothing in particular/i)).toBeInTheDocument();
        // `humaniseEnum` replaces underscores and nothing else, so the
        // SCREAMING_SNAKE token stays shouty — the house style on this screen,
        // where Type renders 'DELIVERY ISSUE' two rows above.
        expect(screen.getByText('OTHER')).toBeInTheDocument();
    });
});

describe('a link is also a permission claim', () => {
    it('degrades to a copyable id without the destination’s permission', () => {
        // Holds the ticket permissions and nothing else — the id still shows,
        // because it is already in the row the operator is reading.
        show(ticketEntityFixture(), new Set(['support.tickets.read']));

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('6670aabbccddeeff00112233')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy order id/i })).toBeInTheDocument();
    });

    it('gates a product link on the vendor permission, not the ticket’s', () => {
        show(
            ticketEntityFixture({
                type: 'PRODUCT',
                id: '66601122334455667788990a',
                vendorId: '6650aa11bb22cc33dd44ee55',
            }),
            new Set(['support.tickets.read', 'orders.read']),
        );
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('the label never replaces the id', () => {
    /**
     * ⚠ The contract says outright that `label` is *"a convenience — never a
     * substitute for the id, and never rendered in its place"*. An order number
     * and a tracking number are both searchable strings an operator copies, so
     * the id keeps its own render underneath.
     */
    it('shows both when a label resolved', () => {
        show(ticketEntityFixture({ label: 'ORD-2026-008841' }));

        expect(screen.getByText('ORD-2026-008841')).toBeInTheDocument();
        expect(screen.getByText('6670aabbccddeeff00112233')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy order id/i })).toBeInTheDocument();
    });
});

describe('an unrecognised token', () => {
    /**
     * wi-admin validates `entityType` by **shape, not membership** — the enum is
     * jovi-mall's to grow. A twelfth value must render as itself rather than
     * blanking the field.
     */
    it('renders as text rather than being swallowed', () => {
        show(ticketEntityFixture({ type: 'WAREHOUSE_PALLET', id: 'abc' }));

        expect(screen.getByText('WAREHOUSE PALLET')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('no entity at all', () => {
    it('says the ticket is about no specific record', () => {
        show(null);
        expect(screen.getByText(/not about a specific record/i)).toBeInTheDocument();
    });
});

describe('the vocabulary this table is written against', () => {
    /**
     * A guard on the *count*, not the members: `support-vocabularies.test.ts`
     * already diffs the twelve against jovi-mall's mirror. This one fails if a
     * thirteenth arrives, which is the moment somebody has to decide whether it
     * routes — the decision this file exists to record. The twelfth,
     * `LISTING_LEAD` (2026-11-07), was decided: it opens the lead page.
     */
    it('still has twelve members', () => {
        expect(TICKET_ENTITY_TYPES).toHaveLength(12);
    });
});
