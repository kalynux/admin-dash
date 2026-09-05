import { describe, expect, it } from 'vitest';

import {
    approveVendorKyc,
    countVendors,
    getVendor,
    getVendorProduct,
    listVendorActivity,
    listVendorAgencyConnections,
    listVendorProducts,
    listVendors,
    rejectVendorKyc,
    restoreVendor,
    restoreVendorProduct,
    suspendVendor,
    suspendVendorProduct,
    updateVendorSettings,
} from '@/services/vendors.service';
import {
    auditEntryFixture,
    auditMetaFixture,
    platformVendorFixture,
    vendorAgencyConnectionFixture,
    vendorDetailFixture,
    vendorFixture,
    vendorListMetaFixture,
    vendorProductDetailFixture,
    vendorProductFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';

const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const PRODUCT_ID = '66601122334455667788990a';
const AGENCY_ID = '665c0011223344556677889a';

const url = (call: FetchCall) => new URL(call.url, 'http://localhost');

describe('listVendors', () => {
    it('coerces the four pagination keys to numbers', async () => {
        stubFetch(() =>
            successResponse([vendorFixture()], {
                meta: { total: '214', page: '1', limit: '20', pages: '11' },
            }),
        );

        const page = await listVendors();

        expect(page.meta).toMatchObject({ total: 214, page: 1, limit: 20, pages: 11 });
    });

    /**
     * The contract's empty-list rule. Defaulting to `1` would render "page 1 of 1"
     * over nothing, which is what a client that recomputes the count does.
     */
    it('reports zero pages on an empty list rather than one', async () => {
        stubFetch(() => successResponse([], { meta: {} }));

        const page = await listVendors();

        expect(page.meta.pages).toBe(0);
    });

    /**
     * The key is **omitted** when it does not apply, never sent as `false`. A
     * truthiness test over a coerced value would turn an absent key into a
     * rendered warning.
     */
    it('keeps businessNameMatchesTruncated only when the server actually set it', async () => {
        stubFetch(() =>
            successResponse([vendorFixture()], {
                meta: { ...vendorListMetaFixture(), businessNameMatchesTruncated: true },
            }),
        );
        expect((await listVendors()).meta.businessNameMatchesTruncated).toBe(true);

        stubFetch(() =>
            successResponse([vendorFixture()], { meta: { ...vendorListMetaFixture() } }),
        );
        expect((await listVendors()).meta.businessNameMatchesTruncated).toBeUndefined();
    });

    it('drops an empty search rather than sending one', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { ...vendorListMetaFixture({ total: 0, pages: 0 }) } }),
        );

        await listVendors({ search: '', status: 'active' });

        // An empty `?search=` is a 400, not "no filter".
        expect(url(calls[0]).searchParams.has('search')).toBe(false);
        expect(url(calls[0]).searchParams.get('status')).toBe('active');
    });
});

describe('countVendors', () => {
    /**
     * The signature matters as much as the behaviour: `CountTile` passes this
     * function by reference and calls it as `read({ signal })`. A leading query
     * parameter would serialise the `AbortSignal` into the URL.
     */
    it('reads meta.total off a single row', async () => {
        const calls = stubFetch(() =>
            successResponse([vendorFixture()], {
                meta: { ...vendorListMetaFixture({ total: 214 }) },
            }),
        );

        expect(await countVendors()).toBe(214);
        expect(url(calls[0]).searchParams.get('limit')).toBe('1');
    });

    it('is what services/counts.ts now re-exports', async () => {
        const counts = await import('@/services/counts');
        expect(counts.countVendors).toBe(countVendors);
    });
});

describe('the reads', () => {
    it('gets one vendor by id', async () => {
        const calls = stubFetch(() => successResponse(vendorDetailFixture()));

        const vendor = await getVendor(VENDOR_ID);

        expect(url(calls[0]).pathname).toBe(`/api/v1/vendors/${VENDOR_ID}`);
        expect(vendor.counts.products.pendingReview).toBe(0);
    });

    it('pages the catalogue and coerces its meta', async () => {
        stubFetch(() =>
            successResponse([vendorProductFixture()], {
                meta: { total: '153', page: '1', limit: '20', pages: '8' },
            }),
        );

        const page = await listVendorProducts(VENDOR_ID);

        expect(page.meta).toEqual({ total: 153, page: 1, limit: 20, pages: 8 });
    });

    /**
     * BR-018's drill-down. It is the reason the count on a connection row is a
     * control rather than a printed number: `meta.total` on this filtered page
     * and `productCount` on the matching row are the same figure, computed from
     * one shared rule, so the number is verifiable rather than merely displayed.
     */
    it('sends deliveryAgencyId as the catalogue drill-down', async () => {
        const calls = stubFetch(() =>
            successResponse([vendorProductFixture()], {
                meta: { total: 42, page: 1, limit: 20, pages: 3 },
            }),
        );

        await listVendorProducts(VENDOR_ID, { deliveryAgencyId: AGENCY_ID });

        expect(url(calls[0]).searchParams.get('deliveryAgencyId')).toBe(AGENCY_ID);
    });

    it('gets one listing, scoped by both ids', async () => {
        const calls = stubFetch(() => successResponse(vendorProductDetailFixture()));

        const product = await getVendorProduct(VENDOR_ID, PRODUCT_ID);

        expect(url(calls[0]).pathname).toBe(
            `/api/v1/vendors/${VENDOR_ID}/products/${PRODUCT_ID}`,
        );
        expect(product.media.images).toHaveLength(1);
        expect(product.deliveryAgency?.businessName).toBe('Littoral Express Delivery');
    });

    /**
     * ⚠ This is the **one delegated read** on the vendor surface, so "no such
     * vendor" and "not this vendor's product" do not arrive as `NOT_FOUND` — they
     * arrive as `PLATFORM_OPERATION_REJECTED` with jovi-mall's own code in
     * `details.platformCode`, which is the only handle on which of the two it was.
     *
     * The status is still 404, so an ordinary "no such record" branch keeps
     * working; anything wanting to tell them apart must read `platformCode`.
     */
    it('surfaces the platform code on a missing listing rather than a bare 404', async () => {
        stubFetch(() =>
            errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                message: 'Product not found',
                details: { platformCode: 'CATALOG_PRODUCT_NOT_FOUND' },
            }),
        );

        const error = await getVendorProduct(VENDOR_ID, PRODUCT_ID).catch((caught) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).isNotFound).toBe(true);
        expect((error as ApiError).platformCode).toBe('CATALOG_PRODUCT_NOT_FOUND');
    });

    it('pages the delivery-agency connections and coerces their meta', async () => {
        const calls = stubFetch(() =>
            successResponse([vendorAgencyConnectionFixture()], {
                meta: { total: '9', page: '1', limit: '20', pages: '1' },
            }),
        );

        const page = await listVendorAgencyConnections(VENDOR_ID);

        expect(url(calls[0]).pathname).toBe(`/api/v1/vendors/${VENDOR_ID}/agencies`);
        expect(page.meta).toEqual({ total: 9, page: 1, limit: 20, pages: 1 });
        expect(page.data[0].agency?.businessName).toBe('Littoral Express Delivery');
    });

    /**
     * ⚠ The vocabulary is jovi-mall's and the service validates `?status=` for
     * **shape, not membership** — so a token this client has never heard of is
     * passed through unchanged rather than being narrowed against a pinned copy.
     * A copy here would make a seventh status silently unfilterable.
     */
    it('passes an unrecognised connection status through unchanged', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listVendorAgencyConnections(VENDOR_ID, { status: 'a_seventh_status' });

        expect(url(calls[0]).searchParams.get('status')).toBe('a_seventh_status');
    });

    /** A blank `status` is a 400, so `buildQuery` drops it before it is sent. */
    it('drops a blank connection status rather than sending one', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listVendorAgencyConnections(VENDOR_ID, { status: '' });

        expect(url(calls[0]).searchParams.has('status')).toBe(false);
    });

    /**
     * The activity feed returns the audit entry shape, so it reuses `toAuditPage`
     * rather than a third coercion helper that could disagree with it — including
     * the two retention fields the panel renders.
     */
    it('reuses the audit page shape for the activity feed', async () => {
        stubFetch(() =>
            successResponse([auditEntryFixture()], { meta: { ...auditMetaFixture() } }),
        );

        const page = await listVendorActivity(VENDOR_ID);

        expect(page.meta.retentionDays).toBe(365);
        expect(page.meta.oldestRetainedAt).toBe('2025-08-14T09:00:00.000Z');
    });
});

describe('the delegated writes', () => {
    it('posts the suspension reason and returns the cascade count', async () => {
        const calls = stubFetch(() =>
            successResponse(platformVendorFixture({ suspendedProductCount: 128 })),
        );

        const result = await suspendVendor(VENDOR_ID, { reason: 'Mislabelled weights' });

        expect(calls[0].method).toBe('POST');
        expect(url(calls[0]).pathname).toBe(`/api/v1/vendors/${VENDOR_ID}/suspend`);
        expect(JSON.parse(calls[0].body as string)).toEqual({ reason: 'Mislabelled weights' });
        expect(result.suspendedProductCount).toBe(128);
    });

    it('restores with no body at all', async () => {
        const calls = stubFetch(() =>
            successResponse(
                platformVendorFixture({ status: 'active', restoredProductCount: 96 }),
            ),
        );

        const result = await restoreVendor(VENDOR_ID);

        expect(calls[0].body).toBeUndefined();
        expect(result.restoredProductCount).toBe(96);
    });

    /**
     * The body is strict, so an approval with no note sends `{}` rather than
     * `{ note: undefined }` — and never `{ note: '' }`, which would be stored as
     * the reviewer's remark.
     */
    it('sends an empty object when a verification is approved without a note', async () => {
        const calls = stubFetch(() => successResponse(platformVendorFixture()));

        await approveVendorKyc(VENDOR_ID);

        expect(JSON.parse(calls[0].body as string)).toEqual({});
    });

    it('requires a reason on a rejection, because the vendor is shown it', async () => {
        const calls = stubFetch(() => successResponse(platformVendorFixture()));

        await rejectVendorKyc(VENDOR_ID, { reason: 'National id unreadable' });

        expect(JSON.parse(calls[0].body as string)).toEqual({
            reason: 'National id unreadable',
        });
    });

    /** The field is `note`, not `reason`, despite meaning the same thing. */
    it('names the product takedown field `note`', async () => {
        const calls = stubFetch(() => successResponse({ productId: PRODUCT_ID }));

        const result = await suspendVendorProduct(VENDOR_ID, PRODUCT_ID, {
            note: 'Mislabelled weight',
        });

        expect(url(calls[0]).pathname).toBe(
            `/api/v1/vendors/${VENDOR_ID}/products/${PRODUCT_ID}/suspend`,
        );
        expect(JSON.parse(calls[0].body as string)).toEqual({ note: 'Mislabelled weight' });
        // Not a product — there is nothing to merge into a row.
        expect(result).toEqual({ productId: PRODUCT_ID });
    });

    it('gets an id and a status back from a product restore, not a product', async () => {
        stubFetch(() => successResponse({ productId: PRODUCT_ID, status: 'active' }));

        expect(await restoreVendorProduct(VENDOR_ID, PRODUCT_ID)).toEqual({
            productId: PRODUCT_ID,
            status: 'active',
        });
    });

    it('patches settings and can clear the cap with null', async () => {
        const calls = stubFetch(() =>
            successResponse({
                autoCancelUnpaidDays: 5,
                autoRedirectOrdersToAgency: true,
                autoRedirectThresholdAmount: null,
            }),
        );

        await updateVendorSettings(VENDOR_ID, {
            autoRedirectOrdersToAgency: true,
            autoRedirectThresholdAmount: null,
        });

        expect(calls[0].method).toBe('PATCH');
        // `null` is forwarded, not dropped: absent means "leave alone" and `null`
        // means "clear", and collapsing the two silently keeps a cap.
        expect(JSON.parse(calls[0].body as string)).toEqual({
            autoRedirectOrdersToAgency: true,
            autoRedirectThresholdAmount: null,
        });
    });
});

/**
 * `details.platformCode` is the only handle on why a delegated write failed —
 * `error.code` is `PLATFORM_OPERATION_REJECTED` for every one of them, so branching
 * on it would treat a status conflict and a blocked restore as the same event.
 */
describe('the platform codes come through', () => {
    it('exposes the status conflict on a lost compare-and-set', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'This vendor is already suspended',
                category: 'conflict',
                details: { platformCode: 'VENDOR_STATUS_CONFLICT', actual: 'inactive' },
            }),
        );

        const error = await suspendVendor(VENDOR_ID, { reason: 'x'.repeat(5) }).catch((e) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).platformCode).toBe('VENDOR_STATUS_CONFLICT');
    });

    /**
     * A **422**, not the `409` the published docs describe, and it carries the
     * itemised reason list that is the only statement of why a listing will not
     * republish.
     */
    it('carries the activation blockers on a refused product restore', async () => {
        stubFetch(() =>
            errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                message: 'This product cannot be put back on sale',
                category: 'business_rule',
                details: {
                    platformCode: 'VENDOR_PRODUCT_UNSUSPEND_BLOCKED',
                    blockers: [
                        {
                            code: 'CATALOG_PRODUCT_VENDOR_SUSPENDED',
                            message: 'The vendor is suspended',
                        },
                    ],
                },
            }),
        );

        const error = (await restoreVendorProduct(VENDOR_ID, PRODUCT_ID).catch(
            (e) => e,
        )) as ApiError;

        expect(error.platformCode).toBe('VENDOR_PRODUCT_UNSUSPEND_BLOCKED');
        expect(error.details?.blockers).toHaveLength(1);
    });
});
