import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { resolvePartyName } from '@/lib/party';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listVendorAgencyConnections } from '@/services/vendors.service';
import {
    AGENCY_CONNECTION_SORT_DEFAULT,
    AGENCY_CONNECTION_STATUSES,
    type VendorAgencyConnection,
    type VendorAgencyConnectionQuery,
} from '@/types/vendors.types';

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

interface VendorAgenciesPanelProps {
    vendorId: string;
    timeZone: string;
    /**
     * Open the catalogue filtered to one agency's listings.
     *
     * The panel does not navigate itself: `productCount` and the catalogue tab
     * live on the same screen, so this is a hand-off inside it rather than a
     * link, exactly as the restore flow's *"show the listings still off sale"*
     * affordance is.
     */
    onShowListings: (agencyId: string) => void;
}

/**
 * `GET /vendors/:vendorId/agencies` — **which agencies this vendor ships through,
 * and on what terms**.
 *
 * The mirror image of the agency roster, and the enumeration behind the seven
 * integers above it: `counts.agencyConnections` says six connections are active,
 * these rows say *which* six. Same collection, same vendor scope — `total` there
 * equals `meta.total` on an unfiltered first page here.
 *
 * ── ⚠ Gate on BOTH permissions, in `all` mode ────────────────────────────────
 * The rows carry business names, contact people and commercial state, so
 * `vendors.read` alone would make this a second door onto the agency directory.
 * The caller renders this panel only for `['vendors.read','agencies.read']` in
 * `all` mode — see `VendorDetail`. A caller holding one and not the other gets a
 * `403` naming the **missing** permission, which is not a thing to discover by
 * trying.
 *
 * ── ⚠ Every status by default, terminal rows included ────────────────────────
 * A live-only default would make a relationship's history impossible to fetch,
 * and on an administrative surface that history is most of what the panel is for:
 * a `rejected` row is precisely what an operator opens this to explain. The
 * filter narrows; it never widens.
 *
 * ── ⚠ The status filter is free-text on the wire ─────────────────────────────
 * The service validates `?status=` for **shape, not membership** — the vocabulary
 * is jovi-mall's, and pinning a copy means a seventh status is silently
 * unfilterable until somebody remembers. The select below offers the six that are
 * known; an incoming value outside them still **renders**, because nothing here
 * switches on the token. That asymmetry is the point.
 *
 * ── This panel does not write ────────────────────────────────────────────────
 * There is no administrative action on a connection anywhere on this service, and
 * that is not an omission: a status change on one of these rows suspends or
 * restores the vendor's products in the same transaction, which is why every
 * write on the collection stayed with jovi-mall.
 */
export function VendorAgenciesPanel({
    vendorId,
    timeZone,
    onShowListings,
}: VendorAgenciesPanelProps) {
    const [status, setStatus] = useState<string>(ANY);
    const [sort, setSort] = useState<string>(AGENCY_CONNECTION_SORT_DEFAULT);
    const [page, setPage] = useState(1);

    const query = useMemo<VendorAgencyConnectionQuery>(
        () => ({
            status: status === ANY ? undefined : status,
            sort: sort || AGENCY_CONNECTION_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [status, sort, page],
    );

    const path = withQuery(`/vendors/${vendorId}/agencies`, { ...query });
    const connections = useAsyncData(path, (signal) =>
        listVendorAgencyConnections(vendorId, query, { signal }),
    );

    const rows = connections.data?.data ?? [];
    const meta = connections.data?.meta;
    const isFiltered = status !== ANY;

    const columns = useMemo<Column<VendorAgencyConnection>[]>(
        () => [
            {
                id: 'agency',
                header: 'Agency',
                className: 'align-top',
                /*
                  ⚠ `resolvePartyName`, not `partyName`, because this heading
                  asserts what kind of name it is. `businessName` is the business
                  and `contactName` is a **person** — a column headed "Agency"
                  falling silently through to the second has been showing a human's
                  name where a company was meant, which is the BR-006 confusion.
                  Where it does fall through, the sub-line says so.

                  ⚠ `agency: null` is a connection pointing at an agency that no
                  longer exists. The row survives the join rather than being
                  dropped, because that broken state is precisely what an
                  administrator opens this panel to find. Render the breakage.
                */
                cell: (connection) => <AgencyCell connection={connection} />,
            },
            {
                id: 'status',
                header: 'Connection',
                sortKey: 'status',
                className: 'align-top',
                cell: (connection) => <ConnectionStateCell connection={connection} />,
            },
            {
                id: 'productCount',
                numeric: true,
                header: 'Listings',
                className: 'align-top tabular-nums',
                /*
                  ⚠ Zero on a `pending`, `rejected` or `withdrawn` row is the truth
                  rather than a gap — only an active connection lets a vendor point
                  a product at an agency. A `terminated` or `paused_reapproval` row
                  may still count listings, because the products keep the override
                  they were given. Both look like bugs and neither is.

                  The drill-down makes the number verifiable rather than merely
                  displayed: the catalogue filtered by this agency reports the same
                  figure as `meta.total`, by construction.
                */
                cell: (connection) =>
                    connection.agency && connection.productCount > 0 ? (
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 tabular-nums"
                            onClick={() => onShowListings(connection.agency!.id)}
                        >
                            {formatCount(connection.productCount)}
                        </Button>
                    ) : (
                        <span
                            className="text-muted-foreground"
                            title={
                                connection.status === 'pending' ||
                                connection.status === 'rejected' ||
                                connection.status === 'withdrawn'
                                    ? 'Only an active connection lets the vendor point a listing at this agency.'
                                    : undefined
                            }
                        >
                            {formatCount(connection.productCount)}
                        </span>
                    ),
            },
            {
                id: 'requested',
                header: 'Requested',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (connection) => (
                    <div className="space-y-0.5">
                        <p>{formatInstantInZone(connection.requestedAt, timeZone) ?? '—'}</p>
                        {connection.requestedBy ? (
                            <p className="text-xs">
                                {/* ⚠ On a pending row this is the entire question:
                                    it says whose turn it is to answer. */}
                                by the {connection.requestedBy}
                                {connection.status === 'pending' ? ' — awaiting the other side' : ''}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'responded',
                header: 'Answered',
                className: 'text-muted-foreground align-top text-sm',
                cell: (connection) =>
                    formatInstantInZone(connection.respondedAt, timeZone) ?? 'Not yet',
            },
        ],
        [timeZone, onShowListings],
    );

    return (
        <Card>
            <CardHeader>
                {/*
                  ⚠ Deliberately NOT "Delivery agency connections" — that is the
                  heading on the counts section directly above, and two identical
                  headings a scroll apart read as the same block rendered twice.
                  The counts summarise and these rows enumerate, so the wording
                  says which is which.
                */}
                <CardTitle className="flex items-center gap-1">
                    Agencies they ship through
                    <InfoHint label="About these rows">
                        <p>
                            The same connections the counts above summarise, one row each — an
                            unfiltered first page reports the same total. Every status is listed,
                            terminal rows included: a rejected or terminated relationship is
                            usually what this panel gets opened to explain.
                        </p>
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <FilterBar
                    isFiltered={isFiltered}
                    onClear={() => {
                        setStatus(ANY);
                        setPage(1);
                    }}
                >
                    <FilterField label="Connection status" htmlFor="filter-connection-status">
                        <Select
                            value={status}
                            onValueChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger id="filter-connection-status" className="w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {AGENCY_CONNECTION_STATUSES.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {humaniseEnum(value) ?? value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                <DataTable
                    caption="The delivery agencies this vendor ships through"
                    columns={columns}
                    rows={rows}
                    rowKey={(connection) => connection.id}
                    sort={sort}
                    onSortChange={(next) => {
                        setSort(next);
                        setPage(1);
                    }}
                    isLoading={connections.isLoading}
                    isRefreshing={connections.isRefreshing}
                    error={connections.error}
                    onRetry={connections.reload}
                    loadingRows={4}
                    empty={
                        <EmptyState
                            icon={Handshake}
                            title={
                                isFiltered
                                    ? 'No connection is in that state'
                                    : 'This vendor ships through nobody'
                            }
                            description={
                                isFiltered
                                    ? 'Try another status, or clear the filter.'
                                    : 'They hold no delivery-agency connection at all — not even a rejected or withdrawn one. A vendor in that state cannot activate a physical listing.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="connections"
                        isBusy={connections.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}

/**
 * The agency, named as honestly as the row allows.
 *
 * Three outcomes and each says which it is: the business name; the id, where the
 * Magazin has no name yet; or a missing join, which is a broken connection rather
 * than a missing label.
 */
function AgencyCell({ connection }: { connection: VendorAgencyConnection }) {
    const agency = connection.agency;

    if (!agency) {
        return (
            <div className="space-y-0.5">
                <p className="text-warning text-sm font-medium">Agency no longer exists</p>
                <p className="text-muted-foreground text-xs">
                    The connection survives and points at nothing. That is a broken state, not a
                    missing name.
                </p>
            </div>
        );
    }

    const name = resolvePartyName([{ source: 'businessName', value: agency.businessName }], {
        source: 'id',
        value: agency.id,
    });

    return (
        <div className="min-w-0 space-y-0.5">
            <Link
                to={`/dashboard/agencies/${agency.id}`}
                className="font-medium hover:underline"
            >
                {name.value}
            </Link>
            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                {/* Only where the name IS the id is the id redundant beside it. */}
                {name.kind === 'identifier' ? (
                    <span>No business name recorded yet</span>
                ) : (
                    <CopyableValue value={agency.id} label="agency ID" />
                )}
                {agency.country ? <span>{agency.country}</span> : null}
                {agency.status ? (
                    <Badge variant="outline" className="text-[11px]">
                        {agency.status}
                    </Badge>
                ) : null}
                {connection.isDefault ? (
                    <Badge variant="outline" className="text-[11px]">
                        default
                    </Badge>
                ) : null}
            </p>
            {/* ⚠ A person, and labelled as one. The whole reason `resolvePartyName`
                reports its source is so a business-shaped column never renders this
                silently in the business's place. */}
            {agency.contactName ? (
                <p className="text-muted-foreground text-xs">Contact: {agency.contactName}</p>
            ) : null}
        </div>
    );
}

/**
 * The connection's state, and **what makes it actionable**.
 *
 * `reapproval` is always a block and never `null` because it is a *state* rather
 * than an event — so it is read only while the row is paused, where
 * `requiredFrom` names the side that has to move and `pausedReason` says whose
 * edit caused it. The three event blocks are the opposite: `null` when they did
 * not happen, a whole object when they did, never a block of nulls that reads as
 * "unknown".
 */
function ConnectionStateCell({ connection }: { connection: VendorAgencyConnection }) {
    const { reapproval, rejection, withdrawal, termination } = connection;

    return (
        <div className="min-w-0 space-y-1">
            <Badge variant="outline">{humaniseEnum(connection.status) ?? connection.status}</Badge>

            {connection.status === 'paused_reapproval' ? (
                <p className="text-warning text-xs">
                    {reapproval.requiredFrom
                        ? `Waiting on the ${reapproval.requiredFrom}`
                        : 'Waiting for a re-approval'}
                    {reapproval.pausedReason
                        ? ` — ${humaniseEnum(reapproval.pausedReason)?.toLowerCase() ?? reapproval.pausedReason}`
                        : ''}
                </p>
            ) : null}

            {rejection ? (
                <p className="text-muted-foreground text-xs">
                    Refused{rejection.byRole ? ` by the ${rejection.byRole}` : ''}
                    {rejection.reason ? `: ${rejection.reason}` : ''}
                </p>
            ) : null}

            {withdrawal ? (
                <p className="text-muted-foreground text-xs">
                    Taken back{withdrawal.byRole ? ` by the ${withdrawal.byRole}` : ''}
                </p>
            ) : null}

            {termination ? (
                <p className="text-muted-foreground text-xs">
                    Ended{termination.byRole ? ` by the ${termination.byRole}` : ''}
                    {termination.reason
                        ? ` — ${humaniseEnum(termination.reason)?.toLowerCase() ?? termination.reason}`
                        : ''}
                    {termination.note ? `. ${termination.note}` : ''}
                </p>
            ) : null}

            {/* Each side's policy version at the moment of approval. `null` on a
                connection that was never approved, which is why the block is
                conditional rather than printing two dashes. */}
            {connection.policyVersions.vendorAtApproval !== null ||
            connection.policyVersions.agencyAtApproval !== null ? (
                <p className="text-muted-foreground text-xs">
                    Agreed on vendor policy v{connection.policyVersions.vendorAtApproval ?? '—'},
                    agency policy v{connection.policyVersions.agencyAtApproval ?? '—'}
                </p>
            ) : null}
        </div>
    );
}
