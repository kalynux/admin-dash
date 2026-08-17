/**
 * Shipment fixtures.
 *
 * Wire-shaped. Four detail blocks have no published shape at all — `handover`,
 * `agentCancellation`, `customerConfirmation` and `hold` — and these follow the
 * DTO. `rejection.by.source` is `'platform' | 'admin'`, never the `"wi-admin"` the
 * docs show.
 */

import type {
    OutboxHealth,
    Shipment,
    ShipmentCod,
    ShipmentDetail,
    ShipmentOffer,
} from '@/types/shipments.types';

const SHIPMENT_ID = '6671aabbccddeeff00112233';
const AGENT_ID = '6660112233445566778899aa';

/** Dispatched to an agency and accepted — the state cancel can still reach. */
export function shipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
    return {
        id: SHIPMENT_ID,
        trackingNumber: 'ACR-260812-103000-4K7QP',
        status: 'assigned',
        orderId: '6670aabbccddeeff00112233',
        orderNumber: 'ORD-2026-008841',
        agency: { id: '665c0011223344556677889a', name: 'Littoral Express' },
        agent: { id: AGENT_ID, name: 'Eric T.' },
        assignmentState: 'accepted',
        held: false,
        itemCount: 3,
        deliveryFeeSnapshot: 1500,
        createdAt: '2026-08-12T10:30:00.000Z',
        updatedAt: '2026-08-12T11:02:00.000Z',
        ...overrides,
    };
}

/** Past pickup — cancel must be disabled, and reassign needs a named agent. */
export function pickedUpShipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
    return shipmentFixture({ status: 'picked_up', ...overrides });
}

/** Frozen by the agency-deactivation cascade — and it still has an agent. */
export function heldShipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
    return shipmentFixture({ id: '6671aabbccddeeff00112240', held: true, ...overrides });
}

/** Out on offer, nobody has accepted. */
export function unassignedShipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
    return shipmentFixture({
        id: '6671aabbccddeeff00112241',
        agent: null,
        assignmentState: 'offered',
        ...overrides,
    });
}

export function offerFixture(overrides: Partial<ShipmentOffer> = {}): ShipmentOffer {
    return {
        id: '6673aabbccddeeff00112233',
        agentId: AGENT_ID,
        agentName: 'Eric T.',
        status: 'accepted',
        origin: 'auto_assignment',
        round: 2,
        sessionId: '6676aabbccddeeff00112233',
        createdBy: null,
        expiresAt: '2026-08-12T11:05:00.000Z',
        respondedAt: '2026-08-12T11:02:00.000Z',
        rejectionReason: null,
        createdAt: '2026-08-12T11:00:00.000Z',
        ...overrides,
    };
}

export function codBlockFixture(overrides: Partial<ShipmentCod> = {}): ShipmentCod {
    return {
        collectionId: '6674aabbccddeeff00112233',
        status: 'pending',
        expectedAmount: 27500,
        currency: 'XAF',
        collectedAt: null,
        verificationMethod: 'delivery_code',
        codeAttempts: 1,
        codeLocked: false,
        settledAmount: null,
        settledAt: null,
        ...overrides,
    };
}

/** Healthy by default — `failed: 0` and a recent event. */
export function outboxHealthFixture(overrides: Partial<OutboxHealth> = {}): OutboxHealth {
    return {
        pending: 0,
        failed: 0,
        lastEventAt: '2026-08-12T11:02:01.000Z',
        lastError: null,
        ...overrides,
    };
}

export function shipmentDetailFixture(
    overrides: Partial<ShipmentDetail> = {},
): ShipmentDetail {
    return {
        ...shipmentFixture(),
        order: {
            id: '6670aabbccddeeff00112233',
            orderNumber: 'ORD-2026-008841',
            paymentMethod: 'cash_on_delivery',
            paymentStatus: 'pending',
            fulfillmentStatus: 'processing',
            customerId: '665f1c2a9b3e4a91c7d2e5f0',
            vendorId: '6650aa11bb22cc33dd44ee55',
        },
        assignment: {
            state: 'accepted',
            currentOfferId: '6673aabbccddeeff00112233',
            offeredAgentId: AGENT_ID,
            updatedAt: '2026-08-12T11:02:00.000Z',
            offerCount: 4,
        },
        statusHistory: [
            { status: 'pending', at: '2026-08-12T10:30:00.000Z', byUserId: null, byRole: 'system' },
            {
                status: 'assigned',
                at: '2026-08-12T11:02:00.000Z',
                byUserId: AGENT_ID,
                byRole: 'agent',
            },
        ],
        handover: null,
        deliveryFailures: [],
        agentCancellation: null,
        rejection: null,
        customerConfirmation: null,
        hold: null,
        cod: codBlockFixture(),
        offers: [offerFixture()],
        items: [
            {
                orderItemId: '6670aabbccddeeff00112240',
                productId: '66601122334455667788990a',
                variantId: null,
                quantity: 3,
            },
        ],
        deliveryProofFileId: null,
        tracking: { outbox: outboxHealthFixture() },
        ...overrides,
    };
}

/**
 * A shipment an administrator pulled back.
 *
 * `rejection.by.source` is `'admin'` — the id resolves in neither the platform
 * database nor as a platform user, so the name is the only readable record.
 */
export function rejectedShipmentDetailFixture(
    overrides: Partial<ShipmentDetail> = {},
): ShipmentDetail {
    return shipmentDetailFixture({
        status: 'rejected',
        rejection: {
            reason: 'platform_intervention',
            note: 'Agency deactivated mid-route — re-routing to Wouri Logistics',
            at: '2026-08-12T17:00:00.000Z',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin', name: 'Ada Nkemelu' },
        },
        ...overrides,
    });
}

/** `meta` on `GET /shipments`. `searchMatchesTruncated` is absent unless set. */
export function shipmentListMetaFixture(
    overrides: Partial<{
        total: number;
        page: number;
        limit: number;
        pages: number;
        searchMatchesTruncated: true;
    }> = {},
) {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}
