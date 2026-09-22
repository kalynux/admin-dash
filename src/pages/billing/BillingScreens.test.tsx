import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { PlanDetail } from '@/pages/billing/PlanDetail';
import { PlansList } from '@/pages/billing/PlansList';
import { SubscriptionsList } from '@/pages/billing/SubscriptionsList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    agentPlanFixture,
    archivedPlanFixture,
    freePlanFixture,
    planFixture,
    planListMetaFixture,
    selfServeSubscriptionFixture,
    subscriptionFixture,
} from '@/test/billing-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

function render(ui: React.ReactElement, held = heldFixture(1)) {
    return renderWithProviders(ui, {
        route: '/dashboard/billing',
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

// ─── The catalog ──────────────────────────────────────────────────────────────

describe('the plan catalog', () => {
    function stubPlans(rows = [planFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/billing/plans')) {
                return successResponse(rows, { meta: planListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('sorts by catalog order rather than newest-first', async () => {
        /*
         * `sortOrder` is the field the platform put there to say what order these
         * belong in. Every other list on this service defaults to -createdAt.
         */
        const calls = stubPlans();

        render(<PlansList />);

        await screen.findByText('Growth');
        expect(latest(calls).searchParams.get('sort')).toBe('sortOrder');
    });

    it('reports a never-expiring tier rather than a blank term', async () => {
        stubPlans([freePlanFixture()]);

        render(<PlansList />);

        expect(await screen.findByText(/never expires/i)).toBeInTheDocument();
    });

    it('excludes archived tiers until asked', async () => {
        const calls = stubPlans();
        const user = userEvent.setup();

        render(<PlansList />);
        await screen.findByText('Growth');
        expect(latest(calls).searchParams.get('includeArchived')).toBeNull();

        await user.click(screen.getByRole('switch', { name: /include archived/i }));
        expect(latest(calls).searchParams.get('includeArchived')).toBe('true');
    });

    it('offers no Edit on an archived tier', async () => {
        /*
         * The platform's write queries filter archived rows, so editing one is a
         * guaranteed 404. A button whose only outcome is a refusal is worse than
         * no button.
         */
        stubPlans([archivedPlanFixture()]);

        render(<PlansList />);

        // Marked twice on purpose: the state badge says what it is, the actions
        // cell says why there is nothing to press.
        expect((await screen.findAllByText('Archived')).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    });

    it('offers Edit on a live tier, under its permission', async () => {
        stubPlans();

        render(<PlansList />);

        expect(await screen.findByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    });

    it('hides Edit and New plan without billing.plans.manage', async () => {
        stubPlans();

        render(<PlansList />, new Set(['billing.plans.read']));

        await screen.findByText('Growth');
        expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /new plan/i })).not.toBeInTheDocument();
    });

    it('distinguishes not-purchasable from archived', async () => {
        // Two independent states: a tier can be defined but unsellable without
        // being soft-deleted.
        stubPlans([planFixture({ isActive: false })]);

        render(<PlansList />);

        expect(await screen.findByText(/not purchasable/i)).toBeInTheDocument();
        expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    });
});

// ─── The plan detail ──────────────────────────────────────────────────────────

describe('the plan detail', () => {
    function renderDetail(plan = planFixture(), held = heldFixture(1)) {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/subscribers')) {
                return successResponse([subscriptionFixture()], { meta: planListMetaFixture() });
            }
            if (call.url.includes('/billing/plans/')) return successResponse(plan);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        return renderWithProviders(
            <Routes>
                <Route path="/dashboard/billing/:planId" element={<PlanDetail />} />
            </Routes>,
            {
                route: `/dashboard/billing/${plan.id}`,
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held },
            },
        );
    }

    it('explains why an archived tier offers no actions', async () => {
        renderDetail(archivedPlanFixture());

        expect(await screen.findByText(/was archived/i)).toBeInTheDocument();
        expect(screen.getByText(/cannot be edited or archived again/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
    });

    it('offers both actions on a live tier', async () => {
        renderDetail();

        expect(await screen.findByRole('button', { name: /^edit$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
    });

    it('reports an unset storage cap as the platform default, not unlimited', async () => {
        /*
         * The one limit where null is NOT "unlimited" — billing.md flattens all
         * five into that reading and is wrong here.
         */
        renderDetail(agentPlanFixture());

        expect(await screen.findByText(/platform default applies/i)).toBeInTheDocument();
    });

    it('marks the delivery limits as not part of a vendor tier', async () => {
        renderDetail(planFixture());

        expect(await screen.findByText(/not defined by a vendor plan/i)).toBeInTheDocument();
    });

    it("shows an agent tier's COD pool", async () => {
        renderDetail(agentPlanFixture());

        expect(await screen.findByText('500,000')).toBeInTheDocument();
    });

    /**
     * ⚠ The one limit that fails CLOSED (2026-09-21): on an agent tier `null` is
     * no cash on delivery, and jovi-mall reads it as 0. A shared "not limited"
     * rendering would tell an operator the opposite of what the platform does.
     */
    it('reports an agent tier with no COD pool as no cash on delivery, never unlimited', async () => {
        const plan = agentPlanFixture();
        renderDetail(agentPlanFixture({ limits: { ...plan.limits, maxCodPool: null } }));

        expect(await screen.findByText('0 — no cash on delivery')).toBeInTheDocument();
    });

    it('renders a 404 as a refusal', async () => {
        stubFetch(() =>
            errorResponse(404, 'NOT_FOUND', {
                message: 'Pricing plan not found',
                category: 'not_found',
            }),
        );

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/billing/:planId" element={<PlanDetail />} />
            </Routes>,
            {
                route: '/dashboard/billing/6690aabbccddeeff00112240',
                auth: { status: 'authenticated', admin: adminFixture() },
            },
        );

        expect(await screen.findByText(/no such plan/i)).toBeInTheDocument();
    });
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

describe('subscriptions', () => {
    function stubSubscriptions(rows = [subscriptionFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/billing/subscriptions')) {
                return successResponse(rows, { meta: planListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('names who assigned a term, and marks an administrator', async () => {
        stubSubscriptions();

        render(<SubscriptionsList />);

        expect(await screen.findByText('Ada Nkemelu')).toBeInTheDocument();
        expect(screen.getByText(/administrator/i)).toBeInTheDocument();
    });

    it('reports a self-service term as not assigned rather than unknown', async () => {
        stubSubscriptions([selfServeSubscriptionFixture()]);

        render(<SubscriptionsList />);

        expect(await screen.findByText(/not assigned/i)).toBeInTheDocument();
    });

    it('reports the free tier as never expiring', async () => {
        // `expiresAt: null` is the never-expiring default, not an unknown date —
        // which is also why the expiry filter never returns one.
        stubSubscriptions([selfServeSubscriptionFixture()]);

        render(<SubscriptionsList />);

        expect(await screen.findByText(/never expires/i)).toBeInTheDocument();
    });

    it('surfaces a dangling plan reference by its surviving code', async () => {
        /*
         * `plan.code` is denormalised onto the term while `plan.name` comes from
         * a lookup, so a removed tier leaves a code and no name. This is the only
         * screen where that can happen.
         */
        stubSubscriptions([
            subscriptionFixture({
                plan: { id: '6690aabbccddeeff00112299', code: 'vendor_legacy', name: null },
            }),
        ]);

        render(<SubscriptionsList />);

        expect(await screen.findByText('vendor_legacy')).toBeInTheDocument();
        expect(screen.getByText(/the tier itself is missing/i)).toBeInTheDocument();
    });

    it('renders a permission refusal as a refusal', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'billing.plans.read', mode: 'all' },
            }),
        );

        render(<SubscriptionsList />);

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
});

/**
 * Assigning a plan — the one write on this dashboard that was reachable from
 * nowhere.
 *
 * `assignSubscription` and `AssignPlanDialog` both shipped with the billing
 * phase, fully written and tested, and `grep -rn AssignPlanDialog src/` returned
 * exactly one hit: its own definition. So a subscription could be listed and
 * never assigned. The dialog needs a `Plan` handed to it, and no screen knew both
 * an owner and a target tier — `ChangePlanDialog` is that missing half.
 */
describe('changing a subscription’s plan', () => {
    function stubSubscriptions(rows = [subscriptionFixture()], plans = [planFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/billing/subscriptions')) {
                return successResponse(rows, { meta: planListMetaFixture() });
            }
            if (call.url.includes('/billing/plans')) {
                return successResponse(plans, { meta: planListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers the action on a subscription row', async () => {
        stubSubscriptions();

        render(<SubscriptionsList />);

        expect(await screen.findByRole('button', { name: 'Change plan' })).toBeInTheDocument();
    });

    it('withholds it from an administrator without the assign permission', async () => {
        stubSubscriptions();

        render(<SubscriptionsList />, heldFixture(3));

        await screen.findByText('Douala Fresh Market');
        expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
    });

    it('reads the catalogue only once the operator asks for it', async () => {
        // The dialog is mounted only while open, so a page that never uses it
        // never fetches the plan list.
        const calls = stubSubscriptions();

        render(<SubscriptionsList />);

        await screen.findByText('Douala Fresh Market');
        expect(calls.some((call) => call.url.includes('/billing/plans'))).toBe(false);
    });

    it('narrows the catalogue to the owner’s role', async () => {
        /*
         * A plan's `role` decides which limit fields it carries, and assigning a
         * vendor plan to an agency is `BILLING_PLAN_ROLE_MISMATCH` — filtering
         * here makes that refusal unreachable rather than merely explained.
         */
        const calls = stubSubscriptions();

        render(<SubscriptionsList />);

        await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }));

        const planRead = calls.find((call) => call.url.includes('/billing/plans'));
        expect(new URL(planRead!.url, 'http://localhost').searchParams.get('role')).toBe('vendor');
    });

    it('names the owner it is about to move', async () => {
        stubSubscriptions();

        render(<SubscriptionsList />);

        await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(/Douala Fresh Market/);
    });

    it('shows a defined-but-not-purchasable tier without offering it', async () => {
        // `isActive: false` is a real state, not a missing record — hiding it
        // would make a deliberate configuration look like an absent one.
        stubSubscriptions(
            [subscriptionFixture()],
            [planFixture({ name: 'Legacy', isActive: false })],
        );

        render(<SubscriptionsList />);

        await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
        await userEvent.click(await screen.findByRole('combobox'));

        const option = await screen.findByRole('option', { name: /Legacy/ });
        expect(option).toHaveTextContent(/not purchasable/);
        expect(option).toHaveAttribute('aria-disabled', 'true');
    });

    it('says so when the owner’s role has no plans at all', async () => {
        stubSubscriptions([subscriptionFixture()], []);

        render(<SubscriptionsList />);

        await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }));

        expect(await screen.findByText(/no plans are defined for vendors/i)).toBeInTheDocument();
    });
});
