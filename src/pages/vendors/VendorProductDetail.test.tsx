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

    /**
     * 🔴 **The one `url: null` that IS expected on this public tree**:
     * `access: "quota_blocked"`, the vendor over their plan's storage cap.
     *
     * This test asserted that the audited fallback *"cannot rescue"* it and that
     * the page asks for nothing — both taken from
     * [`files.md`](../../../api-doc/admin/api/files.md), and both false. The
     * content route serves a blocked file's bytes (BR-023, measured 2026-09-09),
     * so the gallery resolves it like any other addressless image and offers the
     * open. What was right, and still is: *"carries no picture"* would be a lie,
     * because the listing has one.
     */
    it('offers the audited open on a picture blocked by the vendor’s storage plan', async () => {
        const base = vendorProductDetailFixture();
        const blockedImages = base.media.images.map((image) => ({
            ...image,
            url: null,
            access: 'quota_blocked' as const,
        }));

        // The gallery now resolves each blocked image, so the stub must answer
        // `GET /files/:id` — the request the old assertion forbade.
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/products/')) {
                // Both lists, since 2026-10-05: the panel draws from the full
                // file list (`media.files`), and the gallery is the same file.
                return successResponse({
                    ...base,
                    media: { ...base.media, images: blockedImages, files: blockedImages },
                });
            }
            const match = blockedImages.find((image) => call.url.includes(`/files/${image.id}`));
            if (match) return successResponse(match);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(
            <Routes>
                <Route
                    path="/dashboard/vendors/:vendorId/products/:productId"
                    element={<VendorProductDetail />}
                />
            </Routes>,
            {
                route: `/dashboard/vendors/${VENDOR_ID}/products/${PRODUCT_ID}`,
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: heldFixture(1) },
            },
        );

        expect(
            await screen.findAllByRole('button', { name: /click to view/i }),
        ).not.toHaveLength(0);
        expect(screen.getAllByText(/over their plan's storage cap/i).length).toBeGreaterThan(0);
        expect(screen.queryByText(/carries no picture/i)).not.toBeInTheDocument();
    });
});

describe('every image, on a product with variants', () => {
    const CDN = 'https://cdn.example.com/vendors/6650aa11bb22cc33dd44ee55';
    const image = (id: string, name: string) => ({
        id,
        key: `vendors/x/${name}`,
        url: `${CDN}/${name}`,
        access: 'public' as const,
        mimeType: 'image/jpeg',
        size: 1000,
        originalName: name,
    });

    /**
     * 🔴 The bug this screen had: `media.images` is the **customer** gallery for
     * the default variant, and it is a fallback, not a merge — when the default
     * variant has its own picture, the product's pictures and every other
     * variant's are not in it. Rendering it alone made a three-picture listing
     * look like a one-picture one.
     */
    it("shows the product's own pictures and each variant's, labelled by its options", async () => {
        const base = vendorProductDetailFixture();
        const red = image('6612aabbccddeeff00110001', 'red.jpg');
        const blue = image('6612aabbccddeeff00110002', 'blue.jpg');
        const front = image('6612aabbccddeeff00110003', 'front.jpg');
        const variant = base.variants[0];

        detail({
            product: {
                ...base,
                media: { images: [red], primaryImage: red, files: [front] },
                variants: [
                    {
                        ...variant,
                        optionValues: [
                            { optionId: 'o1', optionName: 'Colour', valueId: 'v1', value: 'Red' },
                        ],
                        files: [red],
                    },
                    {
                        ...variant,
                        id: '6613aabbccddeeff00110002',
                        sku: 'PLT-BLUE',
                        optionValues: [
                            { optionId: 'o1', optionName: 'Colour', valueId: 'v2', value: 'Blue' },
                        ],
                        files: [blue],
                    },
                ],
            },
        });

        for (const name of ['front.jpg', 'red.jpg', 'blue.jpg']) {
            expect(await screen.findByRole('img', { name })).toHaveAttribute('src', `${CDN}/${name}`);
        }
        expect(screen.getByRole('heading', { name: /variant — colour: red/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /variant — colour: blue/i })).toBeInTheDocument();
        // The one customers see first is the gallery's head, not the product's.
        expect(screen.getByText(/shown first · red\.jpg/i)).toBeInTheDocument();
    });

    it('lists a non-image attachment rather than dropping it', async () => {
        const base = vendorProductDetailFixture();
        detail({
            product: {
                ...base,
                media: {
                    ...base.media,
                    files: [
                        ...(base.media.files ?? []),
                        { ...image('6612aabbccddeeff00110009', 'spec.pdf'), mimeType: 'application/pdf' },
                    ],
                },
            },
        });

        expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `${CDN}/spec.pdf`);
    });

    /** An older service sends no `media.files`: the customer gallery is all there is. */
    it('falls back to the customer gallery against an older service', async () => {
        const base = vendorProductDetailFixture();
        const media: Partial<typeof base.media> = { ...base.media };
        delete media.files;
        detail({ product: { ...base, media: media as typeof base.media } });

        expect(await screen.findByRole('img', { name: /plantain\.jpg/i })).toBeInTheDocument();
    });
});

describe('what the vendor wrote', () => {
    it('shows the description and says which SEO fields fall back', async () => {
        detail();

        expect(await screen.findByText(/ripe plantain from njombé/i)).toBeInTheDocument();
        expect(screen.getByText('Fresh plantain — Douala')).toBeInTheDocument();
        expect(screen.getByText(/not set — the description is used/i)).toBeInTheDocument();
    });

    it('shows the options and each variant’s own size', async () => {
        detail();

        expect(await screen.findByText('Weight')).toBeInTheDocument();
        expect(screen.getByText('30 × 20 × 12 cm (L × W × H) · 1,000 g')).toBeInTheDocument();
    });

    it('says a variant with no size of its own uses the product defaults', async () => {
        const base = vendorProductDetailFixture();
        detail({ product: { ...base, variants: [{ ...base.variants[0], dimensions: null }] } });

        expect(
            await screen.findByText(/uses the product's defaults — 32 × 22 × 14 cm/i),
        ).toBeInTheDocument();
    });

    it('shows a digital variant’s file and download limits', async () => {
        detail({ product: untrackedProductDetailFixture() });

        expect(await screen.findByText('recipes.pdf')).toBeInTheDocument();
        expect(screen.getByText(/3 downloads · never expires/i)).toBeInTheDocument();
    });
});

describe('negotiation', () => {
    it('shows the ceiling, and that it is live', async () => {
        detail();

        expect(await screen.findAllByText(/5,500/)).not.toHaveLength(0);
        expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    });

    /**
     * ⚠ A window on a product with AI search off is **kept but inert**. Printing
     * the ceiling without saying so tells an operator a price is negotiable when
     * nobody can negotiate it.
     */
    it('says a configured ceiling is not live when AI search is off', async () => {
        const base = vendorProductDetailFixture();
        detail({
            product: {
                ...base,
                vectorisation: { enabled: false, status: 'not_started' },
                variants: [{ ...base.variants[0], bargainable: false }],
            },
        });

        expect(await screen.findAllByText(/not live — the vendor has ai search switched off/i)).not.toHaveLength(0);
        expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });
});

describe('where it is collected from', () => {
    it('names the agency that stores it and the depot', async () => {
        detail();

        expect(await screen.findByText('Stored by Littoral Express Delivery')).toBeInTheDocument();
        expect(screen.getByText('Rue 9, Bonaberi, Douala')).toBeInTheDocument();
        expect(screen.getByText(/bonaberi depot/i)).toBeInTheDocument();
    });

    it("says when it is collected from the vendor's own address", async () => {
        const base = vendorProductDetailFixture();
        detail({
            product: {
                ...base,
                storage: null,
                pickup: {
                    source: 'vendor_address',
                    vendorAddressId: '6619aabbccddeeff00112233',
                    agencyAddressId: null,
                    address: null,
                    isPrimaryFallback: false,
                },
            },
        });

        expect(await screen.findByText("The vendor's own address")).toBeInTheDocument();
        expect(screen.getByText(/the vendor address it names no longer exists/i)).toBeInTheDocument();
    });

    it('warns that a physical listing with no pickup location cannot be activated', async () => {
        detail({ product: { ...vendorProductDetailFixture(), pickup: null } });

        expect(await screen.findByText(/no pickup location is set/i)).toBeInTheDocument();
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
