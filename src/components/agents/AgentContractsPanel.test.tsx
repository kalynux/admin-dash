import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentContractsPanel } from '@/components/agents/AgentContractsPanel';
import {
    agentContractFixture,
    agentDetailFixture,
    agentListMetaFixture,
} from '@/test/agent-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AgentContract } from '@/types/contracts.types';

const AGENCY_ID = '6650bb22cc33dd44ee55ff66';

/**
 * The agent's **roster** — the agencies they hold contracts with.
 *
 * ⚠ This file exists because of a live bug rather than a new feature. The Agency
 * column rendered `agency.contactName ?? agencyId`, and `contactName` is the
 * agency's contact *individual* — so a column headed "Agency" was showing a
 * human's name where a company was meant. `businessName` landed on this row at
 * BR-006 and neither `AgentContract` nor this panel had taken it, so the field
 * that was granted to fix the confusion sat unused for a round. There was no
 * fixture for the shape either, which is why nothing caught it.
 */
function panel(rows: AgentContract[] = [agentContractFixture()], onTransfer = vi.fn()) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/contracts')) {
            return successResponse(rows, { meta: agentListMetaFixture({ total: rows.length }) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <AgentContractsPanel
            agent={agentDetailFixture()}
            reloadToken={0}
            onTransfer={onTransfer}
            canTransfer
        />,
        {
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held: heldFixture(1) },
        },
    );

    return { calls, onTransfer };
}

describe('naming the agency', () => {
    /**
     * ⚠ The fixture's `businessName` and `contactName` are deliberately different
     * strings, so an assertion that accepted the wrong one cannot pass by
     * accident.
     */
    it('renders the business name, not the contact person', async () => {
        panel();

        expect(
            await screen.findByRole('link', { name: 'Littoral Express Delivery' }),
        ).toBeInTheDocument();
        // The regression: a person's name under a heading reading "Agency".
        expect(screen.queryByRole('link', { name: /nadege mballa/i })).not.toBeInTheDocument();
    });

    /**
     * ⚠ Where the fallback *does* land on the contact, the row **says so**. A
     * fallback that silently substitutes one kind of name for another is how this
     * went wrong in the first place, so falling through is allowed and hiding it
     * is not.
     */
    it('labels the contact person when it has to fall through to one', async () => {
        panel([
            agentContractFixture({
                agency: {
                    id: AGENCY_ID,
                    businessName: null,
                    status: 'pending_verification',
                    contactName: 'Nadege Mballa',
                    country: 'CM',
                },
            }),
        ]);

        expect(await screen.findByRole('link', { name: 'Nadege Mballa' })).toBeInTheDocument();
        expect(screen.getByText(/contact person — this agency has/i)).toBeInTheDocument();
    });

    /**
     * ⚠ `agency` is nullable — a contract pointing at an agency that no longer
     * exists — while `agencyId` lives on the contract itself, so the row stays
     * identifiable either way.
     */
    it('keeps the row identifiable when the agency join came back empty', async () => {
        panel([agentContractFixture({ agency: null })]);

        expect(await screen.findByText(/no name recorded/i)).toBeInTheDocument();
        const link = screen
            .getAllByRole('link')
            .find((el) => el.getAttribute('href') === `/dashboard/agencies/${AGENCY_ID}`);
        expect(link).toBeDefined();
    });
});

describe('the transfer hand-off', () => {
    /**
     * ⚠ The whole agency, not the bare id it used to be. The dialog's "Leaving"
     * field is read-only and has to be *recognisable* — and this panel already
     * holds the name, so passing it costs no request. That is what lets the
     * read-only half work for a caller who cannot look an agency up.
     */
    it('hands over the agency object so the dialog can name what is being left', async () => {
        const { onTransfer } = panel();

        await userEvent.click(await screen.findByRole('button', { name: /transfer/i }));

        expect(onTransfer).toHaveBeenCalledWith({
            id: AGENCY_ID,
            businessName: 'Littoral Express Delivery',
            contactName: 'Nadege Mballa',
        });
    });
});
