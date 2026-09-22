import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { AgentCodPanel } from '@/components/agents/AgentCodPanel';
import {
    agentDetailFixture,
    codAllocationFixture,
    pinnedAgentDetailFixture,
} from '@/test/agent-fixtures';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { AgentDetail, CodAllocation } from '@/types/agents.types';

const AGENCY_ID = '6650bb22cc33dd44ee55ff66';

/**
 * The agent's cash pool, and the agency names on its per-contract slices.
 *
 * ── What this file used to assert, and why it no longer does ──────────────────
 * The names were a **client-side join** against `GET /agents/:agentId/contracts`,
 * gated on `can(['agents.read', 'agencies.read'], 'all')` with copy for the
 * caller who failed it, and two of the four cases here tested that degradation.
 * Both the join and the gate are gone, so both cases are too — deleted rather
 * than rewritten, because there is nothing left for them to be about:
 *
 * - The slice now carries `agency: { id, businessName, status }` on the wire
 *   (`agents.md` § cod-allocation, BR-016 § 2).
 * - `cod-allocation` needs `agents.read` **+** `agencies.read` — the same pair
 *   the contracts list needed — so the narrower caller the gate existed for
 *   **cannot reach this panel at all**. The branch was unreachable, and a test
 *   that drives an unreachable branch reports coverage of a state the product
 *   does not have.
 *
 * ⚠ The stub below **throws on `/contracts`**, so reintroducing the join fails
 * this file by name rather than quietly costing an extra request.
 */
function renderPanel(held: ReadonlySet<string> = new Set(['agents.read', 'agencies.read'])) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/cod-allocation')) {
            return successResponse(codAllocationFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<AgentCodPanel agent={agentDetailFixture()} reloadToken={0} timeZone="Africa/Douala" />, {
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held },
    });

    return calls;
}

describe('AgentCodPanel', () => {
    it('names the agency from the slice and keeps the id beneath it', async () => {
        renderPanel();

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === `/dashboard/agencies/${AGENCY_ID}`);
        expect(link).toBeDefined();
    });

    /**
     * The regression guard for the deleted join. One request decorates the whole
     * table because the server already did — a second one would be the old
     * behaviour creeping back, and it was bounded by a single page of a hundred
     * contracts, so an agent holding more silently lost names.
     */
    it('reads the allocation and nothing else', async () => {
        const calls = renderPanel();

        await screen.findByText('Littoral Express Delivery');
        expect(calls.filter((call) => call.url.includes('/cod-allocation'))).toHaveLength(1);
        expect(calls.some((call) => call.url.includes('/contracts'))).toBe(false);
    });

    /**
     * ⚠ `contactName` is a **person** and is never a candidate here: the heading
     * says "Agency", so the fallback is exactly one step — the business name, else
     * the id. Substituting a human would be the BR-006 confusion. The wire shape
     * does not even carry one on this route, which is the point: the fallback
     * chain has nowhere to wander to.
     */
    it('falls through to the id when the Magazin has no name', async () => {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod-allocation')) {
                return successResponse(
                    codAllocationFixture({
                        contracts: [
                            {
                                contractId: '6671aabbccddeeff00112240',
                                agencyId: AGENCY_ID,
                                agency: {
                                    id: AGENCY_ID,
                                    businessName: null,
                                    status: 'pending_verification',
                                },
                                status: 'active',
                                threshold: 90000,
                                outstandingBalance: 12500,
                            },
                        ],
                    }),
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<AgentCodPanel agent={agentDetailFixture()} reloadToken={0} timeZone="Africa/Douala" />, {
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: new Set(['agents.read', 'agencies.read']) },
        });

        await screen.findByText('Per-contract slices');
        expect(screen.queryByText('Littoral Express Delivery')).not.toBeInTheDocument();
        // The id is still there, and still opens the agency.
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === `/dashboard/agencies/${AGENCY_ID}`);
        expect(link).toBeDefined();
    });

    /**
     * ⚠ **A deleted agency still consumes the pool**, so the row must render
     * rather than vanish — `agents.md` says the slice is kept precisely because
     * the money is still allocated. This is the one remaining nameless case, and
     * it is a deleted row, not a permission.
     */
    it('renders a slice whose agency row is gone', async () => {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod-allocation')) {
                return successResponse(
                    codAllocationFixture({
                        contracts: [
                            {
                                contractId: '6671aabbccddeeff00112240',
                                agencyId: AGENCY_ID,
                                agency: null,
                                status: 'active',
                                threshold: 90000,
                                outstandingBalance: 12500,
                            },
                        ],
                    }),
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<AgentCodPanel agent={agentDetailFixture()} reloadToken={0} timeZone="Africa/Douala" />, {
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: new Set(['agents.read', 'agencies.read']) },
        });

        await screen.findByText('Per-contract slices');
        // The figures survive the missing name — they come from the same payload.
        // The outstanding balance, not the slice: 90,000 is also the pool's
        // "Allocated to contracts" figure, so it matches twice.
        expect(await screen.findByText('12,500')).toBeInTheDocument();
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === `/dashboard/agencies/${AGENCY_ID}`);
        expect(link).toBeDefined();
    });
});

/**
 * The pool became automatic on 2026-09-21 — `0` until KYC is verified, then the
 * plan's amount, unless an administrator pinned another — and the panel's job is
 * to say where the number came from, never to decide anything from it.
 */
describe('where the pool comes from', () => {
    function renderWith(agent: AgentDetail, allocation: CodAllocation = codAllocationFixture()) {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod-allocation')) return successResponse(allocation);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        renderWithProviders(
            <AgentCodPanel agent={agent} reloadToken={0} timeZone="Africa/Douala" />,
            {
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: new Set(['agents.read', 'agencies.read']) },
            },
        );
    }

    it('names the plan, and says when the agent chose to carry less', async () => {
        renderWith(agentDetailFixture());

        expect(await screen.findByText('From the agent_free plan')).toBeInTheDocument();
        expect(
            screen.getByText(/the agent chose to carry less than their 500,000 limit/i),
        ).toBeInTheDocument();
    });

    it('labels a zero pool as unverified rather than as a plan', async () => {
        const base = agentDetailFixture();
        renderWith(
            agentDetailFixture({
                cod: {
                    ...base.cod,
                    maxThreshold: 0,
                    pool: { ...base.cod.pool, ceiling: 0, source: 'not_verified', planCode: null, selfLimited: false },
                },
            }),
        );

        expect(await screen.findByText('0 — identity not verified')).toBeInTheDocument();
    });

    /** An agent from before the rule keeps the OLD number until the reconcile runs. */
    it('warns that an unsynced pool may still be the old number', async () => {
        const base = agentDetailFixture();
        renderWith(agentDetailFixture({ cod: { ...base.cod, pool: { ...base.cod.pool, syncedAt: null } } }));

        expect(await screen.findByText(/not yet synced/i)).toBeInTheDocument();
    });

    it('shows who pinned the pool, and why', async () => {
        renderWith(pinnedAgentDetailFixture());

        expect(await screen.findByText('Pinned by an administrator')).toBeInTheDocument();
        expect(screen.getByText(/by Awa N\./)).toBeInTheDocument();
        expect(
            screen.getByText(/Trusted long-standing agent; approved by ops lead/),
        ).toBeInTheDocument();
    });

    it('draws no pin block when there is no pin', async () => {
        renderWith(agentDetailFixture());

        await screen.findByText('From the agent_free plan');
        expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    });

    /**
     * The one figure that explains a headroom of 0 — without it the screen shows
     * a pool with room nobody can use and no reason why.
     */
    it('explains an over-allocated pool', async () => {
        renderWith(
            agentDetailFixture(),
            codAllocationFixture({ maxThreshold: 0, headroom: 0, overAllocatedBy: 90000 }),
        );

        const warning = (await screen.findByText(/than the pool/i)).closest('p');
        expect(warning).toHaveTextContent(/contracts hold 90,000 more than the pool/i);
        expect(warning).toHaveTextContent(/capped at the pool/i);
    });

    it('says nothing about over-allocation when there is none', async () => {
        renderWith(agentDetailFixture());

        await screen.findByText('Headroom');
        expect(screen.queryByText(/than the pool/i)).not.toBeInTheDocument();
    });
});
