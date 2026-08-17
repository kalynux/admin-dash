import { describe, expect, it } from 'vitest';

import {
    listAccountCashLedger,
    listAccountCredits,
    listAccountPayouts,
} from '@/services/accounts.service';
import {
    cashLedgerEntryFixture,
    cashLedgerMetaFixture,
    creditLedgerEntryFixture,
    creditLedgerMetaFixture,
    payoutFixture,
    payoutListMetaFixture,
} from '@/test/money-fixtures';
import { stubFetch, successResponse, type FetchCall } from '@/test/utils';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listAccountPayouts', () => {
    it('scopes the payout queue to one party', async () => {
        const calls = stubFetch(() =>
            successResponse([payoutFixture()], { meta: payoutListMetaFixture() }),
        );

        await listAccountPayouts('agency', '665c0011223344556677889a', {
            status: 'pending',
            sort: '-amount',
            page: 2,
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/accounts/agency/665c0011223344556677889a/payouts');
        expect(query.get('status')).toBe('pending');
        expect(query.get('sort')).toBe('-amount');
        expect(query.get('page')).toBe('2');
    });
});

describe('listAccountCredits', () => {
    it('carries the type and reasonCode filters', async () => {
        const calls = stubFetch(() =>
            successResponse([creditLedgerEntryFixture()], { meta: creditLedgerMetaFixture() }),
        );

        await listAccountCredits('vendor', '6650aa11bb22cc33dd44ee55', {
            type: 'debit',
            reasonCode: 'product_boost',
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/accounts/vendor/6650aa11bb22cc33dd44ee55/credits');
        expect(query.get('type')).toBe('debit');
        expect(query.get('reasonCode')).toBe('product_boost');
    });

    it('keeps the wallet whole, with its unit, currency and direction', async () => {
        /*
         * The endpoint answers through `sendSuccess` rather than `sendPaginated`
         * precisely so these three survive. Stripping them is what makes
         * somebody add a credit balance to a money balance.
         */
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture()], { meta: creditLedgerMetaFixture() }),
        );

        const page = await listAccountCredits('vendor', '6650aa11bb22cc33dd44ee55');

        expect(page.meta.wallet).toEqual({
            unit: 'credit',
            currency: null,
            direction: 'spendable_by_owner',
            balance: 95,
            walletExists: true,
        });
    });

    it('reports a missing wallet as an empty one rather than as absent', async () => {
        // A missing wallet and an empty one hold the same amount of credit; the
        // flag is what tells them apart.
        stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        const page = await listAccountCredits('agent', '6660112233445566778899aa');

        expect(page.meta.wallet.balance).toBe(0);
        expect(page.meta.wallet.walletExists).toBe(false);
        expect(page.meta.wallet.unit).toBe('credit');
    });

    it('keeps a signed amount signed', async () => {
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture({ amount: -5 })], {
                meta: creditLedgerMetaFixture(),
            }),
        );

        const page = await listAccountCredits('vendor', '6650aa11bb22cc33dd44ee55');

        expect(page.data[0].amount).toBe(-5);
    });
});

describe('listAccountCashLedger', () => {
    it('builds the path for an agent', async () => {
        const calls = stubFetch(() =>
            successResponse([cashLedgerEntryFixture()], { meta: cashLedgerMetaFixture() }),
        );

        await listAccountCashLedger('agent', '6660112233445566778899aa', {
            entryType: 'collection',
        });

        expect(calls[0].url).toContain('/accounts/agent/6660112233445566778899aa/cash-ledger');
        expect(queryOf(calls[0]).get('entryType')).toBe('collection');
    });

    it('builds the path for an agency', async () => {
        const calls = stubFetch(() =>
            successResponse([cashLedgerEntryFixture()], { meta: cashLedgerMetaFixture() }),
        );

        await listAccountCashLedger('agency', '665c0011223344556677889a');

        expect(calls[0].url).toContain('/accounts/agency/665c0011223344556677889a/cash-ledger');
    });

    it('keeps the ref as an object, unlike the credit ledger', async () => {
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture()], { meta: cashLedgerMetaFixture() }),
        );

        const page = await listAccountCashLedger('agent', '6660112233445566778899aa');

        expect(page.data[0].ref).toEqual({
            type: 'cash_collection',
            id: '6674aabbccddeeff00112233',
        });
    });

    it('tolerates a null ref, which the doc example does not show', async () => {
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture({ ref: null })], {
                meta: cashLedgerMetaFixture(),
            }),
        );

        const page = await listAccountCashLedger('agent', '6660112233445566778899aa');

        expect(page.data[0].ref).toBeNull();
    });
});
