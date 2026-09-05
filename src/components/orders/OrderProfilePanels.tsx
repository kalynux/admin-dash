import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import {
    FulfillmentStatusBadge,
    PaymentStatusBadge,
} from '@/components/orders/OrderStatusBadges';
import { CopyableValue } from '@/components/common/CopyableValue';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { LineItemImage } from '@/components/common/LineItemImage';
import { PartyValue } from '@/components/common/PartyValue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { resolvePartyName } from '@/lib/party';
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
                            {/*
                              Shown whole. This is the value an operator pastes
                              into `?checkoutGroupId=` to pull up the other orders
                              from the same cart, and the panel has the room —
                              truncation is for the dense rows, not for a
                              definition list with one id in it.
                            */}
                            <CopyableValue
                                variant="id"
                                value={order.checkoutGroupId}
                                label="checkout group ID"
                                truncate={false}
                            />
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
                    {/*
                      ── § C1 · the naming phase this card was waiting for ───────
                      Both parties used to render `name ?? id` as one string, and
                      the note here said a copy button would then copy a *name*
                      whenever one existed — which is true, and is why the two
                      are now **split apart** rather than given an affordance
                      between them.

                      `resolvePartyName` is what makes the split honest: the name
                      is the label and the id is a value beneath it, and where
                      there was never a name the label *is* the id, so printing
                      it twice would be the only thing worse than printing it
                      once. `kind` is what distinguishes those two renders, not a
                      `=== id` string comparison.
                    */}
                    <DefinitionList>
                        <Definition label="Vendor">
                            <PartyValue
                                party={resolvePartyName(
                                    [{ source: 'name', value: order.vendorName }],
                                    { source: 'id', value: order.vendorId },
                                )}
                                id={order.vendorId}
                                idLabel="vendor ID"
                                to={
                                    can('vendors.read')
                                        ? `/dashboard/vendors/${order.vendorId}`
                                        : undefined
                                }
                            />
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
                            {/*
                              ⚠ No `to` on the name, and the id is still shown.
                              A `customers._id` resolves in neither `/users/:id`
                              nor `?search=<24hex>`, so there is nothing to link
                              it to — but it is the parameter of the one query
                              that *does* work, which is exactly what makes it
                              worth copying. The sub-line is the affordance the
                              "their other orders" link cannot be.
                            */}
                            <PartyValue
                                party={resolvePartyName(
                                    [{ source: 'name', value: order.customerName }],
                                    { source: 'id', value: order.customerId },
                                )}
                                id={order.customerId}
                                idLabel="customer ID"
                                after={
                                    can('orders.read') ? (
                                        <Link
                                            to={`/dashboard/orders?customerId=${order.customerId}`}
                                            className="text-muted-foreground text-xs hover:underline"
                                        >
                                            Their other orders
                                        </Link>
                                    ) : null
                                }
                            />
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
                            {/*
                              ⚠ `plain`, never `id`. This is `pi_9f2b8c1a…` — a
                              gateway's own reference, not an ObjectId — and it is
                              looked up character for character in the provider's
                              dashboard. A shortened one is not a reference.
                            */}
                            <CopyableValue
                                variant="plain"
                                mono
                                value={order.paymentIntentId}
                                label="payment intent ID"
                            />
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
                                {/* `dp_44127` — the gateway's reference again, so
                                    `plain` for the same reason as the intent. */}
                                <CopyableValue
                                    variant="plain"
                                    mono
                                    value={order.dispute.gatewayDisputeId}
                                    label="gateway dispute ID"
                                />
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

/**
 * `GET /orders/:orderId` items, with their per-item delivery and their picture.
 *
 * ── § C2 · the picture is an N+1, and it is bounded ──────────────────────────
 * An order item carries a `productId` and no media at all, so each distinct
 * listing is resolved through `GET /vendors/:vendorId/products/:productId` —
 * whose `media.images` are **public URLs**, so they render immediately and
 * write no audit row. The order's own `vendorId` is what completes the address;
 * a product id alone is not one.
 *
 * ⚠ **The same trick is deliberately not applied to the agency name** on these
 * rows. A picture is one request per *distinct product on a detail screen*; an
 * agency name would be one per *row*, and the same shape on a list would be a
 * page of lookups the client should not be making.
 * [BR-017](../../docs/dashboard/backend-requests/BR-017-order-and-shipment-item-media.md)
 * asks for the media to be folded into the order payload so this stops being
 * needed at all.
 */
export function OrderItemsPanel({
    order,
    timeZone,
    can,
    focusItemId = null,
}: {
    order: OrderDetail;
    timeZone: string;
    can: CanPredicate;
    /**
     * The `orderItemId` a shipment's item card handed over, from `?item=`.
     *
     * ⚠ **Scrolled to on mount, not on a token change.** Radix unmounts an
     * inactive `TabsContent`, so this panel mounts *because* the deep link
     * selected the Items tab — there is no earlier render to compare against.
     * The Phase B focus bug was the mirror image of that: a token seeded from
     * its own prop, on a component that also mounted fresh, so `1 !== 1` and
     * nothing applied.
     */
    focusItemId?: string | null;
}) {
    useEffect(() => {
        if (!focusItemId) return;
        // No `focus()`: these are cards, not controls, and moving focus onto a
        // non-interactive region takes it away from wherever the operator's
        // keyboard actually is. Bringing it into view is the whole hand-off.
        document
            .getElementById(orderItemDomId(focusItemId))
            ?.scrollIntoView({ block: 'center' });
    }, [focusItemId]);

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
                <Card
                    key={item.id ?? index}
                    id={item.id ? orderItemDomId(item.id) : undefined}
                    // The hand-off has to be *visible* as well as scrolled to: an
                    // order with nine similar lines otherwise lands the operator
                    // in the middle of a list with nothing saying which one they
                    // were sent to.
                    className={
                        item.id && item.id === focusItemId
                            ? 'ring-primary/40 ring-2 ring-offset-2'
                            : undefined
                    }
                >
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
                    <CardContent className="flex flex-col gap-4 sm:flex-row">
                        {/*
                          ⚠ The title comes from the **order's own snapshot**, not
                          from the listing behind it — a product renamed after the
                          sale must not rename what was bought. The picture is the
                          listing's *current* one, resolved on this payload since
                          BR-017; it was a lookup per product until 2026-08-26.
                        */}
                        <div className="w-full shrink-0 sm:w-40">
                            <LineItemImage
                                image={item.image}
                                alt={item.title ?? 'This item'}
                            />
                        </div>

                        <DefinitionList className="min-w-0 flex-1">
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
                                    {/*
                                      ⚠ Both keep their own null branch rather than
                                      leaning on `CopyableValue`'s `<NotSet />`. The
                                      fallbacks here *say something* — "not routed"
                                      and "not dispatched" are different facts from
                                      "not recorded", and the bare gap would lose
                                      both. `to` is passed rather than wrapping, so
                                      the link survives and the copy button sits
                                      beside it instead of replacing it.
                                    */}
                                    {/*
                                      ⚠ `agencyName` is the **business name**,
                                      from the Magazin — never `display_name`,
                                      which is the agency's contact *person*.
                                      Sourced as `businessName` so a future
                                      fallback cannot quietly rename a company
                                      after whoever answers its phone; that is
                                      the BR-006 confusion, refused at the
                                      source this time.
                                    */}
                                    <Definition label="Agency">
                                        {item.delivery.agencyId ? (
                                            <PartyValue
                                                party={resolvePartyName(
                                                    [
                                                        {
                                                            source: 'businessName',
                                                            value: item.delivery.agencyName,
                                                        },
                                                    ],
                                                    {
                                                        source: 'id',
                                                        value: item.delivery.agencyId,
                                                    },
                                                )}
                                                id={item.delivery.agencyId}
                                                idLabel="agency ID"
                                                to={
                                                    can('agencies.read')
                                                        ? `/dashboard/agencies/${item.delivery.agencyId}`
                                                        : undefined
                                                }
                                            />
                                        ) : (
                                            <NotSet>Not routed to an agency</NotSet>
                                        )}
                                    </Definition>
                                    <Definition label="Shipment">
                                        {item.delivery.shipmentId ? (
                                            <ShipmentHandle
                                                shipmentId={item.delivery.shipmentId}
                                                trackingNumber={item.delivery.trackingNumber}
                                                to={
                                                    can('shipments.read')
                                                        ? `/dashboard/shipments/${item.delivery.shipmentId}`
                                                        : undefined
                                                }
                                            />
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

/**
 * The anchor a deep link into the Items tab lands on.
 *
 * Prefixed rather than the bare id, because an `orderItemId` is a 24-hex string
 * and a document-wide `getElementById` on a bare one would collide with any
 * other element that happened to be keyed on the same record.
 */
function orderItemDomId(orderItemId: string): string {
    return `order-item-${orderItemId}`;
}

function Amount({ value, currency }: { value: number | null | undefined; currency: string }) {
    if (value === null || value === undefined) return <NotSet />;
    return <>{formatMoney(value, currency)}</>;
}

/**
 * The shipment behind a line, named by the handle an operator can actually use.
 *
 * ── ⚠ Which of the two ids goes on top is the whole point ────────────────────
 * `shipmentId` is internal: `GET /shipments`'s `search` matches a
 * **tracking-number prefix**, so the id in hand is a string that box cannot
 * find, and a customer on the phone quotes a tracking number rather than an
 * ObjectId. This panel used to carry an `InfoHint` explaining that the tracking
 * number *"is not on this payload"* and telling the operator to open the
 * shipment and read it — true when it was written, false from
 * `RESPONSE-2026-08-26.md` onwards, and it kept saying so for two days.
 *
 * ⚠ **The id stays, underneath.** It is what a deep link and a support ticket
 * quote, and the tracking number is a *label* for the shipment rather than a
 * substitute for its identifier.
 *
 * `trackingNumber` is `null` while the item is unfulfilled — ordinary, and a
 * different fact from "not dispatched", which is `shipmentId` being null and is
 * handled by the caller.
 */
function ShipmentHandle({
    shipmentId,
    trackingNumber,
    to,
}: {
    shipmentId: string;
    trackingNumber: string | null;
    to?: string;
}) {
    if (!trackingNumber) {
        return (
            <div className="space-y-1">
                <CopyableValue
                    variant="id"
                    value={shipmentId}
                    label="shipment ID"
                    truncate={false}
                    to={to}
                />
                <p className="text-muted-foreground text-xs">
                    No tracking number yet — this item is not fulfilled.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <CopyableValue
                variant="plain"
                value={trackingNumber}
                label="tracking number"
                to={to}
            />
            <div className="text-muted-foreground">
                <CopyableValue
                    variant="id"
                    value={shipmentId}
                    label="shipment ID"
                    truncate={false}
                />
            </div>
        </div>
    );
}
