import { FileText, ImageOff } from 'lucide-react';

import { CategoryChips } from '@/components/categories/CategoryChips';
import { CopyableValue } from '@/components/common/CopyableValue';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { FileViewer } from '@/components/files/FileViewer';
import { ImageBox, ImageBoxNotice, IMAGE_BOX_RATIO } from '@/components/files/ImageBox';
import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import type { LightboxImage } from '@/components/files/ImageLightbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { ProductStatusBadge } from '@/components/vendors/ProductStatusBadge';
import { formatBytes, formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { partyName } from '@/lib/party';
import { type FileDetail } from '@/types/files.types';
import {
    productSuspensionOwner,
    productSuspensionReasonLabel,
    type ProductDimensions,
    type ProductInventory,
    type ProductStorage,
    type ProductVariant,
    type VendorProductDetail,
} from '@/types/vendors.types';

/**
 * The panels of `GET /vendors/:vendorId/products/:productId`.
 *
 * ── ⚠ Four readings this screen must not flatten ──────────────────────────────
 * Each is documented on `vendors.md`'s own field tables, and each has the same
 * failure mode: a number rendered where a *statement* was owed.
 *
 *  1. **`inventory.tracked: false` means stock is not counted, not that it is
 *     zero.** Every count below it is `null`, and `available: 0` on an untracked
 *     listing is meaningless while on a tracked one it means "sold out" —
 *     opposite remedies.
 *  2. **`pricing: null` means no variants at all** — a broken listing, and saying
 *     so is the point. Not "free" and not "we could not load it".
 *  3. **`storage: null` and zero rent are different facts** and must not both
 *     render as `0`. `storageBasedEnabled: false` is a third thing again: the
 *     agency does not offer warehousing at all.
 *  4. **`variants` includes archived ones.** A product with one archived variant
 *     must not look like a product with none.
 *
 * And one that is a business fact rather than a display rule: `monthlyEstimate`
 * is what the agency *should be charging*, collected out of band. **The platform
 * never invoices it**, so nothing here may label it as owed.
 */

interface PanelProps {
    product: VendorProductDetail;
    timeZone: string;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export function ProductIdentityPanel({ product, timeZone }: PanelProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Listing</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Status">
                        <ProductStatusBadge status={product.status} />
                    </Definition>

                    <Definition label="Title">{product.title || <NotSet />}</Definition>

                    <Definition label={product.categories?.length === 1 ? 'Category' : 'Categories'}>
                        {/* Primary first; the deprecated `category` string is not read. */}
                        <CategoryChips categories={product.categories ?? []} empty="None" />
                    </Definition>

                    <Definition label="Type">
                        <span className="capitalize">{product.type}</span>
                    </Definition>

                    <Definition
                        label="Mode"
                        hint={
                            <InfoHint label="About the listing mode">
                                <p>
                                    How the vendor built the listing. Documents predating the
                                    field read as <em>advanced</em>, so this is not evidence the
                                    vendor chose it.
                                </p>
                            </InfoHint>
                        }
                    >
                        <span className="capitalize">{product.mode}</span>
                    </Definition>

                    {product.digital ? (
                        <Definition label="Downloads">
                            {product.digital.isActive ? (
                                'On'
                            ) : (
                                <span className="text-warning">
                                    Switched off — no buyer is given the file, whatever the variant
                                </span>
                            )}
                        </Definition>
                    ) : null}

                    <Definition label="Tags">
                        {product.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                                {product.tags.map((tag) => (
                                    <Badge key={tag} variant="outline" className="text-xs">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <NotSet>None</NotSet>
                        )}
                    </Definition>

                    <Definition label="Slug">
                        {/* The vendor's own URL segment. `plain`, never shortened —
                            it is read end to end or it is not read at all. */}
                        <CopyableValue
                            variant="plain"
                            mono
                            value={product.slug}
                            label="product slug"
                        />
                    </Definition>

                    <Definition label="Listing id">
                        <CopyableValue value={product.id} label="product ID" truncate={false} />
                    </Definition>

                    <Definition label="Last ordered">
                        {formatInstantInZone(product.lastOrderedAt, timeZone) ?? (
                            <NotSet>Never</NotSet>
                        )}
                    </Definition>

                    <Definition label="Created">
                        {formatInstantInZone(product.createdAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="Last updated">
                        {formatInstantInZone(product.updatedAt, timeZone) ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

// ─── Suspension ───────────────────────────────────────────────────────────────

/**
 * Why the listing is off sale, and **whose screen the remedy is on**.
 *
 * Rendered only when there is a suspension: the service sends `null` here on a
 * listing that is on sale precisely so a stale reason cannot read as a current
 * takedown.
 *
 * ⚠ `previousStatus` is *what it returns to, if it returns* and `byAgencyId` is
 * *which agency did this* — the two most actionable fields on a suspended
 * listing, and the two the catalogue table has no room for.
 */
export function ProductSuspensionPanel({ product, timeZone }: PanelProps) {
    const suspension = product.suspension;
    if (!suspension) return null;

    const owner = productSuspensionOwner(suspension.reason);

    return (
        <Card className="border-destructive/30">
            <CardHeader>
                <CardTitle className="text-destructive">Off sale</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <DefinitionList>
                    <Definition label="Reason">
                        <div className="space-y-1">
                            <Badge variant="outline">
                                {productSuspensionReasonLabel(suspension.reason)}
                            </Badge>
                            {owner === 'platform' ? (
                                <p className="text-muted-foreground text-xs">
                                    Taken down by an administrator. Only this listing&apos;s own
                                    restore lifts it.
                                </p>
                            ) : owner === 'agency' ? (
                                <p className="text-muted-foreground text-xs">
                                    Caused by a delivery agency — the remedy is on the agency, not
                                    here.
                                </p>
                            ) : owner === 'vendor' ? (
                                <p className="text-muted-foreground text-xs">
                                    A cascade from suspending the vendor. Reinstating them lifts
                                    it.
                                </p>
                            ) : null}
                        </div>
                    </Definition>

                    <Definition
                        label="Returns to"
                        hint={
                            <InfoHint label="About the previous status">
                                <p>
                                    What the listing goes back to if it is put back on sale — not
                                    necessarily <em>active</em>. A draft taken down returns to
                                    draft.
                                </p>
                            </InfoHint>
                        }
                    >
                        {suspension.previousStatus ? (
                            <ProductStatusBadge status={suspension.previousStatus} />
                        ) : (
                            <NotSet>Not recorded</NotSet>
                        )}
                    </Definition>

                    <Definition label="When">
                        {formatInstantInZone(suspension.at, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition
                        label="By agency"
                        hint={
                            <InfoHint label="About the acting agency">
                                <p>
                                    Set when an <em>agency</em> caused the takedown rather than the
                                    platform or a vendor suspension. Empty on a platform takedown
                                    is correct, not missing data.
                                </p>
                            </InfoHint>
                        }
                    >
                        {suspension.byAgencyId ? (
                            <CopyableValue
                                value={suspension.byAgencyId}
                                label="agency ID"
                                to={`/dashboard/agencies/${suspension.byAgencyId}`}
                                truncate={false}
                            />
                        ) : (
                            <NotSet>Not an agency</NotSet>
                        )}
                    </Definition>

                    <Definition label="Note">
                        {suspension.note ?? <NotSet>No note recorded</NotSet>}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

// ─── Media ────────────────────────────────────────────────────────────────────

/** One group of the listing's media — the product's own, or one variant's. */
interface MediaGroup {
    key: string;
    title: string;
    files: FileDetail[];
}

/**
 * Every file the listing holds, grouped by who it is attached to.
 *
 * ⚠ **`media.images` is not that list.** It is the *customer* gallery for the
 * default variant, and it is variant-first **as a fallback, not a merge**: when
 * the default variant has pictures of its own, the product's pictures are not in
 * it, and no other variant's ever are. Rendering it alone is how a variant
 * product looked like it had one photograph. `media.files` (the product's own)
 * plus `variants[].files` is the whole of it.
 *
 * An older service sends neither (both arrived 2026-10-05); the customer gallery
 * is then all there is, and it is shown under the product.
 */
function mediaGroups(product: VendorProductDetail): MediaGroup[] {
    const productFiles = product.media.files ?? product.media.images;
    const groups: MediaGroup[] = [{ key: 'product', title: 'Product', files: productFiles }];

    for (const variant of product.variants) {
        const files = variant.files ?? [];
        if (files.length === 0) continue;
        groups.push({
            key: variant.id,
            title: `Variant — ${variantLabel(variant)}${variant.status === 'archived' ? ' (archived)' : ''}`,
            files,
        });
    }

    return groups;
}

function isImage(file: FileDetail): boolean {
    return file.mimeType?.startsWith('image/') ?? false;
}

/**
 * The listing's pictures.
 *
 * ── ⚠ Rendered from `url`, and that means no audit row ────────────────────────
 * A product's media lives in a **public** tree, so `GET /vendors/:vendorId/products/:productId`
 * resolves it to a real URL as part of the payload. `<ImageBox src>` therefore
 * displays it straight away: nothing is disclosed here that the read did not
 * already hand over, so there is nothing left for a click to consent to and no
 * `GET /files/:fileId/content` is made.
 *
 * A file whose `url` is `null` falls back to `<ResolvedImageBox>`, which *does*
 * go through the audited content route and *does* wait for a click. That branch
 * should be unreachable on this endpoint — it exists because "should be" is not
 * a guarantee, and a blank tile would be the worst of the outcomes.
 *
 * ⚠ **One `url: null` case IS reachable here, and it must not take that
 * fallback**: `access: "quota_blocked"`, the vendor over their plan's storage
 * cap. The tree is still public — nothing about it is private — and the content
 * route cannot serve a blocked file either, so an audited open would spend a
 * disclosure to fail. It is a billing state, it is temporary, and it gets its
 * own tile.
 *
 * ⚠ The gallery is built from the images that have a `url`, so an arrow key
 * cannot reach a file that has no `src` to show. `LightboxImage` requires one
 * for exactly that reason — **and a blocked image is therefore absent from the
 * lightbox as well as from the grid position it still occupies**, which is the
 * intended behaviour rather than an oversight: there is nothing to enlarge.
 */
export function ProductMediaPanel({ product }: { product: VendorProductDetail }) {
    const groups = mediaGroups(product);
    const total = groups.reduce((sum, group) => sum + group.files.length, 0);
    const primaryId = product.media.primaryImage?.id ?? null;

    // One lightbox across every group, so the arrows walk the whole listing.
    // Deduplicated by address: the same file can be attached in two places.
    const gallery: LightboxImage[] = [];
    for (const group of groups) {
        for (const image of group.files.filter(isImage)) {
            if (image.url === null || gallery.some((entry) => entry.src === image.url)) continue;
            gallery.push({
                src: image.url,
                alt: imageAlt(product, image),
                caption: [group.title, image.originalName, formatBytes(image.size)]
                    .filter(Boolean)
                    .join(' · '),
            });
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Images and files
                    {total > 0 ? (
                        <span className="text-muted-foreground ml-1 text-sm font-normal">
                            {formatCount(total)}
                        </span>
                    ) : null}
                    <InfoHint label="About these images">
                        <p>
                            Everything the vendor attached — to the product itself and to each
                            variant. Customers see a variant&apos;s own pictures when it has any,
                            and the product&apos;s otherwise; the one marked{' '}
                            <em>shown first</em> is what they see on the listing. They are already
                            public URLs, so viewing one here records nothing against your account.
                        </p>
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {total === 0 ? (
                    <ImageBoxNotice
                        ratio={IMAGE_BOX_RATIO}
                        className="max-w-xs"
                        icon={ImageOff}
                        title="This listing carries no picture"
                        // Not phrased as a failure: a service or a digital
                        // product legitimately has none, and a draft rarely has
                        // one yet.
                        body="Nothing has been uploaded for it — a service or an unfinished draft often has none."
                    />
                ) : (
                    groups.map((group) => (
                        <MediaGroupSection
                            key={group.key}
                            group={group}
                            product={product}
                            gallery={gallery}
                            primaryId={primaryId}
                            // The product heading is only worth printing when
                            // there is something to tell it apart from.
                            showTitle={groups.length > 1}
                        />
                    ))
                )}
            </CardContent>
        </Card>
    );
}

function MediaGroupSection({
    group,
    product,
    gallery,
    primaryId,
    showTitle,
}: {
    group: MediaGroup;
    product: VendorProductDetail;
    gallery: readonly LightboxImage[];
    primaryId: string | null;
    showTitle: boolean;
}) {
    const images = group.files.filter(isImage);
    const others = group.files.filter((file) => !isImage(file));

    return (
        <section className="space-y-2">
            {showTitle ? (
                <h3 className="text-sm font-medium">
                    {group.title}
                    <span className="text-muted-foreground ml-2 font-normal">
                        {formatCount(group.files.length)}
                    </span>
                </h3>
            ) : null}

            {group.files.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                    Nothing attached to the product itself
                    {product.variants.length > 0 ? ' — the pictures are on the variants below.' : '.'}
                </p>
            ) : null}

            {images.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {images.map((image) => (
                            <li key={image.id} className="space-y-1">
                                {image.url ? (
                                    <ImageBox
                                        src={image.url}
                                        alt={imageAlt(product, image)}
                                        gallery={{
                                            images: gallery,
                                            index: galleryIndex(gallery, image.url),
                                        }}
                                    />
                                ) : (
                                    /* Not expected on a public tree — see the panel
                                       note. Resolving through the content route is
                                       the honest fallback, and it asks first.

                                       🔴 A `quota_blocked` branch sat ahead of this
                                       until 2026-09-09, calling it "the one `url:
                                       null` the content route cannot rescue". The
                                       route rescues it (BR-023): a vendor over their
                                       storage cap still has their listing's picture
                                       served by the audited read. It now falls here
                                       like any other addressless file, and the box
                                       says why there was no thumbnail. */
                                    <ResolvedImageBox
                                        fileId={image.id}
                                        alt={imageAlt(product, image)}
                                    />
                                )}
                                <p className="text-muted-foreground truncate text-xs">
                                    {image.id === primaryId ? 'Shown first · ' : ''}
                                    {image.originalName ?? image.mimeType}
                                </p>
                            </li>
                        ))}
                </ul>
            ) : null}

            {others.length > 0 ? (
                /* A video or a spec sheet. A public one is a plain link — the read
                   already handed over its address; an addressless one goes through
                   the audited viewer, which asks first. */
                <ul className="space-y-2">
                    {others.map((file) => (
                        <li key={file.id} className="rounded-lg border p-2 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                                <FileText className="text-muted-foreground size-4 shrink-0" />
                                <span className="min-w-0 truncate">
                                    {file.originalName ?? file.id}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                    {[file.mimeType, formatBytes(file.size)].filter(Boolean).join(' · ')}
                                </span>
                                {file.url ? (
                                    <a
                                        href={file.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary ml-auto text-xs underline-offset-2 hover:underline"
                                    >
                                        Open
                                    </a>
                                ) : null}
                            </div>
                            {file.url ? null : (
                                <div className="mt-2">
                                    <FileViewer file={file} />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}

function imageAlt(product: VendorProductDetail, image: FileDetail): string {
    return image.originalName?.trim() || `${product.title} image`;
}

function galleryIndex(gallery: readonly LightboxImage[], src: string): number {
    const index = gallery.findIndex((entry) => entry.src === src);
    return index === -1 ? 0 : index;
}

// ─── Commercials ──────────────────────────────────────────────────────────────

/**
 * Price, negotiation and stock. The agency moved to `ProductDeliveryPanel` on
 * 2026-10-05, beside the pickup location it now has to be read with.
 *
 * ⚠ `pricing: null` is **a broken listing**, not a missing field. A product with
 * no variants at all has no price to quote, cannot be bought, and the screen's
 * job is to say that rather than to leave a dash that reads as a rendering fault.
 */
export function ProductCommercialsPanel({ product }: { product: VendorProductDetail }) {
    const { pricing } = product;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Price and stock</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {pricing === null ? (
                    <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                        This listing has no variants at all, so it has no price. It cannot be
                        bought in that state — the vendor has to add at least one variant before
                        it can be activated.
                    </p>
                ) : null}

                <DefinitionList>
                    {pricing ? (
                        <>
                            <Definition
                                label="Price"
                                hint={
                                    <InfoHint label="About the price">
                                        <p>
                                            The default variant&apos;s price. A plain amount in the
                                            account currency — not minor units, so nothing here is
                                            divided by a hundred.
                                        </p>
                                    </InfoHint>
                                }
                            >
                                {formatMoney(pricing.amount, pricing.currency)}
                            </Definition>

                            <Definition
                                label="Compare-at"
                                hint={
                                    <InfoHint label="About the compare-at price">
                                        <p>
                                            The struck-through price a customer sees beside the
                                            real one. Empty means the vendor is not running one.
                                        </p>
                                    </InfoHint>
                                }
                            >
                                {pricing.compareAtAmount === null ? (
                                    <NotSet>None</NotSet>
                                ) : (
                                    formatMoney(pricing.compareAtAmount, pricing.currency)
                                )}
                            </Definition>

                            <Definition
                                label="Range"
                                hint={
                                    <InfoHint label="About the price range">
                                        <p>
                                            Present only when the active variants disagree on
                                            price. Where they agree there is one price and no
                                            range, which is why this is empty rather than repeating
                                            the figure above.
                                        </p>
                                    </InfoHint>
                                }
                            >
                                {pricing.range ? (
                                    <>
                                        {formatMoney(pricing.range.min, pricing.currency)} –{' '}
                                        {formatMoney(pricing.range.max, pricing.currency)}
                                    </>
                                ) : (
                                    <NotSet>Variants agree</NotSet>
                                )}
                            </Definition>
                        </>
                    ) : null}

                    <NegotiationSummary product={product} />
                </DefinitionList>

                <InventoryFigures
                    inventory={product.inventory}
                    scope="product"
                />
            </CardContent>
        </Card>
    );
}

/**
 * Whether a buyer may haggle, and up to what.
 *
 * ⚠ **A configured window is not a live one.** Bargaining runs through the AI
 * assistant, so a vendor who switched AI search off keeps their ceilings — the
 * platform never deletes them — and none of them applies. Printing the ceiling
 * without saying so is how an operator tells a customer a price is negotiable
 * when it is not.
 */
function NegotiationSummary({ product }: { product: VendorProductDetail }) {
    const currency = product.pricing?.currency ?? null;
    const windows = product.variants
        .filter((variant) => variant.status !== 'archived')
        .map((variant) => variant.bargain)
        .filter((bargain): bargain is NonNullable<typeof bargain> => !!bargain);
    const live = product.vectorisation?.enabled ?? false;

    const ceilings = windows.map((bargain) => bargain.maxPrice);
    const min = Math.min(...ceilings);
    const max = Math.max(...ceilings);

    return (
        <Definition
            label="Negotiable up to"
            hint={
                <InfoHint label="About negotiation">
                    <p>
                        The highest price a buyer may haggle from — the selling price is the floor
                        and the vendor sets this ceiling. It only applies while the vendor has AI
                        search switched on; with it off the ceiling is kept but unused. Each
                        variant&apos;s own ceiling is under Variants.
                    </p>
                </InfoHint>
            }
        >
            {product.vectorisation === undefined ? (
                <NotSet>Not reported by this version of the service</NotSet>
            ) : windows.length === 0 ? (
                <NotSet>Not negotiable</NotSet>
            ) : (
                <div className="space-y-1">
                    <p>
                        {min === max
                            ? formatMoney(max, currency)
                            : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`}
                        <span className="text-muted-foreground ml-2 text-xs">
                            on {formatCount(windows.length)} of{' '}
                            {formatCount(product.variants.filter((v) => v.status !== 'archived').length)}{' '}
                            variant{windows.length === 1 ? '' : 's'}
                        </span>
                    </p>
                    <BargainState live={live} />
                </div>
            )}
        </Definition>
    );
}

function BargainState({ live }: { live: boolean }) {
    return live ? (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-[11px]">
            Live
        </Badge>
    ) : (
        <p className="text-warning text-xs">
            Not live — the vendor has AI search switched off, so nobody can negotiate.
        </p>
    );
}

// ─── Description and search ───────────────────────────────────────────────────

/**
 * The words the customer reads, and the ones a search engine reads instead.
 *
 * ⚠ An empty SEO field is not a missing one: the storefront falls back to the
 * title and the description, and the row says so rather than leaving a blank.
 */
export function ProductDescriptionPanel({ product }: { product: VendorProductDetail }) {
    if (product.description === undefined) return null; // an older service

    return (
        <Card>
            <CardHeader>
                <CardTitle>Description and search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {product.description ? (
                    <p className="text-sm leading-relaxed whitespace-pre-line">
                        {product.description}
                    </p>
                ) : (
                    <NotSet>The vendor wrote no description.</NotSet>
                )}

                <DefinitionList>
                    <Definition label="SEO title">
                        {product.seo?.title ?? <NotSet>Not set — the listing title is used</NotSet>}
                    </Definition>
                    <Definition label="SEO description">
                        {product.seo?.description ?? (
                            <NotSet>Not set — the description is used</NotSet>
                        )}
                    </Definition>
                    <Definition
                        label="AI search"
                        hint={
                            <InfoHint label="About AI search">
                                <p>
                                    Whether the vendor opted this listing into the AI assistant
                                    (vectorisation). Negotiation only works while it is on.
                                </p>
                            </InfoHint>
                        }
                    >
                        {product.vectorisation ? (
                            <span>
                                {product.vectorisation.enabled ? 'On' : 'Off'}
                                <span className="text-muted-foreground ml-2 text-xs">
                                    {vectorisationStatusLabel(product.vectorisation.status)}
                                </span>
                            </span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

const VECTORISATION_STATUS_LABELS: Record<string, string> = {
    not_started: 'Not indexed yet',
    pending: 'Indexing',
    completed: 'Indexed',
    failed: 'Indexing failed',
    skipped_no_credits: 'Skipped — no credits',
};

/** An open vocabulary: an unknown status renders raw rather than as a blank. */
function vectorisationStatusLabel(status: string): string {
    return VECTORISATION_STATUS_LABELS[status] ?? status;
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Who delivers it, **where they collect it from**, and how big it is.
 *
 * ⚠ The responsible agency and the agency that *stores* the stock are the same
 * agency, but they are not the same fact: every physical listing has the first,
 * and only `pickup.source === "agency_storage"` has the second. That is the
 * difference between "Littoral Express delivers it" and "Littoral Express is
 * holding forty of them in its Bonaberi depot", and only this card says which.
 */
export function ProductDeliveryPanel({ product }: { product: VendorProductDetail }) {
    const { deliveryAgency } = product;
    const agencyName = deliveryAgency
        ? partyName(
              [{ source: 'businessName', value: deliveryAgency.businessName }],
              { source: 'id', value: deliveryAgency.id },
          )
        : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Delivery</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition
                        label="Responsible agency"
                        hint={
                            <InfoHint label="About the responsible agency">
                                <p>
                                    The listing&apos;s own override if it has one, otherwise the
                                    vendor&apos;s default. Its status is the agency&apos;s own, so
                                    a listing pointing at a deactivated agency shows as such.
                                </p>
                            </InfoHint>
                        }
                    >
                        {deliveryAgency ? (
                            <div className="space-y-1">
                                <CopyableValue
                                    variant="plain"
                                    mono={false}
                                    value={partyName(
                                        [
                                            {
                                                source: 'businessName',
                                                value: deliveryAgency.businessName,
                                            },
                                        ],
                                        { source: 'id', value: deliveryAgency.id },
                                    )}
                                    label="agency name"
                                />
                                <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                                    <CopyableValue
                                        value={deliveryAgency.id}
                                        label="agency ID"
                                        to={`/dashboard/agencies/${deliveryAgency.id}`}
                                    />
                                    {deliveryAgency.status ? (
                                        <Badge variant="outline" className="text-[11px]">
                                            {deliveryAgency.status}
                                        </Badge>
                                    ) : null}
                                </p>
                            </div>
                        ) : (
                            /* ⚠ A diagnostic state, not a blank. A physical product
                               resolving to no agency cannot be activated at all. */
                            <span className="text-warning text-sm">
                                Neither this listing nor the vendor names a delivery agency.
                                {product.type === 'physical'
                                    ? ' A physical product in that state cannot be activated.'
                                    : ''}
                            </span>
                        )}
                    </Definition>

                    {product.pickup !== undefined ? (
                        <Definition
                            label="Collected from"
                            hint={
                                <InfoHint label="About the pickup location">
                                    <p>
                                        Where the agency picks the item up: from its own depot when
                                        it stores the vendor&apos;s stock, or from one of the
                                        vendor&apos;s addresses. A physical listing cannot be
                                        activated without one.
                                    </p>
                                </InfoHint>
                            }
                        >
                            <PickupValue product={product} agencyName={agencyName} />
                        </Definition>
                    ) : null}

                    {product.shipping !== undefined && product.type === 'physical' ? (
                        <>
                            <Definition
                                label="Default size and weight"
                                hint={
                                    <InfoHint label="About the default size">
                                        <p>
                                            The product-level measurements the vendor entered. A
                                            variant that states its own size uses those instead —
                                            see Variants.
                                        </p>
                                    </InfoHint>
                                }
                            >
                                {product.shipping && dimensionsKnown(product.shipping) ? (
                                    dimensionsLine(product.shipping)
                                ) : (
                                    <NotSet>Not entered</NotSet>
                                )}
                            </Definition>
                            {product.shipping ? (
                                <>
                                    <Definition label="Handling time">
                                        {product.shipping.handlingDays === null ? (
                                            <NotSet />
                                        ) : (
                                            `${formatCount(product.shipping.handlingDays)} day${product.shipping.handlingDays === 1 ? '' : 's'} to prepare an order`
                                        )}
                                    </Definition>
                                    <Definition label="Shipping">
                                        {product.shipping.shippingEnabled ? 'Enabled' : 'Disabled'}
                                        {product.shipping.originZipCode ? (
                                            <span className="text-muted-foreground ml-2 text-xs">
                                                from postcode {product.shipping.originZipCode}
                                            </span>
                                        ) : null}
                                    </Definition>
                                </>
                            ) : null}
                        </>
                    ) : null}
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function PickupValue({
    product,
    agencyName,
}: {
    product: VendorProductDetail;
    agencyName: string | null;
}) {
    const { pickup } = product;

    if (!pickup) {
        return product.type === 'physical' ? (
            <span className="text-warning text-sm">
                No pickup location is set. A physical listing cannot be activated without one.
            </span>
        ) : (
            <NotSet>Not applicable — nothing is collected for a {product.type} listing</NotSet>
        );
    }

    const stored = pickup.source === 'agency_storage';
    const address = pickup.address;

    return (
        <div className="space-y-1">
            <p className="font-medium">
                {stored
                    ? `Stored by ${agencyName ?? 'the responsible agency'}`
                    : pickup.source === 'vendor_address'
                      ? "The vendor's own address"
                      : pickup.source}
            </p>
            {address ? (
                <p className="text-sm">
                    {address.label ? <span className="font-medium">{address.label} — </span> : null}
                    {address.formattedAddress ?? <NotSet>No address details</NotSet>}
                </p>
            ) : (
                <p className="text-warning text-xs">
                    {stored
                        ? 'The depot it names no longer exists, and the agency has no other to fall back to.'
                        : 'The vendor address it names no longer exists — the activation check reports this.'}
                </p>
            )}
            {pickup.isPrimaryFallback ? (
                <p className="text-muted-foreground text-xs">
                    The agency&apos;s primary depot — no depot was chosen, or the one chosen was
                    since deleted.
                </p>
            ) : null}
        </div>
    );
}

function dimensionsKnown(d: ProductDimensions): boolean {
    return d.lengthCm !== null || d.widthCm !== null || d.heightCm !== null || d.weightG !== null;
}

/** What the vendor entered, and only that — an unknown measurement is absent, never 0. */
function dimensionsLine(d: ProductDimensions): string {
    const parts: string[] = [];
    const box = [d.lengthCm, d.widthCm, d.heightCm];

    if (box.every((value) => value !== null)) {
        parts.push(`${box.map((value) => formatCount(value as number)).join(' × ')} cm (L × W × H)`);
    } else {
        if (d.lengthCm !== null) parts.push(`length ${formatCount(d.lengthCm)} cm`);
        if (d.widthCm !== null) parts.push(`width ${formatCount(d.widthCm)} cm`);
        if (d.heightCm !== null) parts.push(`height ${formatCount(d.heightCm)} cm`);
    }
    if (d.weightG !== null) parts.push(`${formatCount(d.weightG)} g`);

    return parts.join(' · ');
}

/**
 * Stock, with `tracked` decided **before** any number is drawn.
 *
 * ⚠ The untracked branch prints **no figures at all**, deliberately. Every count
 * is `null` there, and rendering them as `0` or as `—` alongside a tracked
 * listing's real zero is the exact conflation the flag exists to prevent: "sold
 * out" and "we do not count this" have opposite remedies.
 */
function InventoryFigures({
    inventory,
    scope,
}: {
    inventory: ProductInventory;
    scope: 'product' | 'variant';
}) {
    if (!inventory.tracked) {
        return (
            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                <strong className="text-foreground">Stock is not counted</strong> for this{' '}
                {scope === 'product' ? 'listing' : 'variant'}, which is different from a stock of
                zero — there is no number to be out of.
                {scope === 'product'
                    ? ' A product counts as untracked if any one of its active variants is infinite-stock, so check the variants below before concluding nothing is tracked.'
                    : ''}
                {inventory.allowOversell ? ' Overselling is allowed.' : ''}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Figure label="Available" value={inventory.available} />
                <Figure label="Held mid-checkout" value={inventory.reserved} />
                <Figure label="Sellable" value={inventory.sellable} />
            </dl>
            <p className="text-muted-foreground text-xs">
                Sellable is available minus what is held mid-checkout, floored at zero.
                {inventory.lowStockThreshold !== null
                    ? ` Alerts below ${formatCount(inventory.lowStockThreshold)}.`
                    : scope === 'variant'
                      ? ' No low-stock alert is configured.'
                      : ''}
                {inventory.allowOversell ? ' Overselling is allowed.' : ''}
            </p>
        </div>
    );
}

function Figure({ label, value }: { label: string; value: number | null }) {
    return (
        <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">
                {value === null ? <span className="text-muted-foreground">—</span> : formatCount(value)}
            </dd>
        </div>
    );
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * What the agency's shelf costs — **and the sentence that keeps it honest**.
 *
 * ⚠ Three states, and only one of them is a rate:
 *
 * - **`storage: null`** — the listing is not warehoused by an agency at all (a
 *   digital product, or a physical one collected from the vendor's own address).
 *   Not "zero rent".
 * - **`storageBasedEnabled: false`** — the agency does not offer warehousing, so
 *   the estimate is 0 *by definition* rather than by accident. Printing a rate
 *   nobody agreed to would be worse than saying this.
 * - a real quote — the agency's published tariff times the catalogue quantity.
 *
 * ⚠ And the business fact under all three: **the platform never invoices this.**
 * The rate is collected out of band and is excluded from every earnings split, so
 * the panel says what the agency *should be charging* and never what is owed.
 */
export function ProductStoragePanel({
    storage,
    title = 'Storage',
}: {
    storage: ProductStorage | null;
    title?: string;
}) {
    if (storage === null) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">
                        This listing is not warehoused by an agency, so there is no storage rate
                        for it — a digital product, or a physical one collected from the
                        vendor&apos;s own address. That is not the same as a rent of zero.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    {title}
                    <InfoHint label="About the storage figure">
                        <p>
                            <strong>The platform never invoices this.</strong> The rate has been
                            collected at agency onboarding since day one and has never been
                            charged — it is rent, not a delivery fee, and every earnings split
                            excludes it. What is shown is what the agency should be charging to
                            shelve this listing, which it collects out of band.
                        </p>
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {!storage.storageBasedEnabled ? (
                    <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-sm leading-relaxed">
                        <strong className="text-foreground">
                            This agency does not offer warehousing.
                        </strong>{' '}
                        The estimate below is zero by definition rather than by accident, so it is
                        not a rate anybody agreed to.
                    </p>
                ) : null}

                <DefinitionList>
                    <Definition label="Monthly rate, per SKU">
                        {formatMoney(storage.monthlyRatePerSku, storage.currency)}
                    </Definition>

                    <Definition
                        label="Quantity charged"
                        hint={
                            <InfoHint label="About the quantity">
                                <p>
                                    The <em>catalogue</em> quantity the fee is quoted against — a
                                    figure both parties signed off on, since neither moves it
                                    unilaterally on a warehoused SKU. An infinite-stock SKU yields
                                    zero; inventing a quantity for one would be a fabricated
                                    charge.
                                </p>
                            </InfoHint>
                        }
                    >
                        {formatCount(storage.quantity)}
                    </Definition>

                    <Definition label="Monthly estimate">
                        <span className="font-medium">
                            {formatMoney(storage.monthlyEstimate, storage.currency)}
                        </span>
                    </Definition>

                    <Definition
                        label="Size"
                        hint={
                            <InfoHint label="About the dimensions">
                                <p>
                                    Information for sanity-checking the rate,{' '}
                                    <strong>never a multiplier</strong> — the rate is flat per SKU.
                                    Where the dimensions came from matters, because &ldquo;we do
                                    not know how big this is&rdquo; and a real measurement have to
                                    be distinguishable on a screen justifying a charge.
                                </p>
                            </InfoHint>
                        }
                    >
                        {storage.size ? (
                            <div className="space-y-0.5">
                                <p>{sizeLine(storage.size)}</p>
                                <p className="text-muted-foreground text-xs">
                                    {storage.size.source === 'variant'
                                        ? 'Measured on the variant'
                                        : storage.size.source === 'product_default'
                                          ? "From the product's shipping defaults"
                                          : 'Not measured — the dimensions are unknown'}
                                </p>
                            </div>
                        ) : (
                            <NotSet>
                                {title === 'Storage'
                                    ? 'Not stated at listing level — the variants differ'
                                    : 'Not stated'}
                            </NotSet>
                        )}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/** Only the dimensions that are known, so an unknown one is absent rather than 0. */
function sizeLine(size: NonNullable<ProductStorage['size']>): string {
    const box = [size.lengthCm, size.widthCm, size.heightCm];
    const parts: string[] = [];

    if (box.every((value) => value !== null)) {
        parts.push(`${box.join(' × ')} cm`);
    }
    if (size.volumeCm3 !== null) parts.push(`${formatCount(size.volumeCm3)} cm³`);
    if (size.weightG !== null) parts.push(`${formatCount(size.weightG)} g`);

    return parts.length > 0 ? parts.join(' · ') : 'No dimensions recorded';
}

// ─── Variants ─────────────────────────────────────────────────────────────────

/**
 * Every SKU, **archived ones included**.
 *
 * ⚠ Hiding the archived unit makes a product with one archived variant look like
 * a product with none — and a listing that went wrong is exactly what an
 * administrator opens this screen to understand. So they are rendered, marked,
 * and counted separately in the caption rather than filtered out.
 */
export function ProductVariantsPanel({ product }: { product: VendorProductDetail }) {
    const { variants } = product;
    const archived = variants.filter((variant) => variant.status === 'archived').length;

    if (variants.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Variants</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">
                        This listing has no variants at all, which is why it carries no price. It
                        cannot be bought in that state.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    Variants
                    <span className="text-muted-foreground ml-2 text-sm font-normal">
                        {formatCount(variants.length)}
                        {archived > 0 ? ` · ${formatCount(archived)} archived` : ''}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {archived > 0 ? (
                    <p className="text-muted-foreground text-xs">
                        Archived variants are shown rather than hidden: a product with one archived
                        variant would otherwise look like a product with none.
                    </p>
                ) : null}

                {(product.options ?? []).length > 0 ? (
                    <DefinitionList>
                        {(product.options ?? []).map((option) => (
                            <Definition key={option.id} label={option.name}>
                                <div className="flex flex-wrap gap-1">
                                    {option.values.map((value) => (
                                        <Badge key={value.id} variant="outline" className="text-xs">
                                            {value.value}
                                        </Badge>
                                    ))}
                                </div>
                            </Definition>
                        ))}
                    </DefinitionList>
                ) : null}

                <ul className="space-y-4">
                    {variants.map((variant) => (
                        <li key={variant.id}>
                            {/* ⚠ The currency comes from the product's `pricing`, not
                                from the variant's `storage`. A variant carries a bare
                                `amount` and no currency of its own, and reading it off
                                the storage quote would print nothing at all on a
                                listing nobody warehouses — where the price is exactly
                                as real. `pricing: null` is the broken-listing case and
                                `formatMoney` falls back to the plain number there. */}
                            <VariantCard
                                variant={variant}
                                product={product}
                                currency={product.pricing?.currency ?? null}
                            />
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

/**
 * What tells one variant from another: its option values (`Size: S · Colour:
 * Red`), else its name, else its SKU. The same label heads its images.
 */
function variantLabel(variant: ProductVariant): string {
    const values = variant.optionValues ?? [];
    if (values.length > 0) {
        return values
            .map((v) => (v.optionName ? `${v.optionName}: ${v.value}` : v.value))
            .join(' · ');
    }
    return variant.name ?? variant.sku;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BOOKING_MODE_LABELS: Record<string, string> = {
    calendar: 'Calendar — the customer picks a free slot',
    manual: 'Manual — the vendor confirms each request',
    capacity: 'Capacity — several bookings share a slot',
};

/**
 * Everything the vendor set on one variant beyond its price and stock — the
 * rows the old card had no room for. Each is rendered only when it applies to
 * this variant's kind, and each is absent (not blank) against an older service.
 */
function VariantSettings({
    variant,
    product,
    currency,
}: {
    variant: ProductVariant;
    product: VendorProductDetail;
    currency: string | null;
}) {
    const ownFiles = variant.files;
    const { service, digital } = variant;

    return (
        <>
            {variant.bargain !== undefined && product.type !== 'service' ? (
                <Definition label="Negotiable up to">
                    {variant.bargain ? (
                        <div className="space-y-1">
                            <p>
                                {formatMoney(variant.bargain.maxPrice, currency)}
                                <span className="text-muted-foreground ml-2 text-xs">
                                    from {formatMoney(variant.bargain.minPrice, currency)}
                                </span>
                            </p>
                            <BargainState live={variant.bargainable} />
                        </div>
                    ) : (
                        <NotSet>Not negotiable</NotSet>
                    )}
                </Definition>
            ) : null}

            {variant.dimensions !== undefined && product.type === 'physical' ? (
                <Definition label="Size and weight">
                    {variant.dimensions && dimensionsKnown(variant.dimensions) ? (
                        dimensionsLine(variant.dimensions)
                    ) : (
                        <NotSet>
                            {product.shipping && dimensionsKnown(product.shipping)
                                ? `Uses the product's defaults — ${dimensionsLine(product.shipping)}`
                                : 'Not entered, here or on the product'}
                        </NotSet>
                    )}
                </Definition>
            ) : null}

            {digital ? (
                <>
                    <Definition label="Download file">
                        {digital.asset ? (
                            <span>
                                {digital.asset.originalName}
                                <span className="text-muted-foreground ml-2 text-xs">
                                    {[digital.asset.mimeType, formatBytes(digital.asset.size)]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </span>
                        ) : (
                            <span className="text-warning text-sm">
                                No file uploaded yet — this format cannot be sold.
                            </span>
                        )}
                    </Definition>
                    <Definition label="Download limits">
                        {digital.maxDownloads === null
                            ? 'Unlimited downloads'
                            : `${formatCount(digital.maxDownloads)} download${digital.maxDownloads === 1 ? '' : 's'}`}
                        {' · '}
                        {digital.expiresAfterDays === null
                            ? 'never expires'
                            : `expires ${formatCount(digital.expiresAfterDays)} day${digital.expiresAfterDays === 1 ? '' : 's'} after purchase`}
                    </Definition>
                </>
            ) : null}

            {service ? (
                <>
                    <Definition label="Duration">
                        {formatCount(service.durationMinutes)} min
                        <span className="text-muted-foreground ml-2 text-xs">
                            the price is per this length, prorated
                        </span>
                    </Definition>
                    <Definition label="Buffers">
                        {formatCount(service.bufferBeforeMinutes)} min before ·{' '}
                        {formatCount(service.bufferAfterMinutes)} min after
                    </Definition>
                    <Definition label="Booking">
                        {BOOKING_MODE_LABELS[service.bookingMode] ?? service.bookingMode}
                        {service.maxBookings !== null
                            ? ` · ${formatCount(service.maxBookings)} per slot`
                            : ''}
                    </Definition>
                    <Definition label="Peak hours">
                        {service.peakHours ? (
                            <span>
                                {service.peakHours.daysOfWeek.length === 0
                                    ? 'Every day'
                                    : service.peakHours.daysOfWeek
                                          .map((day) => WEEKDAYS[day] ?? String(day))
                                          .join(', ')}
                                , {service.peakHours.startTime}–{service.peakHours.endTime}:{' '}
                                {service.peakHours.priceType === 'percentage'
                                    ? `+${formatCount(service.peakHours.value)}%`
                                    : service.peakHours.priceType === 'fixed'
                                      ? `+${formatMoney(service.peakHours.value, currency)}`
                                      : `${service.peakHours.priceType} ${service.peakHours.value}`}
                            </span>
                        ) : (
                            <NotSet>No surcharge</NotSet>
                        )}
                    </Definition>
                </>
            ) : null}

            {ownFiles !== undefined ? (
                <Definition label="Images">
                    {ownFiles.length > 0 ? (
                        `${formatCount(ownFiles.length)} of its own — shown under Images and files`
                    ) : (
                        <NotSet>None of its own — customers see the product&apos;s pictures</NotSet>
                    )}
                </Definition>
            ) : null}
        </>
    );
}

function VariantCard({
    variant,
    product,
    currency,
}: {
    variant: ProductVariant;
    product: VendorProductDetail;
    currency: string | null;
}) {
    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{variantLabel(variant)}</p>
                    {(variant.optionValues ?? []).length > 0 && variant.name ? (
                        <p className="text-muted-foreground text-xs">{variant.name}</p>
                    ) : null}
                    <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                        {/* An SKU is the vendor's own reference and the thing an
                            operator pastes into their spreadsheet — `plain`, so it
                            survives whole, and mono because it is a machine value. */}
                        <CopyableValue variant="plain" mono value={variant.sku} label="SKU" />
                        <CopyableValue value={variant.id} label="variant ID" />
                    </p>
                </div>
                <Badge
                    variant="outline"
                    className={
                        variant.status === 'archived'
                            ? 'text-muted-foreground'
                            : 'border-success/30 bg-success/10 text-success'
                    }
                >
                    {variant.status}
                </Badge>
            </div>

            <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                <Definition label="Price">
                    {formatMoney(variant.amount, currency)}
                    {variant.compareAtAmount !== null ? (
                        <span className="text-muted-foreground ml-2 text-xs line-through">
                            {formatMoney(variant.compareAtAmount, currency)}
                        </span>
                    ) : null}
                </Definition>
                <VariantSettings variant={variant} product={product} currency={currency} />
            </DefinitionList>

            <InventoryFigures inventory={variant.inventory} scope="variant" />

            {variant.storage ? (
                <p className="text-muted-foreground text-xs">
                    Shelf rate {formatMoney(variant.storage.monthlyRatePerSku, variant.storage.currency)}{' '}
                    per SKU per month ×{' '}
                    {formatCount(variant.storage.quantity)} ={' '}
                    <span className="text-foreground font-medium">
                        {formatMoney(variant.storage.monthlyEstimate, variant.storage.currency)}
                    </span>{' '}
                    a month
                    {!variant.storage.storageBasedEnabled
                        ? ' — but this agency does not offer warehousing, so the figure is zero by definition'
                        : ''}
                    . The platform never invoices it.
                    {variant.storage.size ? ` ${sizeLine(variant.storage.size)}.` : ''}
                </p>
            ) : (
                <p className="text-muted-foreground text-xs">
                    Not warehoused by an agency — which is not the same as a rent of zero.
                </p>
            )}
        </div>
    );
}
