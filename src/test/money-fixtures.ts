/**
 * Wire-shaped fixtures for `/money` and the account sub-ledgers.
 *
 * Every one of these is shaped from the **backend DTO**, not from the doc
 * examples, because four of them disagree — see `types/money.types.ts` for the
 * list. In particular `full` is `null` on a masked destination, not an object of
 * nulls, and `PayoutDestination` carries `revealed`, which no doc example shows.
 */

import type { CashLedgerEntry, CreditLedgerEntry } from '@/types/accounts.types';
import type { Payout, PayoutDestination } from '@/types/money.types';

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
 * One row of `GET /money/earnings/accounts`.
 *
 * Note what is **not** here: an owner name. The platform returns
 * `(owner_type, owner_id)` and four balances, and wi-admin passes them through.
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
        },
        payer: { id: '665b112233445566778899bb', kind: 'customer_or_user' },
        gateway: 'NOTCHPAY',
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
