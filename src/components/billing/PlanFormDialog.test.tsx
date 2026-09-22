import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlanFormDialog } from '@/components/billing/PlanFormDialog';
import { agentPlanFixture, planFixture } from '@/test/billing-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { Plan } from '@/types/billing.types';

/**
 * The plan form's handling of `maxCodPool` (2026-09-21) — the one limit that
 * fails CLOSED. `null` on an agent tier is no cash on delivery, and a change to it
 * re-syncs every agent on the tier at once, so it is sent more carefully than
 * the other limits: agent tiers only, and on an edit only when it moved.
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

describe('the COD pool on an agent plan', () => {
    it('is offered, filled with the stored amount', async () => {
        editPlan(agentPlanFixture());

        expect(await screen.findByRole('textbox', { name: /^cod pool/i })).toHaveValue('500000');
        expect(screen.getByText(/empty or 0 means no cash on delivery/i)).toBeInTheDocument();
    });

    /**
     * An unrelated edit must not carry it: sending even the unchanged value
     * would be a write to the one field whose change reaches every agent.
     */
    it('is not sent when an unrelated field changes', async () => {
        const { calls } = editPlan(agentPlanFixture());

        const name = await screen.findByLabelText(/^name$/i);
        await userEvent.clear(name);
        await userEvent.type(name, 'Agent Standard');
        const body = await save(calls);

        expect(body.name).toBe('Agent Standard');
        expect(body).not.toHaveProperty('maxCodPool');
    });

    it('is sent when it changes, after saying agents get it now', async () => {
        const { calls } = editPlan(agentPlanFixture());

        const field = await screen.findByRole('textbox', { name: /^cod pool/i });
        await userEvent.clear(field);
        await userEvent.type(field, '1000000');

        expect(screen.getByText(/agents on this plan will get the new cod pool/i)).toBeInTheDocument();
        const body = await save(calls);
        expect(body.maxCodPool).toBe(1000000);
    });

    /** Emptying it is not "lifting a limit" — it closes COD for the whole tier. */
    it('warns loudly that emptying it closes cash on delivery, and sends null', async () => {
        const { calls } = editPlan(agentPlanFixture());

        await userEvent.clear(await screen.findByRole('textbox', { name: /^cod pool/i }));

        expect(
            screen.getByText(/closes cash on delivery for every agent on this plan/i),
        ).toBeInTheDocument();
        const body = await save(calls);
        expect(body.maxCodPool).toBeNull();
    });

    it('refuses a fraction', async () => {
        const { calls } = editPlan(agentPlanFixture());

        const field = await screen.findByRole('textbox', { name: /^cod pool/i });
        await userEvent.clear(field);
        await userEvent.type(field, '1000.5');
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

        expect(await screen.findByText(/enter a whole amount/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
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
