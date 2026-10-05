import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, HandCoins, Scale, Send, Undo2 } from 'lucide-react';

import { EarningsPauseCard } from '@/components/money/EarningsPauseCard';
import { OrderActivityPanel } from '@/components/orders/OrderActivityPanel';
import { OrderDeliveryFeePanel } from '@/components/orders/OrderDeliveryFeePanel';
import { OrderMoneySplitPanel } from '@/components/orders/OrderMoneySplitPanel';
import {
    OrderItemsPanel,
    OrderOverviewPanel,
} from '@/components/orders/OrderProfilePanels';
import { OrderShipmentsPanel } from '@/components/orders/OrderShipmentsPanel';
import { OrderTimelinePanel } from '@/components/orders/OrderTimelinePanel';
import {
    CancelOrderDialog,
    DispatchOrderDialog,
    DispatchResultNotice,
    ResolveDisputeDialog,
} from '@/components/orders/OrderWriteDialogs';
import { OrderRefundRequestsCard } from '@/components/refunds/OrderRefundRequestsCard';
import { RaiseRefundDialog } from '@/components/refunds/RaiseRefundDialog';
import { RaisedRefundNotice } from '@/components/refunds/RaisedRefundNotice';
import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatMoney } from '@/lib/format';
import { getOrder } from '@/services/orders.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    canResolveDispute,
    isDispatchable,
    orderDisplayName,
    type DispatchResult,
} from '@/types/orders.types';
import type { CreateRefundResult } from '@/types/refunds.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /orders/:orderId` — one order, and the four interventions.
 *
 * ── Seven tabs, three of them conditional ─────────────────────────────────────
 * Overview, Items, Delivery fee and Timeline read what `orders.read` already
 * bought, which the module gate required. **Money** needs `money.splits.read`
 * (every tier holds it — Support answers "why did I get this amount?") and is
 * its own delegated read. **Shipments** additionally needs `shipments.read` — an
 * order's payload carries no shipments, so that tab is a separate read against a
 * separate surface. **Activity** needs `audit.read`, or it would be a second door
 * onto the audit trail bypassing the permission governing it.
 *
 * Each is **omitted** rather than rendered and then refusing: a tab whose only
 * content is a denial teaches people the screen is broken. Tabs also fetch lazily,
 * because Radix unmounts an inactive tab's content.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * All four writes are delegated, and two of them answer jovi-mall's **raw Mongoose
 * document** rather than this read's shape. The service discards those bodies
 * entirely, so there is nothing here that could be merged even by accident.
 *
 * Two results are the exception and are held in state, because they exist on their
 * own write's response and **nowhere else**: the dispatch count — no later read
 * says *this action* created those shipments — and the refund's
 * `withinVendorPolicy` / `overrides`, which record a policy evaluated once against
 * terms the vendor may edit tomorrow.
 *
 * ── Refunds go through the refund queue (2026-10-05) ──────────────────────────
 * **Raise a refund** opens a refund REQUEST (`POST /refunds`, on
 * `orders.refund.request` — every tier, Support included). The legacy
 * `POST /orders/:orderId/refund` is no longer called from here: it now opens a
 * request too, and is refused at ≥ 2,000,000 (`REFUND_USE_REFUND_QUEUE`). The
 * eligibility read happens inside the dialog, on open, and never on mount. The
 * order's own requests are listed under the payout card, on `orders.refund.read`.
 */
export function OrderDetail() {
    const { orderId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**. A malformed id is a
     * `400` at the service's edge and only happens when somebody edits the URL, so
     * the round trip buys nothing — and hooks cannot be conditional, so checking
     * inside the screen would mean the read had already been issued.
     */
    if (!OBJECT_ID.test(orderId)) return <InvalidOrderId />;

    return <OrderDetailScreen orderId={orderId} />;
}

function InvalidOrderId() {
    return (
        <PageContainer title="Order not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid order id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

/**
 * The tabs a deep link may name.
 *
 * Only the three every holder of `orders.read` has: the conditional ones would
 * need the permission check the link's *author* cannot make, and landing on a
 * tab that is not there is worse than landing on Overview.
 */
const LINKABLE_TABS = ['overview', 'items', 'delivery-fee', 'timeline'];

function OrderDetailScreen({ orderId }: { orderId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    /**
     * ── § C4 · where `?tab=items&item=` is read ──────────────────────────────
     * A shipment's item card links back to the order line the parcel came from,
     * which is a cross-screen hand-off: the two live at different route paths,
     * so this component always mounts fresh on arrival and the query is read
     * **once**, as the initial tab.
     *
     * ⚠ Deliberately not synchronised afterwards. Keeping the tab in the URL
     * would mean every tab click wrote history, and re-applying the parameter on
     * every render would fight an operator who then clicked a different tab. A
     * hand-off is an opening position, not a binding.
     *
     * An unrecognised or absent value falls back to Overview rather than
     * rendering nothing — a query parameter is the one input an operator can
     * mistype into this screen.
     */
    const [searchParams] = useSearchParams();
    const focusItemId = searchParams.get('item');
    const [tab, setTab] = useState(() => {
        const requested = searchParams.get('tab');
        return requested && LINKABLE_TABS.includes(requested) ? requested : 'overview';
    });
    const [resolving, setResolving] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [dispatching, setDispatching] = useState(false);
    const [refunding, setRefunding] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const [dispatched, setDispatched] = useState<DispatchResult | null>(null);
    const [raised, setRaised] = useState<CreateRefundResult | null>(null);

    const order = useAsyncData(`/orders/${orderId}`, (signal) => getOrder(orderId, { signal }));

    /** One write moves several reads: the record, and every panel keyed on the token. */
    function reconcile() {
        order.reload();
        setReloadToken((current) => current + 1);
    }

    if (order.isLoading) {
        return (
            <PageContainer title="Order">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!order.data) {
        return (
            <PageContainer title="Order">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` renders that as a calm
                    denial rather than a fault. */}
                <ErrorState
                    error={order.error}
                    onRetry={order.reload}
                    deniedTitle="No such order"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = order.data;
    const owedManually = record.deliveryFee?.owedManually ?? 0;
    const canSeeShipments = can('shipments.read');
    const canSeeActivity = can(['orders.read', 'audit.read'], 'all');
    // Every tier holds it today, but it is a separate grant on a separate read.
    const canSeeMoney = can('money.splits.read');
    const canSeePayout = can('money.earnings.read');

    return (
        <PageContainer
            title={orderDisplayName(record)}
            description={<CopyableId value={record.id} label="order ID" truncate={false} />}
            actions={
                <>
                    <Can permission="orders.disputes.resolve">
                        {canResolveDispute(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setResolving(true)}
                            >
                                <Scale className="size-4" />
                                Resolve dispute
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="orders.intervene">
                        {isDispatchable(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDispatching(true)}
                            >
                                <Send className="size-4" />
                                Dispatch
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="orders.refund.request">
                        <Button variant="outline" size="sm" onClick={() => setRefunding(true)}>
                            <Undo2 className="size-4" />
                            Raise a refund
                        </Button>
                    </Can>

                    {/*
                      Always offered under the permission, never gated on the order's
                      state: the six guards are the platform's and are re-evaluated
                      at write time. The dialog lists the ones it expects to bite.
                    */}
                    <Can permission="orders.intervene">
                        <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>
                            <Ban className="size-4" />
                            Cancel
                        </Button>
                    </Can>
                </>
            }
        >
            <BackLink />

            {dispatched ? (
                <DispatchResultNotice
                    result={dispatched}
                    onDismiss={() => setDispatched(null)}
                />
            ) : null}

            {raised ? (
                <RaisedRefundNotice
                    result={raised}
                    timeZone={timeZone}
                    onDismiss={() => setRaised(null)}
                />
            ) : null}

            {/*
              The call to action the changelog asks for: delivery money a person
              must still send. Shown to every reader — Support answers "where is
              my delivery refund" — and the Settle button inside the tab is what
              `orders.refund` gates.
            */}
            {owedManually > 0 && tab !== 'delivery-fee' ? (
                <div
                    role="status"
                    className="border-warning/40 bg-warning/10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                    <p className="flex items-start gap-2">
                        <HandCoins className="text-warning mt-0.5 size-4 shrink-0" />
                        <span>
                            <strong className="font-medium">
                                {formatMoney(owedManually, record.currency)}
                            </strong>{' '}
                            of delivery money is owed back to the customer and must be sent by
                            hand.
                        </span>
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setTab('delivery-fee')}>
                        {can('orders.refund') ? 'Review and settle' : 'Review'}
                    </Button>
                </div>
            ) : null}

            {/*
              The payout chip (2026-10-05): paused or not, with Pause / Resume.
              Above the tabs because a paused payout is the answer to "why has
              the vendor not been paid", whichever tab the operator is on. Its
              read is `money.earnings.read`, which Support lacks — so it is
              omitted for them rather than shown refusing.
            */}
            {canSeePayout ? (
                <EarningsPauseCard
                    kind="order"
                    id={record.id}
                    reference={record.orderNumber || null}
                    timeZone={timeZone}
                    reloadToken={reloadToken}
                    onChanged={() => setReloadToken((current) => current + 1)}
                />
            ) : null}

            {can('orders.refund.read') ? (
                <OrderRefundRequestsCard
                    orderId={record.id}
                    timeZone={timeZone}
                    reloadToken={reloadToken}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="items">Items</TabsTrigger>
                    <TabsTrigger value="delivery-fee">Delivery fee</TabsTrigger>
                    {canSeeMoney ? <TabsTrigger value="money">Money</TabsTrigger> : null}
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    {canSeeShipments ? (
                        <TabsTrigger value="shipments">Shipments</TabsTrigger>
                    ) : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview">
                    <OrderOverviewPanel order={record} timeZone={timeZone} can={can} />
                </TabsContent>

                <TabsContent value="items">
                    <OrderItemsPanel
                        order={record}
                        timeZone={timeZone}
                        can={can}
                        focusItemId={focusItemId}
                    />
                </TabsContent>

                <TabsContent value="delivery-fee">
                    <OrderDeliveryFeePanel
                        order={record}
                        timeZone={timeZone}
                        can={can}
                        onChanged={reconcile}
                    />
                </TabsContent>

                {canSeeMoney ? (
                    <TabsContent value="money">
                        <OrderMoneySplitPanel
                            orderId={record.id}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}

                <TabsContent value="timeline">
                    <OrderTimelinePanel
                        orderId={record.id}
                        timeZone={timeZone}
                        reloadToken={reloadToken}
                    />
                </TabsContent>

                {canSeeShipments ? (
                    <TabsContent value="shipments">
                        <OrderShipmentsPanel
                            orderId={record.id}
                            timeZone={timeZone}
                            can={can}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <OrderActivityPanel
                            orderId={record.id}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <ResolveDisputeDialog
                order={record}
                open={resolving}
                onOpenChange={setResolving}
                onDone={reconcile}
            />
            <CancelOrderDialog
                order={record}
                open={cancelling}
                onOpenChange={setCancelling}
                onDone={reconcile}
            />
            <DispatchOrderDialog
                order={record}
                open={dispatching}
                onOpenChange={setDispatching}
                onDone={(result) => {
                    setDispatched(result);
                    reconcile();
                }}
            />
            {refunding ? (
                <RaiseRefundDialog
                    open
                    onOpenChange={setRefunding}
                    source={{ kind: 'order', id: record.id, label: orderDisplayName(record) }}
                    onRaised={(result) => {
                        setRaised(result);
                        reconcile();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/orders"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All orders
        </Link>
    );
}
