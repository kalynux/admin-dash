import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { VendorDetail } from '@/pages/vendors/VendorDetail';
import {
    adminFixture,
    agencySuspendedProductFixture,
    auditEntryFixture,
    auditMetaFixture,
    heldFixture,
    oversightSuspendedProductFixture,
    platformVendorFixture,
    suspendedVendorDetailFixture,
    vendorAccountFixture,
    vendorAgencyConnectionFixture,
    vendorDetailFixture,
    vendorProductFixture,
} from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';

interface StubOptions {
    detail?: ReturnType<typeof vendorDetailFixture>;
    products?: ReturnType<typeof vendorProductFixture>[];
    connections?: ReturnType<typeof vendorAgencyConnectionFixture>[];
    write?: () => Response;
}

/**
 * Answers the five reads this screen can make, and throws on anything else.
 *
 * The order matters: the sub-resource paths are prefixes of the detail path, so
 * they are matched first. Getting that backwards hands the detail's payload to the
 * catalogue, which renders rows with no `status` — a shape the service cannot
 * produce. `/agencies` joined the list with the connections panel and fell into
 * exactly that trap: without its own branch it was answered with the vendor
 * document, whose `data` is an object, and the table threw while mapping it.
 */
function stubDetail({
    detail = vendorDetailFixture(),
    products = [],
    connections = [vendorAgencyConnectionFixture()],
    write,
}: StubOptions = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.method !== 'GET' && write) return write();

        if (call.url.includes('/products')) {
            return successResponse(products, {
                meta: { total: products.length, page: 1, limit: 20, pages: products.length ? 1 : 0 },
            });
        }
        if (call.url.includes('/agencies')) {
            return successResponse(connections, {
                meta: {
                    total: connections.length,
                    page: 1,
                    limit: 20,
                    pages: connections.length ? 1 : 0,
                },
            });
        }
        if (call.url.includes('/activity')) {
            return successResponse([auditEntryFixture({ action: 'vendors.suspend' })], {
                meta: { ...auditMetaFixture() },
            });
        }
        if (call.url.includes('/accounts/vendor/')) {
            return successResponse(vendorAccountFixture());
        }
        if (call.url.includes('/vendors/')) {
            return successResponse(detail);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * The same as `detail`, but handing back the stub's call log.
 *
 * Split out rather than changing `detail`'s return type, which is `render`'s and
 * is used for its `rerender` elsewhere.
 */
function detailCalls(options: StubOptions & { tier?: 1 | 2 | 3; id?: string } = {}) {
    const { tier = 1, id = VENDOR_ID, ...stubOptions } = options;
    const calls = stubDetail(stubOptions);

    renderWithProviders(
        <Routes>
            <Route path="/dashboard/vendors/:vendorId" element={<VendorDetail />} />
        </Routes>,
        {
            route: `/dashboard/vendors/${id}`,
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(tier) },
        },
    );

    return calls;
}

/** Mounted through a route so `useParams` sees a real `:vendorId`. */
function detail(options: StubOptions & { tier?: 1 | 2 | 3; id?: string } = {}) {
    const { tier = 1, id = VENDOR_ID, ...stubOptions } = options;
    stubDetail(stubOptions);

    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/vendors/:vendorId" element={<VendorDetail />} />
        </Routes>,
        {
            route: `/dashboard/vendors/${id}`,
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(tier) },
        },
    );
}

describe('the record', () => {
    it('refuses a malformed id without making a request', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });
        renderWithProviders(
            <Routes>
                <Route path="/dashboard/vendors/:vendorId" element={<VendorDetail />} />
            </Routes>,
            {
                route: '/dashboard/vendors/not-an-id',
                auth: { status: 'authenticated', admin: adminFixture() },
            },
        );

        expect(await screen.findByText(/24 hexadecimal characters/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('titles the screen with the business name', async () => {
        detail();
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Douala Fresh Market' }),
        ).toBeInTheDocument();
    });
});

/**
 * The failure the contract calls the commonest mistake on this screen: reading one
 * "active" and concluding everything is fine.
 */
describe('the four state axes', () => {
    it('renders trading status, sign-in status, shop hours and verification separately', async () => {
        detail({
            detail: vendorDetailFixture({
                status: 'active',
                kycStatus: 'rejected',
                account: {
                    id: '665f1c2a9b3e4a91c7d2e5f0',
                    email: 'marcel@doualafresh.cm',
                    phone: null,
                    roles: ['vendor'],
                    status: 'suspended',
                    suspension: null,
                },
                store: { ...vendorDetailFixture().store!, isOpen: false },
            }),
        });

        await screen.findByRole('heading', { level: 1, name: 'Douala Fresh Market' });
        const state = screen.getByText('State').closest('[data-slot="card"]') as HTMLElement;

        // Four different answers on one record, none derived from another.
        expect(within(state).getByText('active')).toBeInTheDocument();
        expect(within(state).getByText('suspended')).toBeInTheDocument();
        expect(within(state).getByText(/closed by the vendor/i)).toBeInTheDocument();
        expect(within(state).getByText('rejected')).toBeInTheDocument();
    });

    it('flags a vendor whose sign-in account is missing', async () => {
        detail({ detail: vendorDetailFixture({ account: null }) });

        // Invisible everywhere else, and it stops the person signing in.
        expect(
            await screen.findByText(/this vendor has no sign-in account/i),
        ).toBeInTheDocument();
    });

    it('shows the suspension reason only while the vendor is suspended', async () => {
        detail({ detail: suspendedVendorDetailFixture() });

        expect(await screen.findByText(/this vendor is suspended/i)).toBeInTheDocument();
        expect(
            screen.getByText(/mislabelled weights across the produce catalogue/i),
        ).toBeInTheDocument();
    });

    it('says what a reinstatement would return them to', async () => {
        detail({
            detail: suspendedVendorDetailFixture({
                suspension: {
                    at: '2026-08-13T09:40:11.502Z',
                    reason: 'Documents never submitted',
                    fromStatus: 'pending_verification',
                    by: { id: null, source: 'admin', name: 'Ada Nkemelu' },
                },
            }),
        });

        // Not to active — a vendor who was never verified does not silently become
        // verified by being reinstated.
        expect(await screen.findByText(/not to active/i)).toBeInTheDocument();
    });
});

describe('the counts', () => {
    /**
     * `vendors.md` claims only non-zero statuses appear and omits `pendingReview`
     * entirely. The service emits all six, always — hiding a zero would make
     * "nothing is pending review" and "we did not look" the same screen.
     */
    it('renders every product status including the zeros', async () => {
        detail();

        // `pendingReview: 0` in the fixture — the row has to be there anyway.
        expect(await screen.findByText('Pending review')).toBeInTheDocument();
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders the seventh connection state the docs do not mention', async () => {
        detail();

        await screen.findByText(/delivery agency connections/i);
        // `pausedReapproval`, not the `paused` the docs name.
        expect(screen.getByText('Paused for reapproval')).toBeInTheDocument();
        expect(screen.getByText('Terminated')).toBeInTheDocument();
    });
});

describe('what each tier may reach', () => {
    it('offers a Developer every tab', async () => {
        detail({ tier: 1 });

        await screen.findByRole('tab', { name: 'Overview' });
        expect(screen.getByRole('tab', { name: 'Catalogue' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Account' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
    });

    /**
     * Support holds `vendors.read` and `audit.read` but none of the three money
     * permissions, so the Account tab is not rendered at all rather than opening
     * into a refusal.
     */
    it('hides the Account tab from Support, and every write button with it', async () => {
        detail({ tier: 3 });

        await screen.findByRole('tab', { name: 'Overview' });
        expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Account' })).not.toBeInTheDocument();

        expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /approve verification/i }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /order settings/i })).not.toBeInTheDocument();
    });
});

describe('the write affordances follow the record', () => {
    it('offers Suspend on a trading vendor and Reinstate on a suspended one', async () => {
        const { unmount } = detail();
        expect(await screen.findByRole('button', { name: /suspend/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reinstate/i })).not.toBeInTheDocument();
        unmount();

        detail({ detail: suspendedVendorDetailFixture() });
        expect(await screen.findByRole('button', { name: /reinstate/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    });

    /**
     * Asking for the verdict a vendor already holds is `409
     * VENDOR_KYC_STATUS_CONFLICT`, so a button that could only ever produce it is
     * not offered.
     */
    it('offers only the verification verdict that would change something', async () => {
        const { unmount } = detail({ detail: vendorDetailFixture({ kycStatus: 'verified' }) });
        await screen.findByRole('button', { name: /reject verification/i });
        expect(
            screen.queryByRole('button', { name: /approve verification/i }),
        ).not.toBeInTheDocument();
        unmount();

        detail({ detail: vendorDetailFixture({ kycStatus: 'rejected' }) });
        await screen.findByRole('button', { name: /approve verification/i });
        expect(
            screen.queryByRole('button', { name: /reject verification/i }),
        ).not.toBeInTheDocument();
    });
});

describe('the cascade', () => {
    it('states the blast radius before asking for a reason', async () => {
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /suspend/i }));

        // 128 active listings, off the record already on screen.
        expect(await screen.findByText(/this takes 128 listing/i)).toBeInTheDocument();
    });

    it('reports the count the response carries, and says why fewer come back', async () => {
        detail({
            write: () =>
                successResponse(platformVendorFixture({ suspendedProductCount: 128 })),
        });

        await userEvent.click(await screen.findByRole('button', { name: /suspend/i }));
        await userEvent.type(
            await screen.findByLabelText('Reason'),
            'Mislabelled weights across the produce catalogue',
        );
        await userEvent.click(screen.getByRole('button', { name: /suspend vendor/i }));

        // The count exists on this response and nowhere else, so it stays on screen.
        expect(await screen.findByText(/128 listings taken off sale/i)).toBeInTheDocument();
        expect(screen.getByText(/expect fewer to return/i)).toBeInTheDocument();
    });

    /**
     * ⚠ **Assert the query, not just the tab.** This test used to check that the
     * Catalogue tab became selected and that a suspended listing was on screen —
     * neither of which depends on the filter actually being applied, because the
     * stub answers every catalogue request with the same rows. It passed for a
     * round while the hand-off was silently doing nothing: Radix unmounts an
     * inactive tab, so the panel mounted fresh with the token already set and its
     * "has the token changed" check compared a value against itself.
     *
     * A pre-filter that switches tab and then shows the unfiltered catalogue is
     * worse than not offering one, so what is asserted here is the request.
     */
    it('offers a way to see what stayed off sale after a reinstatement', async () => {
        const calls = detailCalls({
            detail: suspendedVendorDetailFixture(),
            products: [oversightSuspendedProductFixture()],
            write: () =>
                successResponse(
                    platformVendorFixture({
                        status: 'active',
                        suspendedProductCount: undefined,
                        suspendedProductIds: undefined,
                        restoredProductCount: 96,
                        restoredProducts: [],
                    }),
                ),
        });

        await userEvent.click(await screen.findByRole('button', { name: /reinstate/i }));
        await userEvent.click(await screen.findByRole('button', { name: /reinstate vendor/i }));

        expect(await screen.findByText(/96 listings back on sale/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /show what is still off sale/i }));

        // Switches tab and pre-filters, so the difference is inspectable rather
        // than a number the operator has to go hunting for.
        await waitFor(() =>
            expect(screen.getByRole('tab', { name: 'Catalogue' })).toHaveAttribute(
                'aria-selected',
                'true',
            ),
        );
        expect(await screen.findByText('Cassava flour — 5 kg')).toBeInTheDocument();

        // The half that actually matters: the catalogue was asked for the
        // suspended listings, not merely opened.
        await waitFor(() => {
            const catalogue = calls.filter((call) => call.url.includes('/products'));
            const last = new URL(catalogue[catalogue.length - 1].url, 'http://localhost');
            expect(last.searchParams.get('status')).toBe('suspended');
        });
    });
});

describe('the catalogue', () => {
    it('offers a put-back only on a listing an administrator took down', async () => {
        detail({
            products: [
                vendorProductFixture(),
                oversightSuspendedProductFixture(),
                agencySuspendedProductFixture(),
            ],
        });

        await userEvent.click(await screen.findByRole('tab', { name: 'Catalogue' }));
        await screen.findByText('Plantain — 1 kg');

        // One take-off-sale (the active listing) and one put-back (the oversight
        // one). The agency-suspended listing gets neither — that endpoint answers
        // 422 for it, so a button would be a guaranteed refusal.
        expect(screen.getAllByRole('button', { name: /take off sale/i })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: /put back/i })).toHaveLength(1);
    });

    it('says who caused each takedown, not just that there was one', async () => {
        detail({
            products: [oversightSuspendedProductFixture(), agencySuspendedProductFixture()],
        });

        await userEvent.click(await screen.findByRole('tab', { name: 'Catalogue' }));

        expect(await screen.findByText(/taken down by an administrator/i)).toBeInTheDocument();
        expect(screen.getByText(/caused by a delivery agency/i)).toBeInTheDocument();
    });
});

describe('the account tab', () => {
    it('renders the commission from the plan, since no vendor endpoint carries it', async () => {
        detail({ tier: 1 });

        await userEvent.click(await screen.findByRole('tab', { name: 'Account' }));

        expect(await screen.findByText('12%')).toBeInTheDocument();
    });

    /**
     * `null` means the question does not apply to a vendor; `0` would mean it
     * applies and is currently empty. Rendering the first as the second says
     * "owes nothing" where the truth is "cannot owe".
     */
    it('says a vendor cannot hold cash rather than reporting zero', async () => {
        detail({ tier: 1 });

        await userEvent.click(await screen.findByRole('tab', { name: 'Account' }));

        expect(await screen.findByText(/vendors hold no cash/i)).toBeInTheDocument();
        expect(screen.getByText(/never collects cash on delivery/i)).toBeInTheDocument();
        expect(screen.getByText(/no cash-on-delivery contracts/i)).toBeInTheDocument();
    });
});
