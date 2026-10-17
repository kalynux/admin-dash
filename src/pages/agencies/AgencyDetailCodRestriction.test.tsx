/**
 * The agency's cash-on-delivery restriction on the agency detail (2026-10-10).
 *
 * The panel is pinned in `CodRestrictionPanel.test.tsx`. These pin what only the
 * page decides: that the switch sits on the Cash on delivery tab **beside the
 * limit**, that the limit panel says so next to `headroom` the moment a write
 * answers — headroom is an amount and knows nothing about the switch — and that
 * Support sees the state with no button.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AgencyDetail } from '@/pages/agencies/AgencyDetail';
import { agencyCodLimitFixture, agencyDetailFixture } from '@/test/agency-fixtures';
import {
    COD_AGENCY_ID,
    NOT_RESTRICTED,
    agencyCodReportFixture,
    codRestrictionFixture,
} from '@/test/cod-restriction-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AgencyCodLimit, AgencyDetail as AgencyDetailRecord } from '@/types/agencies.types';

const RESTRICT = { name: /^restrict cash on delivery$/i };
const LIFT = { name: /^lift restriction$/i };
const HEADING = 'Cash on delivery restriction';
const BESIDE_HEADROOM = /receives no new cash-on-delivery shipment, whatever the headroom above says/i;

afterEach(() => {
    vi.restoreAllMocks();
});

type Handler = (call: FetchCall) => Response | undefined;

function stub(
    record: AgencyDetailRecord,
    { limit = agencyCodLimitFixture(), extra }: { limit?: AgencyCodLimit; extra?: Handler } = {},
) {
    return stubFetch((call: FetchCall) => {
        const answered = extra?.(call);
        if (answered) return answered;
        if (call.method === 'GET' && call.url.endsWith('/cod-limit')) return successResponse(limit);
        if (call.method === 'GET' && call.url.endsWith(`/agencies/${COD_AGENCY_ID}`)) {
            return successResponse(record);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

async function openCodTab(held: string[]) {
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/agencies/:agencyId" element={<AgencyDetail />} />
        </Routes>,
        {
            route: `/dashboard/agencies/${COD_AGENCY_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { status: 'ready', held: new Set(held) },
        },
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Cash on delivery' }));
    // The limit has settled once its headroom is on screen.
    await screen.findByText('Headroom');
}

const ADMIN = ['agencies.read', 'agencies.cod.restrict'];
const SUPPORT = ['agencies.read'];

describe('the Cash on delivery tab', () => {
    it('shows the switch beside the limit, with nothing said next to headroom while off', async () => {
        stub(agencyDetailFixture({ codRestriction: null }));
        await openCodTab(ADMIN);

        expect(screen.getByText(HEADING)).toBeInTheDocument();
        expect(screen.getByText('Not restricted')).toBeInTheDocument();
        expect(screen.getByRole('button', RESTRICT)).toBeInTheDocument();
        expect(screen.queryByText(BESIDE_HEADROOM)).not.toBeInTheDocument();
    });

    it('says a restricted agency takes no COD shipment, right where the headroom is', async () => {
        // 270,000 of headroom, and still no COD work: the two are independent.
        stub(agencyDetailFixture({ codRestriction: codRestrictionFixture() }));
        await openCodTab(ADMIN);

        expect(screen.getByText('270,000')).toBeInTheDocument();
        expect(screen.getByText(BESIDE_HEADROOM)).toBeInTheDocument();
        expect(screen.getByText('Restricted')).toBeInTheDocument();
        expect(screen.getByRole('button', LIFT)).toBeInTheDocument();
    });

    it('shows Support the restriction and its reason, and no button', async () => {
        stub(
            agencyDetailFixture({
                codRestriction: codRestrictionFixture({
                    reason: 'Three remittances short in two weeks',
                }),
            }),
        );
        await openCodTab(SUPPORT);

        expect(screen.getByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(/Three remittances short in two weeks/)).toBeInTheDocument();
        expect(screen.getByText(BESIDE_HEADROOM)).toBeInTheDocument();
        expect(screen.queryByRole('button', LIFT)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('restricts, and the limit panel says so at once', async () => {
        const calls = stub(agencyDetailFixture({ codRestriction: null }), {
            extra: (call) =>
                call.method === 'PUT' ? successResponse(agencyCodReportFixture()) : undefined,
        });
        await openCodTab(ADMIN);

        await userEvent.click(screen.getByRole('button', RESTRICT));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByRole('textbox'),
            'Three remittances short in two weeks',
        );
        await userEvent.click(within(dialog).getByRole('button', RESTRICT));

        expect(await screen.findByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(BESIDE_HEADROOM)).toBeInTheDocument();

        const put = calls.find((call) => call.method === 'PUT');
        expect(new URL(put!.url).pathname).toBe(
            `/api/v1/agencies/${COD_AGENCY_ID}/cod-restriction`,
        );
        expect(JSON.parse(put!.body ?? '{}')).toEqual({
            reason: 'Three remittances short in two weeks',
        });
    });

    it('lifts, and the note beside the headroom goes — even though the limit read is older', async () => {
        // The limit report still says `codRestricted: true`; the write's answer
        // is newer and must win, or the tab contradicts itself.
        stub(agencyDetailFixture({ codRestriction: codRestrictionFixture() }), {
            limit: agencyCodLimitFixture({
                codRestricted: true,
                codRestrictedAt: '2026-10-10T09:30:00.000Z',
            }),
            extra: (call) =>
                call.method === 'POST' && call.url.endsWith('/cod-restriction/lift')
                    ? successResponse(agencyCodReportFixture(NOT_RESTRICTED))
                    : undefined,
        });
        await openCodTab(ADMIN);
        expect(screen.getByText(BESIDE_HEADROOM)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', LIFT));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), 'Shortfalls settled');
        await userEvent.click(within(dialog).getByRole('button', LIFT));

        expect(await screen.findByText('Not restricted')).toBeInTheDocument();
        expect(screen.queryByText(BESIDE_HEADROOM)).not.toBeInTheDocument();
    });

    it('omits the switch against a service that does not send the field, and still reads the limit’s own flag', async () => {
        stub(agencyDetailFixture(), {
            limit: agencyCodLimitFixture({
                codRestricted: true,
                codRestrictedAt: '2026-10-10T09:30:00.000Z',
            }),
        });
        await openCodTab(ADMIN);

        expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
        expect(screen.getByText(BESIDE_HEADROOM)).toBeInTheDocument();
    });
});
