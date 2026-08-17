/**
 * Order fixtures.
 *
 * Wire-shaped: what the server actually sends, not what `orders.md` says it sends.
 * The nullable `priceBreakdown` / `completion` and the absent-when-never-disputed
 * `dispute` are the three the docs get wrong, and the fixtures follow the code.
 */

import type {
    Order,
    OrderDetail,
    OrderTimelineEntry,
    RefundEligibility,
    RefundResult,
} from '@/types/orders.types';

/** An ordinary cash-on-delivery order, mid-fulfilment, never disputed. */
export function orderFixture(overrides: Partial<Order> = {}): Order {
    return {
        id: '6670aabbccddeeff00112233',
        orderNumber: 'ORD-2026-008841',
        type: 'physical',
        checkoutGroupId: '6670aabbccddeeff00112200',
        vendorId: '6650aa11bb22cc33dd44ee55',
        vendorName: 'Douala Fresh Market',
        customerId: '665f1c2a9b3e4a91c7d2e5f0',
        customerName: 'Amina B.',
        currency: 'XAF',
        totalAmount: 27500,
        paymentMethod: 'cash_on_delivery',
        paymentStatus: 'pending',
        fulfillmentStatus: 'processing',
        disputeHeld: false,
        completedAt: null,
        itemCount: 3,
        createdAt: '2026-08-12T09:14:00.000Z',
        updatedAt: '2026-08-13T07:02:00.000Z',
        ...overrides,
    };
}

/** Frozen by a payment dispute. */
export function disputedOrderFixture(overrides: Partial<Order> = {}): Order {
    return orderFixture({
        id: '6670aabbccddeeff00112299',
        orderNumber: 'ORD-2026-008902',
        paymentStatus: 'disputed',
        disputeHeld: true,
        ...overrides,
    });
}

export function orderDetailFixture(overrides: Partial<OrderDetail> = {}): OrderDetail {
    return {
        ...orderFixture(),
        priceBreakdown: { base: 25000, tax: 1250, discount: 0, total: 27500 },
        paymentIntentId: 'pi_9f2b8c1a',
        // **`null` when never disputed** — absent entirely, not a block of nulls.
        dispute: null,
        completion: { confirmedAt: null, confirmedBy: null, auto: false },
        deliveryAddress: {
            formattedAddress: 'Rue Njo-Njo 14, Bonapriso, Douala, Littoral, CM',
            components: { city: 'Douala', state: 'Littoral', country: 'CM' },
        },
        items: [
            {
                id: '6670aabbccddeeff00112240',
                productId: '66601122334455667788990a',
                variantId: null,
                sku: 'PLT-1KG',
                title: 'Plantain — 1 kg',
                variantTitle: null,
                optionsSnapshot: null,
                productType: 'physical',
                quantity: 3,
                price: 2500,
                currency: 'XAF',
                delivery: {
                    agencyId: '665c0011223344556677889a',
                    shipmentId: '6671aabbccddeeff00112233',
                    status: 'assigned',
                    freeDelivery: false,
                    hold: null,
                    pickup: {
                        source: 'vendor_address',
                        vendorAddressId: '6650aa11bb22cc33dd44ee56',
                        agencyAddressId: null,
                    },
                },
            },
        ],
        ...overrides,
    };
}

/** A dispute that was opened and settled — `active: false`, block present. */
export function resolvedDisputeOrderFixture(
    overrides: Partial<OrderDetail> = {},
): OrderDetail {
    return orderDetailFixture({
        paymentStatus: 'paid',
        dispute: {
            active: false,
            disputedAt: '2026-08-01T10:00:00.000Z',
            resolvedAt: '2026-08-04T16:20:00.000Z',
            gatewayDisputeId: 'dp_44127',
            reason: 'item_not_received',
        },
        ...overrides,
    });
}

/** An open dispute — the only state that makes Resolve worth offering. */
export function openDisputeOrderFixture(overrides: Partial<OrderDetail> = {}): OrderDetail {
    return orderDetailFixture({
        paymentStatus: 'disputed',
        disputeHeld: true,
        dispute: {
            active: true,
            disputedAt: '2026-08-11T10:00:00.000Z',
            resolvedAt: null,
            gatewayDisputeId: 'dp_44190',
            reason: 'item_not_received',
        },
        ...overrides,
    });
}

export function timelineEntryFixture(
    overrides: Partial<OrderTimelineEntry> = {},
): OrderTimelineEntry {
    return {
        id: '6672aabbccddeeff00112233',
        eventType: 'payment.updated',
        description: 'Payment marked paid via MTN MoMo',
        actorType: 'system',
        actorId: null,
        metadata: { gateway: 'mtn_momo', reference: 'MP260812.1402.A44127' },
        occurredAt: '2026-08-12T14:02:31.000Z',
        ...overrides,
    };
}

/**
 * A refundable online order, with the vendor's window already expired.
 *
 * `overrides` is non-empty, which is the state the override checkbox exists for.
 */
export function refundEligibilityFixture(
    overrides: Partial<RefundEligibility> = {},
): RefundEligibility {
    return {
        eligible: true,
        maxRefundable: 27500,
        remaining: 27500,
        currency: 'XAF',
        gateway: 'STRIPE',
        gatewayRefundSupported: true,
        isCod: false,
        vendorPolicy: {
            eligible: false,
            maxRefundable: 13750,
            remaining: 13750,
            currency: 'XAF',
            reasonCode: 'RETURN_WINDOW_EXPIRED',
            refundProcessingDays: 7,
            returnShippingPayer: 'customer',
        },
        overrides: ['RETURN_WINDOW_EXPIRED', 'PARTIAL_REFUND_PERCENTAGE'],
        ...overrides,
    };
}

/** Nothing to override — the checkbox must not appear. */
export function cleanRefundEligibilityFixture(
    overrides: Partial<RefundEligibility> = {},
): RefundEligibility {
    return refundEligibilityFixture({
        vendorPolicy: {
            eligible: true,
            maxRefundable: 27500,
            remaining: 27500,
            currency: 'XAF',
            refundProcessingDays: 7,
            returnShippingPayer: 'vendor',
        },
        overrides: [],
        ...overrides,
    });
}

export function refundResultFixture(overrides: Partial<RefundResult> = {}): RefundResult {
    return {
        refundId: 'rf_66739911',
        status: 'completed',
        amount: 27500,
        currency: 'XAF',
        totalRefunded: 27500,
        fullyRefunded: true,
        withinVendorPolicy: false,
        overrides: ['RETURN_WINDOW_EXPIRED'],
        ...overrides,
    };
}

/** `meta` on `GET /orders`. `searchMatchesTruncated` is **absent** unless set. */
export function orderListMetaFixture(
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
