import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { I18nProvider } from '@/i18n';
import type { Locale } from '@/i18n';
import { UIProvider } from '@/store';
import { AuthContext, type AuthState } from '@/store/auth-context';
import { PermissionsContext, type PermissionsState } from '@/store/permissions-context';
import { NotificationsContext, type NotificationsState } from '@/store/notifications-context';
import { heldFixture } from '@/test/fixtures';

interface Options extends Omit<RenderOptions, 'wrapper'> {
    /** Initial history entries for the router. */
    route?: string;
    /**
     * What the rendered tree may do. Defaults to a **ready Developer set** — all
     * 110 permissions — because the question most screen tests are asking is not
     * "is this gated correctly" but "does it render", and gating them by accident
     * would make a passing test mean nothing.
     *
     * A test that *is* about gating passes a narrower set:
     * `{ permissions: { held: heldFixture(3) } }`.
     *
     * Stood up directly rather than by mounting `PermissionsProvider`, for the
     * same reason as `auth` below: no `GET /permissions/me` fires, so a test that
     * forgot to stub `fetch` cannot pass or fail on whether a server happened to
     * be running.
     */
    permissions?: Partial<PermissionsState>;
    /**
     * The session state to render against. Defaults to an ordinary authenticated
     * session, which is the premise of every screen inside the shell.
     *
     * The context is stood up **directly** rather than by mounting the real
     * `AuthProvider`, so no `GET /auth/me` is fired: a page test that forgot to
     * stub `fetch` would otherwise make a genuine request to `localhost:8033` and
     * pass or fail on whether a server happened to be running. The provider's own
     * behaviour is covered by `store/auth.store.test.tsx`, which mounts it
     * deliberately.
     */
    auth?: Partial<AuthState>;
    /**
     * The inbox badge's state.
     *
     * Stood up directly for the same reason as the two above: the real provider
     * polls `GET /notifications/unread-count` on mount and on every
     * `visibilitychange`, and a screen test should not be measuring that. The
     * provider's own behaviour is covered by `store/notifications.store.test.tsx`.
     */
    notifications?: Partial<NotificationsState>;
    /**
     * The language to render in. Defaults to English, which is what every
     * assertion in the suite is written against.
     *
     * Pass `'fr'` to assert that a screen actually reads from the catalog
     * rather than from the server's message.
     */
    locale?: Locale;
}

/** A complete `AuthState` with inert actions, overridden field by field. */
export function buildAuthState(overrides: Partial<AuthState> = {}): AuthState {
    return {
        status: 'authenticated',
        admin: null,
        session: null,
        bootstrapError: null,
        isSigningOut: false,
        signIn: async () => ({ kind: 'authenticated' }),
        completeMfaChallenge: async () => {},
        signOut: async () => {},
        refreshProfile: async () => {},
        endScopedSession: () => {},
        retryBootstrap: async () => {},
        ...overrides,
    };
}

/** A complete `PermissionsState` with an inert `reload`, overridden field by field. */
export function buildPermissionsState(
    overrides: Partial<PermissionsState> = {},
): PermissionsState {
    return {
        status: 'ready',
        held: heldFixture(1),
        tier: 1,
        tierLabel: 'Developer',
        error: null,
        reload: async () => {},
        ...overrides,
    };
}

/** A complete `NotificationsState` with inert actions, overridden field by field. */
export function buildNotificationsState(
    overrides: Partial<NotificationsState> = {},
): NotificationsState {
    return {
        unreadCount: 0,
        enabled: true,
        refresh: async () => {},
        adjustUnread: () => {},
        ...overrides,
    };
}

function Providers({
    children,
    route,
    locale,
    auth,
    permissions,
    notifications,
}: {
    children: ReactNode;
    route: string;
    locale: Locale;
    auth: Partial<AuthState>;
    permissions: Partial<PermissionsState>;
    notifications: Partial<NotificationsState>;
}) {
    return (
        // Pinned rather than detected. Left to itself the provider reads
        // localStorage and then `navigator.languages`, so the language a test
        // renders in would depend on the machine running it.
        <I18nProvider locale={locale}>
            <MemoryRouter initialEntries={[route]}>
                <UIProvider>
                    <AuthContext.Provider value={buildAuthState(auth)}>
                        <PermissionsContext.Provider value={buildPermissionsState(permissions)}>
                            <NotificationsContext.Provider
                                value={buildNotificationsState(notifications)}
                            >
                                {children}
                            </NotificationsContext.Provider>
                        </PermissionsContext.Provider>
                    </AuthContext.Provider>
                </UIProvider>
            </MemoryRouter>
        </I18nProvider>
    );
}

/** Render inside the providers the app mounts at its root. */
export function renderWithProviders(
    ui: ReactElement,
    {
        route = '/',
        locale = 'en',
        auth = {},
        permissions = {},
        notifications = {},
        ...options
    }: Options = {},
) {
    return render(ui, {
        wrapper: ({ children }) => (
            <Providers
                route={route}
                locale={locale}
                auth={auth}
                permissions={permissions}
                notifications={notifications}
            >
                {children}
            </Providers>
        ),
        ...options,
    });
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Build a `Response` carrying wi-admin's success envelope. */
export function successResponse(
    data: unknown,
    { status = 200, meta, message, requestId = 'req-test' }: {
        status?: number;
        meta?: Record<string, unknown>;
        message?: string;
        requestId?: string;
    } = {},
): Response {
    const body: Record<string, unknown> = { success: true, data };
    if (meta) body.meta = meta;
    if (message) body.message = message;

    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
}

/** Build a `Response` carrying wi-admin's error envelope. */
export function errorResponse(
    status: number,
    code: string,
    {
        message = 'Something went wrong',
        category,
        details,
        requestId = 'req-test',
    }: {
        message?: string;
        category?: string;
        details?: Record<string, unknown>;
        requestId?: string;
    } = {},
): Response {
    const error: Record<string, unknown> = { code, message, statusCode: status };
    if (category) error.category = category;
    // `details` is omitted entirely when absent — never null, never {}.
    if (details) error.details = details;

    return new Response(JSON.stringify({ success: false, requestId, error }), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
}

export interface FetchCall {
    url: string;
    method: string;
    headers: Headers;
    body?: string;
}

/**
 * Stub `fetch` with a queue-aware handler and record every call.
 *
 * The handler receives the call so a test can answer differently per URL —
 * which is how the refresh-and-retry behaviour is exercised.
 */
export function stubFetch(handler: (call: FetchCall, index: number) => Response | Promise<Response>) {
    const calls: FetchCall[] = [];

    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const call: FetchCall = {
            url: typeof input === 'string' ? input : String(input),
            method: (init?.method ?? 'GET').toUpperCase(),
            headers: new Headers(init?.headers),
            body: typeof init?.body === 'string' ? init.body : undefined,
        };
        calls.push(call);
        return handler(call, calls.length - 1);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    return calls;
}
