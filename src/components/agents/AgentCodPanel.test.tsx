import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { AgentCodPanel } from '@/components/agents/AgentCodPanel';
import {
    agentContractFixture,
    agentDetailFixture,
    agentListMetaFixture,
    codAllocationFixture,
} from '@/test/agent-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

const AGENCY_ID = '6650bb22cc33dd44ee55ff66';

/**
 * The agent's cash pool, and the agency names on its per-contract slices.
 *
 * ⚠ **The names are a client-side join that degrades by permission**, and that is
 * the whole point of this file. A slice carries `agencyId` and nothing else.
 * `GET /agents/:agentId/contracts` already carries `agency.businessName`, so one
 * request decorates the whole table — but that endpoint needs `agents.read` **+**
 * `agencies.read` where `cod-allocation` needs only `agents.read`. A caller
 * holding the narrower grant is not entitled to the names, and the panel must
 * neither guess them nor go and collect a 403 finding out.
 */
function panel(held: ReadonlySet<string>) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/cod-allocation')) {
            return successResponse(codAllocationFixture());
        }
        if (call.url.includes('/contracts')) {
            return successResponse([agentContractFixture({ agencyId: AGENCY_ID })], {
                meta: agentListMetaFixture(),
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<AgentCodPanel agent={agentDetailFixture()} reloadToken={0} />, {
        auth: {
            status: 'authenticated',
            admin: adminFixture({ timezone: 'Africa/Douala' }),
        },
        permissions: { held },
    });

    return calls;
}

describe('with both permissions', () => {
    it('names the agency on the slice and keeps the id beneath it', async () => {
        panel(new Set(['agents.read', 'agencies.read']));

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === `/dashboard/agencies/${AGENCY_ID}`);
        expect(link).toBeDefined();
    });

    /**
     * ⚠ `contactName` is a **person** and is never a candidate here: the heading
     * says "Agency", so the fallback is exactly one step — the business name, else
     * the id. Substituting a human would be the BR-006 confusion.
     */
    it('falls through to the id, never to the contact person', async () => {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod-allocation')) {
                return successResponse(codAllocationFixture());
            }
            if (call.url.includes('/contracts')) {
                return successResponse(
                    [
                        agentContractFixture({
                            agencyId: AGENCY_ID,
                            agency: {
                                id: AGENCY_ID,
                                businessName: null,
                                status: 'pending_verification',
                                contactName: 'Nadege Mballa',
                                country: 'CM',
                            },
                        }),
                    ],
                    { meta: agentListMetaFixture() },
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<AgentCodPanel agent={agentDetailFixture()} reloadToken={0} />, {
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: new Set(['agents.read', 'agencies.read']) },
        });

        await screen.findByText('Per-contract slices');
        expect(screen.queryByText('Nadege Mballa')).not.toBeInTheDocument();
    });
});

describe('without agencies.read', () => {
    /**
     * ⚠ Checked **before** the request, not after it is refused. Discovering
     * capability by collecting 403s is the pattern `permissions.md` names outright
     * as the wrong way to find out what an account can do.
     */
    it('never asks for the contracts it is not entitled to read', async () => {
        const calls = panel(new Set(['agents.read']));

        await screen.findByText('Per-contract slices');
        expect(calls.some((call) => call.url.includes('/contracts'))).toBe(false);
    });

    /**
     * Said out loud rather than left as a column of bare ids: an operator who
     * cannot tell why one screen names agencies and this one does not concludes
     * the screen is broken.
     */
    it('says why the ids stand alone', async () => {
        panel(new Set(['agents.read']));

        expect(
            await screen.findByText(/resolving the names needs agency read access/i),
        ).toBeInTheDocument();
        expect(screen.queryByText('Littoral Express Delivery')).not.toBeInTheDocument();
    });
});
