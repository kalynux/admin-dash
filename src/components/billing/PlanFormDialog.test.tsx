import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlanFormDialog } from '@/components/billing/PlanFormDialog';
import { agentPlanFixture, planFixture } from '@/test/billing-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { Plan } from '@/types/billing.types';

/**
 * The plan form's handling of `maxCodPool`. From 2026-09-21 it was every
 * verified agent's pool on the tier and a change re-synced them all; since
 * 2026-10-02 (ADR-A09) every verified agent gets the same 500 000 default and the
 * field is **dormant** — stored, accepted, and moving nobody. So it is shown
 * read-only and labelled, and it is never sent: a box that saves and changes
 * nothing reads as a lever.
 */
function editPlan(plan: Plan) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.method === 'PATCH' && call.url.includes(`/billing/plans/${plan.id}`)) {
            return successResponse(null, { message: 'Plan updated' });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    const onSaved = vi.fn();

    renderWithProviders(
        <PlanFormDialog plan={plan} open onOpenChange={() => {}} onSaved={onSaved} />,
        {
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(1) },
        },
    );

    return { calls, onSaved };
}

async function save(calls: FetchCall[]) {
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
        expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((call) => call.method === 'PATCH')!;
    return JSON.parse(patch.body ?? '{}') as Record<string, unknown>;
}

describe('the COD pool on an agent plan — dormant since 2026-10-02', () => {
    it('shows the stored amount read-only, labelled as not used', async () => {
        editPlan(agentPlanFixture());

        const field = await screen.findByRole('textbox', { name: /^cod pool/i });
        expect(field).toHaveValue('500000');
        expect(field).toHaveAttribute('readonly');
        expect(screen.getByText(/not used since 2026-10-02/i)).toBeInTheDocument();
    });

    it('cannot be typed into', async () => {
        editPlan(agentPlanFixture());

        const field = await screen.findByRole('textbox', { name: /^cod pool/i });
        await userEvent.type(field, '9');
        expect(field).toHaveValue('500000');
    });

    /** No re-sync warning survives: editing the plan moves no agent's pool. */
    it('says nothing about agents getting a new pool', async () => {
        editPlan(agentPlanFixture());

        await screen.findByRole('textbox', { name: /^cod pool/i });
        expect(screen.queryByText(/agents on this plan will get/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/closes cash on delivery/i)).not.toBeInTheDocument();
    });

    it('is never sent, even when the plan is saved', async () => {
        const { calls } = editPlan(agentPlanFixture());

        const name = await screen.findByLabelText(/^name$/i);
        await userEvent.clear(name);
        await userEvent.type(name, 'Agent Standard');
        const body = await save(calls);

        expect(body.name).toBe('Agent Standard');
        expect(body).not.toHaveProperty('maxCodPool');
    });
});

describe('the COD pool on a vendor plan', () => {
    it('is neither offered nor sent', async () => {
        const { calls } = editPlan(planFixture());

        await screen.findByLabelText(/^name$/i);
        expect(screen.queryByRole('textbox', { name: /^cod pool/i })).not.toBeInTheDocument();

        const body = await save(calls);
        expect(body).not.toHaveProperty('maxCodPool');
    });
});
