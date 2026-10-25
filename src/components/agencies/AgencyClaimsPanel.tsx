import { useMemo, useState } from 'react';
import { PackageX } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { EmptyState } from '@/components/common/DataState';
import { DataTable, type Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listAgencyClaims } from '@/services/agency-claims.service';
import { useCan } from '@/store';
import type { AgencyClaim, AgencyClaimListQuery } from '@/types/agency-claims.types';

const PANEL_PAGE_SIZE = 10;

type Scope = Pick<AgencyClaimListQuery, 'agencyId' | 'vendorId' | 'shipmentId'>;

/**
 * Damage claims — `GET /agency-claims?agencyId=` / `?vendorId=` / `?shipmentId=`
 * · `agencies.read` · delegated (2026-10-22).
 *
 * Mounted on the agency detail (what it was **charged**), the vendor detail
 * (what it was **credited**) and the shipment detail (the parcel's one claim).
 * Callers mount it only under `agencies.read`.
 *
 * Each row prints the claim, the agency's investigation fee beside it, and the
 * platform's own `explanation` — the sentence the agency reads on its earnings
 * screen. ⛔ Nothing is summed: there is no "total charged" line, because the
 * page is one slice of a list the server does not total.
 *
 * Page state is local: the detail pages that host this own `?tab=`.
 */
export function AgencyClaimsPanel({
    scope,
    timeZone,
    noun,
    hide = [],
    reloadToken = 0,
}: {
    scope: Scope;
    timeZone: string;
    /** "this agency", "this shop", "this parcel" — for the empty state. */
    noun: string;
    /** Columns that would repeat the page this panel sits on. */
    hide?: readonly ('agency' | 'vendor' | 'parcel')[];
    /** Bump after a charge on the same screen. */
    reloadToken?: number;
}) {
    const can = useCan();
    const [page, setPage] = useState(1);

    const query = useMemo<AgencyClaimListQuery>(
        () => ({ ...scope, page, limit: PANEL_PAGE_SIZE }),
        [scope, page],
    );
    const path = withQuery('/agency-claims', { ...query });
    const list = useAsyncData(`${path}#${reloadToken}`, (signal) => listAgencyClaims(query, { signal }));
    const meta = list.data?.meta;

    const columns = useMemo<Column<AgencyClaim>[]>(() => {
        const all: (Column<AgencyClaim> & { hideKey?: 'agency' | 'vendor' | 'parcel' })[] = [
            {
                id: 'parcel',
                hideKey: 'parcel',
                header: 'Parcel',
                className: 'align-top',
                cell: (claim) => (
                    <div className="space-y-0.5">
                        <CopyableValue
                            variant={claim.trackingNumber ? 'plain' : 'id'}
                            value={claim.trackingNumber ?? claim.shipmentId}
                            label={claim.trackingNumber ? 'tracking number' : 'shipment ID'}
                            to={
                                can('shipments.read')
                                    ? `/dashboard/shipments/${encodeURIComponent(claim.shipmentId)}`
                                    : undefined
                            }
                            className="font-medium"
                        />
                        {claim.orderNumber ? (
                            <CopyableValue
                                variant="plain"
                                value={claim.orderNumber}
                                label="order number"
                                to={
                                    can('orders.read')
                                        ? `/dashboard/orders/${encodeURIComponent(claim.orderId)}`
                                        : undefined
                                }
                                className="text-muted-foreground text-xs"
                            />
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'agency',
                hideKey: 'agency',
                header: 'Agency',
                className: 'align-top',
                cell: (claim) => (
                    <CopyableValue
                        value={claim.agencyId}
                        label="agency ID"
                        to={
                            can('agencies.read')
                                ? `/dashboard/agencies/${encodeURIComponent(claim.agencyId)}`
                                : undefined
                        }
                    />
                ),
            },
            {
                id: 'vendor',
                hideKey: 'vendor',
                header: 'Vendor credited',
                className: 'align-top',
                cell: (claim) =>
                    claim.vendorId ? (
                        <CopyableValue
                            value={claim.vendorId}
                            label="vendor ID"
                            to={
                                can('vendors.read')
                                    ? `/dashboard/vendors/${encodeURIComponent(claim.vendorId)}`
                                    : undefined
                            }
                        />
                    ) : (
                        <NotSet />
                    ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Charged',
                className: 'align-top',
                cell: (claim) => (
                    <div className="space-y-0.5 tabular-nums">
                        <p className="font-medium">{formatMoney(claim.amount, claim.currency)}</p>
                        <p className="text-muted-foreground text-xs">
                            + investigation fee {formatMoney(claim.investigationFee, claim.currency)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                            {formatCount(claim.itemCount)} {claim.itemCount === 1 ? 'item' : 'items'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'explanation',
                header: 'Explanation',
                className: 'align-top text-sm max-w-[26rem]',
                cell: (claim) => (
                    <div className="space-y-1">
                        <p className="break-words">{claim.explanation}</p>
                        {claim.note ? (
                            <p className="text-muted-foreground line-clamp-2 text-xs" title={claim.note}>
                                Note: {claim.note}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'createdAt',
                header: 'Charged on',
                className: 'text-muted-foreground align-top text-sm',
                cell: (claim) => (
                    <div className="space-y-0.5">
                        <p>{formatInstantInZone(claim.createdAt, timeZone) ?? '—'}</p>
                        {claim.createdBy.name ? <p className="text-xs">by {claim.createdBy.name}</p> : null}
                    </div>
                ),
            },
        ];
        return all.filter((column) => !column.hideKey || !hide.includes(column.hideKey));
    }, [can, hide, timeZone]);

    return (
        <div className="space-y-3">
            {meta && !list.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} damage {meta.total === 1 ? 'claim' : 'claims'}
                </p>
            ) : null}
            <DataTable
                caption={`Damage claims on ${noun}`}
                columns={columns}
                rows={list.data?.data ?? []}
                rowKey={(claim) => claim.id}
                isLoading={list.isLoading}
                isRefreshing={list.isRefreshing}
                error={list.error}
                onRetry={list.reload}
                empty={
                    <EmptyState
                        icon={PackageX}
                        title="No damage claims"
                        description={`No damage claim has been charged on ${noun}.`}
                    />
                }
            />
            {meta ? (
                <Pager meta={meta} noun="claims" isBusy={list.isRefreshing} onPageChange={setPage} />
            ) : null}
        </div>
    );
}
