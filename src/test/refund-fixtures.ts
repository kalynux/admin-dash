import type { RefundEligibility, RefundRequest } from '@/types/refunds.types';

/**
 * Wire-shaped refund queue fixtures, from wi-admin's `refund-request.dto.ts`
 * (`toRefundRequestDto`, detail view) and the eligibility example in
 * `refunds.md`. Every key present, absent data `null` — as the DTO emits.
 */

export const REFUND_ID = '6701a0b2c3d4e5f6a7b8c901';
export const REFUND_ORDER_ID = '66f3a1b2c3d4e5f6a7b8c944';

export function refundRequestFixture(overrides: Partial<RefundRequest> = {}): RefundRequest {
    return {
        id: REFUND_ID,
        source: { kind: 'order', id: REFUND_ORDER_ID, number: 'WM-2026-001234' },
        vendor: { id: '66f2a1b2c3d4e5f6a7b8c933', name: 'Chez Awa' },
        customerId: '66f0a1b2c3d4e5f6a7b8c901',
        reasonKind: 'return',
        reason: 'Sandals arrived with a broken strap',
        itemDefective: true,
        overridePolicy: false,
        earningsImpact: 'clawback',
        attribution: { goods: 5000, delivery: 0 },
        grossAmount: 5000,
        feeRate: 2,
        feeAmount: 100,
        netAmount: 4900,
        currency: 'XAF',
        paymentChannel: 'mobile_money',
        channel: 'payout',
        destination: { phone: '+237690004417', name: 'Awa N.', source: 'payer' },
        destinationProofFileId: null,
        secondApproverRequired: false,
        codCollectionIds: [],
        status: 'awaiting_approval',
        requestedBy: { id: '6650a1b2c3d4e5f6a7b8c9aa', role: 'support', name: 'Support Agent' },
        approvedBy: null,
        rejectedBy: null,
        rejectionReason: null,
        transfer: { gateway: null, gatewayRef: null, failureReason: null, note: null, legs: [] },
        externalSettlement: null,
        ticketId: null,
        refundTransactionIds: [],
        completedAt: null,
        earningsSettledAt: null,
        billingReversedAt: null,
        createdAt: '2026-10-05T10:00:00.000Z',
        updatedAt: '2026-10-05T10:00:00.000Z',
        ...overrides,
    };
}

/** A COD order refund to a TYPED number — R-7 applies. */
export function typedRefundRequestFixture(overrides: Partial<RefundRequest> = {}): RefundRequest {
    return refundRequestFixture({
        paymentChannel: 'cod',
        channel: null,
        destination: { phone: '+237677001122', name: 'Awa N.', source: 'typed' },
        destinationProofFileId: '6702a1b2c3d4e5f6a7b8c999',
        secondApproverRequired: true,
        requestedBy: { id: '6650a1b2c3d4e5f6a7b8c9bb', role: 'admin', name: 'Ops Admin' },
        ...overrides,
    });
}

export function refundListMetaFixture(total = 1) {
    return { total, page: 1, limit: 20, pages: total === 0 ? 0 : 1 };
}

/** `GET /refunds/eligibility` for a mobile-money order with the payer's number on record. */
export function refundEligibilityFixture(overrides: Partial<RefundEligibility> = {}): RefundEligibility {
    return {
        sourceKind: 'order',
        sourceId: REFUND_ORDER_ID,
        maxRefundable: 6000,
        currency: 'XAF',
        paymentChannel: 'mobile_money',
        hasPayerPhone: true,
        payerPhoneMasked: '+•••••••••417',
        attributionPreview: {
            reasonKind: 'cancellation',
            itemDefective: null,
            goods: 5000,
            delivery: 1000,
            goodsAmount: 5000,
            deliveryAmountPaid: 1000,
            delivered: false,
            remaining: 6000,
            feeAmount: 120,
            netAmount: 5880,
            byReasonKind: {
                cancellation: { maxRefundable: 6000, goods: 5000, delivery: 1000, feeAmount: 120, netAmount: 5880 },
                return: { maxRefundable: 5000, goods: 5000, delivery: 0, feeAmount: 100, netAmount: 4900 },
                goodwill: { maxRefundable: 6000, goods: 5000, delivery: 1000, feeAmount: 120, netAmount: 5880 },
                dispute_settlement: {
                    maxRefundable: 6000,
                    goods: 5000,
                    delivery: 1000,
                    feeAmount: 120,
                    netAmount: 5880,
                },
            },
        },
        returnShippingPayer: 'vendor',
        overrides: [],
        codCoverage: [],
        feePercent: 2,
        ...overrides,
    };
}

/** Cash on delivery: no payer number, so the form asks for a typed one and its picture. */
export function codRefundEligibilityFixture(overrides: Partial<RefundEligibility> = {}): RefundEligibility {
    return refundEligibilityFixture({
        paymentChannel: 'cod',
        hasPayerPhone: false,
        payerPhoneMasked: null,
        ...overrides,
    });
}
