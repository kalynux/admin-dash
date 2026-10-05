import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Undo2, X } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { RaiseRefundDialog } from '@/components/refunds/RaiseRefundDialog';
import { RaisedRefundNotice } from '@/components/refunds/RaisedRefundNotice';
import { RefundMoney, RefundStatusCell } from '@/components/refunds/RefundBits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listRefundRequests } from '@/services/refunds.service';
import { useAdmin, useCan } from '@/store';
import {
    REFUND_CHANNELS,
    REFUND_PAYMENT_CHANNELS,
    REFUND_REQUEST_STATUSES,
    REFUND_SORT_DEFAULT,
    REFUND_SORT_OPTIONS,
    REFUND_SOURCE_KINDS,
    refundChannelLabel,
    refundDetailPath,
    refundPaymentChannelLabel,
    refundSourceKindLabel,
    refundSourcePath,
    refundStatusLabel,
    type CreateRefundResult,
    type RefundListQuery,
    type RefundRequest,
} from '@/types/refunds.types';

/**
 * The refund queue — `GET /refunds` · `orders.refund.read` (**every tier**).
 *
 * ── One tab per status, plus the working queue ────────────────────────────────
 * **Open** (`?open=true`, the default) is the five statuses still needing
 * somebody; then each of the seven statuses; then **All**. ⚠ `status` is a
 * pinned enum server-side, so only names from `REFUND_REQUEST_STATUSES` are ever
 * sent — a hand-edited `?tab=` outside them reads as Open, never a `400`.
 *
 * ── Gross, fee and net, side by side, on every row ────────────────────────────
 * Printed as sent. ⛔ Nothing is computed here. The phone on this list is
 * **masked** by the server; the detail shows it in full.
 *
 * ── Who sees what ─────────────────────────────────────────────────────────────
 * **Raise a refund** is `orders.refund.request` — Support holds it. Every
 * decision lives on the detail, behind `orders.refund` /
 * `orders.refund.settle_external`, which Support does not hold.
 */

const SCOPE_KEYS = ['sourceId', 'vendorId', 'customerId'] as const;
const FILTER_KEYS = ['tab', 'sourceKind', 'paymentChannel', 'channel', 'sort', ...SCOPE_KEYS] as const;
const FILTER_DEFAULTS = { tab: 'open', sort: REFUND_SORT_DEFAULT } as const;

const ANY = 'any';

const SCOPE_LABELS: Record<(typeof SCOPE_KEYS)[number], string> = {
    sourceId: 'one order, booking or purchase',
    vendorId: 'one shop',
    customerId: 'one customer',
};

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T =>
    (list as readonly string[]).includes(value);

export function RefundRequestsList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [raising, setRaising] = useState(false);
    const [raised, setRaised] = useState<CreateRefundResult | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const tab = values.tab === 'all' || isOneOf(REFUND_REQUEST_STATUSES, values.tab) ? values.tab : 'open';
    const sort = REFUND_SORT_OPTIONS.some((option) => option.value === values.sort)
        ? values.sort
        : REFUND_SORT_DEFAULT;

    const query: RefundListQuery = {
        ...(tab === 'open' ? { open: true } : tab === 'all' ? {} : { status: tab }),
        sourceKind: isOneOf(REFUND_SOURCE_KINDS, values.sourceKind) ? values.sourceKind : undefined,
        paymentChannel: isOneOf(REFUND_PAYMENT_CHANNELS, values.paymentChannel)
            ? values.paymentChannel
            : undefined,
        channel: isOneOf(REFUND_CHANNELS, values.channel) ? values.channel : undefined,
        sourceId: values.sourceId || undefined,
        vendorId: values.vendorId || undefined,
        customerId: values.customerId || undefined,
        sort,
        page,
    };

    const path = withQuery('/refunds', { ...query });
    const list = useAsyncData(path, (signal) => listRefundRequests(query, { signal }));
    const meta = list.data?.meta;

    const columns = useMemo<Column<RefundRequest>[]>(
        () => [
            {
                id: 'raised',
                header: 'Raised',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <Link to={refundDetailPath(row.id)} className="font-medium hover:underline">
                            {formatInstantInZone(row.createdAt, timeZone) ?? 'Open'}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                            by {row.requestedBy.name ?? 'someone'}
                            {row.requestedBy.role ? ` (${row.requestedBy.role})` : ''}
                        </p>
                    </div>
                ),
            },
            {
                id: 'source',
                header: 'For',
                className: 'align-top',
                cell: (row) => {
                    const to = row.source.kind === 'order' && can('orders.read') ? refundSourcePath(row.source) : null;
                    return (
                        <div className="space-y-0.5">
                            <p className="text-muted-foreground text-xs">{refundSourceKindLabel(row.source.kind)}</p>
                            {row.source.number ? (
                                <CopyableValue
                                    variant="plain"
                                    value={row.source.number}
                                    label="reference"
                                    to={to ?? undefined}
                                />
                            ) : row.source.id ? (
                                <CopyableValue value={row.source.id} label="source ID" to={to ?? undefined} />
                            ) : null}
                            {row.vendor.name ? <p className="text-xs">{row.vendor.name}</p> : null}
                        </div>
                    );
                },
            },
            {
                id: 'grossAmount',
                numeric: true,
                header: 'Refund',
                sortKey: 'grossAmount',
                className: 'align-top',
                cell: (row) => (
                    <RefundMoney
                        gross={row.grossAmount}
                        fee={row.feeAmount}
                        net={row.netAmount}
                        currency={row.currency}
                        compact
                    />
                ),
            },
            {
                id: 'how',
                header: 'Paid by / back by',
                className: 'align-top text-sm',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p>{refundPaymentChannelLabel(row.paymentChannel)}</p>
                        <p className="text-muted-foreground text-xs">{refundChannelLabel(row.channel)}</p>
                        {row.destination?.phone ? (
                            <p className="text-muted-foreground font-mono text-xs">{row.destination.phone}</p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <RefundStatusCell refund={row} />,
            },
        ],
        [timeZone, can],
    );

    const scope = SCOPE_KEYS.find((key) => values[key]);

    return (
        <PageContainer
            title="Refund queue"
            description="Every refund to a customer is a request an approver decides. Raise one, approve it, or settle it by hand."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={list.reload}
                        disabled={list.isLoading || list.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    <Can permission="orders.refund.request">
                        <Button size="sm" onClick={() => setRaising(true)}>
                            <Undo2 className="size-4" />
                            Raise a refund
                        </Button>
                    </Can>
                </>
            }
        >
            <div className="space-y-4">
                {raised ? (
                    <RaisedRefundNotice
                        result={raised}
                        timeZone={timeZone}
                        onDismiss={() => setRaised(null)}
                    />
                ) : null}

                <div className="overflow-x-auto">
                    <Tabs value={tab} onValueChange={(next) => set({ tab: next === 'open' ? null : next })}>
                        <TabsList aria-label="Refund status">
                            <TabsTrigger value="open">Open</TabsTrigger>
                            {REFUND_REQUEST_STATUSES.map((status) => (
                                <TabsTrigger key={status} value={status}>
                                    {refundStatusLabel(status)}
                                </TabsTrigger>
                            ))}
                            <TabsTrigger value="all">All</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {scope ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Showing {SCOPE_LABELS[scope]}</Badge>
                        <Button variant="ghost" size="sm" onClick={() => set({ [scope]: null })}>
                            <X className="size-3.5" />
                            Show every refund
                        </Button>
                    </div>
                ) : null}

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="For" htmlFor="refund-filter-kind">
                        <Select
                            value={values.sourceKind || ANY}
                            onValueChange={(next) => set({ sourceKind: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="refund-filter-kind" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Anything</SelectItem>
                                {REFUND_SOURCE_KINDS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {refundSourceKindLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Paid by" htmlFor="refund-filter-payment">
                        <Select
                            value={values.paymentChannel || ANY}
                            onValueChange={(next) => set({ paymentChannel: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="refund-filter-payment" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any payment</SelectItem>
                                {REFUND_PAYMENT_CHANNELS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {refundPaymentChannelLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Back by" htmlFor="refund-filter-channel">
                        <Select
                            value={values.channel || ANY}
                            onValueChange={(next) => set({ channel: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="refund-filter-channel" className="w-[200px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any way</SelectItem>
                                {REFUND_CHANNELS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {refundChannelLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Order" htmlFor="refund-filter-sort">
                        <Select value={sort} onValueChange={(next) => set({ sort: next })}>
                            <SelectTrigger id="refund-filter-sort" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {REFUND_SORT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {meta ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'request' : 'requests'}
                    </p>
                ) : null}

                <DataTable
                    caption="Refund requests"
                    columns={columns}
                    rows={list.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={list.isLoading}
                    isRefreshing={list.isRefreshing}
                    error={list.error}
                    onRetry={list.reload}
                    empty={
                        <EmptyState
                            icon={Undo2}
                            title={tab === 'open' && !isFiltered ? 'Nothing waiting' : 'No refund requests match'}
                            description={
                                tab === 'open' && !isFiltered
                                    ? 'No refund request needs anybody right now.'
                                    : 'Try another tab, or clear the filters.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager meta={meta} noun="requests" isBusy={list.isRefreshing} onPageChange={setPage} />
                ) : null}
            </div>

            {raising ? (
                <RaiseRefundDialog
                    open
                    onOpenChange={setRaising}
                    onRaised={(result) => {
                        setRaised(result);
                        list.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
