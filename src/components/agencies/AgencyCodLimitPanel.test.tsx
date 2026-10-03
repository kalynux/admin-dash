import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgencyCodLimitPanel } from '@/components/agencies/AgencyCodLimitPanel';
import {
    agencyCodLimitFixture,
    agencyDetailFixture,
    pinnedAgencyCodLimitFixture,
} from '@/test/agency-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AgencyCodLimit } from '@/types/agencies.types';

/**
 * The agency COD limit (2026-10-02). Read with `agencies.read` — Support holds
 * it — and written with `agencies.cod_limit.set`, a `financial` permission Support
 * never holds, so the buttons are hidden rather than left to `403`.
 */
const READ_ONLY = new Set(['agencies.read']);
const CAN_SET = new Set(['agencies.read', 'agencies.cod_limit.set']);

function renderPanel(
    limit: AgencyCodLimit,
    held: Set<string> = CAN_SET,
    onWrite?: (call: FetchCall) => Response,
) {
    // The server's state: a successful write moves it, so the re-read the panel
    // issues afterwards sees what was written — as the real service would.
    let current = limit;
    const calls = stubFetch(async (call: FetchCall) => {
        if (call.method === 'GET' && call.url.endsWith('/cod-limit')) return successResponse(current);
        if (onWrite && call.method !== 'GET') {
            const response = onWrite(call);
            if (response.ok) {
                current = ((await response.clone().json()) as { data: AgencyCodLimit }).data;
            }
            return response;
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <AgencyCodLimitPanel agency={agencyDetailFixture()} timeZone="Africa/Douala" />,
        {
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
    return calls;
}

describe('AgencyCodLimitPanel', () => {
    it('shows the platform default with the exposure split', async () => {
        renderPanel(agencyCodLimitFixture());

        expect(await screen.findByText('Platform default')).toBeInTheDocument();
        expect(screen.getByText('730,000')).toBeInTheDocument();
        expect(screen.getByText('In deliveries (6)')).toBeInTheDocument();
        expect(screen.getByText('Collected, not remitted (4)')).toBeInTheDocument();
        expect(screen.getByText('270,000')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: /cash held/i })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a pin with its amount, author, date and reason', async () => {
        renderPanel(pinnedAgencyCodLimitFixture());

        expect(await screen.findByText('Pinned')).toBeInTheDocument();
        expect(screen.getByText(/by Ada Admin/)).toBeInTheDocument();
        expect(screen.getByText(/Long-standing partner, remits daily/)).toBeInTheDocument();
    });

    it('falls back to the source when the pin has no author name', async () => {
        const pinned = pinnedAgencyCodLimitFixture();
        renderPanel({ ...pinned, override: { ...pinned.override!, setByName: null } });

        expect(await screen.findByText(/by admin/)).toBeInTheDocument();
    });

    /** G-1: check-then-act, so over limit can happen and must be shown, not assumed away. */
    it('says prominently when the agency holds more than its limit', async () => {
        renderPanel(
            agencyCodLimitFixture({
                limit: 500000,
                headroom: 0,
                overLimit: true,
            }),
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Holds more than its limit — the next vendor dispatch to this agency will be refused until cash comes back.',
        );
    });

    it('hides pin and release from an administrator without agencies.cod_limit.set', async () => {
        renderPanel(pinnedAgencyCodLimitFixture(), READ_ONLY);

        await screen.findByText('Pinned');
        expect(screen.queryByRole('button', { name: /pin/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
    });

    it('offers Release only on a pin', async () => {
        renderPanel(agencyCodLimitFixture());

        expect(await screen.findByRole('button', { name: /pin a limit/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
    });

    it('pins with a reason and shows the answer', async () => {
        const calls = renderPanel(agencyCodLimitFixture(), CAN_SET, () =>
            successResponse(pinnedAgencyCodLimitFixture()),
        );

        await userEvent.click(await screen.findByRole('button', { name: /pin a limit/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/not of your reason or your name/i)).toBeInTheDocument();

        await userEvent.type(within(dialog).getByLabelText(/pinned limit/i), '1500000');
        await userEvent.type(
            within(dialog).getByLabelText(/^reason/i),
            'Long-standing partner, remits daily',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: /pin limit/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
        const put = calls.find((call) => call.method === 'PUT')!;
        expect(JSON.parse(put.body ?? '{}')).toEqual({
            maxAmount: 1500000,
            reason: 'Long-standing partner, remits daily',
        });
        expect(await screen.findByText('Pinned')).toBeInTheDocument();
    });

    it('requires a reason before pinning', async () => {
        const calls = renderPanel(agencyCodLimitFixture(), CAN_SET, () =>
            successResponse(pinnedAgencyCodLimitFixture()),
        );

        await userEvent.click(await screen.findByRole('button', { name: /pin a limit/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/pinned limit/i), '1500000');
        await userEvent.click(within(dialog).getByRole('button', { name: /pin limit/i }));

        expect(await within(dialog).findByText(/a reason is required/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    });

    /** jovi-mall owns the ceiling; the client names it only from `details.max`. */
    it('names the ceiling from the refusal, with no maximum of its own', async () => {
        renderPanel(agencyCodLimitFixture(), CAN_SET, () =>
            errorResponse(400, 'PLATFORM_OPERATION_REJECTED', {
                category: 'validation',
                details: { platformCode: 'VALIDATION_ERROR', requested: 200000000, min: 0, max: 100000000 },
            }),
        );

        await userEvent.click(await screen.findByRole('button', { name: /pin a limit/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/pinned limit/i), '200000000');
        await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'A very large partner');
        await userEvent.click(within(dialog).getByRole('button', { name: /pin limit/i }));

        expect(
            await within(dialog).findByText('The most you can pin is 100,000,000'),
        ).toBeInTheDocument();
    });

    it('releases a pin with a reason', async () => {
        const calls = renderPanel(pinnedAgencyCodLimitFixture(), CAN_SET, () =>
            successResponse(agencyCodLimitFixture()),
        );

        await userEvent.click(await screen.findByRole('button', { name: /release/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Partnership review closed');
        await userEvent.click(within(dialog).getByRole('button', { name: /release pin/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toMatch(/\/cod-limit\/release$/);
        expect(JSON.parse(post.body ?? '{}')).toEqual({ reason: 'Partnership review closed' });
    });
});
