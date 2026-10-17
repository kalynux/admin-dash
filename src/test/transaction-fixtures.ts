import type {
    TransactionDetail,
    TransactionLinks,
    TransactionListMeta,
    TransactionRow,
    TransactionSummary,
} from '@/types/transactions.types';

/*
 * Wire-shaped fixtures for `/money/transactions`, built from the source mirror
 * `api-doc/admin/transaction-dto.ts` — `transactions.types.test.ts` checks that
 * the row and its links carry exactly the mirror's keys, so a fixture cannot
 * agree with a misreading of the page.
 */

export const TX_PAYMENT_ID = '66f0a1b2c3d4e5f601234567';
export const TX_REFUND_ID = '66f0a1b2c3d4e5f601234568';
export const TX_ORDER_ID = '66ef00112233445566778899';
export const TX_VENDOR_ID = '6650aa11bb22cc33dd44ee55';

export function transactionLinksFixture(
    overrides: Partial<TransactionLinks> = {},
): TransactionLinks {
    return {
        orderIds: [],
        bookingId: null,
        shipmentId: null,
        paymentTransactionId: null,
        refundRequestId: null,
        ticketId: null,
        allocationId: null,
        planId: null,
        vendorId: null,
        agencyId: null,
        agentId: null,
        payoutId: null,
        ...overrides,
    };
}

/** A succeeded customer payment — the example on the contract page. */
export function transactionRowFixture(overrides: Partial<TransactionRow> = {}): TransactionRow {
    return {
        kind: 'payment',
        id: TX_PAYMENT_ID,
        group: 'provider',
        direction: 'in',
        party: { role: 'customer', id: '665c00112233445566778899', name: 'Awa N.' },
        amount: 20000,
        currency: 'XAF',
        status: 'SUCCEEDED',
        outcome: 'succeeded',
        gateway: 'NOTCHPAY',
        provider: 'MTN',
        method: 'MOBILE',
        reason: { code: 'order_payment', text: null },
        reference: 'trx.AbC123',
        merchantRef: 'jm_pt_5f0c41ab77e0463d8a15c6be02d7f318',
        links: transactionLinksFixture({ orderIds: [TX_ORDER_ID] }),
        createdAt: '2026-10-11T09:14:02.000Z',
        completedAt: '2026-10-11T09:14:40.000Z',
        ...overrides,
    };
}

export function refundRowFixture(overrides: Partial<TransactionRow> = {}): TransactionRow {
    return transactionRowFixture({
        kind: 'refund',
        id: TX_REFUND_ID,
        direction: 'out',
        amount: 5000,
        status: 'completed',
        outcome: 'succeeded',
        gateway: null,
        provider: null,
        method: 'payout',
        reason: { code: 'refund', text: 'Parcel never arrived' },
        reference: 'MR260813.0950.B10233',
        merchantRef: null,
        links: transactionLinksFixture({
            orderIds: [TX_ORDER_ID],
            paymentTransactionId: TX_PAYMENT_ID,
            refundRequestId: '6700aabbccddeeff00112299',
            vendorId: TX_VENDOR_ID,
        }),
        ...overrides,
    });
}

export function payoutRowFixture(overrides: Partial<TransactionRow> = {}): TransactionRow {
    return transactionRowFixture({
        kind: 'payout',
        id: '66a2aabbccddeeff00112233',
        direction: 'out',
        party: { role: 'vendor', id: TX_VENDOR_ID, name: 'Boutique Verify' },
        amount: 100000,
        status: 'paid',
        outcome: 'succeeded',
        gateway: 'NOTCHPAY',
        provider: 'Orange',
        method: 'mobile_money',
        reason: { code: 'payout_manual', text: null },
        reference: 'trf.9911',
        merchantRef: null,
        links: transactionLinksFixture({ ticketId: '66a3aabbccddeeff00112233' }),
        ...overrides,
    });
}

/** A seller's earnings movement — `internal`, and a kind Support is not sent. */
export function ledgerRowFixture(overrides: Partial<TransactionRow> = {}): TransactionRow {
    return transactionRowFixture({
        kind: 'ledger_entry',
        id: '66a0aabbccddeeff00112233',
        group: 'internal',
        direction: 'internal',
        party: { role: 'vendor', id: TX_VENDOR_ID, name: 'Boutique Verify' },
        amount: 18000,
        status: 'hold',
        outcome: 'succeeded',
        gateway: null,
        provider: null,
        method: null,
        reason: { code: 'order_split', text: null },
        reference: null,
        merchantRef: null,
        links: transactionLinksFixture({
            orderIds: [TX_ORDER_ID],
            allocationId: '66a1aabbccddeeff00112233',
        }),
        completedAt: '2026-10-11T09:14:02.000Z',
        ...overrides,
    });
}

export function transactionMetaFixture(
    overrides: Partial<TransactionListMeta> = {},
): TransactionListMeta {
    return {
        limit: 20,
        nextCursor: null,
        hasMore: false,
        sort: '-createdAt',
        window: { from: '2025-10-11T10:00:00.000Z', to: '2026-10-12T10:00:00.000Z' },
        withheld: { kinds: [], platformAccounts: false },
        ...overrides,
    };
}

/** What a Support administrator's list reports as left out. */
export const SUPPORT_WITHHELD = {
    kinds: ['plan_purchase', 'credit_topup', 'ledger_entry'],
    platformAccounts: true,
};

export function transactionSummaryFixture(
    overrides: Partial<TransactionSummary> = {},
): TransactionSummary {
    return {
        count: 14,
        groups: [
            {
                kind: 'payment',
                direction: 'in',
                outcome: 'succeeded',
                currency: 'XAF',
                count: 9,
                amount: 180000,
            },
            {
                kind: 'payout',
                direction: 'out',
                outcome: 'failed',
                currency: 'XAF',
                count: 2,
                amount: 30000,
            },
            {
                kind: 'ledger_entry',
                direction: 'internal',
                outcome: 'succeeded',
                currency: null,
                count: 3,
                amount: 20500,
            },
        ],
        window: { from: '2025-10-11T10:00:00.000Z', to: '2026-10-12T10:00:00.000Z' },
        withheld: { kinds: [], platformAccounts: false },
        ...overrides,
    };
}

/** A refund: no screen of its own, so the detail read carries `record`. */
export function refundDetailFixture(overrides: Partial<TransactionDetail> = {}): TransactionDetail {
    return {
        transaction: refundRowFixture(),
        record: {
            kind: 'refund',
            channel: 'payout',
            feeAmount: 100,
            netAmount: 4900,
            initiatedBy: { id: '665f00112233445566778899', role: 'support' },
            vendor: { id: TX_VENDOR_ID, name: 'Boutique Verify' },
        },
        recordPath: null,
        related: {
            orders: [{ id: TX_ORDER_ID, orderNumber: 'ORD-2026-000123' }],
            transactions: [transactionRowFixture()],
            truncated: false,
        },
        ...overrides,
    };
}

/** A payment: its full record is a screen that already exists, so `record` is `null`. */
export function paymentDetailFixture(
    overrides: Partial<TransactionDetail> = {},
): TransactionDetail {
    return {
        transaction: transactionRowFixture(),
        record: null,
        recordPath: `/money/payments/${TX_PAYMENT_ID}`,
        related: {
            orders: [{ id: TX_ORDER_ID, orderNumber: 'ORD-2026-000123' }],
            transactions: [refundRowFixture()],
            truncated: false,
        },
        ...overrides,
    };
}

export const TX_AGENT_ID = '6660112233445566778899aa';
export const TX_PAYOUT_ID = '66a2aabbccddeeff00112299';

/** A customer paying cash at the door (BR-030): `cash`, `internal`, the agent on `links` and `record`. */
export function codCollectionDetailFixture(
    overrides: Partial<TransactionDetail> = {},
): TransactionDetail {
    return {
        transaction: transactionRowFixture({
            kind: 'cod_collection',
            id: '66c0aabbccddeeff00112233',
            group: 'cash',
            direction: 'internal',
            amount: 12000,
            status: 'collected',
            outcome: 'succeeded',
            gateway: null,
            provider: null,
            method: null,
            reason: { code: 'cod_order_payment', text: null },
            reference: null,
            merchantRef: null,
            links: transactionLinksFixture({
                orderIds: [TX_ORDER_ID],
                shipmentId: '66b0aabbccddeeff00112233',
                agentId: TX_AGENT_ID,
            }),
        }),
        record: {
            kind: 'cod_collection',
            collects: 'order',
            itemsAmount: 10000,
            deliveryFeeAmount: 2000,
            settledAmount: 0,
            settledAt: null,
            agent: { id: TX_AGENT_ID, name: 'Eric T.' },
        },
        recordPath: null,
        related: { orders: [{ id: TX_ORDER_ID, orderNumber: 'ORD-2026-000123' }], transactions: [], truncated: false },
        ...overrides,
    };
}

/** A refund debt paid down by a payout that came back (BR-030): no actor, the payout on `links`. */
export function debtRecoveryDetailFixture(
    overrides: Partial<TransactionDetail> = {},
): TransactionDetail {
    return {
        transaction: transactionRowFixture({
            kind: 'earnings_adjustment',
            id: '66d0aabbccddeeff00112233',
            group: 'internal',
            direction: 'internal',
            party: { role: 'vendor', id: TX_VENDOR_ID, name: 'Boutique Verify' },
            amount: 3000,
            status: 'clawback_recovery',
            outcome: 'succeeded',
            gateway: null,
            provider: null,
            method: null,
            reason: { code: 'debt_recovered_from_payout', text: null },
            reference: null,
            merchantRef: null,
            links: transactionLinksFixture({ payoutId: TX_PAYOUT_ID }),
        }),
        record: {
            kind: 'earnings_adjustment',
            adjustment: 'clawback_recovery',
            actor: null,
            payoutEvent: 'rejected',
        },
        recordPath: null,
        related: { orders: [], transactions: [], truncated: false },
        ...overrides,
    };
}
