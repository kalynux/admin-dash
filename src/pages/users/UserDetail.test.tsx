import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { UserDetail } from '@/pages/users/UserDetail';
import {
    adminFixture,
    auditEntryFixture,
    auditMetaFixture,
    missingRoleProfileFixture,
    platformUserFixture,
    roleProfileFixture,
    userDetailFixture,
} from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { UserDetail as UserDetailRecord } from '@/types/users.types';

const USER_ID = '665f1c2a9b3e4a91c7d2e5f0';

/** Answers the detail and the activity feed; anything else is a failure. */
function stubDetail(record: UserDetailRecord = userDetailFixture(), activity = [auditEntryFixture()]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/activity')) {
            return successResponse(activity, {
                meta: { ...auditMetaFixture({ total: activity.length, pages: 1 }) },
            });
        }
        if (call.url.includes(`/users/${USER_ID}`)) return successResponse(record);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * Mounted through a route so `useParams` resolves, and with permissions injected
 * directly — every gate on this screen keys off the held set.
 */
function detail(held: string[] = ['users.read', 'audit.read', 'users.update', 'users.suspend']) {
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

describe('the account', () => {
    it('titles itself by the identifier and shows both', async () => {
        stubDetail();
        detail();

        expect(
            await screen.findByRole('heading', { level: 1, name: 'amina@example.cm' }),
        ).toBeInTheDocument();
        expect(screen.getByText('+237670112233')).toBeInTheDocument();
    });

    it('says an identifier is not set rather than leaving a blank', async () => {
        // A field that exists is always present and absent data is `null` — so a
        // blank would read as a rendering bug rather than a fact about the account.
        stubDetail(userDetailFixture({ phone: null }));
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByText('Not set')).toBeInTheDocument();
    });

    it('refuses a malformed id without spending a request', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/users/:userId" element={<UserDetail />} />
            </Routes>,
            {
                route: '/dashboard/users/not-an-id',
                auth: { status: 'authenticated', admin: adminFixture() },
                permissions: { status: 'ready', held: new Set(['users.read']) },
            },
        );

        expect(await screen.findByText(/not a valid user id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('renders a 404 calmly, because it is also the scope denial', async () => {
        // A 403 on an id would confirm the id exists, so out-of-scope records
        // answer 404 — which means a 404 here is not necessarily a bug.
        stubFetch(() => errorResponse(404, 'NOT_FOUND', { message: 'User not found' }));
        detail();

        expect(await screen.findByText(/no such user/i)).toBeInTheDocument();
    });
});

describe('the suspension block', () => {
    it('is absent on an active account', async () => {
        stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByText(/this account is suspended/i)).not.toBeInTheDocument();
    });

    it('shows the reason, the moment and who imposed it when suspended', async () => {
        stubDetail(
            userDetailFixture({
                status: 'suspended',
                suspension: {
                    at: '2026-08-13T09:31:02.118Z',
                    reason: 'Fraudulent chargebacks',
                    by: { id: USER_ID, source: 'admin', name: 'Ada Nkemelu' },
                },
            }),
        );
        detail();

        expect(await screen.findByText(/this account is suspended/i)).toBeInTheDocument();
        expect(screen.getByText('Fraudulent chargebacks')).toBeInTheDocument();
        expect(screen.getByText(/ada nkemelu/i)).toBeInTheDocument();
    });

    it('never renders a stale reason left on an active account', async () => {
        // The service keys the block on `status` for exactly this reason. Pinned
        // because a screen that read `suspension` alone would show a lie.
        stubDetail(
            userDetailFixture({
                status: 'active',
                suspension: {
                    at: '2026-08-13T09:31:02.118Z',
                    reason: 'Stale reason that must not appear',
                    by: null,
                },
            }),
        );
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByText(/stale reason that must not appear/i)).not.toBeInTheDocument();
    });
});

describe('role profiles', () => {
    it('renders one entry per role held', async () => {
        stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByText('KYC: verified')).toBeInTheDocument();
    });

    it('renders a missing profile prominently, because nothing else surfaces it', async () => {
        // The role is on the users row but its entity does not exist, which stops
        // the person signing in at all.
        stubDetail(
            userDetailFixture({
                roles: ['customer', 'agent'],
                profiles: [roleProfileFixture(), missingRoleProfileFixture('agent')],
            }),
        );
        detail();

        expect(await screen.findByText(/the agent profile is missing/i)).toBeInTheDocument();
        expect(screen.getByText(/AUTH_ROLE_PROFILE_NOT_FOUND/)).toBeInTheDocument();
    });

    it('renders an unknown status or kyc value raw rather than dropping it', async () => {
        // Both are unenumerated pass-throughs from four collections. Adding a
        // member upstream must not blank a row here.
        stubDetail(
            userDetailFixture({
                profiles: [
                    roleProfileFixture({ status: 'probation', kycStatus: 'under_review' }),
                ],
            }),
        );
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByText('probation')).toBeInTheDocument();
        expect(screen.getByText('KYC: under_review')).toBeInTheDocument();
    });

    it('says what it deliberately cannot do', async () => {
        stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByText(/no role editor, no force sign-out/i)).toBeInTheDocument();
    });
});

describe('the actions, gated', () => {
    it('offers both writes to someone holding both permissions', async () => {
        stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByRole('button', { name: /edit login details/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument();
    });

    it('hides every write from a Support administrator', async () => {
        // Support holds `users.read` and nothing else on this family. The
        // affordance is hidden, not disabled — a disabled button invites a guess
        // about why.
        stubDetail();
        detail(['users.read', 'audit.read']);

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('button', { name: /edit login details/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
    });

    it('offers restore instead of suspend on a suspended account', async () => {
        // One permission, two directions — which is offered follows the record.
        stubDetail(
            userDetailFixture({
                status: 'suspended',
                suspension: { at: null, reason: 'Chargebacks', by: null },
            }),
        );
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    });
});

describe('the activity tab', () => {
    it('is offered to someone holding both halves of the composite guard', async () => {
        stubDetail();
        detail(['users.read', 'audit.read']);

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
    });

    it('is absent without audit.read, rather than present and refusing', async () => {
        // `GET /users/:userId/activity` needs users.read AND audit.read, in `all`
        // mode. A tab whose only content is a denial is worse than no tab.
        stubDetail();
        detail(['users.read', 'users.update']);

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('tab', { name: 'Activity' })).not.toBeInTheDocument();
    });

    it('does not fetch the feed until the tab is opened', async () => {
        const calls = stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(calls.some((call) => call.url.includes('/activity'))).toBe(false);

        await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        await waitFor(() =>
            expect(calls.some((call) => call.url.includes('/activity'))).toBe(true),
        );
    });

    it('renders a users.* row with its outcome', async () => {
        stubDetail(userDetailFixture(), [
            auditEntryFixture({
                action: 'users.suspend',
                actionFamily: 'users',
                actionSummary: 'Suspended a user account',
                status: 'succeeded',
            }),
        ]);
        detail();

        await screen.findByRole('heading', { level: 1 });
        await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(await screen.findByText('Suspended')).toBeInTheDocument();
        expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    it('renders an action the catalog no longer describes rather than blanking it', async () => {
        stubDetail(userDetailFixture(), [
            auditEntryFixture({ action: 'users.something_new', actionSummary: null }),
        ]);
        detail();

        await screen.findByRole('heading', { level: 1 });
        await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(await screen.findByText('users.something_new')).toBeInTheDocument();
    });

    it('says why the feed stops where it does', async () => {
        stubDetail();
        detail();

        await screen.findByRole('heading', { level: 1 });
        await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(await screen.findByText(/the trail is kept for 365 days/i)).toBeInTheDocument();
    });

    it('explains that an empty feed is not the person’s own activity', async () => {
        stubDetail(userDetailFixture(), []);
        detail();

        await screen.findByRole('heading', { level: 1 });
        await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(
            await screen.findByText(/no administrator has acted on this account/i),
        ).toBeInTheDocument();
    });
});

describe('after a write', () => {
    it('refetches the record rather than merging the flat write response', async () => {
        // The write answers jovi-mall's DTO — flat `suspendedAt`, no `profiles`.
        // Merging it would need a second mapper that can drift from the first.
        let detailReads = 0;
        stubFetch((call: FetchCall) => {
            if (call.method === 'POST' && call.url.includes('/restore')) {
                return successResponse(platformUserFixture({ status: 'active' }));
            }
            if (call.url.includes('/activity')) {
                return successResponse([], { meta: { ...auditMetaFixture({ total: 0, pages: 0 }) } });
            }
            if (call.url.includes(`/users/${USER_ID}`)) {
                detailReads += 1;
                return successResponse(
                    userDetailFixture(
                        detailReads === 1
                            ? {
                                  status: 'suspended',
                                  suspension: { at: null, reason: 'Chargebacks', by: null },
                              }
                            : { status: 'active', suspension: null },
                    ),
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        detail();

        await screen.findByText(/this account is suspended/i);
        await userEvent.click(screen.getByRole('button', { name: /restore/i }));
        await userEvent.click(screen.getByRole('button', { name: /restore account/i }));

        await waitFor(() => expect(detailReads).toBe(2));
        expect(screen.queryByText(/this account is suspended/i)).not.toBeInTheDocument();
    });
});
