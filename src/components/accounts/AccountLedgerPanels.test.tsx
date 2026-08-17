import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { AccountCashLedgerPanel } from '@/components/accounts/AccountCashLedgerPanel';
import { AccountCodExposurePanel } from '@/components/accounts/AccountCodExposurePanel';
import { AccountCreditsPanel } from '@/components/accounts/AccountCreditsPanel';
import { adminFixture } from '@/test/fixtures';
import {
    cashLedgerEntryFixture,
    cashLedgerMetaFixture,
    creditLedgerEntryFixture,
    creditLedgerMetaFixture,
} from '@/test/money-fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { CodExposure } from '@/types/accounts.types';

const OWNER_ID = '6660112233445566778899aa';

function render(ui: React.ReactElement) {
    return renderWithProviders(ui, {
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

describe('the credit ledger', () => {
    it('keeps a signed amount signed', async () => {
        /*
         * Unlike the activity feed, whose amount is a positive magnitude with the
         * sign living in `direction`. A component that rendered a bare magnitude
         * here would show a spend as a grant.
         */
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture({ amount: -5 })], {
                meta: creditLedgerMetaFixture(),
            }),
        );

        render(<AccountCreditsPanel ownerType="vendor" ownerId={OWNER_ID} timeZone="UTC" />);

        expect(await screen.findByText('−5')).toBeInTheDocument();
    });

    it('reports the wallet in credits, never as money', async () => {
        // A credit has `currency: null` and never converts to money, so no
        // currency symbol may appear against it.
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture()], { meta: creditLedgerMetaFixture() }),
        );

        render(<AccountCreditsPanel ownerType="vendor" ownerId={OWNER_ID} timeZone="UTC" />);

        expect(await screen.findByText('95 credits')).toBeInTheDocument();
    });

    it('says top-ups are not in this ledger', async () => {
        // The repository drops the ledger half of a paid top-up so one event is
        // not counted twice. Unsaid, "my top-up is missing" reads as a bug.
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture()], { meta: creditLedgerMetaFixture() }),
        );

        render(<AccountCreditsPanel ownerType="vendor" ownerId={OWNER_ID} timeZone="UTC" />);

        expect(await screen.findByText(/top-up purchases are not listed here/i)).toBeInTheDocument();
    });

    it('renders the reference as a bare string', async () => {
        stubFetch(() =>
            successResponse([creditLedgerEntryFixture({ ref: 'abc123' })], {
                meta: creditLedgerMetaFixture(),
            }),
        );

        render(<AccountCreditsPanel ownerType="vendor" ownerId={OWNER_ID} timeZone="UTC" />);

        expect(await screen.findByText('abc123')).toBeInTheDocument();
    });
});

describe('the cash ledger', () => {
    it('names a positive movement as raising the liability', async () => {
        /*
         * The opposite of the intuition a money column usually carries, so the
         * direction is spelled out rather than left to a colour.
         */
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture({ amount: 27500 })], {
                meta: cashLedgerMetaFixture(),
            }),
        );

        render(
            <AccountCashLedgerPanel
                ownerType="agent"
                ownerId={OWNER_ID}
                timeZone="UTC"
                currency="XAF"
            />,
        );

        expect(await screen.findByText(/raises what they owe/i)).toBeInTheDocument();
    });

    it('names a negative movement as discharging it', async () => {
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture({ amount: -12000 })], {
                meta: cashLedgerMetaFixture(),
            }),
        );

        render(
            <AccountCashLedgerPanel
                ownerType="agent"
                ownerId={OWNER_ID}
                timeZone="UTC"
                currency="XAF"
            />,
        );

        expect(await screen.findByText(/discharges what they owe/i)).toBeInTheDocument();
    });

    it('renders the reference as an object, unlike the credit ledger', async () => {
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture()], { meta: cashLedgerMetaFixture() }),
        );

        render(
            <AccountCashLedgerPanel
                ownerType="agent"
                ownerId={OWNER_ID}
                timeZone="UTC"
                currency="XAF"
            />,
        );

        expect(await screen.findByText('cash collection')).toBeInTheDocument();
        expect(screen.getByText('6674aabbccddeeff00112233')).toBeInTheDocument();
    });

    it('tolerates a null reference, which the doc example does not show', async () => {
        stubFetch(() =>
            successResponse([cashLedgerEntryFixture({ ref: null })], {
                meta: cashLedgerMetaFixture(),
            }),
        );

        render(
            <AccountCashLedgerPanel
                ownerType="agent"
                ownerId={OWNER_ID}
                timeZone="UTC"
                currency="XAF"
            />,
        );

        expect(await screen.findByText(/not recorded/i)).toBeInTheDocument();
    });
});

describe('COD exposure', () => {
    const exposure = (overrides: Partial<CodExposure> = {}): CodExposure => ({
        contracts: [
            {
                contractId: '6661aabbccddeeff00112233',
                agencyId: '665c0011223344556677889a',
                agentId: OWNER_ID,
                status: 'active',
                outstandingBalance: 400000,
                outstandingToAgent: 18500,
                maxThreshold: 150000,
                lastSettledAt: '2026-08-11T17:04:00.000Z',
            },
        ],
        reserveHolds: null,
        ...overrides,
    });

    it('reads a zero ceiling as blocking COD, not as no limit', () => {
        /*
         * The single most invertible value on the screen: `0` blocks all COD
         * rather than meaning unlimited, so it is spelled out.
         */
        render(
            <AccountCodExposurePanel
                exposure={exposure({
                    contracts: [{ ...exposure().contracts[0], maxThreshold: 0 }],
                })}
                ownerType="agent"
                currency="XAF"
                timeZone="UTC"
            />,
        );

        expect(screen.getByText(/COD blocked/i)).toBeInTheDocument();
    });

    it('shows both directions of debt', () => {
        // Outstanding cash is owed onward; outstanding-to-agent is owed back.
        render(
            <AccountCodExposurePanel
                exposure={exposure()}
                ownerType="agent"
                currency="XAF"
                timeZone="UTC"
            />,
        );

        expect(screen.getByText(/400,000/)).toBeInTheDocument();
        expect(screen.getByText(/18,500/)).toBeInTheDocument();
    });

    it('says an agent has no rolling reserve rather than showing an empty table', () => {
        render(
            <AccountCodExposurePanel
                exposure={exposure({ reserveHolds: null })}
                ownerType="agent"
                currency="XAF"
                timeZone="UTC"
            />,
        );

        expect(screen.getByText(/an agent has no rolling reserve/i)).toBeInTheDocument();
    });

    it('explains a vendor null as cannot rather than none', () => {
        render(
            <AccountCodExposurePanel
                exposure={null}
                ownerType="vendor"
                currency="XAF"
                timeZone="UTC"
            />,
        );

        expect(screen.getByText(/not the same as an exposure of zero/i)).toBeInTheDocument();
    });
});
