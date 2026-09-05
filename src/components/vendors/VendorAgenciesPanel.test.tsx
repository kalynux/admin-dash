import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VendorAgenciesPanel } from '@/components/vendors/VendorAgenciesPanel';
import { adminFixture, heldFixture, vendorAgencyConnectionFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { VendorAgencyConnection } from '@/types/vendors.types';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const AGENCY_ID = '665c0011223344556677889a';

function stubConnections(rows: VendorAgencyConnection[] = [vendorAgencyConnectionFixture()]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/agencies')) {
            return successResponse(rows, {
                meta: { total: rows.length, page: 1, limit: 20, pages: rows.length ? 1 : 0 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function panel(
    rows: VendorAgencyConnection[] = [vendorAgencyConnectionFixture()],
    onShowListings = vi.fn(),
) {
    const calls = stubConnections(rows);

    renderWithProviders(
        <VendorAgenciesPanel
            vendorId={VENDOR_ID}
            timeZone="Africa/Douala"
            onShowListings={onShowListings}
        />,
        {
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(1) },
        },
    );

    return { calls, onShowListings };
}

describe('naming the agency', () => {
    /**
     * ⚠ `businessName` is the business; `contactName` is a **person**. A column
     * headed "Agency" that renders the second is the BR-006 confusion, and the
     * fixture gives the two deliberately different strings so a wrong assertion
     * cannot match both.
     */
    it('leads with the business name and never substitutes the contact person', async () => {
        panel();

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
        // The person is shown, and shown as a person — never in the name's place.
        expect(screen.getByText(/contact: nadege mballa/i)).toBeInTheDocument();
    });

    /**
     * An agency mid-onboarding legitimately has no Magazin name yet, and must
     * still be identifiable by its id. ⚠ It must **not** silently borrow the
     * contact person's name to fill the gap.
     */
    it('falls through to the id, not to the contact, when there is no business name', async () => {
        panel([
            vendorAgencyConnectionFixture({
                agency: {
                    id: AGENCY_ID,
                    businessName: null,
                    status: 'pending_verification',
                    contactName: 'Paul Etoa',
                    country: 'CM',
                },
            }),
        ]);

        await screen.findByText(/no business name recorded yet/i);
        // The link's text is the id, not the person's name.
        expect(screen.queryByRole('link', { name: /paul etoa/i })).not.toBeInTheDocument();
        expect(screen.getByText(/contact: paul etoa/i)).toBeInTheDocument();
    });

    /**
     * ⚠ A connection pointing at an agency that no longer exists. The row survives
     * the join rather than being dropped, because that broken state is precisely
     * what an administrator opens this panel to find — so it is rendered as a
     * breakage, not as a missing label.
     */
    it('renders a connection whose agency no longer exists as broken', async () => {
        panel([vendorAgencyConnectionFixture({ agency: null })]);

        expect(await screen.findByText(/agency no longer exists/i)).toBeInTheDocument();
        expect(screen.getByText(/broken state, not a missing name/i)).toBeInTheDocument();
    });
});

describe('the listing count', () => {
    /**
     * The count is a control rather than a printed number because that is what
     * makes it verifiable: the catalogue filtered by this agency reports the same
     * figure as `meta.total`, by construction.
     */
    it('hands the agency off to the catalogue when the count is pressed', async () => {
        const { onShowListings } = panel();

        await userEvent.click(await screen.findByRole('button', { name: '42' }));

        expect(onShowListings).toHaveBeenCalledWith(AGENCY_ID);
    });

    /**
     * ⚠ Zero on a `pending` row is the **truth**, not a gap: only an active
     * connection lets a vendor point a product at an agency. It gets no
     * drill-down, because there is nothing behind it to show.
     */
    it('offers no drill-down on a pending connection, which legitimately counts zero', async () => {
        panel([
            vendorAgencyConnectionFixture({
                status: 'pending',
                productCount: 0,
                respondedAt: null,
                requestedBy: 'vendor',
            }),
        ]);

        await screen.findByText('Littoral Express Delivery');
        expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
    });
});

describe('what makes a row actionable', () => {
    /**
     * ⚠ On a `pending` row `requestedBy` is the entire question — it says whose
     * turn it is to answer.
     */
    it('says whose turn it is on a pending connection', async () => {
        panel([
            vendorAgencyConnectionFixture({
                status: 'pending',
                productCount: 0,
                respondedAt: null,
                requestedBy: 'vendor',
            }),
        ]);

        expect(await screen.findByText(/by the vendor/i)).toBeInTheDocument();
        expect(screen.getByText(/awaiting the other side/i)).toBeInTheDocument();
    });

    /**
     * ⚠ `reapproval` is a **state**, not an event — always a block, never `null`.
     * It is read only while the row is paused, and there it names the side that
     * has to move and whose edit caused it. That is what makes a paused row
     * actionable rather than merely alarming.
     */
    it('names the side that must act on a paused connection', async () => {
        panel([
            vendorAgencyConnectionFixture({
                status: 'paused_reapproval',
                reapproval: {
                    requiredFrom: 'vendor',
                    pausedAt: '2026-08-20T10:00:00.000Z',
                    pausedReason: 'agency_policy_changed',
                },
            }),
        ]);

        expect(await screen.findByText(/waiting on the vendor/i)).toBeInTheDocument();
        expect(screen.getByText(/agency policy changed/i)).toBeInTheDocument();
    });

    /**
     * ⚠ `null` when it did not happen, a whole object when it did — never a block
     * of nulls that reads as "unknown". A terminated row is one an operator opens
     * this panel to explain, so the grounds are on the row.
     */
    it('explains a termination on the row rather than only badging it', async () => {
        panel([
            vendorAgencyConnectionFixture({
                status: 'terminated',
                termination: {
                    byRole: 'agency',
                    byUserId: '6650aabbccddeeff00119911',
                    at: '2026-08-01T09:15:00.000Z',
                    reason: 'reapproval_declined',
                    note: 'Coverage no longer includes Bafoussam',
                },
            }),
        ]);

        expect(await screen.findByText(/ended by the agency/i)).toBeInTheDocument();
        expect(screen.getByText(/coverage no longer includes bafoussam/i)).toBeInTheDocument();
    });
});

describe('the status filter', () => {
    /**
     * ⚠ Every status is returned by default, terminal rows included. A live-only
     * default would make a relationship's history impossible to fetch, which on an
     * administrative surface is most of what the panel is for.
     */
    it('sends no status on first load', async () => {
        const { calls } = panel();

        await screen.findByText('Littoral Express Delivery');
        expect(new URL(calls[0].url, 'http://localhost').searchParams.has('status')).toBe(false);
    });

    it('narrows to one status when the filter is set', async () => {
        const { calls } = panel();
        await screen.findByText('Littoral Express Delivery');

        await userEvent.click(screen.getByRole('combobox', { name: /connection status/i }));
        /*
          ⚠ "paused reapproval", not the counts panel's hand-written "Paused for
          reapproval". The options are jovi-mall's own tokens run through
          `humaniseEnum`, deliberately — a hand-written label table for a
          vocabulary this service does not own would go stale silently the moment
          a seventh status appears, and the filter is where that costs most.
        */
        await userEvent.click(await screen.findByRole('option', { name: /paused reapproval/i }));

        await waitFor(() => {
            const last = new URL(calls[calls.length - 1].url, 'http://localhost');
            expect(last.searchParams.get('status')).toBe('paused_reapproval');
        });
    });

    /**
     * ⚠ The vocabulary is jovi-mall's and the service validates it for shape, not
     * membership — so an incoming value outside the six known ones **renders**
     * rather than blanking the cell. Nothing in this panel switches on the token.
     */
    it('renders a status it has never heard of rather than blanking the cell', async () => {
        panel([vendorAgencyConnectionFixture({ status: 'a_seventh_status' })]);

        expect(await screen.findByText(/a seventh status/i)).toBeInTheDocument();
    });
});

describe('an empty roster', () => {
    it('says the vendor ships through nobody at all', async () => {
        panel([]);

        expect(await screen.findByText(/ships through nobody/i)).toBeInTheDocument();
        expect(screen.getByText(/cannot activate a physical listing/i)).toBeInTheDocument();
    });
});
