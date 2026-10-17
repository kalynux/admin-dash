/**
 * The customer's cash-on-delivery restriction on the user detail (2026-10-10).
 *
 * The panel itself is pinned in `CodRestrictionPanel.test.tsx`. These pin what
 * only the page decides: **who is shown a switch at all** (a customer with a
 * real profile, on a service that knows the field), that Support sees the state
 * and no button, and that the badge follows the write's own answer until the
 * next read of the account replaces it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { UserDetail } from '@/pages/users/UserDetail';
import {
    NOT_RESTRICTED,
    codRestrictionFixture,
    customerCodReportFixture,
} from '@/test/cod-restriction-fixtures';
import {
    adminFixture,
    auditMetaFixture,
    missingRoleProfileFixture,
    roleProfileFixture,
    userDetailFixture,
} from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { CodRestriction } from '@/types/cod-restriction.types';
import type { UserDetail as UserDetailRecord } from '@/types/users.types';

const USER_ID = '665f1c2a9b3e4a91c7d2e5f0';
const RESTRICT = { name: /^restrict cash on delivery$/i };
const LIFT = { name: /^lift restriction$/i };
const HEADING = 'Cash on delivery restriction';

afterEach(() => {
    vi.restoreAllMocks();
});

/** A customer-and-agent account whose customer entry carries the field. */
function customer(
    codRestriction: CodRestriction | null,
    overrides: Partial<UserDetailRecord> = {},
): UserDetailRecord {
    return userDetailFixture({
        profiles: [
            roleProfileFixture({ codRestriction }),
            roleProfileFixture({ role: 'agent', id: '665f1c2a9b3e4a91c7d2e5f2' }),
        ],
        ...overrides,
    });
}

type Handler = (call: FetchCall) => Response | undefined;

/** The detail, the closure list and the trail; `extra` answers first. */
function stub(record: UserDetailRecord | (() => UserDetailRecord), extra?: Handler) {
    return stubFetch((call: FetchCall) => {
        const answered = extra?.(call);
        if (answered) return answered;
        if (call.url.includes('/closure-requests')) return successResponse([]);
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { ...auditMetaFixture({ total: 0, pages: 0 }) } });
        }
        if (call.method === 'GET' && call.url.endsWith(`/users/${USER_ID}`)) {
            return successResponse(typeof record === 'function' ? record() : record);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(held: string[]) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/users/:userId" element={<UserDetail />} />
        </Routes>,
        {
            route: `/dashboard/users/${USER_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { status: 'ready', held: new Set(held) },
        },
    );
}

const ADMIN = ['users.read', 'users.cod.restrict'];
const SUPPORT = ['users.read'];

describe('who is shown the switch', () => {
    it('shows it on a customer, from the detail alone', async () => {
        const calls = stub(customer(null));
        detail(ADMIN);

        expect(await screen.findByText(HEADING)).toBeInTheDocument();
        expect(screen.getByText('Not restricted')).toBeInTheDocument();
        expect(screen.getByRole('button', RESTRICT)).toBeInTheDocument();
        // The badge needs no second call.
        expect(calls.some((call) => call.url.includes('/cod-restriction'))).toBe(false);
    });

    it('omits it on an account without the customer role', async () => {
        stub(
            userDetailFixture({
                roles: ['agent'],
                profiles: [roleProfileFixture({ role: 'agent', id: '665f1c2a9b3e4a91c7d2e5f2' })],
            }),
        );
        detail(ADMIN);

        await screen.findByText('Role profiles');
        expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('omits it when the customer profile is missing — all three routes would 404', async () => {
        stub(
            userDetailFixture({
                roles: ['customer'],
                profiles: [missingRoleProfileFixture('customer')],
            }),
        );
        detail(ADMIN);

        await screen.findByText(/the customer profile is missing/i);
        expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
    });

    it('omits it against a service that does not send the field, rather than saying "not restricted"', async () => {
        stub(userDetailFixture());
        detail(ADMIN);

        await screen.findByText('Role profiles');
        expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
        expect(screen.queryByText('Not restricted')).not.toBeInTheDocument();
    });

    it('shows Support the restriction and its reason, and no button', async () => {
        stub(customer(codRestrictionFixture()));
        detail(SUPPORT);

        expect(await screen.findByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(/by Ada Admin/)).toBeInTheDocument();
        expect(screen.getByText(/Refused three parcels without a reason/)).toBeInTheDocument();
        expect(screen.queryByRole('button', LIFT)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('still offers it on a suspended account, which neither service refuses', async () => {
        stub(
            customer(null, {
                status: 'suspended',
                suspension: {
                    at: '2026-10-01T08:00:00.000Z',
                    reason: 'Chargeback fraud',
                    by: null,
                },
            }),
        );
        detail(ADMIN);

        expect(await screen.findByRole('button', RESTRICT)).toBeInTheDocument();
    });

    it('shows the state on a closed account and offers nothing', async () => {
        stub(
            customer(codRestrictionFixture(), {
                status: 'closed',
                closedAt: '2026-10-02T08:00:00.000Z',
                email: null,
                phone: null,
            }),
        );
        detail(ADMIN);

        expect(await screen.findByText('Restricted')).toBeInTheDocument();
        expect(screen.queryByRole('button', LIFT)).not.toBeInTheDocument();
    });
});

describe('the badge follows the response', () => {
    async function restrict(reason: string) {
        await userEvent.click(await screen.findByRole('button', RESTRICT));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), reason);
        await userEvent.click(within(dialog).getByRole('button', RESTRICT));
    }

    it('restricts, and shows the answer without re-reading the account', async () => {
        const calls = stub(customer(null), (call) =>
            call.method === 'PUT'
                ? successResponse(customerCodReportFixture(), {
                      message: 'Cash on delivery restricted for this customer',
                  })
                : undefined,
        );
        detail(ADMIN);

        await restrict('Refused three parcels without a reason');

        expect(await screen.findByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(/by Ada Admin/)).toBeInTheDocument();
        expect(screen.getByRole('button', LIFT)).toBeInTheDocument();

        const put = calls.find((call) => call.method === 'PUT');
        expect(new URL(put!.url).pathname).toBe(`/api/v1/users/${USER_ID}/cod-restriction`);
        expect(JSON.parse(put!.body ?? '{}')).toEqual({
            reason: 'Refused three parcels without a reason',
        });
        // The write answers the report the page shows; the account is not re-read.
        expect(
            calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/users/${USER_ID}`)),
        ).toHaveLength(1);
    });

    it('lifts, and goes back to Not restricted', async () => {
        stub(customer(codRestrictionFixture()), (call) =>
            call.method === 'POST' && call.url.endsWith('/cod-restriction/lift')
                ? successResponse(customerCodReportFixture(NOT_RESTRICTED))
                : undefined,
        );
        detail(ADMIN);

        await userEvent.click(await screen.findByRole('button', LIFT));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), 'Customer explained');
        await userEvent.click(within(dialog).getByRole('button', LIFT));

        expect(await screen.findByText('Not restricted')).toBeInTheDocument();
        expect(screen.getByRole('button', RESTRICT)).toBeInTheDocument();
    });

    it('lets the next read of the account replace a write’s answer', async () => {
        // The write says restricted; by the time the page is refreshed a
        // colleague has lifted it. The service's newer answer must win.
        let stored: CodRestriction | null = null;
        stub(
            () => customer(stored),
            (call) =>
                call.method === 'PUT' ? successResponse(customerCodReportFixture()) : undefined,
        );
        detail(ADMIN);

        await restrict('Refused three parcels');
        expect(await screen.findByText('Restricted')).toBeInTheDocument();

        stored = null;
        await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

        await waitFor(() => expect(screen.getByText('Not restricted')).toBeInTheDocument());
    });
});
