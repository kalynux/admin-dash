/**
 * Role closure on the user detail (jovi-mall ADR-A10, 2026-10-04).
 *
 * The administrator ASKS; only the user can close. These pin the parts a
 * reasonable change gets backwards: who sees the action (`users.close`, never
 * Support), that refusals branch on `details.platformCode`, that a blocked
 * request shows its checklist rather than a generic failure, and that nothing
 * on this screen confirms anything.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { notify } from '@/lib/notify';
import { UserDetail } from '@/pages/users/UserDetail';
import { adminFixture, auditMetaFixture, userDetailFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { RoleClosureRequest, UserDetail as UserDetailRecord } from '@/types/users.types';

const USER_ID = '665f1c2a9b3e4a91c7d2e5f0';
const REQUEST = { name: /request closure/i };

afterEach(() => {
    vi.restoreAllMocks();
});

function closureFixture(overrides: Partial<RoleClosureRequest> = {}): RoleClosureRequest {
    return {
        id: '6710aa000000000000000001',
        userId: USER_ID,
        role: 'agent',
        roleEntityId: '665f1c2a9b3e4a91c7d2e5f2',
        status: 'pending',
        reason: 'Agent asked by phone to stop delivering',
        requestedBy: { id: '6600000000000000000000aa', name: 'Awa N.' },
        requestedAt: '2026-10-04T09:12:00.000Z',
        expiresAt: '2026-10-11T09:12:00.000Z',
        warnings: [],
        resolvedAt: null,
        resolvedBy: null,
        declineNote: null,
        outcome: null,
        ...overrides,
    };
}

type Handler = (call: FetchCall) => Response | undefined;

/** The detail, the request list and the trail; `extra` answers writes first. */
function stub({
    record = userDetailFixture(),
    requests = [] as RoleClosureRequest[] | (() => RoleClosureRequest[]),
    extra,
}: {
    record?: UserDetailRecord;
    requests?: RoleClosureRequest[] | (() => RoleClosureRequest[]);
    extra?: Handler;
} = {}) {
    return stubFetch((call: FetchCall) => {
        const answered = extra?.(call);
        if (answered) return answered;
        if (call.url.includes('/closure-requests')) {
            return successResponse(typeof requests === 'function' ? requests() : requests);
        }
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { ...auditMetaFixture({ total: 0, pages: 0 }) } });
        }
        if (call.url.includes(`/users/${USER_ID}`)) return successResponse(record);
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

async function openRequestFor(role: 'customer' | 'agent') {
    await screen.findByRole('heading', { level: 1 });
    const buttons = await screen.findAllByRole('button', REQUEST);
    // Profiles render in `roles` order: customer, then agent.
    await userEvent.click(buttons[role === 'customer' ? 0 : 1]);
    return screen.findByRole('dialog');
}

describe('who is offered it', () => {
    it('offers one Request closure per held role under users.close', async () => {
        stub();
        detail(['users.read', 'users.close']);

        expect(await screen.findAllByRole('button', REQUEST)).toHaveLength(2);
    });

    it('offers nothing to Support, who still sees the requests', async () => {
        stub({ requests: [closureFixture()] });
        detail(['users.read']);

        expect(await screen.findByText('Agent asked by phone to stop delivering')).toBeInTheDocument();
        expect(screen.queryByRole('button', REQUEST)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    });

    it('is hidden on a suspended account, which the platform refuses', async () => {
        stub({
            record: userDetailFixture({
                status: 'suspended',
                suspension: { at: null, reason: 'Chargebacks', by: null },
            }),
        });
        detail(['users.read', 'users.close']);

        await screen.findByText(/this account is suspended/i);
        expect(screen.queryByRole('button', REQUEST)).not.toBeInTheDocument();
    });

    it('shows a waiting request instead of a second button for that role', async () => {
        stub({ requests: [closureFixture({ role: 'agent' })] });
        detail(['users.read', 'users.close']);

        expect(await screen.findByRole('link', { name: /closure requested/i })).toBeInTheDocument();
        expect(screen.getAllByRole('button', REQUEST)).toHaveLength(1);
    });

    it('offers no confirm anywhere — only the user can close', async () => {
        stub({ requests: [closureFixture()] });
        detail(['users.read', 'users.close']);

        await screen.findByText('Agent asked by phone to stop delivering');
        expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
    });
});

describe('requesting', () => {
    it('posts the trimmed reason to the role and reloads the list', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        let listReads = 0;
        const calls = stub({
            requests: () => {
                listReads += 1;
                return [];
            },
            extra: (call) =>
                call.method === 'POST' && call.url.includes('/roles/customer/closure')
                    ? successResponse(closureFixture({ role: 'customer' }), { status: 201 })
                    : undefined,
        });
        detail(['users.read', 'users.close']);

        const dialog = await openRequestFor('customer');
        expect(within(dialog).getByText(/other roles \(agent\) are not affected/i)).toBeInTheDocument();
        await userEvent.type(within(dialog).getByLabelText(/reason/i), '  Closing at your request  ');
        await userEvent.click(within(dialog).getByRole('button', { name: /send closure request/i }));

        await waitFor(() => expect(listReads).toBe(2));
        const post = calls.find((call) => call.method === 'POST');
        expect(post?.url).toContain(`/users/${USER_ID}/roles/customer/closure`);
        expect(JSON.parse(post?.body ?? '{}')).toEqual({ reason: 'Closing at your request' });
        expect(notify.success).toHaveBeenCalled();
    });

    it('requires a reason of at least three characters', async () => {
        const calls = stub();
        detail(['users.read', 'users.close']);

        const dialog = await openRequestFor('agent');
        await userEvent.type(within(dialog).getByLabelText(/reason/i), 'no');
        await userEvent.click(within(dialog).getByRole('button', { name: /send closure request/i }));

        expect(await within(dialog).findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('says when the role is the last one, so the whole account would close', async () => {
        stub({ record: userDetailFixture({ roles: ['agent'] }) });
        detail(['users.read', 'users.close']);

        await screen.findByRole('heading', { level: 1 });
        await userEvent.click((await screen.findAllByRole('button', REQUEST)).at(-1)!);
        expect(
            await screen.findByText(/only role, so confirming would close the whole account/i),
        ).toBeInTheDocument();
    });
});

describe('refusals, by details.platformCode', () => {
    function refuse(status: number, platformCode: string, details: Record<string, unknown> = {}) {
        return (call: FetchCall) =>
            call.method === 'POST' && call.url.includes('/closure')
                ? errorResponse(status, 'PLATFORM_OPERATION_REJECTED', {
                      category: status === 422 ? 'business_rule' : 'conflict',
                      details: { platformCode, ...details },
                  })
                : undefined;
    }

    async function submit(role: 'customer' | 'agent' = 'agent') {
        const dialog = await openRequestFor(role);
        await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Owner asked us to');
        await userEvent.click(within(dialog).getByRole('button', { name: /send closure request/i }));
        return dialog;
    }

    it('lists ROLE_CLOSURE_BLOCKED blockers as a checklist, unknown codes raw', async () => {
        stub({
            extra: refuse(422, 'ROLE_CLOSURE_BLOCKED', {
                blockers: [
                    { code: 'shipments_active', count: 2 },
                    { code: 'cod_cash_held', count: 1, amount: 45000 },
                    { code: 'a_new_blocker', count: 3 },
                ],
            }),
        });
        detail(['users.read', 'users.close']);

        const dialog = await submit();
        expect(await within(dialog).findByText(/cannot be closed yet/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/shipments in the agent’s hands/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/delivered or handed back/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/cash-on-delivery cash in hand/i)).toBeInTheDocument();
        expect(within(dialog).getByText('a_new_blocker')).toBeInTheDocument();
        // Not retried into the same refusal.
        expect(within(dialog).getByRole('button', { name: /send closure request/i })).toBeDisabled();
    });

    it('still says it is blocked when the blockers did not arrive', async () => {
        stub({ extra: refuse(422, 'ROLE_CLOSURE_BLOCKED') });
        detail(['users.read', 'users.close']);

        const dialog = await submit();
        expect(await within(dialog).findByText(/did not say what/i)).toBeInTheDocument();
    });

    it('points ROLE_CLOSURE_ALREADY_PENDING at the waiting request', async () => {
        stub({ extra: refuse(409, 'ROLE_CLOSURE_ALREADY_PENDING') });
        detail(['users.read', 'users.close']);

        const dialog = await submit();
        expect(await within(dialog).findByText(/already waiting for this role/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: /closure requests/i })).toHaveAttribute(
            'href',
            '#role-closure-requests',
        );
    });

    it.each([
        [422, 'ROLE_CLOSURE_ROLE_NOT_HELD', /does not hold the agent role/i],
        [409, 'ROLE_CLOSED', /agent role is already closed/i],
        [409, 'USER_STATUS_CONFLICT', /suspended or closed/i],
    ])('closes and refreshes on %s %s', async (status, code, title) => {
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
        let detailReads = 0;
        stub({
            extra: (call) => {
                const refused = refuse(status, code)(call);
                if (refused) return refused;
                if (
                    call.url.endsWith(`/users/${USER_ID}`) ||
                    call.url.includes(`/users/${USER_ID}?`)
                ) {
                    detailReads += 1;
                }
                return undefined;
            },
        });
        detail(['users.read', 'users.close']);

        await submit();
        await waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringMatching(title), expect.anything()));
        await waitFor(() => expect(detailReads).toBe(2));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('the closure-requests panel', () => {
    it('shows each answer: declined with a note, confirmed with its outcome', async () => {
        stub({
            requests: [
                closureFixture({
                    id: '6710aa000000000000000002',
                    role: 'customer',
                    status: 'declined',
                    resolvedAt: '2026-10-05T08:00:00.000Z',
                    declineNote: 'I still shop here',
                }),
                closureFixture({
                    status: 'confirmed',
                    resolvedAt: '2026-10-05T14:03:11.000Z',
                    warnings: [
                        { code: 'prepaid_plan_forfeited', planCode: 'pro', expiresAt: '2026-11-12T00:00:00.000Z', amount: null },
                    ],
                    outcome: {
                        closedAt: '2026-10-05T14:03:11.000Z',
                        accountClosed: false,
                        endedRelationships: 3,
                    },
                }),
            ],
        });
        detail(['users.read', 'users.close']);

        expect(await screen.findByText('Declined by the user')).toBeInTheDocument();
        expect(screen.getByText('I still shop here')).toBeInTheDocument();
        expect(screen.getByText('Closed by the user')).toBeInTheDocument();
        expect(screen.getByText(/other roles were not affected/i)).toBeInTheDocument();
        expect(screen.getByText(/3 contracts or connections ended/i)).toBeInTheDocument();
        expect(screen.getByText(/paid plan time is forfeited · plan pro/i)).toBeInTheDocument();
        expect(screen.getAllByText(/awa n\./i).length).toBeGreaterThan(0);
        // Withdraw is for pending rows only.
        expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    });

    it('renders an unknown status raw', async () => {
        stub({ requests: [closureFixture({ status: 'archived' })] });
        detail(['users.read']);

        expect(await screen.findByText('archived')).toBeInTheDocument();
    });

    it('withdraws a pending request with DELETE on its role', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        let listReads = 0;
        const calls = stub({
            requests: () => {
                listReads += 1;
                return listReads === 1 ? [closureFixture()] : [closureFixture({ status: 'cancelled' })];
            },
            extra: (call) =>
                call.method === 'DELETE'
                    ? successResponse(closureFixture({ status: 'cancelled' }))
                    : undefined,
        });
        detail(['users.read', 'users.close']);

        await userEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
        await userEvent.click(screen.getByRole('button', { name: /withdraw request/i }));

        expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
        const del = calls.find((call) => call.method === 'DELETE');
        expect(del?.url).toContain(`/users/${USER_ID}/roles/agent/closure`);
    });

    it('treats ROLE_CLOSURE_REQUEST_NOT_FOUND as answered-first, not a failure', async () => {
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
        let listReads = 0;
        stub({
            requests: () => {
                listReads += 1;
                return [closureFixture()];
            },
            extra: (call) =>
                call.method === 'DELETE'
                    ? errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                          category: 'not_found',
                          details: { platformCode: 'ROLE_CLOSURE_REQUEST_NOT_FOUND' },
                      })
                    : undefined,
        });
        detail(['users.read', 'users.close']);

        await userEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
        await userEvent.click(screen.getByRole('button', { name: /withdraw request/i }));

        await waitFor(() => expect(warning).toHaveBeenCalled());
        await waitFor(() => expect(listReads).toBe(2));
    });
});
