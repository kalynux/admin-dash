import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { deliveryFeeRefundColumns } from '@/components/money/deliveryFeeRefundColumns';
import { SettleDeliveryFeeRefundDialog } from '@/components/money/SettleDeliveryFeeRefundDialog';
import { InfoHint } from '@/components/ui/info-hint';
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
import { formatCount } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listDeliveryFeeRefunds } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    DELIVERY_FEE_REFUND_QUEUE_DEFAULT,
    DELIVERY_FEE_REFUND_QUEUES,
    DELIVERY_FEE_REFUND_SORT_DEFAULT,
    type DeliveryFeeRefund,
    type DeliveryFeeRefundListQuery,
    type DeliveryFeeRefundQueue,
} from '@/types/money.types';

/**
 * `GET /money/delivery-fee-refunds` · **`money.payments.read`** (every tier).
 *
 * Delivery money owed back to a customer that the gateway could not return — a
 * COD order, mobile money, an account with refunds off. A person sends it, then
 * records it here with **Settle** (`orders.refund`, tiers 1–2). Support reads the
 * queue to answer *"where is my delivery refund"* and sees no button.
 *
 * ── `status` is the QUEUE, and it is strict ───────────────────────────────────
 * `manual_required` (still owed — the server's default and ours) · `settled` ·
 * `all`. It is wi-admin's vocabulary, not the row status, and a pinned `z.enum`:
 * an unknown value is a `400`, so the picker offers exactly the three. Automatic
 * refunds the gateway completed are not the queue's at all — they appear on the
 * order's own ledger.
 *
 * `orderId`, `vendorId` and `customerId` are address-only filters, reached by the
 * links on the order and vendor screens; Clear drops them.
 */

const FILTER_KEYS = ['status', 'orderId', 'vendorId', 'customerId', 'sort'] as const;
const FILTER_DEFAULTS = {
    status: DELIVERY_FEE_REFUND_QUEUE_DEFAULT,
    sort: DELIVERY_FEE_REFUND_SORT_DEFAULT,
} as const;

const QUEUE_LABELS: Record<DeliveryFeeRefundQueue, string> = {
    manual_required: 'Still owed',
    settled: 'Settled by hand',
    all: 'Both',
};

function isQueue(value: string): value is DeliveryFeeRefundQueue {
    return (DELIVERY_FEE_REFUND_QUEUES as readonly string[]).includes(value);
}

export function DeliveryFeeRefundsList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const [settling, setSettling] = useState<DeliveryFeeRefund | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    // A hand-edited `?status=` outside the three would be a `400`; fall back to
    // the default rather than sending it.
    const queue: DeliveryFeeRefundQueue = isQueue(values.status)
        ? values.status
        : DELIVERY_FEE_REFUND_QUEUE_DEFAULT;

    const query: DeliveryFeeRefundListQuery = {
        status: queue,
        orderId: values.orderId || undefined,
        vendorId: values.vendorId || undefined,
        customerId: values.customerId || undefined,
        sort: values.sort || undefined,
        page,
    };

    const path = withQuery('/money/delivery-fee-refunds', { ...query });
    const refunds = useAsyncData(path, (signal) => listDeliveryFeeRefunds(query, { signal }));

    const columns = useMemo(
        () => deliveryFeeRefundColumns({ timeZone, can, onSettle: setSettling }),
        [timeZone, can],
    );

    const meta = refunds.data?.meta;
    const scoped = values.orderId || values.vendorId || values.customerId;

    return (
        <PageContainer
            title="Delivery-fee refunds"
            description="Delivery money owed back to customers that the payment gateway could not return — a person sends it, then records it here."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField
                        htmlFor="dfr-queue"
                        label={
                            <>
                                Show
                                <InfoHint label="About this queue">
                                    Only refunds a person must pay. Refunds the gateway returned on
                                    its own are listed on each order, not here.
                                </InfoHint>
                            </>
                        }
                    >
                        <Select
                            value={queue}
                            onValueChange={(next) => set({ status: next })}
                        >
                            <SelectTrigger id="dfr-queue" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DELIVERY_FEE_REFUND_QUEUES.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {QUEUE_LABELS[value]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {scoped ? (
                    <p className="text-muted-foreground text-sm">
                        Narrowed to one{' '}
                        {values.orderId ? 'order' : values.vendorId ? 'vendor' : 'customer'}. Clear
                        the filters to see every refund.
                    </p>
                ) : null}

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} {meta.total === 1 ? 'refund' : 'refunds'}
                    </p>
                ) : null}

                <DataTable
                    caption="Delivery-fee refunds"
                    columns={columns}
                    rows={refunds.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={refunds.isLoading}
                    isRefreshing={refunds.isRefreshing}
                    error={refunds.error}
                    onRetry={refunds.reload}
                    empty={
                        <EmptyState
                            icon={HandCoins}
                            title={
                                queue === 'manual_required'
                                    ? 'Nothing is owed'
                                    : 'No refunds match'
                            }
                            description={
                                queue === 'manual_required'
                                    ? 'No customer is waiting for delivery money to be paid by hand.'
                                    : 'No delivery-fee refund matches these filters.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="refunds"
                        isBusy={refunds.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {settling ? (
                <SettleDeliveryFeeRefundDialog
                    refund={settling}
                    open
                    onOpenChange={(open) => {
                        if (!open) setSettling(null);
                    }}
                    onSettled={() => {
                        setSettling(null);
                        refunds.reload();
                    }}
                    onStale={() => {
                        setSettling(null);
                        refunds.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
