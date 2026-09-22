import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssignabilityCheck } from '@/components/agents/AssignabilityCheck';
import { assignabilityFixture } from '@/test/agent-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AgentAssignability } from '@/types/agents.types';

const AGENT_ID = '6660112233445566778899aa';
const AGENCY_ID = '6650bb22cc33dd44ee55ff66';
const SHIPMENT_ID = '6a90228701508373b234f6e8';

/**
 * `GET /agents/:agentId/assignability` — the whole "why can this agent not take
 * this work?" answer, both families of gate.
 *
 * ⚠ It had **no service function and no screen** until 2026-09-22 while this
 * repository said every route had one. The stub answers this route alone and
 * throws on `/eligibility`, so the row's old platform-half-only check cannot
 * come back unnoticed.
 */
function check(answer: () => Response = () => successResponse(assignabilityFixture())) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/assignability')) return answer();
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<AssignabilityCheck agentId={AGENT_ID} agencyId={AGENCY_ID} />, {
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held: heldFixture(1) },
    });

    return calls;
}

/** The fixture with the cash gate's `limit` replaced — the pool binding, or not. */
function withLimit(limit: Record<string, unknown>): AgentAssignability {
    const base = assignabilityFixture();
    return {
        ...base,
        gates: base.gates.map((gate) =>
            gate.gate === 'cod_exposure'
                ? {
                      ...gate,
                      observed: {
                          ...gate.observed,
                          limit: {
                              ...(gate.observed.limit as Record<string, unknown>),
                              ...limit,
                          },
                      },
                  }
                : gate,
        ),
    };
}

describe('the verdict', () => {
    it('asks with the agency and no shipment by default', async () => {
        const calls = check();

        expect(await screen.findByText('Cannot be dispatched to')).toBeInTheDocument();
        const url = new URL(calls[0].url);
        expect(url.pathname).toMatch(new RegExp(`/agents/${AGENT_ID}/assignability$`));
        expect(url.searchParams.get('agencyId')).toBe(AGENCY_ID);
        // Strict query: an absent shipment is omitted, never sent empty.
        expect(url.searchParams.has('shipmentId')).toBe(false);
        expect(screen.getByText(/no shipment given/i)).toBeInTheDocument();
    });

    it('renders both families, with the platform rules first', async () => {
        check();

        const platform = await screen.findByText('Platform rules');
        const contract = screen.getByText('Contract terms');
        expect(
            platform.compareDocumentPosition(contract) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    /** "Never ran" must not read as "passed". */
    it('says a skipped gate was skipped', async () => {
        check();

        expect(await screen.findByText('skipped')).toBeInTheDocument();
    });

    it('shows the limit the gate decided, not the slice it started from', async () => {
        check();

        await screen.findByText('Limit');
        // effectiveLimit 100,000 — the slice 200,000 halved by reduced trust.
        expect(screen.getByText('100,000')).toBeInTheDocument();
        expect(screen.getByText('200,000')).toBeInTheDocument();
        expect(screen.getByText("This agency's slice")).toBeInTheDocument();
    });

    it('turns the remedies into sentences', async () => {
        check();

        expect(await screen.findByText(/deposit 20,400 of the cash they hold/i)).toBeInTheDocument();
        expect(screen.getByText(/raise the trust score from 75 to 80/i)).toBeInTheDocument();
    });

    it('renders a dependency failure as unavailable, not as a refusal', async () => {
        check(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );

        expect(await screen.findByText(/this is not a refusal/i)).toBeInTheDocument();
        expect(screen.queryByText('Cannot be dispatched to')).not.toBeInTheDocument();
    });
});

/**
 * The changelog's one instruction for this read. The platform's own summary line
 * says *"the contract threshold of {base}"* even when the agent's pool set
 * `base`, so the screen must say which cap bound rather than let that line blame
 * the contract.
 */
describe('when the agent pool binds', () => {
    it('says the agent pool set the limit, not the slice', async () => {
        check(() =>
            successResponse(withLimit({ agentPool: 120000, poolBinds: true, base: 120000 })),
        );

        expect(await screen.findByText(/agent's own COD pool/i)).toBeInTheDocument();
        expect(screen.getByText(/raising the slice will not change this answer/i)).toBeInTheDocument();
        expect(
            screen.getByText(/will not help while the agent's own pool is the limit/i),
        ).toBeInTheDocument();
    });

    it('says nothing of the kind when the slice set the limit', async () => {
        check();

        await screen.findByText('Limit');
        expect(screen.queryByText(/agent's own COD pool/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/will not help/i)).not.toBeInTheDocument();
    });

    /** A build from before the pool cap carries neither field; that is "did not bind". */
    it('treats a limit with no pool fields as not binding', async () => {
        check(() => successResponse(withLimit({ agentPool: undefined, poolBinds: undefined })));

        await screen.findByText('Limit');
        expect(screen.queryByText(/agent's own COD pool/i)).not.toBeInTheDocument();
    });
});

describe('asking about one shipment', () => {
    it('sends the shipment id only once it is a whole id', async () => {
        const calls = check();
        await screen.findByText('Cannot be dispatched to');

        const button = screen.getByRole('button', { name: /check this shipment/i });
        await userEvent.type(screen.getByLabelText(/ask about one shipment/i), 'abc');
        expect(button).toBeDisabled();

        await userEvent.clear(screen.getByLabelText(/ask about one shipment/i));
        await userEvent.type(screen.getByLabelText(/ask about one shipment/i), SHIPMENT_ID);
        await userEvent.click(button);

        await waitFor(() => {
            expect(
                calls.some((call) => new URL(call.url).searchParams.get('shipmentId') === SHIPMENT_ID),
            ).toBe(true);
        });
    });
});
