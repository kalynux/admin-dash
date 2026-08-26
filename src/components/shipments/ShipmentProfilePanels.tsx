import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import {
    AssignmentStateBadge,
    ShipmentStatusBadge,
} from '@/components/shipments/ShipmentStatusBadge';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { ResolvedFileViewer } from '@/components/files/FileViewer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { isPlatformActor } from '@/types/actor.types';
import type { CanPredicate } from '@/store';
import { SHIPMENT_OFFER_CAP, type ShipmentDetail } from '@/types/shipments.types';

/** Identity, the order it belongs to, and the two parties. */
export function ShipmentOverviewPanel({
    shipment,
    timeZone,
    can,
}: {
    shipment: ShipmentDetail;
    timeZone: string;
    can: CanPredicate;
}) {
    const cappedOffers = shipment.assignment.offerCount >= SHIPMENT_OFFER_CAP;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Shipment</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Tracking number">
                            {shipment.trackingNumber ?? <NotSet>Not minted yet</NotSet>}
                        </Definition>
                        <Definition label="Status">
                            <ShipmentStatusBadge status={shipment.status} />
                        </Definition>
                        <Definition label="Items">
                            {formatCount(shipment.itemCount)}
                        </Definition>
                        <Definition
                            label="Delivery fee"
                            hint={
                                <InfoHint label="About the fee">
                                    A snapshot taken when the shipment was created. No currency
                                    accompanies it anywhere in the record, so it is shown as a plain
                                    number.
                                </InfoHint>
                            }
                        >
                            {shipment.deliveryFeeSnapshot === null ? (
                                <NotSet />
                            ) : (
                                formatMoney(shipment.deliveryFeeSnapshot, null)
                            )}
                        </Definition>
                        <Definition label="Held">
                            {shipment.held ? (
                                <Badge
                                    variant="outline"
                                    className="border-warning/30 bg-warning/10 text-warning"
                                >
                                    Frozen by an agency deactivation
                                </Badge>
                            ) : (
                                'No'
                            )}
                        </Definition>
                        <Definition
                            label="Proof of delivery"
                            hint={
                                <InfoHint label="About the proof">
                                    Delivery proofs live in a private storage tree, so they resolve
                                    with no URL and cannot be rendered from one. Opening the photo
                                    fetches the bytes through wi-admin, and{' '}
                                    <strong>every open is recorded in the audit trail</strong> —
                                    which is what lets Support hold the permission at all.
                                </InfoHint>
                            }
                        >
                            {shipment.deliveryProofFileId ? (
                                <ResolvedFileViewer fileId={shipment.deliveryProofFileId} />
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Created">
                            {formatInstantInZone(shipment.createdAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Updated">
                            {formatInstantInZone(shipment.updatedAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Assignment</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition
                            label="State"
                            hint={
                                <InfoHint label="About the assignment state">
                                    The assignment mirror, not the status — whether an agent has
                                    been found is a different question from where the parcel is.
                                </InfoHint>
                            }
                        >
                            <AssignmentStateBadge state={shipment.assignment.state} />
                        </Definition>
                        <Definition label="Agent">
                            {shipment.agent ? (
                                <AgentRef
                                    id={shipment.agent.id}
                                    name={shipment.agent.name}
                                    can={can}
                                />
                            ) : (
                                <NotSet>No agent bound</NotSet>
                            )}
                        </Definition>
                        <Definition label="Offered to">
                            {shipment.assignment.offeredAgentId ? (
                                <AgentRef id={shipment.assignment.offeredAgentId} can={can} />
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition
                            label={cappedOffers ? 'Offers (at least)' : 'Offers'}
                            hint={
                                cappedOffers ? (
                                    <InfoHint label="About the offer count">
                                        The platform serves at most {SHIPMENT_OFFER_CAP} offer rows
                                        and this count is that same capped read — so it means
                                        &ldquo;at least {SHIPMENT_OFFER_CAP}&rdquo;, not a total.
                                    </InfoHint>
                                ) : undefined
                            }
                        >
                            {formatCount(shipment.assignment.offerCount)}
                        </Definition>
                        <Definition label="Assignment updated">
                            {formatInstantInZone(shipment.assignment.updatedAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Order and agency</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Order">
                            {can('orders.read') ? (
                                <Link
                                    to={`/dashboard/orders/${shipment.orderId}`}
                                    className="hover:underline"
                                >
                                    {shipment.orderNumber ?? shipment.orderId}
                                </Link>
                            ) : (
                                (shipment.orderNumber ?? shipment.orderId)
                            )}
                        </Definition>
                        <Definition label="Payment">
                            {shipment.order?.paymentStatus ? (
                                <span className="capitalize">
                                    {shipment.order.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                                    {shipment.order.paymentMethod ? (
                                        <span className="text-muted-foreground">
                                            {' '}
                                            · {humaniseEnum(shipment.order.paymentMethod) ?? '—'}
                                        </span>
                                    ) : null}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Fulfilment">
                            {shipment.order?.fulfillmentStatus ? (
                                <span className="capitalize">
                                    {humaniseEnum(shipment.order.fulfillmentStatus) ?? '—'}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Vendor">
                            {shipment.order?.vendorId ? (
                                can('vendors.read') ? (
                                    <Link
                                        to={`/dashboard/vendors/${shipment.order.vendorId}`}
                                        className="font-mono text-xs hover:underline"
                                    >
                                        {shipment.order.vendorId}
                                    </Link>
                                ) : (
                                    <span className="font-mono text-xs">
                                        {shipment.order.vendorId}
                                    </span>
                                )
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Agency">
                            {can('agencies.read') ? (
                                <Link
                                    to={`/dashboard/agencies/${shipment.agency.id}`}
                                    className="hover:underline"
                                >
                                    {shipment.agency.name ?? shipment.agency.id}
                                </Link>
                            ) : (
                                (shipment.agency.name ?? shipment.agency.id)
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Items</CardTitle>
                </CardHeader>
                <CardContent>
                    {shipment.items.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            This shipment carries no items.
                        </p>
                    ) : (
                        <>
                            <p className="text-muted-foreground mb-3 text-sm">
                                Ids only. Product titles live on the order —{' '}
                                {can('orders.read') ? (
                                    <Link
                                        to={`/dashboard/orders/${shipment.orderId}`}
                                        className="hover:underline"
                                    >
                                        open it
                                    </Link>
                                ) : (
                                    'behind orders.read'
                                )}{' '}
                                to see what is actually in the parcel.
                            </p>
                            <ul className="space-y-1 text-sm">
                                {shipment.items.map((item, index) => (
                                    <li
                                        key={item.orderItemId ?? index}
                                        className="flex flex-wrap gap-2"
                                    >
                                        <span className="font-mono text-xs">
                                            {item.productId ?? 'unknown product'}
                                        </span>
                                        <span className="text-muted-foreground">
                                            × {formatCount(item.quantity)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * The delivery history and every exception on it.
 *
 * Each exception card is **omitted when null**, so an ordinary delivery shows a
 * status history and nothing else, and anything present is by definition worth
 * reading.
 */
export function ShipmentDeliveryPanel({
    shipment,
    timeZone,
    can,
}: {
    shipment: ShipmentDetail;
    timeZone: string;
    can: CanPredicate;
}) {
    const nothingWentWrong =
        shipment.deliveryFailures.length === 0 &&
        shipment.agentCancellation === null &&
        shipment.rejection === null &&
        shipment.handover === null &&
        shipment.hold === null;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Status history</CardTitle>
                </CardHeader>
                <CardContent>
                    {shipment.statusHistory.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
                    ) : (
                        <ol className="space-y-2">
                            {shipment.statusHistory.map((entry, index) => (
                                <li
                                    key={`${entry.status}-${entry.at}-${index}`}
                                    className="flex flex-wrap items-baseline gap-2 text-sm"
                                >
                                    <span className="capitalize">
                                        {(entry.status ?? 'unknown').replace(/_/g, ' ')}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                        {formatInstantInZone(entry.at, timeZone) ?? '—'}
                                    </span>
                                    {entry.byRole ? (
                                        <Badge variant="outline" className="capitalize">
                                            {entry.byRole}
                                        </Badge>
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                    )}
                </CardContent>
            </Card>

            {nothingWentWrong ? (
                <Card>
                    <CardContent className="py-6">
                        <p className="text-muted-foreground text-sm">
                            Nothing has gone wrong on this shipment — no failed attempt, no
                            cancellation, no handover and no hold.
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {shipment.deliveryFailures.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Failed attempts</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {shipment.deliveryFailures.map((failure, index) => (
                            <DefinitionList key={index}>
                                <Definition label="Reason">
                                    {failure.reason ? (
                                        <span className="capitalize">
                                            {humaniseEnum(failure.reason) ?? '—'}
                                        </span>
                                    ) : (
                                        <NotSet />
                                    )}
                                </Definition>
                                <Definition label="Note">{failure.note ?? <NotSet />}</Definition>
                                <Definition label="From status">
                                    {failure.fromStatus ?? <NotSet />}
                                </Definition>
                                <Definition label="Reported by">
                                    {failure.reportedByAgentId ? (
                                        <AgentRef id={failure.reportedByAgentId} can={can} />
                                    ) : (
                                        <NotSet />
                                    )}
                                </Definition>
                                <Definition label="Reported at">
                                    {formatInstantInZone(failure.reportedAt, timeZone) ?? '—'}
                                </Definition>
                            </DefinitionList>
                        ))}
                    </CardContent>
                </Card>
            ) : null}

            {shipment.handover ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Handover</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-muted-foreground text-sm">
                            Where a replacement agent collects. <strong>Textual only</strong> — the
                            geographic point behind it is excluded by the service twice over,
                            because its source is very often the previous agent&apos;s last known
                            GPS position.
                        </p>
                        <DefinitionList>
                            <Definition label="Source">
                                {shipment.handover.source ? (
                                    <span className="capitalize">
                                        {humaniseEnum(shipment.handover.source) ?? '—'}
                                    </span>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Where">
                                {shipment.handover.label ?? <NotSet />}
                            </Definition>
                            <Definition label="Note">
                                {shipment.handover.note ?? <NotSet />}
                            </Definition>
                            <Definition label="Derived fallback">
                                {shipment.handover.isFallback ? 'Yes' : 'No'}
                            </Definition>
                            <Definition label="Taken from">
                                {shipment.handover.fromAgentId ? (
                                    <AgentRef id={shipment.handover.fromAgentId} can={can} />
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Was at">
                                {shipment.handover.fromStatus ?? <NotSet />}
                            </Definition>
                            <Definition label="Reassigned">
                                {formatInstantInZone(shipment.handover.reassignedAt, timeZone) ??
                                    '—'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            {shipment.agentCancellation ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Cancelled by the agent</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Reason">
                                {shipment.agentCancellation.reason ?? <NotSet />}
                            </Definition>
                            <Definition label="Note">
                                {shipment.agentCancellation.note ?? <NotSet />}
                            </Definition>
                            <Definition label="Agent">
                                {shipment.agentCancellation.cancelledByAgentId ? (
                                    <AgentRef
                                        id={shipment.agentCancellation.cancelledByAgentId}
                                        can={can}
                                    />
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="From status">
                                {shipment.agentCancellation.fromStatus ?? <NotSet />}
                            </Definition>
                            <Definition label="When">
                                {formatInstantInZone(
                                    shipment.agentCancellation.cancelledAt,
                                    timeZone,
                                ) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            {shipment.rejection ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Rejected</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Reason">
                                {shipment.rejection.reason ? (
                                    <span className="capitalize">
                                        {humaniseEnum(shipment.rejection.reason) ?? '—'}
                                    </span>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Note">
                                {shipment.rejection.note ?? <NotSet />}
                            </Definition>
                            <Definition
                                label="By"
                                hint={
                                    <InfoHint label="About who rejected it">
                                        The source says which database the id resolves in. An
                                        administrator&apos;s id resolves in neither the platform
                                        database nor as a platform user, so their name is the only
                                        readable record.
                                    </InfoHint>
                                }
                            >
                                <span className="flex flex-wrap items-center gap-2">
                                    {shipment.rejection.by.name ?? 'Not recorded'}
                                    {isPlatformActor(shipment.rejection.by) ? null : (
                                        <Badge variant="outline">administrator</Badge>
                                    )}
                                </span>
                            </Definition>
                            <Definition label="When">
                                {formatInstantInZone(shipment.rejection.at, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            {shipment.hold ? (
                <Card>
                    <CardHeader>
                        <CardTitle>On hold</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground mb-3 flex items-start gap-2 text-sm">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            Frozen by the agency-deactivation cascade. The previous status is kept
                            so it can be put back.
                        </p>
                        <DefinitionList>
                            <Definition label="Was at">
                                {shipment.hold.previousStatus ?? <NotSet />}
                            </Definition>
                            <Definition label="Since">
                                {formatInstantInZone(shipment.hold.heldAt, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            {shipment.customerConfirmation ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Customer confirmation</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Confirmed">
                                {formatInstantInZone(
                                    shipment.customerConfirmation.confirmedAt,
                                    timeZone,
                                ) ?? '—'}
                            </Definition>
                            <Definition label="By">
                                {shipment.customerConfirmation.confirmedBy ?? <NotSet />}
                            </Definition>
                            <Definition label="How">
                                {shipment.customerConfirmation.auto
                                    ? 'Automatically'
                                    : 'Confirmed by the customer'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}

/** The cash block. Rendered only when there is one. */
export function ShipmentCodPanel({
    shipment,
    timeZone,
}: {
    shipment: ShipmentDetail;
    timeZone: string;
}) {
    if (shipment.cod === null) {
        return (
            <Card>
                <CardContent className="py-6">
                    <p className="text-sm">
                        <NotApplicable>
                            This shipment carries no cash collection — the order was paid online.
                        </NotApplicable>
                    </p>
                </CardContent>
            </Card>
        );
    }

    const cod = shipment.cod;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Cash on delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                    The cash state — <strong>never the delivery code</strong>. Submitting that code
                    is the only way a cash shipment reaches delivered, so it is a bearer credential
                    over somebody else&apos;s money and the service refuses to return it. What is
                    here is whether the code worked and whether it locked.
                </p>
                <DefinitionList>
                    <Definition label="Collection">
                        <span className="font-mono text-xs">{cod.collectionId}</span>
                    </Definition>
                    <Definition label="State">
                        <span className="capitalize">{humaniseEnum(cod.status) ?? '—'}</span>
                    </Definition>
                    <Definition label="Expected">
                        {formatMoney(cod.expectedAmount, cod.currency)}
                    </Definition>
                    <Definition label="Collected">
                        {formatInstantInZone(cod.collectedAt, timeZone) ?? 'Not yet'}
                    </Definition>
                    <Definition
                        label="Verified by"
                        hint={
                            <InfoHint label="About verification">
                                Whether the customer&apos;s code was used or the delivery was
                                accepted without one. This is the fact a delivery dispute turns on.
                            </InfoHint>
                        }
                    >
                        {cod.verificationMethod ? (
                            <span className="capitalize">
                                {humaniseEnum(cod.verificationMethod) ?? '—'}
                            </span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>
                    <Definition label="Code attempts">
                        <span className="flex flex-wrap items-center gap-2">
                            {formatCount(cod.codeAttempts)}
                            {cod.codeLocked ? (
                                <Badge
                                    variant="outline"
                                    className="border-destructive/30 bg-destructive/10 text-destructive"
                                >
                                    Locked
                                </Badge>
                            ) : null}
                        </span>
                    </Definition>
                    <Definition label="Settled">
                        {cod.settledAmount === null
                            ? 'Not settled'
                            : `${formatMoney(cod.settledAmount, cod.currency)} · ${
                                  formatInstantInZone(cod.settledAt, timeZone) ?? ''
                              }`}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/**
 * An agent id, wherever one appears on this surface.
 *
 * One component for all five places — `agent.id`, `offers[].agentId`,
 * `deliveryFailures[].reportedByAgentId`, `agentCancellation.cancelledByAgentId`
 * and `handover.fromAgentId` — so the link and the fallback cannot diverge.
 */
export function AgentRef({
    id,
    name,
    can,
}: {
    id: string;
    name?: string | null;
    can: CanPredicate;
}) {
    const label = name ?? id;

    if (!can('agents.read')) {
        return <span className={name ? undefined : 'font-mono text-xs'}>{label}</span>;
    }

    return (
        <Link
            to={`/dashboard/agents/${id}`}
            className={name ? 'hover:underline' : 'font-mono text-xs hover:underline'}
        >
            {label}
        </Link>
    );
}
