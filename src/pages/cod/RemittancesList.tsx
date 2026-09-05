import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, X } from 'lucide-react';

import { CodSettlementStatusBadge } from '@/components/cod/CodBadges';
import {
    ConfirmRemittanceDialog,
    RejectRemittanceDialog,
} from '@/components/cod/CodWriteDialogs';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listRemittances } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import {
    COD_SETTLEMENT_STATUSES,
    isUnresolved,
    type Remittance,
    type RemittanceListQuery,
} from '@/types/cod.types';
import { CopyableId } from '@/components/common/CopyableId';

/**
 * `GET /cod/remittances` · `cod.remittances.read` · **delegated**.
 *
 * The agency handing cash up — the second layer of the liability model, and the
 * one whose confirmation releases money.
 *
 * ── No sort control, and that is a type error rather than a decision ──────────
 * `RemittanceListQuery` has no `sort` key, because the endpoint offers none: the
 * ordering belongs to the platform. So no column here declares a `sortKey` and no
 * `onSortChange` is passed — a control that silently did nothing would be worse
 * than its absence.
 *
 * ── The status filter is pinned, unlike every other filter here ───────────────
 * This list is delegated and jovi-mall validates `status` with a `z.enum`, so an
 * unrecognised value is a `400` rather than an empty page. That is why the select
 * offers exactly three values and does not widen to whatever a shared link
 * carried — the usual rule on this dashboard, and the wrong one here.
 *
 * ── The rows carry an agency **id** and no name ───────────────────────────────
 * The list is jovi-mall's DTO; the name arrives only on the detail, which is
 * wi-admin's own. So the id is what an operator sees, linked into the directory
 * where they may open it.
 */

const FILTER_KEYS = ['status', 'agencyId'] as const;
const FILTER_DEFAULTS = {} as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function RemittancesList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const query: RemittanceListQuery = {
        status: values.status || undefined,
        agencyId: values.agencyId || undefined,
        page,
    };

    const path = withQuery('/cod/remittances', { ...query });
    const remittances = useAsyncData(path, (signal) => listRemittances(query, { signal }));

    // Two permissions, not one — the detail screen gates them separately and so
    // must this, or a holder of one is offered both and refused on the other.
    const canConfirm = can('cod.remittances.confirm');
    const canReject = can('cod.remittances.reject');

    const [settling, setSettling] = useState<{
        remittance: Remittance;
        kind: 'confirm' | 'reject';
    } | null>(null);

    const columns = useMemo<Column<Remittance>[]>(
        () => [
            {
                id: 'reference',
                header: 'Declaration',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-1">
                        {/*
                          The bank reference is how a person recognises this row
                          against a statement — so it keeps its link to the record
                          and gains a copy button beside it, as `plain`: it is
                          reconciled character for character and must never be
                          shortened.

                          Where there is none, the plain link stays. Its absence
                          is worth showing rather than hiding behind the id
                          silently, and `NotSet` would take the way in with it.
                        */}
                        {row.reference ? (
                            <CopyableValue
                                variant="plain"
                                mono={false}
                                value={row.reference}
                                label="remittance reference"
                                to={`/dashboard/cod/remittances/${row.id}`}
                                className="font-medium"
                            />
                        ) : (
                            <Link
                                to={`/dashboard/cod/remittances/${row.id}`}
                                className="font-medium hover:underline"
                            >
                                No reference
                            </Link>
                        )}
                        {row.note ? (
                            <p className="text-muted-foreground line-clamp-1 text-xs">
                                {row.note}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'agency',
                header: 'Agency',
                className: 'align-top',
                /*
                  One render, two shapes. The two branches used to disagree about
                  more than the link: only the permission-less one was copyable,
                  so the operator who COULD open the agency was the one who could
                  not quote its id. `agencies.read` decides whether there is
                  somewhere to go and nothing else.
                */
                cell: (row) => (
                    <CopyableId
                        value={row.agencyId}
                        label="agency ID"
                        to={
                            can('agencies.read')
                                ? `/dashboard/agencies/${row.agencyId}`
                                : undefined
                        }
                    />
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                className: 'align-top font-medium tabular-nums',
                cell: (row) => formatMoney(row.amount, row.currency),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <CodSettlementStatusBadge status={row.status} />,
            },
            {
                id: 'declaredAt',
                header: 'Declared',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.declaredAt, timeZone) ?? <NotSet />,
            },
            {
                id: 'resolvedAt',
                header: 'Answered',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) =>
                    /*
                      Keyed on `resolvedAt`, never on `status`: every COD status is
                      an unpinned platform vocabulary, and rejection stamps this
                      field just as confirmation does.
                    */
                    formatInstantInZone(row.resolvedAt, timeZone) ?? (
                        <NotSet>Waiting on us</NotSet>
                    ),
            },
            {
                id: 'actions',
                header: '',
                className: 'align-top',
                /*
                  Offered on `isUnresolved` — i.e. on `resolvedAt` — and never on
                  `status`. The COD status vocabularies belong to the platform and
                  can gain a member on a routine deploy, so a status allowlist
                  would silently stop offering these buttons the day one does.
                */
                cell: (row) => {
                    if (!isUnresolved(row)) return null;

                    return (
                        <RowActions>
                            {canConfirm ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setSettling({ remittance: row, kind: 'confirm' })
                                    }
                                >
                                    Confirm
                                </Button>
                            ) : null}
                            {canReject ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSettling({ remittance: row, kind: 'reject' })}
                                >
                                    Reject
                                </Button>
                            ) : null}
                        </RowActions>
                    );
                },
            },
        ],
        [timeZone, can, canConfirm, canReject],
    );

    const meta = remittances.data?.meta;

    return (
        <PageContainer
            title="Remittances"
            description="Cash the agencies say they have handed up to the platform."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="remittance-status" className="flex items-center gap-1">
                            Status
                            <InfoHint label="About remittance status">
                                <strong>Declared</strong> is a claim and nothing has moved yet.{' '}
                                <strong>Confirmed</strong> means an administrator agreed the cash
                                arrived, which settles the agency&rsquo;s collections and releases
                                their earnings. <strong>Rejected</strong> settles nothing.
                            </InfoHint>
                        </Label>
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="remittance-status" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {/*
                                  Not widened from the URL: the endpoint is
                                  delegated and jovi-mall pins this parameter, so
                                  an unknown value is a 400 rather than an empty
                                  page.
                                */}
                                {COD_SETTLEMENT_STATUSES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </FilterBar>

                {/*
                  Arrives from an agency's own screen. Shown as a dismissible chip
                  because an id in a filter bar is otherwise invisible — an
                  operator would see a short list and no reason for it.
                */}
                {values.agencyId ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                            Agency {values.agencyId}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => set({ agencyId: null })}>
                            <X className="size-3.5" />
                            Clear agency
                        </Button>
                    </div>
                ) : null}

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} declarations
                    </p>
                ) : null}

                <DataTable
                    caption="Remittances declared by delivery agencies"
                    columns={columns}
                    rows={remittances.data?.data ?? []}
                    rowKey={(row) => row.id}
                    isLoading={remittances.isLoading}
                    isRefreshing={remittances.isRefreshing}
                    error={remittances.error}
                    onRetry={remittances.reload}
                    empty={
                        <EmptyState
                            icon={Coins}
                            title="No remittances"
                            description={
                                isFiltered
                                    ? 'No declaration matches these filters.'
                                    : 'No agency has declared a hand-over.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="declarations"
                        isBusy={remittances.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {/*
              Both writes answer `{ message }` and no document, so the list
              refetches rather than patching the row — and `api.mutate` keeps the
              server's own sentence for the toast.
            */}
            {settling?.kind === 'confirm' ? (
                <ConfirmRemittanceDialog
                    remittance={settling.remittance}
                    open
                    onOpenChange={(open) => !open && setSettling(null)}
                    onDone={() => {
                        setSettling(null);
                        remittances.reload();
                    }}
                />
            ) : null}

            {settling?.kind === 'reject' ? (
                <RejectRemittanceDialog
                    remittance={settling.remittance}
                    open
                    onOpenChange={(open) => !open && setSettling(null)}
                    onDone={() => {
                        setSettling(null);
                        remittances.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
