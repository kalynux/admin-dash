/**
 * Wire-shaped fixtures for `/money` and the account sub-ledgers.
 *
 * Every one of these is shaped from the **backend DTO**, not from the doc
 * examples, because four of them disagree — see `types/money.types.ts` for the
 * list. In particular `full` is `null` on a masked destination, not an object of
 * nulls, and `PayoutDestination` carries `revealed`, which no doc example shows.
 */

import type { CashLedgerEntry, CreditLedgerEntry } from '@/types/accounts.types';
import type { DeliveryFeeRefund, Payout, PayoutDestination } from '@/types/money.types';

/**
 * A masked destination, as every endpoint but the audited disclosure sends one.
 *
 * The digits are `null` because the projection never named the number columns —
 * an operator recognises this by "MTN · Nadège Mbarga".
 */
export function maskedDestinationFixture(
    overrides: Partial<PayoutDestination> = {},
): PayoutDestination {
    return {
        method: 'mobile_money',
        isPreferred: true,
        masked: {
            mobileMoney: {
                provider: 'MTN',
                phoneNumberMasked: null,
                accountName: 'Nadège Mbarga',
            },
            bank: null,
            card: null,
        },
        full: null,
        revealed: false,
        ...overrides,
    };
}

/** The same destination after the audited reveal — `full` populated, `revealed` true. */
export function revealedDestinationFixture(
    overrides: Partial<PayoutDestination> = {},
): PayoutDestination {
    return {
        method: 'mobile_money',
        isPreferred: true,
        masked: {
            mobileMoney: {
                provider: 'MTN',
                phoneNumberMasked: '••••3456',
                accountName: 'Nadège Mbarga',
            },
            bank: null,
            card: null,
        },
        full: { mobileMoney: { phoneNumber: '+237677003456' }, bank: null, card: null },
        revealed: true,
        ...overrides,
    };
}

/**
 * A card destination disclosed: `revealed` true, every `full` member `null`.
 *
 * The case a client that infers disclosure from `full` renders as a failure.
 */
export function revealedCardDestinationFixture(): PayoutDestination {
    return {
        method: 'card',
        isPreferred: true,
        masked: {
            mobileMoney: null,
            bank: null,
            card: {
                brand: 'VISA',
                last4: '4242',
                numberMasked: '•••• •••• •••• 4242',
                cardHolderName: 'Jean Dupont',
                expiryMonth: 11,
                expiryYear: 2029,
                issuingBank: 'Afriland First Bank',
                country: 'CM',
            },
        },
        full: { mobileMoney: null, bank: null, card: null },
        revealed: true,
    };
}

/** A pending payout below the four-eyes threshold. */
export function payoutFixture(overrides: Partial<Payout> = {}): Payout {
    return {
        id: '66a2aabbccddeeff00112233',
        owner: { type: 'agency', id: '665c0011223344556677889a', name: 'Littoral Express' },
        amount: 340000,
        currency: 'XAF',
        status: 'pending',
        origin: 'auto_threshold',
        destination: maskedDestinationFixture(),
        /*
          ⚠ **`pending`, not `verified`, is the honest default for a fixture.**
          Vendor and agency default to `pending` on registration, so most rows in
          a real queue are unvetted — a fixture that defaulted to verified would
          make the safe path the one nothing is tested against.
        */
        verification: { verified: false, verdict: 'pending' },
        /*
          ⚠ **`null`, and this is the honest default for the same reason as
          `verification` above.** Endorsement is advisory (ADR-024 D-2) — a payout
          nobody has endorsed is exactly as payable as one that has been, and an
          empty Support queue is the ordinary case. A fixture that arrived
          pre-endorsed would test every pay control against the state where a
          mistaken gate is invisible.
        */
        triage: null,
        // Raw, as wi-admin passes it: `null` on a payout never attempted.
        transferGateway: null,
        transferGatewayRef: null,
        transferFailureReason: null,
        ticketId: null,
        requestedByUserId: null,
        resolvedAt: null,
        resolvedBy: null,
        paidReference: null,
        rejectionReason: null,
        createdAt: '2026-08-13T00:10:00.000Z',
        updatedAt: '2026-08-13T00:10:00.000Z',
        ...overrides,
    };
}

/** At or above 2,000,000 XAF — marking this paid answers `202`, not `200`. */
export function largePayoutFixture(overrides: Partial<Payout> = {}): Payout {
    return payoutFixture({ amount: 3_400_000, ...overrides });
}

/**
 * A payout predating the destination snapshot.
 *
 * `destination: null` is a different fact from a destination with no details, and
 * there is nothing here to reveal.
 */
export function legacyPayoutFixture(overrides: Partial<Payout> = {}): Payout {
    return payoutFixture({ destination: null, ...overrides });
}

export function resolvedPayoutFixture(overrides: Partial<Payout> = {}): Payout {
    return payoutFixture({
        status: 'paid',
        resolvedAt: '2026-08-14T09:00:00.000Z',
        resolvedBy: { id: '665b112233445566778899bb', source: 'admin', name: 'Awa N.' },
        paidReference: 'AFRILAND/TRF/2026-08-13/00412',
        ...overrides,
    });
}

export function payoutListMetaFixture(overrides: Record<string, unknown> = {}) {
    return { total: 17, page: 1, limit: 20, pages: 1, ...overrides };
}

/**
 * One row of `GET /money/earnings/accounts` in jovi-mall's **flat** shape.
 *
 * ⚠ Kept as the LEGACY shape: wi-admin has served the hydrated
 * {@link servedEarningsAccountRowFixture} since 2026-08-18, and this fixture —
 * built from jovi-mall's mapper — is why no test noticed the directory dropped
 * every real row.
 */
export function earningsAccountRowFixture(overrides: Record<string, unknown> = {}) {
    return {
        ownerType: 'agency',
        ownerId: '665c0011223344556677889a',
        pending: 42000,
        available: 380000,
        reserve: 0,
        requested: 0,
        currency: 'XAF',
        updatedAt: '2026-08-13T07:12:00.000Z',
        ...overrides,
    };
}

/**
 * The same row as wi-admin SERVES it — `toEarningsAccountDto` in
 * `money/read-models/money.dto.ts`: the owner hydrated with a name, plus the
 * refund debt (`clawback`, 2026-10-05).
 */
export function servedEarningsAccountRowFixture(overrides: Record<string, unknown> = {}) {
    return {
        owner: { type: 'agency', id: '665c0011223344556677889a', name: 'Douala Express' },
        pending: 42000,
        available: 380000,
        reserve: 0,
        requested: 0,
        clawback: 0,
        currency: 'XAF',
        updatedAt: '2026-08-13T07:12:00.000Z',
        ...overrides,
    };
}

// ─── The account sub-ledgers ──────────────────────────────────────────────────

/** `amount` is **signed** here, and `ref` is a bare string. */
export function creditLedgerEntryFixture(
    overrides: Partial<CreditLedgerEntry> = {},
): CreditLedgerEntry {
    return {
        id: '66b0aabbccddeeff00112233',
        type: 'debit',
        reasonCode: 'product_boost',
        amount: -5,
        balanceAfter: 95,
        ref: '66601122334455667788990a',
        createdAt: '2026-08-12T09:00:00.000Z',
        ...overrides,
    };
}

export function creditWalletFixture(overrides: Record<string, unknown> = {}) {
    return {
        unit: 'credit',
        currency: null,
        direction: 'spendable_by_owner',
        balance: 95,
        walletExists: true,
        ...overrides,
    };
}

export function creditLedgerMetaFixture(overrides: Record<string, unknown> = {}) {
    return {
        total: 42,
        page: 1,
        limit: 20,
        pages: 3,
        wallet: creditWalletFixture(),
        ...overrides,
    };
}

/** `amount` is **signed**: positive raises the liability. `ref` is an object. */
export function cashLedgerEntryFixture(
    overrides: Partial<CashLedgerEntry> = {},
): CashLedgerEntry {
    return {
        id: '6681aabbccddeeff00112233',
        entryType: 'collection',
        amount: 27500,
        balanceAfter: 400000,
        ref: { type: 'cash_collection', id: '6674aabbccddeeff00112233' },
        createdAt: '2026-08-13T07:12:00.000Z',
        ...overrides,
    };
}

export function cashLedgerMetaFixture(overrides: Record<string, unknown> = {}) {
    return { total: 118, page: 1, limit: 20, pages: 6, ...overrides };
}

// ─── The earnings ledger, allocations, payments and refunds ───────────────────

/** `amount` is a positive magnitude — direction lives in `entryType`. */
export function ledgerEntryFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: '66a0aabbccddeeff00112233',
        accountId: '66a0aabbccddeeff00112200',
        owner: { type: 'platform', id: null, name: null },
        entryType: 'release',
        amount: 2338,
        balancesAfter: { pending: 184220, available: 902118 },
        source: { type: 'order', id: '6670aabbccddeeff00112233' },
        allocationId: '66a1aabbccddeeff00112233',
        reasonCode: 'hold_release',
        createdAt: '2026-08-13T00:05:00.000Z',
        ...overrides,
    };
}

/** Held, requiring cash settlement, and the cash has not arrived — the stuck state. */
export function allocationFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: '66a1aabbccddeeff00112233',
        source: { type: 'order', id: '6670aabbccddeeff00112233' },
        beneficiary: { type: 'vendor', id: '6650aa11bb22cc33dd44ee55', name: 'Douala Fresh Market' },
        amount: 25162,
        currency: 'XAF',
        status: 'held',
        snapshots: { gross: 27500, commissionPercent: 8.5 },
        release: {
            completedAt: '2026-08-12T18:00:00.000Z',
            holdReleaseAt: '2026-08-19T18:00:00.000Z',
            releasedAt: null,
            reversedAt: null,
            requiresCashSettlement: true,
            cashSettledAt: null,
        },
        createdAt: '2026-08-12T18:00:00.000Z',
        updatedAt: '2026-08-12T18:00:00.000Z',
        ...overrides,
    };
}

export function allocationDetailFixture(overrides: Record<string, unknown> = {}) {
    return {
        ...allocationFixture(),
        movements: [ledgerEntryFixture()],
        siblings: [allocationFixture()],
        ...overrides,
    };
}

/** ⚠ UPPERCASE vocabularies — the doc's lowercase examples match nothing. */
export function paymentFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: '66c0aabbccddeeff00112233',
        settles: {
            orderId: '6670aabbccddeeff00112233',
            orderIds: [],
            bookingId: null,
            cartId: null,
            purpose: 'primary',
            deliveryTopup: null,
        },
        payer: { id: '665b112233445566778899bb', kind: 'customer_or_user' },
        gateway: 'NOTCHPAY',
        // `null` on rows written before payment routing (2026-09-30).
        provider: 'MTN',
        method: 'MOBILE',
        gatewayRef: 'NP-2026-08-13-4471',
        status: 'SUCCEEDED',
        amount: 27500,
        currency: 'XAF',
        refunds: { totalRefunded: 0, netAmount: 27500, hasPartialRefund: false },
        createdAt: '2026-08-12T18:00:00.000Z',
        updatedAt: '2026-08-12T18:00:00.000Z',
        ...overrides,
    };
}

export function paymentDetailFixture(overrides: Record<string, unknown> = {}) {
    return { ...paymentFixture(), refundTransactions: [], ...overrides };
}

/** ⚠ `status` lowercase, `gateway` UPPERCASE — in one object. */
export function refundFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: '66d0aabbccddeeff00112233',
        paymentTransactionId: '66c0aabbccddeeff00112233',
        source: { orderId: '6670aabbccddeeff00112233', bookingId: null },
        vendorId: '6650aa11bb22cc33dd44ee55',
        userId: '665b112233445566778899bb',
        amount: 5000,
        currency: 'XAF',
        reason: 'Item out of stock',
        status: 'completed',
        gateway: 'NOTCHPAY',
        gatewayRefundRef: 'NP-RF-2026-08-13-991',
        initiatedBy: { id: '665b112233445566778899bb', role: 'vendor' },
        createdAt: '2026-08-13T10:00:00.000Z',
        completedAt: '2026-08-13T10:05:00.000Z',
        ...overrides,
    };
}

/**
 * A delivery-fee refund the gateway could not make: a COD order's fee was
 * lowered after the customer paid it in cash, so a person must send 1 500 back.
 * `settleable` is the flag the Settle button reads.
 */
export function deliveryFeeRefundFixture(
    overrides: Partial<DeliveryFeeRefund> = {},
): DeliveryFeeRefund {
    return {
        id: '6700aabbccddeeff00112233',
        orderId: '6670aabbccddeeff00112233',
        orderNumber: 'ORD-2026-008841',
        shipmentId: '6671aabbccddeeff00112233',
        customerId: '665f1c2a9b3e4a91c7d2e5f0',
        vendorId: '6650aa11bb22cc33dd44ee55',
        amount: 1500,
        currency: 'XAF',
        status: 'manual_required',
        cause: 'fee_decrease',
        // Operator-facing — never shown to the customer.
        note: 'The order was paid in cash at delivery — there is no charge to refund',
        ticketId: '6701aabbccddeeff00112233',
        settleable: true,
        refundTransactionIds: [],
        settledAt: null,
        settlement: null,
        createdAt: '2026-10-04T10:00:00.000Z',
        updatedAt: '2026-10-04T10:00:00.000Z',
        ...overrides,
    };
}

/** The same row after an administrator recorded sending it by mobile money. */
export function settledDeliveryFeeRefundFixture(
    overrides: Partial<DeliveryFeeRefund> = {},
): DeliveryFeeRefund {
    return deliveryFeeRefundFixture({
        status: 'completed',
        settleable: false,
        settledAt: '2026-10-04T12:00:00.000Z',
        settlement: {
            method: 'mobile_money',
            reference: 'MP241004.1234.A56789',
            note: 'Sent to the order’s MTN number',
            settledBy: { id: 'ad01aabbccddeeff00112233', source: 'admin', name: 'Awa N.' },
            settledAt: '2026-10-04T12:00:00.000Z',
        },
        ...overrides,
    });
}

// ─── The order money split (2026-10-04) ───────────────────────────────────────

const SPLIT_ORDER_ID = '6670aabbccddeeff00112233';
const SPLIT_VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const SPLIT_AGENCY_ID = '6650aa11bb22cc33dd44ee66';
const SPLIT_SHIPMENT_ID = '6680aabbccddeeff00112233';

/** A line as the wire carries it; every field present, `null` where absent. */
export function moneyLineFixture(overrides: Record<string, unknown> = {}) {
    return {
        role: 'vendor_net',
        beneficiary: { type: 'vendor', id: SPLIT_VENDOR_ID, name: 'Chez Ama' },
        amount: 52450,
        status: 'projected',
        allocationId: null,
        holdReleaseAt: null,
        releasedAt: null,
        requiresCashSettlement: false,
        cashSettledAt: null,
        waitingOn: [],
        ...overrides,
    };
}

export function goodsBasisFixture(overrides: Record<string, unknown> = {}) {
    return {
        gross: 65000,
        bargainFee: {
            percent: 30,
            amount: 4500,
            lines: [
                {
                    orderItemId: '6690aabbccddeeff00112233',
                    title: 'Phone — Black',
                    unitPrice: 65000,
                    floorPrice: 50000,
                    quantity: 1,
                    uplift: 15000,
                    fee: 4500,
                },
            ],
        },
        commission: { percent: 10, base: 60500, amount: 6050 },
        deliveryFeeCharged: 2000,
        codHandlingFee: 0,
        vendorNet: 52450,
        ...overrides,
    };
}

export function deliveryBasisFixture(overrides: Record<string, unknown> = {}) {
    return {
        fee: 2000,
        feeSource: 'snapshot',
        payer: 'vendor',
        customerPaid: 0,
        vendorBorne: 2000,
        outcome: 'expected',
        earnedFee: 2000,
        codHandlingFee: 0,
        agentCut: null,
        agentSplit: null,
        refundToVendor: 0,
        refundToCustomer: 0,
        ...overrides,
    };
}

export function splitShipmentFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: SPLIT_SHIPMENT_ID,
        trackingNumber: 'DLX-261004-0001',
        status: 'pending',
        agencyId: SPLIT_AGENCY_ID,
        agencyName: 'Douala Express',
        agentId: null,
        agentName: null,
        ...overrides,
    };
}

/**
 * `GET /money/orders/:orderId/split` — **money.md's own worked example**:
 * prepaid, before payment, sold at 65 000 over a 50 000 minimum, vendor on a
 * 10% plan, vendor pays a 2 000 delivery. Every figure is the server's.
 */
export function orderMoneySplitFixture(overrides: Record<string, unknown> = {}) {
    return {
        order: {
            id: SPLIT_ORDER_ID,
            orderNumber: 'ORD-2026-000123',
            vendorId: SPLIT_VENDOR_ID,
            vendorName: 'Chez Ama',
            customerId: '6640aa11bb22cc33dd44ee55',
            currency: 'XAF',
            orderType: 'physical',
            paymentMethod: 'mobile_money',
            paymentStatus: 'AWAITING_PAYMENT',
            fulfillmentStatus: 'pending',
            deliveryPayer: 'vendor',
            completedAt: null,
            createdAt: '2026-10-04T09:00:00.000Z',
        },
        charged: { items: 65000, delivery: 0, deliveryInCash: 0, total: 65000 },
        sections: [
            {
                key: 'payment',
                moment: 'payment',
                source: { type: 'order', id: SPLIT_ORDER_ID },
                state: 'projected',
                noneReason: null,
                shipment: null,
                goods: goodsBasisFixture(),
                delivery: null,
                lines: [
                    moneyLineFixture(),
                    moneyLineFixture({
                        role: 'commission',
                        beneficiary: { type: 'platform', id: null, name: null },
                        amount: 6050,
                    }),
                    moneyLineFixture({
                        role: 'bargain_fee',
                        beneficiary: { type: 'platform_ai', id: null, name: null },
                        amount: 4500,
                    }),
                ],
                notes: ['commission_rate_may_change'],
            },
            {
                key: `shipment:${SPLIT_SHIPMENT_ID}`,
                moment: 'delivery',
                source: { type: 'shipment', id: SPLIT_SHIPMENT_ID },
                state: 'projected',
                noneReason: null,
                shipment: splitShipmentFixture(),
                goods: null,
                delivery: deliveryBasisFixture(),
                lines: [
                    moneyLineFixture({
                        role: 'delivery_agency',
                        beneficiary: { type: 'agency', id: SPLIT_AGENCY_ID, name: 'Douala Express' },
                        amount: 2000,
                    }),
                ],
                notes: ['agent_not_assigned'],
            },
        ],
        totals: {
            platform: { commission: 6050, bargainFee: 4500, total: 10550 },
            vendor: 52450,
            agencies: 2000,
            agents: 0,
            customerRefunds: 0,
            reversed: 0,
        },
        reconciliation: { charged: 65000, distributed: 65000, difference: 0, complete: true },
        estimated: true,
        holdDays: 7,
        bargainFeePercent: 30,
        ...overrides,
    };
}

/** `GET /money/earnings/platform/summary` — money.md's worked example. */
export function platformSummaryFixture(overrides: Record<string, unknown> = {}) {
    return {
        from: '2026-10-01T00:00:00.000Z',
        to: null,
        currencies: [
            {
                currency: 'XAF',
                commission: { held: 6050, released: 1000, reversed: 0, earned: 7050, count: 3 },
                bargainFee: { held: 4500, released: 0, reversed: 300, earned: 4500, count: 1 },
                total: { held: 10550, released: 1000, reversed: 300, earned: 11550, count: 4 },
            },
        ],
        ...overrides,
    };
}
