import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { TicketPerson } from '@/components/support/TicketPerson';
import type { TicketPersonLike } from '@/lib/ticket-people';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';

const VENDOR: TicketPersonLike = {
    role: 'vendor',
    userId: '6640aa11bb22cc33dd44ee01',
    profileId: '6640aa11bb22cc33dd44ee02',
    name: 'Paul Etoa',
    businessName: 'Chez Paul',
    phone: '+237600000002',
    email: 'paul@chezpaul.example',
};

const CUSTOMER: TicketPersonLike = {
    role: 'customer',
    userId: '665f1c2a9b3e4a91c7d2e5f0',
    profileId: '665f1c2a9b3e4a91c7d2e5f1',
    name: 'Awa Ndiaye',
    businessName: null,
    phone: '+237600000001',
    email: null,
};

function show(
    person: TicketPersonLike,
    options: { held?: ReadonlySet<string>; density?: 'full' | 'compact' } = {},
) {
    renderWithProviders(<TicketPerson person={person} density={options.density} />, {
        permissions: { held: options.held ?? heldFixture(1) },
    });
}

describe('a vendor or an agency', () => {
    /**
     * `name` is a human. The business leads and the person is the contact line
     * — printing the person under "Vendor" mislabels the row.
     */
    it('leads with the business name and shows the person as the contact', () => {
        show(VENDOR);

        expect(screen.getByRole('link', { name: 'Chez Paul' })).toBeInTheDocument();
        expect(screen.getByText('Contact: Paul Etoa')).toBeInTheDocument();
        expect(screen.getByText('Vendor')).toBeInTheDocument();
    });

    /** `/vendors/:id` takes the profile id. The user id opens the directory. */
    it('opens the vendor screen with the PROFILE id and the user directory with the user id', () => {
        show(VENDOR);

        expect(screen.getByRole('link', { name: 'Chez Paul' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/6640aa11bb22cc33dd44ee02',
        );
        expect(screen.getByRole('link', { name: '6640aa11bb22cc33dd44ee01' })).toHaveAttribute(
            'href',
            '/dashboard/users/6640aa11bb22cc33dd44ee01',
        );
    });

    it('says when the title is the contact person, because no business name resolved', () => {
        show({ ...VENDOR, businessName: null });

        expect(screen.getByRole('link', { name: 'Paul Etoa' })).toBeInTheDocument();
        expect(screen.getByText(/contact person — no shop name on record/i)).toBeInTheDocument();
    });
});

describe('a customer', () => {
    it('shows the person, the phone and a link to the user — and no business line', () => {
        show(CUSTOMER);

        // No customer screen exists here, so the name opens the user.
        expect(screen.getByRole('link', { name: 'Awa Ndiaye' })).toHaveAttribute(
            'href',
            '/dashboard/users/665f1c2a9b3e4a91c7d2e5f0',
        );
        expect(screen.getByText('+237600000001')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy customer phone/i })).toBeInTheDocument();
        // A customer can register by phone alone — said, not left blank.
        expect(screen.getByText('No e-mail')).toBeInTheDocument();
        expect(screen.queryByText(/^Contact:/)).not.toBeInTheDocument();
    });
});

describe('nothing resolved', () => {
    /**
     * A deleted profile or a closed, anonymised account. The ticket still names
     * them, so the row stays: the role and the id, and a sentence saying why
     * the rest is missing.
     */
    it('keeps the row, with the role and the id', () => {
        show({
            role: 'agent',
            userId: '6630aa11bb22cc33dd44ee03',
            profileId: null,
            name: null,
            businessName: null,
            phone: null,
            email: null,
        });

        expect(screen.getByText('No name on record')).toBeInTheDocument();
        expect(screen.getByText('Agent')).toBeInTheDocument();
        expect(screen.getByText('6630aa11bb22cc33dd44ee03')).toBeInTheDocument();
        expect(screen.getByText(/nothing could be looked up for this id/i)).toBeInTheDocument();
    });

    it('survives a service that sends none of the looked-up keys', () => {
        show({ role: 'customer', userId: '665f1c2a9b3e4a91c7d2e5f0' });

        expect(screen.getByText('Customer')).toBeInTheDocument();
        expect(screen.getByText('665f1c2a9b3e4a91c7d2e5f0')).toBeInTheDocument();
    });
});

describe('an administrator', () => {
    /**
     * A name and nothing else: no phone, no e-mail, no profile — and an id that
     * is not a `users._id`, so no link to the user directory.
     */
    it('shows the name only', () => {
        show({
            role: 'admin',
            userId: '66aa000000000000000000ff',
            profileId: null,
            name: 'Wi-Mall (automatic)',
            businessName: null,
            phone: null,
            email: null,
        });

        expect(screen.getByText('Wi-Mall (automatic)')).toBeInTheDocument();
        expect(screen.getByText('Administrator')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByText('No phone')).not.toBeInTheDocument();
        expect(screen.queryByText(/nothing could be looked up/i)).not.toBeInTheDocument();
    });
});

describe('a link is a permission claim', () => {
    it('falls back to the user when the role screen is out of reach, and to text without either', () => {
        // Holds `users.read` and not `vendors.read`.
        show(VENDOR, { held: new Set(['users.read']) });

        expect(screen.getByRole('link', { name: 'Chez Paul' })).toHaveAttribute(
            'href',
            '/dashboard/users/6640aa11bb22cc33dd44ee01',
        );
    });

    it('still shows every value with no link at all', () => {
        show(VENDOR, { held: new Set() });

        expect(screen.getByText('Chez Paul')).toBeInTheDocument();
        expect(screen.getByText('+237600000002')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('the queue cell', () => {
    it('shows the name, the role with the contact, and the phone', () => {
        show(VENDOR, { density: 'compact' });

        expect(screen.getByRole('link', { name: 'Chez Paul' })).toBeInTheDocument();
        expect(screen.getByText('Vendor · Paul Etoa')).toBeInTheDocument();
        expect(screen.getByText('+237600000002')).toBeInTheDocument();
    });

    it('falls back to the role and the id when nothing resolved', () => {
        show(
            { role: 'customer', userId: '665f1c2a9b3e4a91c7d2e5f0', name: null, phone: null },
            { density: 'compact' },
        );

        expect(screen.getByText('Customer')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy user id/i })).toBeInTheDocument();
    });
});
