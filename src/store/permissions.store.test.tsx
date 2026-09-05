import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { emitPermissionDenied } from '@/lib/session-events';
import { AuthContext } from '@/store/auth-context';
import { usePermissions } from '@/store/permissions-context';
import { PermissionsProvider } from '@/store/permissions.store';
import { adminFixture, permissionsMeFixture } from '@/test/fixtures';
import { buildAuthState, errorResponse, stubFetch, successResponse } from '@/test/utils';
import type { AdminProfile, AdminTier } from '@/types/auth.types';
import type { AuthStatus } from '@/store';

/** Renders the whole state as text, so assertions read off the DOM. */
function Probe() {
    const { status, held, tier, tierLabel, reload } = usePermissions();
    return (
        <div>
            <span data-testid="status">{status}</span>
            <span data-testid="count">{held ? held.size : 'none'}</span>
            <span data-testid="tier">{tier ?? 'none'}</span>
            <span data-testid="label">{tierLabel ?? 'none'}</span>
            <button onClick={() => void reload()}>reload</button>
        </div>
    );
}

function renderProvider({
    admin = adminFixture(),
    status = 'authenticated',
    strict = false,
}: { admin?: AdminProfile | null; status?: AuthStatus; strict?: boolean } = {}) {
    const tree = (
        <MemoryRouter>
            <AuthContext.Provider value={buildAuthState({ status, admin })}>
                <PermissionsProvider>
                    <Probe />
                </PermissionsProvider>
            </AuthContext.Provider>
        </MemoryRouter>
    );
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** A harness whose administrator's level can change, the way a demotion does. */
function MovableLevel({ initial }: { initial: AdminTier }) {
    const [tier, setTier] = useState<AdminTier>(initial);
    return (
        <MemoryRouter>
            <AuthContext.Provider
                value={buildAuthState({ status: 'authenticated', admin: adminFixture({ tier }) })}
            >
                <PermissionsProvider>
                    <Probe />
                    <button onClick={() => setTier(3)}>demote</button>
                </PermissionsProvider>
            </AuthContext.Provider>
        </MemoryRouter>
    );
}

describe('loading the set', () => {
    it('asks GET /permissions/me exactly once under StrictMode', async () => {
        const calls = stubFetch(() => successResponse(permissionsMeFixture(2)));

        renderProvider({ strict: true });

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(1);
        expect(screen.getByTestId('count')).toHaveTextContent('99');
        expect(screen.getByTestId('label')).toHaveTextContent('Admin');
    });

    it('never asks while the session is anonymous or scoped to enrolment', async () => {
        // The tree already prevents this — the provider mounts inside RequireAuth,
        // which redirects a scoped session to /mfa-setup — but /permissions/me
        // would answer 403 ADMIN_AUTH_MFA_REQUIRED if it were ever reached, so the
        // guard is worth having on its own terms too.
        const calls = stubFetch(() => successResponse(permissionsMeFixture(1)));

        renderProvider({ status: 'mfa-enrolment-required' });
        renderProvider({ status: 'anonymous', admin: null });

        await act(async () => {});
        expect(calls).toHaveLength(0);
        expect(screen.getAllByTestId('status')[0]).toHaveTextContent('loading');
    });

    it('records a failure without ending the session', async () => {
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));

        renderProvider();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
        // No set, and deliberately not "anonymous": the session is fine, the
        // navigation just cannot be drawn honestly.
        expect(screen.getByTestId('count')).toHaveTextContent('none');
    });

    it('recovers when a retry succeeds', async () => {
        stubFetch((_call, index) =>
            index === 0
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE')
                : successResponse(permissionsMeFixture(3)),
        );

        renderProvider();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
        expect(screen.getByTestId('count')).toHaveTextContent('30');
    });
});

describe('a level change', () => {
    /**
     * The reason the one-shot guard is keyed rather than boolean.
     *
     * `tier` is re-read from the database on every request, so a demotion lands
     * mid-session. A boolean guard — the shape the auth store's bootstrap uses,
     * and the obvious thing to copy — would fetch once and never again, leaving
     * the sidebar offering modules the server now refuses.
     */
    it('refetches when the administrator changes level', async () => {
        const calls = stubFetch(() => {
            // First read answers Admin, every later one answers Support — the
            // server resolving the *new* level, which is how a demotion actually
            // reaches a client.
            const nth = calls.filter((c) => c.url.includes('/permissions/me')).length;
            return successResponse(permissionsMeFixture(nth <= 1 ? 2 : 3));
        });

        render(<MovableLevel initial={2} />);
        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('99'));

        await userEvent.click(screen.getByRole('button', { name: 'demote' }));

        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('30'));
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(2);
    });
});

describe('a refusal', () => {
    async function readySet(tier: AdminTier) {
        const calls = stubFetch(() => successResponse(permissionsMeFixture(tier)));
        renderProvider();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

        /**
         * Flush the effects the commit queued before handing control back.
         *
         * "ready" appearing in the DOM means the state is committed; it does not
         * mean the effect that **subscribes to refusals** has run. Emitting into
         * that window drops the event, and the three tests below split on it: the
         * one asserting a re-read fails outright, while the two asserting *no*
         * re-read pass for the wrong reason. Waiting here makes all three mean
         * what they say.
         */
        await act(async () => {});
        return calls;
    }

    /**
     * The filter is the whole point of subscribing at all.
     *
     * Thirteen endpoints are composite `all`-mode guards sitting inside sections
     * a caller reaches on any-of, so being refused one while holding the other is
     * the *normal* case. Re-reading /permissions/me there returns the identical
     * set, so paying a round trip for it on every composite miss across Phases
     * 5–7 would buy nothing at all.
     */
    it('ignores a refusal that agrees with the set it already holds', async () => {
        const calls = await readySet(3);

        // Support reaches the Money section on `money.payments.read` alone, then
        // opens a payout's activity — `money.payouts.read` + `audit.read`, and it
        // holds only the second. The refusal is exactly what its own set predicts,
        // so re-reading would return the identical answer.
        act(() => {
            emitPermissionDenied({
                required: ['money.payouts.read', 'audit.read'],
                mode: 'all',
                code: 'AUTHZ_PERMISSION_DENIED',
            });
        });

        await act(async () => {});
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(1);
    });

    it('re-reads when the refusal contradicts the set — the demotion case', async () => {
        const calls = await readySet(2);

        // The set says yes, the server said no. The only thing that produces that
        // is a level change since the set was read.
        act(() => {
            emitPermissionDenied({
                required: ['money.payouts.read'],
                mode: 'all',
                code: 'AUTHZ_PERMISSION_DENIED',
            });
        });

        await waitFor(() =>
            expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(2),
        );
    });

    it('re-reads at most once per cooldown, however many refusals arrive', async () => {
        const calls = await readySet(2);

        for (let i = 0; i < 5; i += 1) {
            act(() => {
                emitPermissionDenied({
                    required: ['money.payouts.read'],
                    mode: 'all',
                    code: 'AUTHZ_PERMISSION_DENIED',
                });
            });
        }

        await act(async () => {});
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(2);
    });

    it('ignores a refusal that named no permission', async () => {
        const calls = await readySet(2);

        // The escalation refusals and the scoped 404s carry no `required`, and no
        // permission set could ever explain them.
        act(() => {
            emitPermissionDenied({ required: [], code: 'AUTHZ_TARGET_TIER_PROTECTED' });
        });

        await act(async () => {});
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(1);
    });
});
