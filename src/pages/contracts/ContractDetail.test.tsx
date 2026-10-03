import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { ContractDetail } from '@/pages/contracts/ContractDetail';
import { agentContractFixture } from '@/test/agent-fixtures';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { ContractDetail as Contract } from '@/types/contracts.types';

/**
 * The fee split on the contract screen. `monthly_salary` arrived on 2026-10-02:
 * the agency pays a salary off-platform and jovi-mall pays the agent 0 per
 * delivery, so the screen must never present it as a fee or a platform payment.
 */
function renderContract(feeSplit: Contract['terms']['feeSplit']) {
    const base = agentContractFixture();
    const contract: Contract = {
        ...base,
        terms: { ...base.terms, feeSplit },
        agent: null,
    };
    stubFetch((call: FetchCall) => {
        if (call.url.includes(`/contracts/${contract.id}`)) return successResponse(contract);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/contracts/:contractId" element={<ContractDetail />} />
        </Routes>,
        {
            route: `/dashboard/contracts/${contract.id}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: new Set(['agents.read', 'agencies.read']) },
        },
    );
}

describe('the fee split on a contract', () => {
    it('renders a monthly salary as paid by the agency, off-platform', async () => {
        renderContract({
            model: 'monthly_salary',
            agentSharePercent: null,
            // A stale flat fee from before the model changed — ignored.
            agentFlatFee: 1500,
            agentMonthlySalary: 90000,
            currency: 'XAF',
        });

        expect(await screen.findByText(/^Salaried — .*90,000.* \/ month \(agency pays off-platform\)$/)).toBeInTheDocument();
        expect(screen.queryByText(/flat to the agent/)).not.toBeInTheDocument();
    });

    it('still renders a percentage split', async () => {
        renderContract({
            model: 'percentage',
            agentSharePercent: 70,
            agentFlatFee: null,
            agentMonthlySalary: null,
            currency: 'XAF',
        });

        expect(await screen.findByText('70% to the agent')).toBeInTheDocument();
    });
});
