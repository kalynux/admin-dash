import { Link } from 'react-router-dom';

import {
    FulfillmentStatusBadge,
    PaymentStatusBadge,
} from '@/components/orders/OrderStatusBadges';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import type { CanPredicate } from '@/store';
import type { OrderDetail } from '@/types/orders.types';

/**
 * The read-only panels of an order's detail screen.
 *
 * ── Three fields that are easy to misread ─────────────────────────────────────
 * 1. **`dispute` is `null` when the order has never been disputed** — absent
 *    entirely rather than a block of nulls that reads as "unknown". Present with
 *    `active: false` once resolved, because a resolved dispute is exactly what an
 *    administrator opens this screen for. The two states are rendered as different
 *    sentences.
 * 2. **`completion` is the escrow gate**, not delivery. Funds released and parcel
 *    delivered are two facts, and the API refuses to derive either from the other.
 * 3. **`deliveryAddress` is textual only.** The coordinates and the customer's raw
 *    typed input are excluded by the projection *and* by the mapper — the sharpest
 *    PII in the collection. The panel says so, so nobody reads the absence as a
 *    rendering bug.
 */
export function OrderOverviewPanel({
    order,
    timeZone,
    can,
}: {
    order: OrderDetail;
    timeZone: string;
    can: CanPredicate;
}) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Order</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Number">{order.orderNumber}</Definition>
                        <Definition label="Type">
                            <span className="capitalize">{order.type}</span>
                        </Definition>
                        <Definition
                            label="Checkout group"
                            hint={
                                <InfoHint label="About the checkout group">
                                    The cart this order came from. **One checkout splits into one
                                    order per vendor, all sharing this id** — so a customer&apos;s
                                    single purchase is several orders, and this is how they are
                                    reassembled.
                                </InfoHint>
                            }
                        >
                            {order.checkoutGroupId ? (
                                <span className="font-mono text-xs">{order.checkoutGroupId}</span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Placed">
                            {formatInstantInZone(order.createdAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Updated">
                            {formatInstantInZone(order.updatedAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Parties</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Vendor">
                            {can('vendors.read') ? (
                                <Link
                                    to={`/dashboard/vendors/${order.vendorId}`}
                                    className="hover:underline"
                                >
                                    {order.vendorName ?? order.vendorId}
                                </Link>
                            ) : (
                                (order.vendorName ?? order.vendorId)
                            )}
                        </Definition>
                        <Definition
                            label="Customer"
                            hint={
                                <InfoHint label="Why there is no account link">
                                    A customer id is not a user id on this platform — the two live
                                    in different collections, and no order carries the account id
                                    that would join them. So there is no account to link to from
                                    here; their other orders are the closest thing.
                                </InfoHint>
                            }
                        >
                            <span className="flex flex-wrap items-center gap-2">
                                {order.customerName ?? 'Not recorded'}
                                {can('orders.read') ? (
                                    <Link
                                        to={`/dashboard/orders?customerId=${order.customerId}`}
                                        className="text-muted-foreground text-xs hover:underline"
                                    >
                                        Their other orders
                                    </Link>
                                ) : null}
                            </span>
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Money</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Payment">
                            <span className="flex flex-wrap items-center gap-2">
                                <PaymentStatusBadge status={order.paymentStatus} />
                                {/* Absent on orders older than the field — see
                                    the note on `Order['paymentMethod']`. */}
                                <span className="text-muted-foreground text-xs capitalize">
                                    {humaniseEnum(order.paymentMethod) ?? (
                                        <NotSet>Method not recorded</NotSet>
                                    )}
                                </span>
                            </span>
                        </Definition>
                        <Definition label="Fulfilment">
                            <FulfillmentStatusBadge status={order.fulfillmentStatus} />
                        </Definition>
                        <Definition label="Total">
                            {formatMoney(order.totalAmount, order.currency)}
                        </Definition>
                        {/* Nullable object with nullable members — each blank is "—", never NaN. */}
                        <Definition label="Base">
                            <Amount
                                value={order.priceBreakdown?.base}
                                currency={order.currency}
                            />
                        </Definition>
                        <Definition label="Tax">
                            <Amount value={order.priceBreakdown?.tax} currency={order.currency} />
                        </Definition>
                        <Definition label="Discount">
                            <Amount
                                value={order.priceBreakdown?.discount}
                                currency={order.currency}
                            />
                        </Definition>
                        <Definition
                            label="Gateway reference"
                            hint={
                                <InfoHint label="About the payment intent">
                                    The reference every gateway call looks the order up on. It is
                                    what correlates this order with the payment provider&apos;s own
                                    records.
                                </InfoHint>
                            }
                        >
                            {order.paymentIntentId ? (
                                <span className="font-mono text-xs">{order.paymentIntentId}</span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Payment dispute</CardTitle>
                </CardHeader>
                <CardContent>
                    {order.dispute === null ? (
                        /*
                          Never disputed — a different statement from "resolved", and
                          from "we do not know". The block is absent on the wire, and
                          it is absent here.
                        */
                        <p className="text-sm">
                            <NotApplicable>
                                This order has never been disputed.
                            </NotApplicable>
                        </p>
                    ) : (
                        <DefinitionList>
                            <Definition label="State">
                                <Badge
                                    variant="outline"
                                    className={
                                        order.dispute.active
                                            ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                            : undefined
                                    }
                                >
                                    {order.dispute.active ? 'Open' : 'Resolved'}
                                </Badge>
                            </Definition>
                            <Definition label="Reason">
                                {order.dispute.reason ?? <NotSet />}
                            </Definition>
                            <Definition label="Opened">
                                {formatInstantInZone(order.dispute.disputedAt, timeZone) ?? '—'}
                            </Definition>
                            <Definition label="Resolved">
                                {formatInstantInZone(order.dispute.resolvedAt, timeZone) ?? '—'}
                            </Definition>
                            <Definition label="Gateway dispute">
                                {order.dispute.gatewayDisputeId ? (
                                    <span className="font-mono text-xs">
                                        {order.dispute.gatewayDisputeId}
                                    </span>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                        </DefinitionList>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Escrow</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-3 text-sm">
                        Whether the platform has released the funds to the vendor.{' '}
                        <strong>Not the same as delivered</strong> — the two are independent, and
                        neither is derived from the other.
                    </p>
                    <DefinitionList>
                        <Definition label="Funds released">
                            {order.completedAt
                                ? (formatInstantInZone(order.completedAt, timeZone) ?? 'Yes')
                                : 'Still held'}
                        </Definition>
                        <Definition label="Confirmed by">
                            {order.completion?.confirmedBy ?? <NotSet />}
                        </Definition>
                        <Definition
                            label="How"
                            hint={
                                <InfoHint label="About automatic release">
                                    Escrow releases on a timer unless somebody confirms sooner. This
                                    says which happened.
                                </InfoHint>
                            }
                        >
                            {order.completion === null ? (
                                <NotSet />
                            ) : order.completion.auto ? (
                                'Automatically'
                            ) : (
                                'Confirmed by a person'
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Delivery address</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        Textual only. The coordinates and whatever the customer originally typed are
                        excluded by the service — twice over, by the projection and by the mapping —
                        so there is nothing further to reveal here.
                    </p>
                    <DefinitionList>
                        <Definition label="Address">
                            {order.deliveryAddress?.formattedAddress ?? (
                                <NotSet>No address on this order</NotSet>
                            )}
                        </Definition>
                        {order.deliveryAddress?.components
                            ? Object.entries(order.deliveryAddress.components).map(
                                  ([key, value]) => (
                                      <Definition key={key} label={key}>
                                          {value === null || value === undefined ? (
                                              <NotSet />
                                          ) : (
                                              String(value)
                                          )}
                                      </Definition>
                                  ),
                              )
                            : null}
                    </DefinitionList>
                </CardContent>
            </Card>
        </div>
    );
}

/** `GET /orders/:orderId` items, with their per-item delivery. */
export function OrderItemsPanel({
    order,
    timeZone,
    can,
}: {
    order: OrderDetail;
    timeZone: string;
    can: CanPredicate;
}) {
    if (order.items.length === 0) {
        return (
            <Card>
                <CardContent className="py-6">
                    <p className="text-muted-foreground text-sm">This order carries no items.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {order.items.map((item, index) => (
                <Card key={item.id ?? index}>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {item.title ?? 'Untitled item'}
                            {item.variantTitle ? (
                                <span className="text-muted-foreground font-normal">
                                    {' '}
                                    · {item.variantTitle}
                                </span>
                            ) : null}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="SKU">{item.sku ?? <NotSet />}</Definition>
                            <Definition label="Options">
                                {item.optionsSnapshot ?? <NotSet />}
                            </Definition>
                            <Definition label="Quantity">{formatCount(item.quantity)}</Definition>
                            <Definition label="Unit price">
                                {formatMoney(item.price, item.currency ?? order.currency)}
                            </Definition>

                            {item.delivery ? (
                                <>
                                    <Definition label="Delivery status">
                                        {item.delivery.status ? (
                                            <span className="capitalize">
                                                {humaniseEnum(item.delivery.status) ?? '—'}
                                            </span>
                                        ) : (
                                            <NotSet />
                                        )}
                                    </Definition>
                                    <Definition label="Agency">
                                        {item.delivery.agencyId ? (
                                            can('agencies.read') ? (
                                                <Link
                                                    to={`/dashboard/agencies/${item.delivery.agencyId}`}
                                                    className="font-mono text-xs hover:underline"
                                                >
                                                    {item.delivery.agencyId}
                                                </Link>
                                            ) : (
                                                <span className="font-mono text-xs">
                                                    {item.delivery.agencyId}
                                                </span>
                                            )
                                        ) : (
                                            <NotSet>Not routed to an agency</NotSet>
                                        )}
                                    </Definition>
                                    <Definition label="Shipment">
                                        {item.delivery.shipmentId ? (
                                            can('shipments.read') ? (
                                                <Link
                                                    to={`/dashboard/shipments/${item.delivery.shipmentId}`}
                                                    className="font-mono text-xs hover:underline"
                                                >
                                                    {item.delivery.shipmentId}
                                                </Link>
                                            ) : (
                                                <span className="font-mono text-xs">
                                                    {item.delivery.shipmentId}
                                                </span>
                                            )
                                        ) : (
                                            <NotSet>Not dispatched</NotSet>
                                        )}
                                    </Definition>
                                    <Definition label="Free delivery">
                                        {item.delivery.freeDelivery ? 'Yes' : 'No'}
                                    </Definition>
                                    <Definition
                                        label="On hold"
                                        hint={
                                            <InfoHint label="About holds">
                                                Set when a delivery agency was deactivated while
                                                this item was in flight. The previous status is kept
                                                so it can be put back.
                                            </InfoHint>
                                        }
                                    >
                                        {item.delivery.hold ? (
                                            <>
                                                since{' '}
                                                {formatInstantInZone(
                                                    item.delivery.hold.heldAt,
                                                    timeZone,
                                                ) ?? '—'}
                                                {item.delivery.hold.previousStatus ? (
                                                    <span className="text-muted-foreground">
                                                        {' '}
                                                        · was {item.delivery.hold.previousStatus}
                                                    </span>
                                                ) : null}
                                            </>
                                        ) : (
                                            <NotApplicable>Not held</NotApplicable>
                                        )}
                                    </Definition>
                                    <Definition label="Collected from">
                                        {item.delivery.pickup?.source ? (
                                            <span className="capitalize">
                                                {humaniseEnum(item.delivery.pickup.source) ?? '—'}
                                            </span>
                                        ) : (
                                            <NotSet />
                                        )}
                                    </Definition>
                                </>
                            ) : (
                                <Definition label="Delivery">
                                    <NotApplicable>
                                        This item carries no delivery record
                                    </NotApplicable>
                                </Definition>
                            )}
                        </DefinitionList>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function Amount({ value, currency }: { value: number | null | undefined; currency: string }) {
    if (value === null || value === undefined) return <NotSet />;
    return <>{formatMoney(value, currency)}</>;
}
