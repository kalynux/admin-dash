import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { ContractHistoryPanel } from '@/components/contracts/ContractHistoryPanel';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { ContractEvent } from '@/types/contracts.types';

const AGENCY_ID = '6650bb22cc33dd44ee55ff66';
const AGENT_ID = '6660112233445566778899aa';

function contractEventFixture(overrides: Partial<ContractEvent> = {}): ContractEvent {
    return {
        id: '6680aabbccddeeff00112233',
        contractId: '6671aabbccddeeff00112240',
        agentId: AGENT_ID,
        agencyId: AGENCY_ID,
        // ⚠ `name`, not `businessName` — an agent is a person. Carried on BOTH
        // feeds, including the one whose path already names them.
        agent: { id: AGENT_ID, name: 'Ibrahim T.' },
        type: 'CONTRACT_APPROVED',
        fromStatus: 'pending',
        toStatus: 'active',
        actorRole: 'agency',
        actorUserId: '6650aabbccddeeff00119911',
        reason: null,
        occurredAt: '2026-02-11T14:20:00.000Z',
        ...overrides,
    };
}

/**
 * `GET /{agencies,agents}/:id/contract-history`.
 *
 * ⚠ **The two sides are not symmetrical, and the asymmetry is the payload's.**
 * BR-016 § 1 put `agent: { id, name }` on every row, batched after
 * `skip`/`limit` — but it names the **agent**, on both feeds. So the agency side
 * of this panel gets a name and the agent side still shows the agency's id:
 * there is no `agency` decoration to read, and no batch-by-ids route to invent
 * one from. The stub throws on anything else, which is what would catch a
 * client-side resolve creeping back in.
 */
function panel(
    side: 'agency' | 'agent',
    held: ReadonlySet<string>,
    event: ContractEvent = contractEventFixture(),
) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/contract-history')) {
            return successResponse([event], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <ContractHistoryPanel
            side={side}
            ownerId={side === 'agency' ? AGENCY_ID : AGENT_ID}
            timeZone="Africa/Douala"
        />,
        {
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held },
        },
    );

    return calls;
}

/**
 * `queryAllBy`, not `getAllBy`: on the degraded case there is **no link at all**
 * on the panel, and `getAllByRole` throws rather than returning an empty list —
 * which would turn the assertion this test is making into an error.
 */
function hrefs() {
    return screen.queryAllByRole('link').map((el) => el.getAttribute('href'));
}

describe('the counterparty column', () => {
    it('links an agent id to the agent, on an agency screen', async () => {
        panel('agency', heldFixture(1));

        await screen.findByText('CONTRACT_APPROVED');
        expect(hrefs()).toContain(`/dashboard/agents/${AGENT_ID}`);
    });

    it('links an agency id to the agency, on an agent screen', async () => {
        panel('agent', heldFixture(1));

        await screen.findByText('CONTRACT_APPROVED');
        expect(hrefs()).toContain(`/dashboard/agencies/${AGENCY_ID}`);
    });

    /**
     * ⚠ **What is visible must be reachable.** This panel needs only
     * `agencies.read` — it is not audit data — so a caller can hold it without
     * `agents.read`, and a link that lands on a denial is worse than no link. The
     * id is still shown, and still copyable.
     */
    it('shows the id without a link when the destination is not reachable', async () => {
        panel('agency', new Set(['agencies.read']));

        await screen.findByText('CONTRACT_APPROVED');
        expect(hrefs()).not.toContain(`/dashboard/agents/${AGENT_ID}`);
        expect(screen.getByText(AGENT_ID)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy agent id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ Not shortened, though this is a table. The rest of the sweep lets a dense
     * row take the head-and-tail form; here the id is not *beside* an identifier,
     * it **is** the only one the row has — and taking fourteen characters away
     * attacks the complaint "the table shows only ids" from the wrong end.
     */
    it('renders the counterparty id whole', async () => {
        panel('agency', heldFixture(1));

        await screen.findByText('CONTRACT_APPROVED');
        expect(screen.getByText(AGENT_ID)).toBeInTheDocument();
    });
});

describe('the actor column', () => {
    /**
     * ⚠ `actorUserId` stays off this panel deliberately, per the contract: read
     * the **role**, not the id, because an `admin` row's id belongs to the
     * wi-admin database and resolves to nothing in the platform's.
     */
    it('shows the role and not the actor id', async () => {
        panel('agency', heldFixture(1));

        await screen.findByText('CONTRACT_APPROVED');
        expect(screen.getByText('agency')).toBeInTheDocument();
        expect(screen.queryByText('6650aabbccddeeff00119911')).not.toBeInTheDocument();
    });
});

describe('naming the agent', () => {
    /**
     * 🔴 **This panel shipped an id-only column with a comment saying a name
     * "is still not owed here"**, for two days after BR-016 § 1 delivered one.
     */
    it('names the agent and keeps the id beneath it', async () => {
        panel('agency', heldFixture(1));

        expect(await screen.findByText('Ibrahim T.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy agent id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ `agent: null` means **the agent record is gone** — a broken state the
     * row is kept to show, and never a fabricated label. The id alone is the
     * honest answer, which is what an identifier-only party renders as.
     */
    it('shows the id alone when the agent record is gone', async () => {
        panel('agency', heldFixture(1), contractEventFixture({ agent: null }));

        expect(
            await screen.findByRole('button', { name: /copy agent id/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText('Ibrahim T.')).not.toBeInTheDocument();
    });

    /**
     * ⚠ **The decoration names the agent on both feeds**, so on an agent's own
     * screen it names the agent the path already named — and the counterparty
     * there is the *agency*, which nothing on this row names. Rendering
     * "Ibrahim T." in a column headed "Agency" would be the BR-006 confusion
     * with the parties swapped.
     */
    it('never puts the agent’s name in the agency column', async () => {
        panel('agent', heldFixture(1));

        expect(
            await screen.findByRole('button', { name: /copy agency id/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText('Ibrahim T.')).not.toBeInTheDocument();
    });
});
