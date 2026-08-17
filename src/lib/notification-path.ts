import { routeRequirement } from '@/config/navigation';

/**
 * Turn a notification's `actionPath` into a route this application can open.
 *
 * The service emits **dashboard-relative** paths without this app's `/dashboard`
 * prefix — `/cod/discrepancies/:id`, `/money/payouts/:id`. That is a live
 * coupling between the backend's route vocabulary and this dashboard's URL
 * layout, and it is why the mapping lives in one tested function rather than
 * being inlined at the click site.
 *
 * It returns `null` rather than a best guess in three cases:
 *
 * - the notification carries no `actionPath` at all (the field is nullable);
 * - the value is not a relative path — an absolute URL here would be somebody
 *   else's origin, and following it would turn an inbox row into an open
 *   redirect;
 * - the mapped path resolves to no declared route.
 *
 * The third is the one that matters in practice. The service already emits
 * `actionPath` for surfaces this dashboard has not built, so a row that linked
 * anyway would take an operator to a 404 and read as a broken product. A row with
 * no link is honest: the notification still says what happened.
 */
export function toDashboardPath(actionPath: string | null | undefined): string | null {
    if (typeof actionPath !== 'string') return null;

    const trimmed = actionPath.trim();
    if (trimmed.length === 0) return null;

    // Must be a single-slash-rooted relative path. `//evil.example` is
    // protocol-relative and would leave the application entirely — the same rule
    // `resolveReturnTo` applies to the post-sign-in redirect.
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

    // Already absolute within the dashboard, in case the service ever emits it
    // that way. Prefixing again would produce `/dashboard/dashboard/...`.
    const candidate =
        trimmed === '/dashboard' || trimmed.startsWith('/dashboard/')
            ? trimmed
            : `/dashboard${trimmed}`;

    // Strip the query and hash before asking the nav config, which knows about
    // paths only. They are preserved on the value returned.
    const [pathname] = candidate.split(/[?#]/);

    return routeRequirement(pathname) === 'undeclared' ? null : candidate;
}
