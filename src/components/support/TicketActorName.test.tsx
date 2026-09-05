import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { TicketActorName } from '@/components/support/TicketActorName';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';
import type { FileDetail } from '@/types/files.types';
import type { TicketActorSummary } from '@/types/support.types';

const AVATAR: FileDetail = {
    id: '6612a4f0c1a2b3d4e5f6071a',
    key: 'images/2026/08/amina.jpg',
    url: 'https://cdn.example.com/images/2026/08/amina.jpg',
    access: 'public',
    mimeType: 'image/jpeg',
    size: 8140,
    originalName: 'amina.jpg',
};

function actorFixture(overrides: Partial<TicketActorSummary> = {}): TicketActorSummary {
    return {
        user_id: '665f1c2a9b3e4a91c7d2e5f0',
        role: 'customer',
        name: 'Amina Bekele',
        avatar: null,
        ...overrides,
    };
}

function show(actor: TicketActorSummary | null, held: ReadonlySet<string> = heldFixture(3)) {
    renderWithProviders(<TicketActorName actor={actor} />, { permissions: { held } });
}

/** The link's `href`, or `null` when the value did not render as one. */
function href(name: RegExp | string): string | null {
    return screen.queryByRole('link', { name })?.getAttribute('href') ?? null;
}

describe('when the name actually resolved', () => {
    it('renders it', () => {
        show(actorFixture());
        expect(screen.getByText('Amina Bekele')).toBeInTheDocument();
    });

    it('routes a platform actor to the user directory', () => {
        show(actorFixture());
        expect(href('Amina Bekele')).toBe('/dashboard/users/665f1c2a9b3e4a91c7d2e5f0');
    });

    it('withholds the link from an account that cannot follow it', () => {
        show(actorFixture(), new Set(['support.tickets.read']));
        expect(screen.getByText('Amina Bekele')).toBeInTheDocument();
        expect(href('Amina Bekele')).toBeNull();
    });

    it('shows a public avatar beside the name', () => {
        show(actorFixture({ avatar: AVATAR }));
        expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute(
            'src',
            AVATAR.url,
        );
    });

    /**
     * ⚠ `isDisplayableImage` is all three conditions, not any one. A private
     * tree resolves with `url: null`, and an `<img>` built from it renders a
     * broken icon where a face was meant.
     */
    it('draws no avatar for a file with no public URL', () => {
        show(actorFixture({ avatar: { ...AVATAR, url: null, access: 'authorized' } }));
        expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument();
    });
});

describe('when nothing resolved — the placeholder', () => {
    /**
     * 🔴 **The case this component exists for.** An administrator has no row in
     * `jovi_mall` at all (ADR-004 D-1, the synthetic actor), so jovi-mall's
     * resolver matches nothing and falls back to the capitalised role — without
     * saying that it did. `name: "Admin"` reads exactly like somebody's name.
     */
    it('never prints "Admin" as though it were a name', () => {
        show(actorFixture({ role: 'admin', name: 'Admin' }));

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
        expect(screen.getByText('an administrator')).toBeInTheDocument();
    });

    /**
     * ⚠ **The same fall-through covers a DELETED profile**, which is why the
     * rule is "name equals role", not "role is admin". A customer whose profile
     * is gone comes back as `"Customer"`.
     */
    it('treats a deleted profile the same way', () => {
        show(actorFixture({ name: 'Customer' }));

        expect(screen.queryByText('Customer')).not.toBeInTheDocument();
        expect(screen.getByText('a customer')).toBeInTheDocument();
    });

    /**
     * ⚠ **The link is worth more than the name here.** The placeholder withholds
     * the identity; the id is still good and still resolves — in wi-admin's own
     * directory, one permission away.
     */
    it('routes an administrator to the administrator directory for a tier that holds it', () => {
        show(actorFixture({ role: 'admin', name: 'Admin' }), heldFixture(2));
        expect(href(/an administrator/i)).toBe('/dashboard/administrators/665f1c2a9b3e4a91c7d2e5f0');
    });

    /**
     * ⚠ **Support reads tickets and cannot read the administrator directory**
     * (`tier-grants.ts`: "no sight of the administrator directory"). So the tier
     * that meets this placeholder most often is the tier that cannot resolve it
     * — which is the argument for asking the backend to snapshot the name.
     */
    it('gives Support the phrase and no link', () => {
        show(actorFixture({ role: 'admin', name: 'Admin' }), heldFixture(3));

        expect(screen.getByText('an administrator')).toBeInTheDocument();
        expect(href(/an administrator/i)).toBeNull();
    });

    /**
     * ⚠ An `admin_accounts._id` is not a `users._id`. Sending it to
     * `/users/:userId` would 404 on every row while looking like a working link
     * — the mistake `CUSTOMER` made on `TicketEntityLink`.
     */
    it('never sends an administrator id to the user directory', () => {
        show(actorFixture({ role: 'admin', name: 'Admin' }), heldFixture(1));
        expect(href(/an administrator/i)).not.toContain('/users/');
    });

    it('falls back to a phrase when there is no actor object at all', () => {
        renderWithProviders(<TicketActorName actor={null} role="vendor" />, {
            permissions: { held: heldFixture(3) },
        });
        expect(screen.getByText('a vendor')).toBeInTheDocument();
    });

    /**
     * Treat an unknown enum value as unknown and render it raw — adding a role
     * upstream is an additive change, so a closed lookup would break on a
     * routine deploy.
     */
    it('renders an unrecognised role humanised rather than swallowing it', () => {
        renderWithProviders(<TicketActorName actor={null} role="delivery_partner" />, {
            permissions: { held: heldFixture(3) },
        });
        expect(screen.getByText('delivery partner')).toBeInTheDocument();
    });

    it('says "someone" when there is neither a name nor a role', () => {
        renderWithProviders(<TicketActorName actor={null} />, {
            permissions: { held: heldFixture(3) },
        });
        expect(screen.getByText('someone')).toBeInTheDocument();
    });
});
