import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VendorProductsPanel } from '@/components/vendors/VendorProductsPanel';
import { adminFixture, heldFixture, vendorProductFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { VendorProduct } from '@/types/vendors.types';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const PRODUCT_ID = '66601122334455667788990a';
const AGENCY_ID = '665c0011223344556677889a';

function panel(
    rows: VendorProduct[] = [vendorProductFixture()],
    props: { focusAgencyId?: string; focusToken?: number } = {},
) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/products')) {
            return successResponse(rows, {
                meta: { total: rows.length, page: 1, limit: 20, pages: rows.length ? 1 : 0 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <VendorProductsPanel
            vendorId={VENDOR_ID}
            timeZone="Africa/Douala"
            reloadToken={0}
            {...props}
        />,
        {
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(1) },
        },
    );

    return calls;
}

const params = (calls: FetchCall[]) =>
    new URL(calls[calls.length - 1].url, 'http://localhost').searchParams;

describe('opening a listing', () => {
    /**
     * The detail route BR-005 was granted for. The **title** is the link and the
     * row is not: two of the row's cells are already controls, and a row-wide link
     * would swallow their clicks.
     */
    it('links the title to the listing detail', async () => {
        panel();

        const link = await screen.findByRole('link', { name: /plantain/i });
        expect(link).toHaveAttribute(
            'href',
            `/dashboard/vendors/${VENDOR_ID}/products/${PRODUCT_ID}`,
        );
    });
});

describe('the delivery agency column', () => {
    /**
     * ⚠ `deliveryAgency` is an **object** on the row, not an id — a breaking
     * rename that removed both the N+1 and the permission question: the name
     * arrives under `vendors.read` alone, so a caller without `agencies.read`
     * still reads it.
     */
    it('names the agency the listing resolves to', async () => {
        panel();

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
    });

    /**
     * ⚠ `businessName: null` is an agency with no Magazin name yet. It falls
     * through to the id and stays identifiable — it never borrows `contactName`,
     * which is a contact *person* and is not on this projection at all.
     */
    it('falls through to the id when the agency has no business name', async () => {
        panel([
            vendorProductFixture({
                deliveryAgency: { id: AGENCY_ID, businessName: null },
            }),
        ]);

        const link = await screen.findByRole('link', { name: AGENCY_ID });
        expect(link).toHaveAttribute('href', `/dashboard/agencies/${AGENCY_ID}`);
    });

    /**
     * ⚠ `deliveryAgency: null` means neither the listing nor the vendor names one
     * — a real and diagnostic state rather than a blank, because a **physical**
     * product in that condition cannot be activated at all.
     */
    it('calls out a physical listing that resolves to no agency', async () => {
        panel([vendorProductFixture({ type: 'physical', deliveryAgency: null })]);

        expect(await screen.findByText(/none — cannot be activated/i)).toBeInTheDocument();
    });

    /** The same absence on a digital listing is unremarkable, and reads that way. */
    it('does not warn about a digital listing with no agency', async () => {
        panel([vendorProductFixture({ type: 'digital', deliveryAgency: null })]);

        expect(await screen.findByText('None named')).toBeInTheDocument();
        expect(screen.queryByText(/cannot be activated/i)).not.toBeInTheDocument();
    });
});

describe('the drill-down from a connection count', () => {
    /**
     * The hand-off from the connections panel's `productCount`. ⚠ The filter is
     * matched against the **resolved** agency rather than the stored override,
     * which is what makes `meta.total` here equal the number that was clicked.
     */
    it('sends deliveryAgencyId when the panel is opened on one agency', async () => {
        const calls = panel([vendorProductFixture()], {
            focusAgencyId: AGENCY_ID,
            focusToken: 1,
        });

        await waitFor(() => {
            expect(params(calls).get('deliveryAgencyId')).toBe(AGENCY_ID);
        });
    });

    /**
     * ⚠ This filter has no control in the bar, so without a visible statement it
     * would be an **invisible filter** — a catalogue quietly showing a subset
     * while looking complete. That is the failure mode the whole `listQuery`
     * warning in this repository is about, arriving from the other direction.
     */
    it('says the filter is applied and offers the way out', async () => {
        const calls = panel([vendorProductFixture()], {
            focusAgencyId: AGENCY_ID,
            focusToken: 1,
        });

        expect(
            await screen.findByText(/showing only the listings this agency answers for/i),
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /show the whole catalogue/i }));

        await waitFor(() => {
            expect(params(calls).has('deliveryAgencyId')).toBe(false);
        });
    });

    it('applies nothing when no agency was handed over', async () => {
        const calls = panel();

        await screen.findByText('Littoral Express Delivery');
        expect(params(calls).has('deliveryAgencyId')).toBe(false);
        expect(
            screen.queryByText(/showing only the listings this agency answers for/i),
        ).not.toBeInTheDocument();
    });
});
