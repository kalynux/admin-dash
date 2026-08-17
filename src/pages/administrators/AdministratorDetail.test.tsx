import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { AdministratorDetail } from '@/pages/administrators/AdministratorDetail';
import {
    adminFixture,
    administratorFixture,
    bootstrapAdministratorFixture,
    heldFixture,
    suspendedAdministratorFixture,
} from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Administrator } from '@/types/administrators.types';
import type { AdminTier } from '@/types/auth.types';

/**
 * The screen where the escalation rules become visible.
 *
 * Most of these cases inject a **full Developer permission set** and still expect
 * buttons to be absent, which is the whole point: layer 1 says "you may manage
 * administrators", layer 2 says "not this one", and only the second explains why
 * a tier-2 Admin cannot touch a Developer. A test that narrowed the permission
 * set would be testing `can()` again rather than the mirror.
 */

/**
 * The caller's id.
 *
 * ⚠ Deliberately distinct from **every** fixture id. `bootstrapAdministratorFixture`
 * uses `6650aabbccddeeff00112233`, so borrowing that here would make rule 1 fire
 * on cases meant to exercise rule 2 — the peer tests would pass for the wrong
 * reason, which is worse than failing.
 */
const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function stubRecord(record: Administrator) {
    return stubFetch((call) => {
        if (call.url.includes('/sessions')) return successResponse([]);
        if (call.url.includes('/activity') || call.url.includes('/history')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        return successResponse(record);
    });
}

/**
 * Render the detail at `record.id`, as an administrator at `actorTier`.
 *
 * `permissions.held` defaults to the whole Developer set, so an absent control
 * is never explained by a missing permission unless a case says so.
 */
function renderDetail(
    record: Administrator,
    { actorTier = 1, actorId = ME, held = heldFixture(1) }: {
        actorTier?: AdminTier;
        actorId?: string;
        held?: ReadonlySet<string>;
    } = {},
) {
    stubRecord(record);

    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/administrators/:adminId" element={<AdministratorDetail />} />
        </Routes>,
        {
            route: `/dashboard/administrators/${record.id}`,
            auth: { admin: adminFixture({ id: actorId, tier: actorTier }) },
            permissions: { held, tier: actorTier },
        },
    );
}

describe('what a Developer may do to a Support administrator', () => {
    it('offers every write and every tab', async () => {
        renderDetail(administratorFixture({ mfaEnrolled: true }));

        await screen.findByRole('heading', { level: 1, name: /samuel etoo/i });

        expect(screen.getByRole('button', { name: /edit profile/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /change level/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /clear two-factor/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^suspend$/i })).toBeInTheDocument();

        expect(screen.getByRole('tab', { name: /sessions/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument();
    });

    it('offers Reinstate instead of Suspend on a suspended account', async () => {
        renderDetail(suspendedAdministratorFixture());

        await screen.findByRole('button', { name: /reinstate/i });

        expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
        // The panel is keyed on `status`, and it names where the reason survives.
        expect(screen.getByText(/this account is suspended/i)).toBeInTheDocument();
        expect(screen.getByText(/history tab is where it survives/i)).toBeInTheDocument();
    });

    it('does not offer to clear two-factor for somebody who has none', async () => {
        renderDetail(administratorFixture({ mfaEnrolled: false }));

        await screen.findByRole('heading', { level: 1 });

        expect(
            screen.queryByRole('button', { name: /clear two-factor/i }),
        ).not.toBeInTheDocument();
    });
});

/**
 * The headline assertion of the phase.
 *
 * A tier-2 Admin holding **every** `administrators.*` permission still may not
 * act on a Developer — rule 2 refuses at or above your own level, and it is not
 * overridable. Nothing here is hidden by `can()`.
 */
describe('what an Admin may do to a Developer', () => {
    it('offers no write at all, despite holding every permission', async () => {
        renderDetail(bootstrapAdministratorFixture(), { actorTier: 2, held: heldFixture(1) });

        await screen.findByRole('heading', { level: 1, name: /ada n\./i });

        expect(screen.queryByRole('button', { name: /edit profile/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /change level/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /clear two-factor/i }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    });

    /*
     * `read_sessions` is the one READ governed by rule 2, because it discloses
     * where a colleague works from and on what. The tab is omitted rather than
     * rendered-and-refusing.
     */
    it('hides the Sessions tab, because that read is escalation-gated too', async () => {
        renderDetail(bootstrapAdministratorFixture(), { actorTier: 2 });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('tab', { name: /sessions/i })).not.toBeInTheDocument();
    });

    it('still shows the audit tabs, which are not escalation-gated', async () => {
        renderDetail(bootstrapAdministratorFixture(), { actorTier: 2 });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument();
    });

    it('explains the rule rather than leaving a blank toolbar', async () => {
        renderDetail(bootstrapAdministratorFixture(), { actorTier: 2 });

        await screen.findByRole('heading', { level: 1 });

        // Names the rule, never the caller's standing — the same discipline the
        // server's own messages keep.
        expect(screen.getByText(/at or above your own level/i)).toBeInTheDocument();
    });
});

describe('what a Developer may do to another Developer', () => {
    /*
     * Rule 3, the exception that makes Developers recoverable: allowed, but
     * always queued. Without it a compromised Developer could never be contained
     * through the API — rule 2 would protect it from every other Developer, and
     * rule 1 from itself.
     */
    it('offers Suspend, because peer-Developer actions are allowed with a second signature', async () => {
        renderDetail(bootstrapAdministratorFixture(), { actorTier: 1 });

        await screen.findByRole('button', { name: /^suspend$/i });
    });
});

describe('your own record', () => {
    const self = administratorFixture({ id: ME, tier: 1, tierLabel: 'Developer' });

    it('offers no write, not even the profile edit', async () => {
        renderDetail(self, { actorTier: 1, actorId: ME });

        await screen.findByRole('heading', { level: 1 });

        // A self-edit must go through `PATCH /administrators/me` so it audits as
        // `administrators.profile.update_self`, which is the account screen.
        expect(screen.queryByRole('button', { name: /edit profile/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument();
    });

    it('hides the Sessions tab and points at Account & security instead', async () => {
        renderDetail(self, { actorTier: 1, actorId: ME });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('tab', { name: /sessions/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /account & security/i })).toHaveAttribute(
            'href',
            '/dashboard/account/security',
        );
    });
});

describe('the audit tabs', () => {
    it('are absent without audit.read', async () => {
        const held = new Set([...heldFixture(1)].filter((name) => name !== 'audit.read'));

        renderDetail(administratorFixture(), { held });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('tab', { name: /activity/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /history/i })).not.toBeInTheDocument();
    });

    /*
     * `/administrators/:id/activity` carries `audit.read` alone — unlike
     * `/users/:id/activity`, which is a composite guard. Requiring the composite
     * here would be this client inventing a stricter rule than the server has.
     */
    it('need audit.read alone, not a composite with administrators.read', async () => {
        const held = new Set(['audit.read', 'administrators.read']);

        renderDetail(administratorFixture(), { held });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument();
    });
});

describe('the record itself', () => {
    it('names the bootstrap account rather than showing a dash', async () => {
        renderDetail(bootstrapAdministratorFixture());

        expect(await screen.findByText(/bootstrap account/i)).toBeInTheDocument();
    });

    it('reports never-signed-in as a fact, not a gap', async () => {
        renderDetail(administratorFixture({ lastLoginAt: null }));

        expect(await screen.findByText('Never')).toBeInTheDocument();
    });

    it('says there is no delete, and why', async () => {
        renderDetail(administratorFixture());

        await screen.findByRole('heading', { level: 1 });

        expect(screen.getByText(/deliberately no delete/i)).toBeInTheDocument();
        expect(screen.getByText(/no per-administrator permission overrides/i)).toBeInTheDocument();
    });

    it('refuses a malformed id without firing a request', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        renderWithProviders(
            <Routes>
                <Route
                    path="/dashboard/administrators/:adminId"
                    element={<AdministratorDetail />}
                />
            </Routes>,
            { route: '/dashboard/administrators/not-an-id' },
        );

        expect(await screen.findByText(/24 hexadecimal characters/i)).toBeInTheDocument();
        await waitFor(() => expect(calls).toHaveLength(0));
    });
});
