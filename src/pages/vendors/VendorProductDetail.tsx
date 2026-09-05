import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PackageX, RotateCcw, RotateCw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import {
    RestoreProductDialog,
    SuspendProductDialog,
} from '@/components/vendors/VendorProductDialogs';
import {
    ProductCommercialsPanel,
    ProductIdentityPanel,
    ProductMediaPanel,
    ProductStoragePanel,
    ProductSuspensionPanel,
    ProductVariantsPanel,
} from '@/components/vendors/VendorProductPanels';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { getVendorProduct } from '@/services/vendors.service';
import { useAdmin } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    canRestoreProduct,
    canSuspendProduct,
    type VendorProduct,
    type VendorProductDetail as VendorProductDetailRecord,
} from '@/types/vendors.types';

/** Ids on this service are 24-hex ObjectIds, validated at the service's edge. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /vendors/:vendorId/products/:productId` — one listing, in full.
 *
 * ── Why this is a route and not the expandable card BR-005 shipped ────────────
 * The card was a placeholder for exactly this: *"factored as a standalone card so
 * it becomes the body of a real route with no rework once this endpoint lands"*.
 * The endpoint landed, and the reason a route is now correct is the reason it was
 * wrong before — a route has to be able to re-read the record on a deep link, and
 * until this endpoint existed the only way to do that was to re-fetch a page of
 * the catalogue and scan it for the id.
 *
 * ── The breadcrumb needs no nav entry ─────────────────────────────────────────
 * `findNavTrail` resolves by **longest prefix**, so `/dashboard/vendors/:id/products/:id`
 * lands on the Vendors item and the sidebar highlight and trail already work. A
 * nav entry here would put a product in the sidebar, which is not a destination.
 *
 * ── ⚠ Permission: `vendors.read` and nothing narrower ─────────────────────────
 * The same as the list, so the module gate has already run and this screen
 * re-checks nothing. The two write buttons gate on `vendors.products.manage`,
 * which is the only thing here that is narrower than the module.
 *
 * ── ⚠ A 404 arrives wearing a platform code ───────────────────────────────────
 * This is the one **delegated** read on the vendor surface, so "no such vendor"
 * and "not this vendor's product" both come back as
 * `404 PLATFORM_OPERATION_REJECTED`. `ErrorState` renders a 404 as a calm "not
 * available" already; the copy below names the two possibilities because the path
 * carries two ids and the operator cannot otherwise tell which one was wrong.
 */
export function VendorProductDetail() {
    const { vendorId = '', productId = '' } = useParams();

    /*
      Both ids validated before the fetching component mounts, for the reason the
      vendor detail states: hooks cannot be conditional, so a check inside the
      screen would already have issued the request. A malformed id is a 400 at the
      edge and only happens on a hand-edited URL, so the round trip buys nothing.
    */
    if (!OBJECT_ID.test(vendorId) || !OBJECT_ID.test(productId)) {
        return <InvalidProductId vendorId={vendorId} />;
    }

    return <VendorProductDetailScreen vendorId={vendorId} productId={productId} />;
}

function InvalidProductId({ vendorId }: { vendorId: string }) {
    return (
        <PageContainer title="Listing not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message:
                            'That is not a valid vendor and listing address. Both ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink vendorId={OBJECT_ID.test(vendorId) ? vendorId : null} />
        </PageContainer>
    );
}

function VendorProductDetailScreen({
    vendorId,
    productId,
}: {
    vendorId: string;
    productId: string;
}) {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const [suspending, setSuspending] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const product = useAsyncData(`/vendors/${vendorId}/products/${productId}`, (signal) =>
        getVendorProduct(vendorId, productId, { signal }),
    );

    if (product.isLoading) {
        return (
            <PageContainer title="Listing">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!product.data) {
        return (
            <PageContainer title="Listing">
                <ErrorState
                    error={product.error}
                    onRetry={product.reload}
                    deniedTitle="No such listing"
                />
                <p className="text-muted-foreground max-w-2xl text-sm">
                    The address carries two ids, and a refusal covers both: either no such vendor,
                    or the listing does not belong to them. The ownership is the authorisation, so
                    the service answers the same way to each.
                </p>
                <BackLink vendorId={vendorId} />
            </PageContainer>
        );
    }

    const record = product.data;

    return (
        <PageContainer
            title={record.title}
            description={
                <CopyableValue value={record.id} label="listing ID" truncate={false} />
            }
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={product.reload}
                        disabled={product.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    {/*
                      The same two conditional actions the catalogue row offers, and
                      conditional for the same reason: both endpoints answer 422 on a
                      listing in the wrong state, so offering a button that could only
                      produce a refusal is not offering anything.

                      ⚠ The predicates take a `VendorProduct` — the *list* row — and
                      this record is the detail. They read `status` and
                      `suspension.reason`, which both projections carry identically,
                      so the narrowing below is a shape adapter and not a claim that
                      the two types are the same. See `asListRow`.
                    */}
                    <Can permission="vendors.products.manage">
                        {canSuspendProduct(asListRow(record)) ? (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setSuspending(true)}
                            >
                                <PackageX className="size-4" />
                                Take off sale
                            </Button>
                        ) : canRestoreProduct(asListRow(record)) ? (
                            <Button variant="outline" size="sm" onClick={() => setRestoring(true)}>
                                <RotateCcw className="size-4" />
                                Put back
                            </Button>
                        ) : null}
                    </Can>
                </>
            }
        >
            <BackLink vendorId={vendorId} />

            <ProductSuspensionPanel product={record} timeZone={timeZone} />
            <ProductMediaPanel product={record} />
            <ProductCommercialsPanel product={record} />
            <ProductStoragePanel storage={record.storage} />
            <ProductVariantsPanel product={record} />
            <ProductIdentityPanel product={record} timeZone={timeZone} />

            {/*
              Stated in the open rather than behind an info icon, for the reason the
              vendor detail gives: an administrator holding `vendors.*` reasonably
              goes looking for each of these, and a consequence somebody has to click
              to discover is one they will not discover.
            */}
            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                Taking a listing off sale and putting it back are the only two things this screen
                can change. Price, stock, images and the delivery agency are the vendor&apos;s and
                their agency&apos;s to set — no endpoint offers them to an administrator. A
                listing taken down here is marked <em>platform oversight</em> and is never
                republished by reinstating the vendor; only this screen&apos;s own restore lifts
                it.
            </p>

            <SuspendProductDialog
                vendorId={vendorId}
                product={asListRow(record)}
                open={suspending}
                onOpenChange={setSuspending}
                onDone={() => {
                    setSuspending(false);
                    product.reload();
                }}
            />
            <RestoreProductDialog
                vendorId={vendorId}
                product={asListRow(record)}
                open={restoring}
                onOpenChange={setRestoring}
                onDone={() => {
                    setRestoring(false);
                    product.reload();
                }}
            />
        </PageContainer>
    );
}

/**
 * The detail record, as the two write dialogs' `VendorProduct` prop.
 *
 * ⚠ **A shape adapter, not a claim that the two projections are the same.** They
 * disagree in both directions — the list types `title`, `slug` and `category` as
 * nullable and the detail does not; the detail carries `media`, `pricing`,
 * `inventory`, `storage`, `variants`, `tags` and a `deliveryAgency.status` the row
 * has no room for. What the dialogs and the two predicates actually read is
 * `id`, `title`, `status` and `suspension`, and those four are identical on both.
 *
 * Written as a named field list rather than a cast, so a field added to
 * `VendorProduct` fails the build here instead of arriving as `undefined` inside
 * a confirmation dialog.
 */
function asListRow(product: VendorProductDetailRecord): VendorProduct {
    return {
        id: product.id,
        title: product.title,
        slug: product.slug,
        category: product.category,
        type: product.type,
        status: product.status,
        mode: product.mode,
        hasVariants: product.hasVariants,
        suspension: product.suspension,
        deliveryAgency: product.deliveryAgency
            ? {
                  id: product.deliveryAgency.id,
                  businessName: product.deliveryAgency.businessName,
              }
            : null,
        lastOrderedAt: product.lastOrderedAt,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
    };
}

function BackLink({ vendorId }: { vendorId: string | null }) {
    return (
        <Link
            to={vendorId ? `/dashboard/vendors/${vendorId}` : '/dashboard/vendors'}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
            <ArrowLeft className="size-4" />
            {vendorId ? 'Back to the vendor' : 'All vendors'}
        </Link>
    );
}
