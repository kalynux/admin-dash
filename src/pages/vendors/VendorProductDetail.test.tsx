import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { VendorProductDetail } from '@/pages/vendors/VendorProductDetail';
import {
    adminFixture,
    heldFixture,
    unpricedProductDetailFixture,
    untrackedProductDetailFixture,
    vendorProductDetailFixture,
} from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { VendorProductDetail as VendorProductDetailRecord } from '@/types/vendors.types';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const PRODUCT_ID = '66601122334455667788990a';

/**
 * `GET /vendors/:vendorId/products/:productId` — the screen BR-005 was granted
 * for, and never built until Phase B2.
 *
 * ⚠ **Almost every test here is about a state, not a number.** The payload's four
 * documented reading traps each have the same failure mode — a figure rendered
 * where a *statement* was owed — and each conflates two situations with opposite
 * remedies. That is what these assert; the happy path is the least interesting
 * part of the screen.
 */
function stubProduct(
    product: VendorProductDetailRecord | null = vendorProductDetailFixture(),
    error?: () => Response,
) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/products/')) {
            return error?.() ?? successResponse(product);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(
    options: {
        product?: VendorProductDetailRecord;
        error?: () => Response;
        tier?: 1 | 2 | 3;
        vendorId?: string;
        productId?: string;
    } = {},
) {
    const {
        product = vendorProductDetailFixture(),
        error,
        tier = 1,
        vendorId = VENDOR_ID,
        productId = PRODUCT_ID,
    } = options;

    const calls = stubProduct(product, error);

    renderWithProviders(
        <Routes>
            <Route
                path="/dashboard/vendors/:vendorId/products/:productId"
                element={<VendorProductDetail />}
            />
        </Routes>,
        {
            route: `/dashboard/vendors/${vendorId}/products/${productId}`,
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(tier) },
        },
    );

    return calls;
}

describe('the address', () => {
    /**
     * Both ids are validated before the fetching component mounts. A malformed one
     * is a `400` at the service's edge and only happens on a hand-edited URL, so
     * the round trip buys nothing.
     */
    it('refuses a malformed product id without making a request', async () => {
        const calls = detail({ productId: 'not-an-id' });

        expect(await screen.findByText(/not a valid vendor and listing address/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('refuses a malformed vendor id without making a request', async () => {
        const calls = detail({ vendorId: 'nope' });

        expect(await screen.findByText(/not a valid vendor and listing address/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    /**
     * ⚠ The ownership **is** the authorisation, so the service answers the same
     * way to "no such vendor" and "not this vendor's product". The screen says so
     * rather than implying the product id was the wrong one.
     */
    it('names both possibilities when the listing is refused', async () => {
        detail({
            error: () =>
                errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                    message: 'Product not found',
                    details: { platformCode: 'CATALOG_PRODUCT_NOT_FOUND' },
                }),
        });

        expect(await screen.findByText(/either no such vendor/i)).toBeInTheDocument();
    });
});

describe('stock — tracked is not the same as zero', () => {
    /*
      ⚠ `getAllBy`, not `getBy`: the figures appear twice on purpose — once rolled
      up over the product and once on the variant. `lowStockThreshold` is exactly
      why that duplication is load-bearing: it is always `null` at product level
      because the alert is per SKU, so the variant row is the only place it can be
      read.
    */
    it('shows the three counts on a tracked listing, at both levels', async () => {
        detail();

        expect((await screen.findAllByText('Available')).length).toBe(2);
        expect(screen.getAllByText('Sellable')).toHaveLength(2);
        expect(screen.getAllByText('42').length).toBeGreaterThan(0);
        // The per-SKU alert level, readable only on the variant.
        expect(screen.getByText(/alerts below 10/i)).toBeInTheDocument();
    });

    /**
     * ⚠ **The trap this whole panel exists for.** `tracked: false` means stock is
     * not counted; every count below it is `null`. Rendering those as `0` — or
     * even as a dash beside a tracked listing's real zero — conflates "sold out"
     * with "we do not count this", and the two have opposite remedies.
     *
     * So the untracked branch prints **no figures at all** and says why.
     */
    it('prints no figures at all when stock is not counted', async () => {
        detail({ product: untrackedProductDetailFixture() });

        // Twice: rolled up over the product, and again on its only variant.
        expect(await screen.findAllByText(/stock is not counted/i)).toHaveLength(2);
        expect(screen.getAllByText(/different from a stock of zero/i)).toHaveLength(2);
        // Not "Available: 0", not "Available: —". The labels are not on screen at
        // either level — a dash beside a tracked listing's real zero is the same
        // conflation, only quieter.
        expect(screen.queryByText('Available')).not.toBeInTheDocument();
        expect(screen.queryByText('Sellable')).not.toBeInTheDocument();
        expect(screen.queryByText('Held mid-checkout')).not.toBeInTheDocument();
    });
});

describe('price — null is a broken listing, not a missing field', () => {
    it('prices a listing that has variants', async () => {
        detail();

        // Once on the product, once on the variant.
        expect((await screen.findAllByText('Price')).length).toBe(2);
        expect(screen.getByText('Compare-at')).toBeInTheDocument();
    });

    /**
     * ⚠ `pricing: null` means **no variants at all**. The listing cannot be
     * bought, and saying so is the point — a dash would read as a rendering
     * fault, and "0" would read as free.
     */
    it('says the listing cannot be bought when it has no variants', async () => {
        detail({ product: unpricedProductDetailFixture() });

        expect(
            await screen.findByText(/has no variants at all, so it has no price/i),
        ).toBeInTheDocument();
        // Said on the pricing panel and again on the variants panel — the two
        // halves of the same broken listing, and each is where an operator looks.
        expect(screen.getAllByText(/cannot be bought in that state/i)).toHaveLength(2);
    });
});

describe('storage — three states, and only one of them is a rate', () => {
    it('quotes the agency rate and says the platform never invoices it', async () => {
        detail();

        expect(await screen.findByText('Monthly rate, per SKU')).toBeInTheDocument();
        expect(screen.getByText('Monthly estimate')).toBeInTheDocument();
        expect(
            screen.getAllByText(/the platform never invoices it/i).length,
        ).toBeGreaterThan(0);
    });

    /**
     * ⚠ **`null` and "zero rent" are different facts** and must not both render as
     * `0`. A digital product, or a physical one collected from the vendor's own
     * address, is simply not warehoused.
     */
    it('distinguishes a listing nobody warehouses from a rent of zero', async () => {
        detail({ product: untrackedProductDetailFixture() });

        // Said on the storage panel and again on the variant, because each is a
        // separate `storage: null` and neither may be read as zero rent.
        expect(await screen.findAllByText(/not warehoused by an agency/i)).toHaveLength(2);
        expect(screen.getAllByText(/not the same as a rent of zero/i)).toHaveLength(2);
        expect(screen.queryByText('Monthly rate, per SKU')).not.toBeInTheDocument();
        expect(screen.queryByText('Monthly estimate')).not.toBeInTheDocument();
    });

    /**
     * ⚠ The third state: the agency does not offer warehousing at all, so the
     * estimate is zero **by definition** rather than by accident. Printing a rate
     * nobody agreed to would be worse than saying this.
     */
    it('says an agency offers no warehousing rather than printing a rate nobody agreed to', async () => {
        const product = vendorProductDetailFixture();
        detail({
            product: {
                ...product,
                storage: {
                    ...product.storage!,
                    storageBasedEnabled: false,
                    monthlyRatePerSku: 0,
                    monthlyEstimate: 0,
                },
            },
        });

        expect(await screen.findByText(/does not offer warehousing/i)).toBeInTheDocument();
        expect(screen.getByText(/zero by definition rather than by accident/i)).toBeInTheDocument();
    });
});

describe('variants — archived ones are shown', () => {
    /**
     * ⚠ Hiding the archived unit makes a product with one archived variant look
     * like a product with none — and a listing that went wrong is exactly what an
     * administrator opens this screen to understand.
     */
    it('renders an archived variant and counts it separately', async () => {
        const product = vendorProductDetailFixture();
        detail({
            product: {
                ...product,
                variants: [
                    ...product.variants,
                    {
                        ...product.variants[0],
                        id: '6613aabbccddeeff00112244',
                        name: '2 kg',
                        sku: 'PLT-2KG',
                        status: 'archived',
                    },
                ],
            },
        });

        expect(await screen.findByText('PLT-2KG')).toBeInTheDocument();
        expect(screen.getByText('archived')).toBeInTheDocument();
        expect(screen.getByText(/1 archived/)).toBeInTheDocument();
        expect(screen.getByText(/would otherwise look like a product with none/i)).toBeInTheDocument();
    });
});

describe('the responsible agency', () => {
    it('names the agency and links to it', async () => {
        detail();

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
        /*
          ⚠ Matched on the href, not on the accessible name: the id is rendered
          head-and-tail (`665c00…889a`), which is the point of the `id` variant —
          two ObjectIds created in the same second differ only near the end, so a
          left-truncated one is the same string for half a page. The whole value
          is in the `title` and is what gets copied.
        */
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === '/dashboard/agencies/665c0011223344556677889a');
        expect(link).toBeDefined();
    });

    /**
     * ⚠ A diagnostic state, not a blank: a **physical** product resolving to no
     * agency cannot be activated at all, and that is the sentence the operator
     * needs rather than a dash.
     */
    it('says a physical listing with no agency cannot be activated', async () => {
        const product = vendorProductDetailFixture();
        detail({ product: { ...product, deliveryAgency: null } });

        expect(
            await screen.findByText(/neither this listing nor the vendor names a delivery agency/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/cannot be activated/i)).toBeInTheDocument();
    });
});

describe('images', () => {
    /**
     * ⚠ A product's media lives in a **public** tree and this read resolves it to
     * a real URL, so the picture is displayed straight away. Nothing is disclosed
     * that the read did not already hand over, so there is nothing for a click to
     * consent to — and **no audited `GET /files/:fileId/content` is made**. The
     * click-to-reveal box is for private trees; this is not one.
     */
    it('displays the picture without a second, audited request', async () => {
        const calls = detail();

        const image = await screen.findByRole('img', { name: /plantain\.jpg/i });
        expect(image).toHaveAttribute(
            'src',
            'https://cdn.example.com/vendors/6650aa11bb22cc33dd44ee55/plantain-1.jpg',
        );
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);
    });

    /** Not a failure: a service or an unfinished draft legitimately has none. */
    it('says a listing carries no picture rather than rendering an error', async () => {
        detail({ product: untrackedProductDetailFixture() });

        expect(await screen.findByText(/carries no picture/i)).toBeInTheDocument();
    });
});

describe('the write affordances', () => {
    it('offers a take-down on a listing that is on sale', async () => {
        detail();

        expect(await screen.findByRole('button', { name: /take off sale/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /put back/i })).not.toBeInTheDocument();
    });

    /**
     * ⚠ Only a takedown an administrator made can be lifted from here. An agency
     * cascade answers `422`, so offering the button would be offering a guaranteed
     * refusal — the same predicate the catalogue row uses.
     */
    it('offers a put-back only on a listing an administrator took down', async () => {
        const product = vendorProductDetailFixture();
        detail({
            product: {
                ...product,
                status: 'suspended',
                suspension: {
                    reason: 'platform_oversight',
                    previousStatus: 'active',
                    at: '2026-08-10T13:02:41.008Z',
                    byAgencyId: null,
                    note: 'Mislabelled weight',
                },
            },
        });

        expect(await screen.findByRole('button', { name: /put back/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /take off sale/i })).not.toBeInTheDocument();
    });

    it('offers neither to a caller without the write permission', async () => {
        detail({ tier: 3 });

        await screen.findByText('Price and stock');
        expect(screen.queryByRole('button', { name: /take off sale/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /put back/i })).not.toBeInTheDocument();
    });
});

describe('a suspended listing', () => {
    /**
     * `previousStatus` is *what it returns to, if it returns* and `byAgencyId` is
     * *which agency did this* — the two most actionable fields on a suspended
     * listing, and the two the catalogue table has no room for.
     */
    it('says what it returns to and which agency caused it', async () => {
        const product = vendorProductDetailFixture();
        detail({
            product: {
                ...product,
                status: 'suspended',
                suspension: {
                    reason: 'agency_storage_suspended',
                    previousStatus: 'active',
                    at: '2026-08-11T08:00:00.000Z',
                    byAgencyId: '665c0011223344556677889a',
                    note: null,
                },
            },
        });

        expect(await screen.findByText('Off sale')).toBeInTheDocument();
        expect(screen.getByText('Returns to')).toBeInTheDocument();
        expect(screen.getByText('By agency')).toBeInTheDocument();
        expect(screen.getByText(/the remedy is on the agency, not here/i)).toBeInTheDocument();
    });
});
