import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { env } from '@/config/env';
import { hasAll, hasAny } from '@/lib/authorization';
import { onPermissionDenied } from '@/lib/session-events';
import * as permissionsService from '@/services/permissions.service';
import type { AdminTier } from '@/types/auth.types';
import { useAuth } from './auth-context';
import { PermissionsContext, type PermissionsState, type PermissionsStatus } from './permissions-context';

/**
 * How long to wait between reloads triggered by a refusal.
 *
 * A backstop, not the main defence — the staleness filter below already declines
 * the overwhelming majority of refusals. This only bounds the pathological case
 * where the server keeps refusing something the set says is allowed, which would
 * otherwise be a request per denial.
 */
const RELOAD_COOLDOWN_MS = 60_000;

interface Loaded {
    status: PermissionsStatus;
    held: ReadonlySet<string> | null;
    tier: AdminTier | null;
    tierLabel: string | null;
    error: unknown;
}

const INITIAL: Loaded = {
    status: 'loading',
    held: null,
    tier: null,
    tierLabel: null,
    error: null,
};

/**
 * What the signed-in administrator may do.
 *
 * **Mounted inside `RequireAuth`, not at the app root.** That placement is what
 * makes one rule structural instead of conditional: a scoped MFA-enrolment
 * session reaches exactly four routes and everything else — `/permissions/me`
 * included — answers `403 ADMIN_AUTH_MFA_REQUIRED`. `RequireAuth` sends such a
 * session to `/mfa-setup` before this provider ever mounts, so "never ask for
 * permissions mid-enrolment" cannot be lost to a refactor of an `if`.
 *
 * **Separate from the auth store on purpose.** "Who am I" must succeed for
 * `/mfa-setup` to work at all; "what may I do" must not even be attempted there.
 * Folding them together would put both in one state machine and make a
 * `/permissions/me` 5xx look like a dead session.
 */
export function PermissionsProvider({ children }: { children: React.ReactNode }) {
    const { status: authStatus, admin } = useAuth();
    const [state, setState] = useState<Loaded>(INITIAL);

    const adminId = admin?.id ?? null;
    const adminTier = admin?.tier ?? null;

    /**
     * One fetch per (administrator, level).
     *
     * A **key**, not the boolean the auth store guards its one-shot bootstrap
     * with. A boolean would make this fetch once and never again, which would
     * defeat the whole point: the level is re-resolved server-side on every
     * request, so a demotion has to re-key this effect and pull the new set.
     */
    const loadedKey = adminId && adminTier ? `${adminId}:${adminTier}` : null;
    const lastLoaded = useRef<string | null>(null);
    const lastReloadAt = useRef(0);

    const load = useCallback(async () => {
        setState((current) => ({ ...current, status: 'loading', error: null }));
        try {
            const result = await permissionsService.fetchMyPermissions();

            if (env.isDev) {
                // Two free consistency probes. `/permissions/me` re-resolves the
                // level on every request, so a disagreement with the cached
                // profile is a demotion the chrome has not caught up with — and
                // a different `adminId` would mean a response arrived for a
                // session other than this one.
                if (adminId && result.adminId !== adminId) {
                    console.warn(
                        `[permissions] /permissions/me answered for ${result.adminId}, expected ${adminId}`,
                    );
                }
                if (adminTier && result.tier !== adminTier) {
                    console.warn(
                        `[permissions] level moved: the profile says tier ${adminTier}, the server says ${result.tier}. The cached profile is stale.`,
                    );
                }
            }

            setState({
                status: 'ready',
                held: new Set(result.permissions),
                tier: result.tier,
                tierLabel: result.tierLabel,
                error: null,
            });
        } catch (error) {
            // Not a sign-out. A 5xx or a network fault leaves the session
            // perfectly good and only means the navigation cannot be drawn
            // honestly — which is a screen with a retry, not a redirect.
            setState({ status: 'error', held: null, tier: null, tierLabel: null, error });
        }
    }, [adminId, adminTier]);

    useEffect(() => {
        if (authStatus !== 'authenticated' || !loadedKey) return;
        if (lastLoaded.current === loadedKey) return;
        lastLoaded.current = loadedKey;
        void load();
    }, [authStatus, loadedKey, load]);

    const reload = useCallback(async () => {
        lastLoaded.current = loadedKey;
        lastReloadAt.current = Date.now();
        await load();
    }, [loadedKey, load]);

    /**
     * A refusal that contradicts what we hold means the set is stale.
     *
     * The filter is the whole design. Most refusals are *consistent* with the set
     * — a section is offered when the caller holds any of its permissions, while
     * thirteen endpoints inside those sections demand all of two or three, so an
     * administrator legitimately reaches a screen and is legitimately refused a
     * panel on it. Re-reading `/permissions/me` there returns the identical
     * answer, and doing it on every composite miss would be a round trip per
     * refusal for no information.
     *
     * The interesting case is the opposite: the set says yes and the server said
     * no. The only thing that produces that is a level change since the set was
     * read — exactly what this is for.
     */
    const { held } = state;
    useEffect(() => {
        if (!held) return;

        return onPermissionDenied((event) => {
            if (event.required.length === 0) return;

            const weExpectedToPass =
                event.mode === 'any' ? hasAny(held, event.required) : hasAll(held, event.required);
            if (!weExpectedToPass) return;

            const now = Date.now();
            if (now - lastReloadAt.current < RELOAD_COOLDOWN_MS) return;
            lastReloadAt.current = now;
            void load();
        });
    }, [held, load]);

    const value = useMemo<PermissionsState>(
        () => ({
            status: state.status,
            held: state.held,
            tier: state.tier,
            tierLabel: state.tierLabel,
            error: state.error,
            reload,
        }),
        [state, reload],
    );

    return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}
