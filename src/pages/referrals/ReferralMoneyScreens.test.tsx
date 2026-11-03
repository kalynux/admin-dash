import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AuditTargetLink } from '@/components/audit/AuditTargetLink';
import { PayoutDetail } from '@/pages/money/PayoutDetail';
import { PayoutsQueue } from '@/pages/money/PayoutsQueue';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { payoutFixture, payoutListMetaFixture } from '@/test/money-fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import { AUDIT_TARGET_TYPES } from '@/types/audit.types';
import {
    CLAWBACK_OWNER_TYPES,
    EARNINGS_ACCOUNT_OWNER_TYPES,
    moneyOwnerPath,
    PAYOUT_OWNER_TYPES,
} from '@/types/money.types';
import {
    transactionPartyScreen,
    transactionReasonLabel,
    transactionRoleLabel,
} from '@/types/transactions.types';
import { ROLE_CLOSURE_BLOCKER_LABELS } from '@/types/users.types';

/**
 * Where the referral program touches screens built before it (changelog § Existing
 * screens). The partner's own screens are in `Referrals.test.tsx`.
 */

const PARTNER_ID = '6900a1b2c3d4e5f6a7b8c901';

const PARTNER_PAYOUT = payoutFixture({
    owner: { type: 'referral_partner', id: PARTNER_ID, name: 'ULRICH123' },
    // What the service answers for an owner its verification lookup does not cover.
    verification: { verified: false, verdict: 'unverified' },
});

function render(ui: React.ReactElement, tier: 1 | 2 | 3, route = '/') {
    return renderWithProviders(ui, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { status: 'ready', held: heldFixture(tier) },
    });
}

describe('the payout queue', () => {
    it('names a partner by code, links their page and does not call them unverified', async () => {
        stubFetch(() => successResponse([PARTNER_PAYOUT], { meta: payoutListMetaFixture() }));
        render(<PayoutsQueue />, 2);

        const link = await screen.findByRole('link', { name: 'ULRICH123' });
        expect(link).toHaveAttribute('href', `/dashboard/referrals/partners/${PARTNER_ID}`);
        const row = link.closest('tr') as HTMLElement;
        expect(within(row).getByText('referral partner')).toBeInTheDocument();
        expect(within(row).getByText('No verification')).toBeInTheDocument();
        expect(within(row).queryByText(/^unverified$/i)).not.toBeInTheDocument();
    });

    it('offers partners on the owner filter', async () => {
        const user = userEvent.setup();
        stubFetch(() => successResponse([], { meta: payoutListMetaFixture({ total: 0, pages: 0 }) }));
        render(<PayoutsQueue />, 2);

        await user.click(await screen.findByRole('combobox', { name: /owner kind/i }));
        expect(await screen.findByRole('option', { name: 'referral partner' })).toBeInTheDocument();
    });

    it('sends the partner filter as the wire value', async () => {
        const calls = stubFetch(() => successResponse([], { meta: payoutListMetaFixture({ total: 0, pages: 0 }) }));
        render(<PayoutsQueue />, 2, `/dashboard/money/payouts?ownerType=referral_partner&ownerId=${PARTNER_ID}`);

        await screen.findByText(new RegExp(`Owner ${PARTNER_ID}`));
        const url = new URL(calls[0].url, 'http://x');
        expect(url.searchParams.get('ownerType')).toBe('referral_partner');
        expect(url.searchParams.get('ownerId')).toBe(PARTNER_ID);
    });
});

describe('the payout detail', () => {
    it('opens the partner rather than an account page that refuses them', async () => {
        const id = PARTNER_PAYOUT.id;
        stubFetch((call) =>
            call.url.includes(`/money/payouts/${id}`)
                ? successResponse(PARTNER_PAYOUT)
                : successResponse([], { meta: payoutListMetaFixture({ total: 0, pages: 0 }) }),
        );
        render(
            <Routes>
                <Route path="/dashboard/money/payouts/:payoutId" element={<PayoutDetail />} />
            </Routes>,
            2,
            `/dashboard/money/payouts/${id}`,
        );

        const open = await screen.findByRole('link', { name: 'Open the partner' });
        expect(open).toHaveAttribute('href', `/dashboard/referrals/partners/${PARTNER_ID}`);
        expect(screen.getByText(/no verification: read the checks/i)).toBeInTheDocument();
        expect(document.querySelector('a[href^="/dashboard/accounts/referral_partner"]')).toBeNull();
    });
});

describe('the owner vocabulary', () => {
    it('lists partners on payouts, accounts and refund debt', () => {
        expect(PAYOUT_OWNER_TYPES).toContain('referral_partner');
        expect(CLAWBACK_OWNER_TYPES).toContain('referral_partner');
    });

    it('does not offer one on Allocations: a reward is never an allocation', () => {
        expect(EARNINGS_ACCOUNT_OWNER_TYPES).not.toContain('referral_partner' as never);
    });

    it('sends every other owner to their account page, as before', () => {
        expect(moneyOwnerPath('vendor', 'v1')).toBe('/dashboard/accounts/vendor/v1');
        expect(moneyOwnerPath('referral_partner', 'p1')).toBe('/dashboard/referrals/partners/p1');
    });
});

describe('transactions', () => {
    it('labels the three ledger reasons in words', () => {
        expect(transactionReasonLabel('referral_reward')).toBe('Referral reward earned');
        expect(transactionReasonLabel('referral_reward_matured')).toBe('Referral reward available');
        expect(transactionReasonLabel('referral_reward_clawback')).toBe('Referral reward reduced by a refund');
    });

    it('names the party role and links the partner on the read', () => {
        expect(transactionRoleLabel('referral_partner')).toMatch(/referral partner/i);
        expect(transactionPartyScreen({ role: 'referral_partner', id: 'p1' })).toEqual({
            path: '/dashboard/referrals/partners/p1',
            permission: 'referrals.read',
        });
    });
});

describe('audit', () => {
    it('offers both new targets on the filter', () => {
        expect(AUDIT_TARGET_TYPES).toContain('referral_partner');
        expect(AUDIT_TARGET_TYPES).toContain('referral_settings');
    });

    it('links a partner target, and leaves the one settings document unlinked', () => {
        stubFetch(() => successResponse({}));
        render(<AuditTargetLink type="referral_partner" id={PARTNER_ID} label="ULRICH123" />, 3);
        expect(screen.getByRole('link', { name: 'ULRICH123' })).toHaveAttribute(
            'href',
            `/dashboard/referrals/partners/${PARTNER_ID}`,
        );
    });

    it('prints the settings target by its label', () => {
        stubFetch(() => successResponse({}));
        render(<AuditTargetLink type="referral_settings" id={null} label="Referral settings" />, 3);
        expect(screen.getByText('Referral settings')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('closing a role', () => {
    it('words the referral wallet blocker', () => {
        expect(ROLE_CLOSURE_BLOCKER_LABELS.referral_balance.what).toMatch(/referral wallet/i);
    });
});
