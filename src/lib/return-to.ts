/**
 * Where to send somebody once they have signed in.
 *
 * The guards stash the route an anonymous caller was reaching for in
 * `location.state`, and the sign-in flow reads it back. Both sibling dashboards
 * capture the same thing and never consume it — their login screen is an external
 * link, so the round trip was impossible. Here it is not.
 */

const FALLBACK = '/dashboard';

interface FromState {
    from?: { pathname?: unknown; search?: unknown };
}

/**
 * Is this a path we are willing to navigate to?
 *
 * It has to be an absolute, same-document path. **`//evil.com` is the one that
 * bites**: it looks like a path, but it is a protocol-relative URL, and
 * `<Navigate>` will follow it straight off the origin. Since this value arrives
 * through router state — which anything holding a link can set — it is untrusted
 * input, and an admin console is the last place to hand somebody an open redirect.
 */
function isSafePath(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/**
 * Read the intended destination out of router state.
 *
 * Returns `fallback` for anything missing, malformed or off-origin — never
 * throws, because a bad `state` should land the operator on their dashboard, not
 * on an error.
 */
export function resolveReturnTo(state: unknown, fallback: string = FALLBACK): string {
    if (!state || typeof state !== 'object') return fallback;

    const from = (state as FromState).from;
    if (!from || typeof from !== 'object') return fallback;

    const { pathname, search } = from;
    if (!isSafePath(pathname)) return fallback;

    // A query string is worth carrying — a filtered list is a different
    // destination from the bare list.
    const hasSearch = typeof search === 'string' && search.startsWith('?');
    return hasSearch ? `${pathname}${search}` : pathname;
}
