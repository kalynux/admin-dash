import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TransferAgentDialog } from '@/components/agents/AgentWriteDialogs';
import { agencyFixture } from '@/test/agency-fixtures';
import { agentDetailFixture } from '@/test/agent-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { Agency } from '@/types/agencies.types';

const SOURCE_ID = '6650bb22cc33dd44ee55ff66';
const OTHER_ID = '665c0011223344556677889a';

/**
 * `POST /agents/transfer` — moving an agent from one agency to another.
 *
 * Two halves, and they answer to different permissions. **Leaving** is read-only
 * and comes from the row the transfer was started from, so it works for anyone
 * holding `agents.transfer`. **Joining** searches the agency directory, which
 * needs `agencies.read` — a permission `agents.transfer` does not imply, so the
 * picker must degrade to a plain id field rather than collect a 403.
 */
function dialog({
    held = new Set(['agents.transfer', 'agencies.read']),
    directory = [
        agencyFixture({ id: SOURCE_ID, businessName: 'Littoral Express Delivery' }),
        agencyFixture({ id: OTHER_ID, businessName: 'Sanaga Freight' }),
    ],
    fromAgency = {
        id: SOURCE_ID,
        businessName: 'Littoral Express Delivery',
        contactName: 'Nadege Mballa',
    },
}: {
    held?: ReadonlySet<string>;
    directory?: Agency[];
    fromAgency?: { id: string; businessName: string | null; contactName: string | null };
} = {}) {
    const calls = stubFetch((call: FetchCall) => {
        if (call.url.includes('/agencies')) {
            return successResponse(directory, {
                meta: { total: directory.length, page: 1, limit: 9, pages: 1 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <TransferAgentDialog
            agent={agentDetailFixture()}
            fromAgency={fromAgency}
            open
            onOpenChange={vi.fn()}
            onDone={vi.fn()}
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

describe('the agency being left', () => {
    /**
     * ⚠ It used to render a raw 24-hex id in a mono input, which an operator
     * cannot recognise — so they had no way to tell whether they had opened the
     * right row. The name leads and the id is demoted beneath it.
     */
    it('names the source agency rather than showing a bare id', async () => {
        dialog();

        const leaving = (await screen.findByText('Leaving')).parentElement!;
        expect(within(leaving).getByText('Littoral Express Delivery')).toBeInTheDocument();
        expect(within(leaving).getByRole('button', { name: /copy agency id/i })).toBeInTheDocument();
    });

    /** It is the row the transfer started from, not a choice — so it is read-only. */
    it('offers no control to change it', async () => {
        dialog();

        const leaving = (await screen.findByText('Leaving')).parentElement!;
        expect(within(leaving).queryByRole('textbox')).not.toBeInTheDocument();
        expect(within(leaving).queryByRole('combobox')).not.toBeInTheDocument();
    });

    /**
     * ⚠ `contactName` is a **person**. Where the fallback lands on one, the field
     * says so rather than passing a human off as the business.
     */
    it('labels the contact person when the agency has no business name', async () => {
        dialog({
            fromAgency: { id: SOURCE_ID, businessName: null, contactName: 'Nadege Mballa' },
        });

        const leaving = (await screen.findByText('Leaving')).parentElement!;
        expect(within(leaving).getByText('Nadege Mballa')).toBeInTheDocument();
        expect(within(leaving).getByText(/contact person/i)).toBeInTheDocument();
    });
});

describe('the agency being joined', () => {
    /**
     * ⚠ Excluding the source **removes a choice; it does not enforce a rule.** The
     * schema's `.refine()` that the two differ stays exactly where it is, and so
     * does the platform's own refusal — this only means the operator cannot reach
     * that refusal by accident. A list is an affordance, never a validator.
     */
    it('drops the source agency from the options', async () => {
        dialog();

        expect(await screen.findByRole('button', { name: /sanaga freight/i })).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /littoral express delivery/i }),
        ).not.toBeInTheDocument();
    });

    it('fills the id field from the chosen row', async () => {
        dialog();

        await userEvent.click(await screen.findByRole('button', { name: /sanaga freight/i }));

        /*
          Narrowed by role: the label text also reaches the copy button that sits
          inside the same `<label>` element, so `getByLabelText` alone is
          ambiguous. The textbox is the field the picker fills.
        */
        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: /agency id/i })).toHaveValue(OTHER_ID);
        });
    });

    /**
     * ⚠ An empty `?search=` is a **400**, not an ignored parameter, so nothing is
     * sent until there is a term. The first page therefore arrives unfiltered,
     * which is what an operator opening a picker wants.
     */
    it('sends no search parameter until there is a term', async () => {
        const calls = dialog();

        await screen.findByRole('button', { name: /sanaga freight/i });
        expect(new URL(calls[0].url, 'http://localhost').searchParams.has('search')).toBe(false);
    });

    it('narrows the directory on a typed term', async () => {
        const calls = dialog();
        await screen.findByRole('button', { name: /sanaga freight/i });

        await userEvent.type(
            screen.getByRole('textbox', { name: /search the agency directory/i }),
            'sanaga',
        );

        await waitFor(() => {
            const last = new URL(calls[calls.length - 1].url, 'http://localhost');
            expect(last.searchParams.get('search')).toBe('sanaga');
        });
    });

    /**
     * ⚠ `agents.transfer` does not imply `agencies.read`, and the picker's
     * endpoint needs the second. It degrades to the id field the picker would have
     * filled — not to a dead end — and never collects the 403.
     */
    it('degrades to a plain id field without agencies.read, and asks for nothing', async () => {
        const calls = dialog({ held: new Set(['agents.transfer']) });

        expect(await screen.findByRole('textbox', { name: /joining/i })).toBeInTheDocument();
        expect(
            screen.queryByRole('textbox', { name: /search the agency directory/i }),
        ).not.toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});
