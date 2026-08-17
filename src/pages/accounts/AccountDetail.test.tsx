import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { AccountDetail } from '@/pages/accounts/AccountDetail';
import { adminFixture, heldFixture, vendorAccountFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const AGENCY_ID = '665c0011223344556677889a';

/** Answers the composed account read and throws on anything unexpected. */
function stubAccount() {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/accounts/')) return successResponse(vendorAccountFixture());
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * Rendered through the route pattern, because the screen reads
 * `:ownerType/:ownerId` from `useParams` — the pair is the whole address here,
 * and neither half means anything alone.
 */
function render(path = `/dashboard/accounts/vendor/${VENDOR_ID}`, held = heldFixture(1)) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/accounts/:ownerType/:ownerId" element={<AccountDetail />} />
        </Routes>,
        {
            route: path,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
}

describe('the address', () => {
    it('refuses a platform account without firing a request', () => {
        /*
         * The platform's own commission account is deliberately not one of these
         * — it has no plan, no credit wallet and no cash liability. Checking here
         * saves a round trip to be told what the screen already knows.
         */
        const calls = stubAccount();

        render(`/dashboard/accounts/platform/${VENDOR_ID}`);

        expect(screen.getByText(/not an account address/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('refuses a malformed id without firing a request', () => {
        const calls = stubAccount();

        render('/dashboard/accounts/vendor/not-an-id');

        expect(screen.getByText(/24-character hexadecimal/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

describe('the tabs a caller may open', () => {
    it('shows every tab to an administrator holding all of them', async () => {
        stubAccount();

        render();

        expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /payouts/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /credits/i })).toBeInTheDocument();
    });

    it('omits the cash ledger for a vendor, whose route refuses it', () => {
        /*
         * A route fact, not a data one: the params schema accepts agent and
         * agency only, so no value the server could send would make this tab
         * meaningful for a vendor.
         */
        stubAccount();

        render();

        expect(screen.queryByRole('tab', { name: /cash ledger/i })).not.toBeInTheDocument();
    });

    it('offers the cash ledger for an agency', async () => {
        stubFetch(() => successResponse(vendorAccountFixture()));

        render(`/dashboard/accounts/agency/${AGENCY_ID}`);

        expect(await screen.findByRole('tab', { name: /cash ledger/i })).toBeInTheDocument();
    });

    it('omits the payouts tab without money.payouts.read', () => {
        stubAccount();

        render(`/dashboard/accounts/vendor/${VENDOR_ID}`, new Set(['money.earnings.read']));

        expect(screen.queryByRole('tab', { name: /payouts/i })).not.toBeInTheDocument();
    });

    it('omits the credits tab without billing.plans.read', () => {
        stubAccount();

        render(`/dashboard/accounts/vendor/${VENDOR_ID}`, new Set(['money.earnings.read']));

        expect(screen.queryByRole('tab', { name: /credits/i })).not.toBeInTheDocument();
    });

    it('omits the overview unless all three of its permissions are held', () => {
        // The composed read is an `all`-mode guard; two of three is a refusal.
        stubAccount();

        render(
            `/dashboard/accounts/vendor/${VENDOR_ID}`,
            new Set(['money.earnings.read', 'billing.plans.read']),
        );

        expect(screen.queryByRole('tab', { name: /overview/i })).not.toBeInTheDocument();
    });

    it('lands on the first tab the caller may actually open', async () => {
        /*
         * A payout-only administrator must not land on a blank Overview. The
         * default is computed from what they hold, never fixed.
         */
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/payouts')) {
                return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        render(`/dashboard/accounts/vendor/${VENDOR_ID}`, new Set(['money.payouts.read']));

        expect(await screen.findByRole('tab', { name: /payouts/i })).toHaveAttribute(
            'data-state',
            'active',
        );
    });

    it('explains itself when the caller holds none of the permissions', () => {
        const calls = stubAccount();

        render(`/dashboard/accounts/vendor/${VENDOR_ID}`, new Set(['users.read']));

        expect(screen.getByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.getByText(/each behind its own permission/i)).toBeInTheDocument();
        // Nothing to fetch, so nothing is fetched.
        expect(calls).toHaveLength(0);
    });
});
