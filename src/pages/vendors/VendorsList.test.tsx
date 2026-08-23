import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VendorsList } from '@/pages/vendors/VendorsList';
import {
    adminFixture,
    onboardingVendorFixture,
    vendorFixture,
    vendorListMetaFixture,
} from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

/** Answers `/vendors` and throws on anything else, so a stray request is a failure. */
function stubList(rows = [vendorFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/vendors')) {
            return successResponse(rows, { meta: { ...vendorListMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * `Africa/Douala` is pinned rather than left to the runner's zone: every date this
 * screen renders or sends is resolved in the operator's zone, and a test that
 * inherited the machine's would pass or fail depending on where it ran.
 */
function list(route = '/dashboard/vendors') {
    return renderWithProviders(<VendorsList />, {
        route,
        auth: {
            status: 'authenticated',
            admin: adminFixture({ timezone: 'Africa/Douala' }),
        },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

describe('the directory', () => {
    it('renders a row per vendor, named by its business', async () => {
        stubList();
        list();

        expect(
            await screen.findByRole('link', { name: 'Douala Fresh Market' }),
        ).toBeInTheDocument();
        expect(screen.getByText('douala-fresh-market')).toBeInTheDocument();
        expect(screen.getByText('marcel@doualafresh.cm')).toBeInTheDocument();
    });

    it('falls through to the contact name when a vendor has no store yet', async () => {
        stubList([onboardingVendorFixture()]);
        list();

        // No business name and no slug — the record still has to be openable.
        expect(await screen.findByRole('link', { name: 'Marcel T.' })).toBeInTheDocument();
        expect(screen.getByText(/no store yet/i)).toBeInTheDocument();
    });

    it('links each row to its detail route', async () => {
        stubList();
        list();

        expect(await screen.findByRole('link', { name: 'Douala Fresh Market' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/6650aa11bb22cc33dd44ee55',
        );
    });

    /**
     * The inversion the contract warns about: step `0` is *complete*. A screen that
     * read the number the natural way would render "Step 0" on a finished vendor.
     */
    it('reads onboarding step 0 as complete, and names an unfinished step', async () => {
        stubList([
            vendorFixture(),
            onboardingVendorFixture({ id: 'b'.repeat(24), onboardingStep: 2 }),
        ]);
        list();

        expect(await screen.findByText('Complete')).toBeInTheDocument();
        expect(screen.getByText('Delivery linking')).toBeInTheDocument();
    });

    it('renders the vendor status verbatim rather than softening it', async () => {
        stubList([suspended()]);
        list();

        // `inactive`, not a friendlier "suspended" — the word has to match the API,
        // the audit trail and the vendor's own error message.
        expect(await screen.findByText('inactive')).toBeInTheDocument();
    });
});

describe('filters', () => {
    it('sorts by -createdAt without being told', async () => {
        const calls = stubList();
        list();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(latest(calls).searchParams.get('sort')).toBe('-createdAt');
    });

    it('asks for the documented default page size', async () => {
        const calls = stubList();
        list();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(latest(calls).searchParams.get('limit')).toBe('20');
    });

    it('sends no search parameter when the box is empty', async () => {
        const calls = stubList();
        list();

        await waitFor(() => expect(calls).toHaveLength(1));
        // An empty `?search=` is a 400, not "no filter".
        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    it('reads the status filter out of the URL', async () => {
        const calls = stubList();
        list('/dashboard/vendors?status=inactive');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(latest(calls).searchParams.get('status')).toBe('inactive');
    });

    it('reads the verification and onboarding filters out of the URL', async () => {
        const calls = stubList();
        list('/dashboard/vendors?kycStatus=pending&onboarding=incomplete');

        await waitFor(() => expect(calls).toHaveLength(1));
        const params = latest(calls).searchParams;
        expect(params.get('kycStatus')).toBe('pending');
        // The filter is `onboarding`; the response field is `onboardingComplete`.
        expect(params.get('onboarding')).toBe('incomplete');
    });

    it('upper-cases the country before sending it', async () => {
        const calls = stubList();
        list('/dashboard/vendors?country=cm');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(latest(calls).searchParams.get('country')).toBe('CM');
    });

    /**
     * The days in the URL are resolved to instants at request time, in the
     * *operator's* zone. Douala is UTC+1 with no DST, so a day starting locally at
     * midnight is 23:00 the previous day in UTC — and the range is half-open, so
     * `to` is the start of the day *after* the one picked.
     */
    it('resolves the day range to instants in the operator’s zone', async () => {
        const calls = stubList();
        list('/dashboard/vendors?createdFrom=2026-08-11&createdTo=2026-08-13');

        await waitFor(() => expect(calls).toHaveLength(1));
        const params = latest(calls).searchParams;
        expect(params.get('from')).toBe('2026-08-10T23:00:00.000Z');
        expect(params.get('to')).toBe('2026-08-13T23:00:00.000Z');
    });

    it('makes no request at all for an over-cap range', async () => {
        const calls = stubList();
        list('/dashboard/vendors?createdFrom=2024-01-01&createdTo=2026-08-13');

        // The span is a 400. Catching it here keeps the last good page on screen
        // instead of flashing an error panel over it.
        await screen.findByText(/366 days or fewer/i);
        const rangeCalls = calls.filter((call) => call.url.includes('from='));
        expect(rangeCalls).toHaveLength(0);
    });

    it('offers sorting only on the three keys the endpoint allows', async () => {
        stubList();
        list();

        await screen.findByRole('link', { name: 'Douala Fresh Market' });

        expect(screen.getByRole('button', { name: /sort by registered/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sort by updated/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sort by contact/i })).toBeInTheDocument();
        // Business name lives on `stores` and is not sortable — a control here
        // would produce a 400 naming the permitted set.
        expect(screen.queryByRole('button', { name: /sort by business/i })).not.toBeInTheDocument();
    });

    it('resets to page one when a filter changes', async () => {
        const calls = stubList();
        list('/dashboard/vendors?page=4');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(latest(calls).searchParams.get('page')).toBe('4');

        await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
        await userEvent.click(await screen.findByRole('option', { name: 'inactive' }));

        await waitFor(() => {
            const query = latest(calls).searchParams;
            expect(query.get('status')).toBe('inactive');
            // Page 4 of every vendor is rarely page 4 of the suspended ones. The
            // key leaves the URL; the request still names page 1 explicitly.
            expect(query.get('page')).toBe('1');
        });
    });
});

describe('states', () => {
    /**
     * The cap [ADR-005 D-13 forbids hiding. A short list that reads as complete is
     * the same as telling an operator the vendor they want does not exist.
     */
    it('warns when a business-name search matched more names than it could look up', async () => {
        stubList([vendorFixture()], { businessNameMatchesTruncated: true });
        list('/dashboard/vendors?search=market');

        expect(await screen.findByText(/results may be incomplete/i)).toBeInTheDocument();
    });

    it('says nothing about completeness when the server did not set the flag', async () => {
        stubList();
        list('/dashboard/vendors?search=market');

        await screen.findByRole('link', { name: 'Douala Fresh Market' });
        expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
    });

    it('distinguishes an empty directory from an empty filter result', async () => {
        stubList([], { total: 0, pages: 0 });
        list();

        expect(await screen.findByText(/no vendors yet/i)).toBeInTheDocument();
    });

    it('offers a way out when filters produced nothing', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/vendors?status=inactive');

        expect(await screen.findByText(/no vendors match these filters/i)).toBeInTheDocument();
        // Two of them by design — the filter bar's, and the empty state's.
        expect(
            screen.getAllByRole('button', { name: /clear filters/i }).length,
        ).toBeGreaterThan(0);
    });

    it('renders a disabled pager over a single page', async () => {
        stubList();
        list();

        await screen.findByRole('link', { name: 'Douala Fresh Market' });
        // `pages: 1` is read from `meta`, never recomputed — so the count line is
        // honest and both directions are dead.
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('renders a permission refusal as a refusal, not a fault', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'vendors.read', mode: 'all' },
            }),
        );
        list();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        // Retrying an authorization refusal never becomes a success.
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry on a dependency failure, which often does clear', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'No answer came back from a service we depend on',
                category: 'external_service',
            }),
        );
        list();

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});

function suspended() {
    return vendorFixture({ status: 'inactive' });
}
