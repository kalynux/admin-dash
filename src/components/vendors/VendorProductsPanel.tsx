import { useMemo, useState } from 'react';
import { PackageX, RotateCcw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ProductStatusBadge } from '@/components/vendors/ProductStatusBadge';
import {
    RestoreProductDialog,
    SuspendProductDialog,
} from '@/components/vendors/VendorProductDialogs';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listVendorProducts } from '@/services/vendors.service';
import {
    canRestoreProduct,
    canSuspendProduct,
    PRODUCT_MODES,
    PRODUCT_SORT_DEFAULT,
    PRODUCT_STATUSES,
    PRODUCT_SUSPENSION_REASONS,
    PRODUCT_TYPES,
    productSuspensionOwner,
    productSuspensionReasonLabel,
    type VendorProduct,
    type VendorProductListQuery,
} from '@/types/vendors.types';

/**
 * `GET /vendors/:vendorId/products` — the catalogue, as platform oversight sees it.
 *
 * ── Local state, not the URL ──────────────────────────────────────────────────
 * Unlike the directory's filters. The URL already identifies the vendor, which is
 * the part worth sharing; a colleague sent this link wants the shop, not the
 * sender's half-applied product filter. It also keeps "clear the filters" and "go
 * back to the vendor" from being the same control. `focusStatus` is the one
 * exception, and it is a prop rather than a parameter — see below.
 *
 * ── The `suspensionReason` filter earns its place ─────────────────────────────
 * *"Which of this vendor's listings did **we** take down, and which did their
 * agency?"* is unanswerable without it, and the two have completely different
 * remedies. `platform_oversight` is the reason an administrator's takedown sets;
 * the four agency reasons are cascades; `vendor_suspended` is the shop being
 * suspended. Each row therefore says who owns its takedown, not just that there
 * was one.
 *
 * ── Why the two row actions are conditional ───────────────────────────────────
 * Take-off-sale is offered only on a listing that is actually on sale, and
 * put-back only on one an administrator took down. Both endpoints answer **422**
 * otherwise, so offering the buttons everywhere would be offering guaranteed
 * refusals. The predicates live in `types/vendors.types.ts` beside the reasons
 * they read.
 *
 * ── Every write refetches ─────────────────────────────────────────────────────
 * The two product writes answer `{ productId }` and `{ productId, status }` — not
 * a product — so there is nothing to merge into the row. That is the honest shape
 * rather than an inconvenience: a restore re-runs the activation gate, so the
 * resulting status is the server's to state.
 */

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

interface VendorProductsPanelProps {
    vendorId: string;
    timeZone: string;
    /** Bumped by the detail screen after a vendor-level write, so the cascade shows. */
    reloadToken: number;
    /**
     * A status to start filtered on, applied once.
     *
     * Set by the restore flow's *"show the listings still off sale"* affordance.
     * A prop rather than a URL key because it is a hand-off inside one screen, not
     * a view worth linking to — and adding a second set of list parameters to the
     * detail's query string would make the vendor's own link ambiguous.
     */
    focusStatus?: string;
    /** Changes when `focusStatus` should be re-applied, even to the same value. */
    focusToken?: number;
}

export function VendorProductsPanel({
    vendorId,
    timeZone,
    reloadToken,
    focusStatus,
    focusToken = 0,
}: VendorProductsPanelProps) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<string>(ANY);
    const [type, setType] = useState<string>(ANY);
    const [mode, setMode] = useState<string>(ANY);
    const [reason, setReason] = useState<string>(ANY);
    const [sort, setSort] = useState<string>(PRODUCT_SORT_DEFAULT);
    const [page, setPage] = useState(1);

    const [suspending, setSuspending] = useState<VendorProduct | null>(null);
    const [restoring, setRestoring] = useState<VendorProduct | null>(null);

    /**
     * Apply the caller's focus without an effect.
     *
     * Rendering-phase state adjustment on a changed prop, which React documents in
     * preference to a `useEffect` that would render the old filter once and then
     * re-render — visibly showing the unfiltered catalogue for a frame after the
     * operator asked for the suspended one.
     */
    const [appliedFocus, setAppliedFocus] = useState(focusToken);
    if (focusToken !== appliedFocus) {
        setAppliedFocus(focusToken);
        if (focusStatus) {
            setStatus(focusStatus);
            setPage(1);
        }
    }

    const query = useMemo<VendorProductListQuery>(
        () => ({
            search: search || undefined,
            status: status === ANY ? undefined : status,
            type: type === ANY ? undefined : type,
            mode: mode === ANY ? undefined : mode,
            suspensionReason: reason === ANY ? undefined : reason,
            sort: sort || PRODUCT_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [search, status, type, mode, reason, sort, page],
    );

    const path = withQuery(`/vendors/${vendorId}/products`, { ...query });
    const products = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listVendorProducts(vendorId, query, { signal }),
    );

    const rows = products.data?.data ?? [];
    const meta = products.data?.meta;
    const isFiltered =
        Boolean(search) || status !== ANY || type !== ANY || mode !== ANY || reason !== ANY;

    function clear() {
        setSearch('');
        setStatus(ANY);
        setType(ANY);
        setMode(ANY);
        setReason(ANY);
        setPage(1);
    }

    function reload() {
        products.reload();
    }

    const columns = useMemo<Column<VendorProduct>[]>(
        () => [
            {
                id: 'title',
                header: 'Listing',
                className: 'align-top',
                cell: (product) => (
                    <div className="min-w-0">
                        <p className="font-medium">{product.title ?? product.id}</p>
                        <p className="text-muted-foreground truncate text-xs">
                            {[product.category, product.type, product.mode]
                                .filter(Boolean)
                                .join(' · ')}
                            {product.hasVariants ? ' · variants' : ''}
                        </p>
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (product) => (
                    <div className="space-y-1">
                        <ProductStatusBadge status={product.status} />
                        {product.suspension ? (
                            <SuspensionNote product={product} />
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'lastOrderedAt',
                header: 'Last ordered',
                sortKey: 'lastOrderedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (product) => formatInstantInZone(product.lastOrderedAt, timeZone) ?? 'Never',
            },
            {
                id: 'createdAt',
                header: 'Created',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (product) => formatInstantInZone(product.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (product) => formatInstantInZone(product.updatedAt, timeZone) ?? '—',
            },
            {
                id: 'actions',
                header: 'Actions',
                className: 'align-top',
                cell: (product) => (
                    <Can permission="vendors.products.manage">
                        {canSuspendProduct(product) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSuspending(product)}
                            >
                                <PackageX className="size-4" />
                                Take off sale
                            </Button>
                        ) : canRestoreProduct(product) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRestoring(product)}
                            >
                                <RotateCcw className="size-4" />
                                Put back
                            </Button>
                        ) : (
                            /* Neither action applies. Saying so beats an inert button
                               that would answer 422 — the reason is on the badge above. */
                            <span className="text-muted-foreground text-xs">—</span>
                        )}
                    </Can>
                ),
            },
        ],
        [timeZone],
    );

    return (
        <div className="space-y-4">
            <FilterBar isFiltered={isFiltered} onClear={clear}>
                <SearchInput
                    label="Search this catalogue"
                    placeholder="Listing title"
                    value={search}
                    onChange={(next) => {
                        setSearch(next);
                        setPage(1);
                    }}
                />

                <Select
                    value={status}
                    onValueChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-40" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {PRODUCT_STATUSES.map((value) => (
                            <SelectItem key={value} value={value}>
                                {value === 'pending_review' ? 'Pending review' : value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={type}
                    onValueChange={(value) => {
                        setType(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-36" aria-label="Type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any type</SelectItem>
                        {PRODUCT_TYPES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={mode}
                    onValueChange={(value) => {
                        setMode(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-36" aria-label="Mode">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any mode</SelectItem>
                        {PRODUCT_MODES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="flex items-center gap-1">
                    <Select
                        value={reason}
                        onValueChange={(value) => {
                            setReason(value);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-56" aria-label="Suspension reason">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any takedown reason</SelectItem>
                            {PRODUCT_SUSPENSION_REASONS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {productSuspensionReasonLabel(value)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <InfoHint label="About takedown reasons">
                        Which listings <em>we</em> took down, and which their delivery agency did.
                        The two have different remedies: only a platform takedown can be lifted from
                        here, and only reinstating the vendor lifts a vendor-suspension cascade.
                    </InfoHint>
                </div>
            </FilterBar>

            <DataTable
                caption="This vendor's catalogue"
                columns={columns}
                rows={rows}
                rowKey={(product) => product.id}
                sort={sort}
                onSortChange={(next) => {
                    setSort(next);
                    setPage(1);
                }}
                isLoading={products.isLoading}
                isRefreshing={products.isRefreshing}
                error={products.error}
                onRetry={products.reload}
                loadingRows={5}
                empty={
                    <EmptyState
                        icon={PackageX}
                        title={
                            isFiltered
                                ? 'No listings match these filters'
                                : 'This vendor sells nothing'
                        }
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters.'
                                : 'Their catalogue is empty. A vendor part-way through onboarding often has no listings yet.'
                        }
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={clear}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="listings"
                    isBusy={products.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {suspending ? (
                <SuspendProductDialog
                    vendorId={vendorId}
                    product={suspending}
                    open
                    onOpenChange={(next) => {
                        if (!next) setSuspending(null);
                    }}
                    onDone={() => {
                        setSuspending(null);
                        reload();
                    }}
                />
            ) : null}

            {restoring ? (
                <RestoreProductDialog
                    vendorId={vendorId}
                    product={restoring}
                    open
                    onOpenChange={(next) => {
                        if (!next) setRestoring(null);
                    }}
                    onDone={() => {
                        setRestoring(null);
                        reload();
                    }}
                />
            ) : null}
        </div>
    );
}

/**
 * Who took this listing down, under the status badge.
 *
 * The reason alone is jargon (`agency_storage_suspended`); the *owner* of the
 * reason is the actionable half, because it says which screen the remedy is on.
 */
function SuspensionNote({ product }: { product: VendorProduct }) {
    const suspension = product.suspension;
    if (!suspension) return null;

    const owner = productSuspensionOwner(suspension.reason);

    return (
        <div className="space-y-0.5">
            <Badge variant="outline" className="text-[11px]">
                {productSuspensionReasonLabel(suspension.reason)}
            </Badge>
            {owner === 'platform' ? (
                <p className="text-muted-foreground text-xs">Taken down by an administrator</p>
            ) : owner === 'agency' ? (
                <p className="text-muted-foreground text-xs">Caused by a delivery agency</p>
            ) : owner === 'vendor' ? (
                <p className="text-muted-foreground text-xs">
                    Cascade from suspending this vendor
                </p>
            ) : null}
            {suspension.note ? (
                <p className="text-muted-foreground text-xs italic">{suspension.note}</p>
            ) : null}
        </div>
    );
}
