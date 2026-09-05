import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import {
    AssignmentStateBadge,
    ShipmentStatusBadge,
} from '@/components/shipments/ShipmentStatusBadge';
import { CopyableValue } from '@/components/common/CopyableValue';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { LineItemImage } from '@/components/common/LineItemImage';
import { PartyValue } from '@/components/common/PartyValue';
import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { resolvePartyName } from '@/lib/party';
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
                            {/*
                              ⚠ `plain`, and it must stay `plain`. `GET
                              /shipments?search=` matches a tracking-number
                              **prefix**, so copying this and pasting it into that
                              box is the whole workflow this value exists for — a
                              head-and-tail form would be a string that matches
                              nothing. Mono because it is a machine value, even
                              though it was not mono before: the affordance beside
                              it now invites character-by-character reading.

                              Its own null branch stays: "not minted yet" is a
                              stage of the shipment's life, not a missing field.
                            */}
                            {shipment.trackingNumber ? (
                                <CopyableValue
                                    variant="plain"
                                    mono
                                    value={shipment.trackingNumber}
                                    label="tracking number"
                                />
                            ) : (
                                <NotSet>Not minted yet</NotSet>
                            )}
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
                            {/*
                              ⚠ **This is the reason `ImageBox` exists**, and the
                              upgrade from `ResolvedFileViewer` is the whole of it:
                              a delivery proof is a photograph, and a button
                              labelled "Open the file" is not how anybody looks at
                              one. The box is drawn at the picture's size before
                              anything loads, and the click is still the consent —
                              `deliveryProofFileId` resolves with `url: null` and
                              `access: "authorized"`, so the audited content route
                              is the only way to see it and the box says the open
                              is recorded *before* it happens.

                              A non-image still falls through to the metadata card:
                              `ResolvedImageBox` reads the resolve's own type and
                              hands anything that is not an image to `FileViewer`,
                              without spending an audited read to find out.
                            */}
                            {shipment.deliveryProofFileId ? (
                                <ResolvedImageBox
                                    fileId={shipment.deliveryProofFileId}
                                    alt="the delivery proof"
                                    className="max-w-sm"
                                />
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
                        <Definition
                            label="Vendor"
                            hint={
                                <InfoHint label="Which name this is">
                                    The shop&apos;s registered business name. The orders list shows
                                    a different field of the same name — the vendor&apos;s own
                                    personal name — so the two screens can legitimately call one
                                    vendor two things.
                                </InfoHint>
                            }
                        >
                            {/*
                              ⚠ **This hint used to explain a request.** It said
                              the payload "carries the vendor's id and no name" and
                              that the name cost a second read — true when it was
                              written, false from BR-016 § 6 onwards, and it kept
                              saying so after the field arrived. The read is gone;
                              what is worth saying now is *which* name this is,
                              because the orders list shows the other one.
                            */}
                            <VendorRef
                                vendorId={shipment.order?.vendorId ?? null}
                                vendorName={shipment.order?.vendorName ?? null}
                                can={can}
                            />
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
                    <CardTitle className="flex items-center gap-1">
                        Items
                        <InfoHint label="Where these titles and prices come from">
                            <p>
                                A shipment line carries ids and a quantity. The title, the price
                                and the picture are read from the vendor&apos;s listing, one
                                request per distinct product, and need the vendor catalogue
                                permission.
                            </p>
                            {/*
                              ⚠ Money, so said plainly rather than implied by the
                              per-row "listed" suffix alone. A listing's price is
                              today's; what the customer paid is on the order
                              line, which every row links to.
                            */}
                            <p>
                                <strong>
                                    A listed price is what the item costs now, not what was
                                    charged.
                                </strong>{' '}
                                Open the order line for the figure that settles a money question.
                            </p>
                        </InfoHint>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ShipmentItems shipment={shipment} can={can} />
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
                        {/* The handle on this cash in the `/cod` module, and the
                            record carries no other name for it. Shown whole. */}
                        <CopyableValue
                            variant="id"
                            value={cod.collectionId}
                            label="collection ID"
                            truncate={false}
                        />
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
 *
 * ── ⚠ The copy affordance is on the id branch only ────────────────────────────
 * Where a name arrived, the name is what is rendered, and a copy button beside a
 * name copies the *name* — which is not a value anybody pastes into a search box,
 * a ticket or a Mongo query. Pairing the two is the naming phase's job. Here, the
 * branch that already shows nothing but a 24-hex id is the one that gains a way
 * to take it.
 *
 * `truncate={false}` because every one of these sites renders the id in full
 * today, in a definition list or a table cell with room for it. The affordance is
 * additive; it must not quietly take characters away.
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
    if (!name) {
        return (
            <CopyableValue
                variant="id"
                value={id}
                label="agent ID"
                truncate={false}
                to={can('agents.read') ? `/dashboard/agents/${id}` : undefined}
            />
        );
    }

    if (!can('agents.read')) {
        return <span>{name}</span>;
    }

    return (
        <Link to={`/dashboard/agents/${id}`} className="hover:underline">
            {name}
        </Link>
    );
}

/**
 * The vendor behind the order, by name.
 *
 * ── ✅ This used to be a request, and now it is a field ──────────────────────
 * Phase C paid one `GET /vendors/:vendorId` for this name, behind `vendors.read`
 * and with three states because a read can fail. BR-016 § 6 was granted and
 * `order.vendorName` is on the shipment payload, so the read is gone and so are
 * two of the states: the name either came with the record or does not exist.
 *
 * ⚠ **It is `stores.name` — the vendor's BUSINESS name.** Not the same source as
 * `GET /orders`'s field of the same spelling, which is `vendors.display_name`,
 * a *person*. Sourced as `businessName` here so `PartyValue` can never label it
 * as anything else, and so the two fields cannot be quietly unified later.
 *
 * `null` where the vendor has no Store row — mid-onboarding, an ordinary state —
 * and the id is the honest answer there, exactly as it was when a read failed.
 * The id was always the load-bearing half; the name is a convenience on top.
 */
function VendorRef({ vendorId, vendorName, can }: {
    vendorId: string | null;
    vendorName: string | null;
    can: CanPredicate;
}) {
    if (!vendorId) return <NotSet />;

    const to = can('vendors.read') ? `/dashboard/vendors/${vendorId}` : undefined;

    return (
        <PartyValue
            party={resolvePartyName(
                [{ source: 'businessName', value: vendorName }],
                { source: 'id', value: vendorId },
            )}
            id={vendorId}
            idLabel="vendor ID"
            to={to}
        />
    );
}

/**
 * What is actually in the parcel.
 *
 * ── The card used to say "ids only", and then it said too much ───────────────
 * A shipment item once carried `orderItemId`, `productId`, `variantId` and a
 * quantity and nothing else — `6670…40 × 3` on the screen an operator opens
 * mid-dispute. Phase C filled that in by resolving
 * `GET /vendors/:vendorId/products/:productId` per distinct listing, which was
 * the only door open at the time.
 *
 * ✅ **BR-017 put `title`, `price`, `currency` and `image` on the payload**, so
 * the lookup is gone. It is not merely cheaper — **it is more correct**. The
 * catalogue could only ever quote *today's listed* price, which the old card had
 * to label "listed" and caveat, because what the customer actually paid was not
 * reachable from it. These four are joined from the **order line's own
 * snapshot**, so this card now shows the terms of the sale.
 *
 * ⚠ **Batched upstream**: the titles are one read of the order document these
 * items already belong to, and the images are the same three reads the order
 * detail makes, however many lines the shipment has.
 *
 * ── ⚠ The links do not depend on any read ────────────────────────────────────
 * Both are built from ids this component already holds, so they ship whether or
 * not the caller holds `vendors.read`. A screen that loses its navigation
 * because an enrichment failed is worse than one that never had it.
 */
function ShipmentItems({ shipment, can }: { shipment: ShipmentDetail; can: CanPredicate }) {
    const vendorId = shipment.order?.vendorId ?? null;

    if (shipment.items.length === 0) {
        return <p className="text-muted-foreground text-sm">This shipment carries no items.</p>;
    }

    return (
        <ul className="space-y-4">
            {shipment.items.map((item, index) => {
                /*
                  ⚠ The order line, not the product. `orderItemId` identifies
                  *this parcel's* line in the order it came from, which is the
                  only way back to what the customer actually paid — the price on
                  a listing today is not what was charged then.
                */
                const orderItemHref = item.orderItemId
                    ? `/dashboard/orders/${shipment.orderId}?tab=items&item=${item.orderItemId}`
                    : `/dashboard/orders/${shipment.orderId}?tab=items`;

                const productHref =
                    vendorId && item.productId && can('vendors.read')
                        ? `/dashboard/vendors/${vendorId}/products/${item.productId}`
                        : undefined;

                return (
                    <li key={item.orderItemId ?? index} className="flex flex-col gap-3 sm:flex-row">
                        <div className="w-full shrink-0 sm:w-32">
                            <LineItemImage image={item.image} alt={item.title || 'this item'} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                            <p className="font-medium">
                                {item.title ? (
                                    productHref ? (
                                        <Link to={productHref} className="hover:underline">
                                            {item.title}
                                        </Link>
                                    ) : (
                                        item.title
                                    )
                                ) : (
                                    /* ⚠ A sentence, not a gap — and the two are
                                       different facts. No `productId` is a broken
                                       row; a `null` title means the ORDER LINE is
                                       gone, because the title is joined from it
                                       rather than refreshed from the catalogue. */
                                    <NotSet>
                                        {item.productId
                                            ? 'The order line behind this is gone'
                                            : 'No product on this line'}
                                    </NotSet>
                                )}
                            </p>

                            <p className="text-muted-foreground">
                                × {formatCount(item.quantity)}
                                {/*
                                  ⚠ **What was charged, not what is listed.** This
                                  is the order line's own snapshot, so it needs no
                                  "listed" caveat and no variant lookup — the card
                                  used to carry both because the catalogue price
                                  was the only one it could reach.
                                */}
                                {item.price !== null ? (
                                    <> · {formatMoney(item.price, item.currency)}</>
                                ) : null}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                {item.productId ? (
                                    <CopyableValue
                                        variant="id"
                                        value={item.productId}
                                        label="product ID"
                                        truncate={false}
                                        to={productHref}
                                    />
                                ) : null}
                                {can('orders.read') ? (
                                    <Link
                                        to={orderItemHref}
                                        className="text-muted-foreground text-xs hover:underline"
                                    >
                                        This line on the order
                                    </Link>
                                ) : null}
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
