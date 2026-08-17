/**
 * `/notifications` — the administrator inbox. All ten routes.
 *
 * **Five of these writes are the service's one exception to "every mutation is
 * audited".** Marking read, unread, archived, unarchived and read-all record
 * nothing, on purpose — a read receipt says somebody *looked*, not that anybody
 * *did* anything, and auditing them would bury a security review under a
 * morning's triage. Whatever the administrator then does about a notification is
 * audited by the endpoint that does it.
 *
 * The **preference write is the one audited action here**
 * (`notifications.preferences.update_self`), because durable configuration that
 * changes what the service does in future is on the other side of that line.
 * Both preference routes are *self*-service and carry **no permission at all** —
 * gating an administrator's own configuration behind a level permission would
 * stop a tier-3 Support administrator configuring theirs.
 */

import { api, type RequestOptions } from '@/services/api';
import { withQuery } from '@/lib/query';
import type {
    AdminNotification,
    MarkAllReadBody,
    MarkAllReadResult,
    NotificationListMeta,
    NotificationListQuery,
    NotificationPreference,
    NotificationPreferenceOverrides,
    NotificationSource,
    UnreadCountQuery,
} from '@/types/notifications.types';

export interface NotificationPage {
    data: AdminNotification[];
    meta: NotificationListMeta;
}

/**
 * The inbox.
 *
 * Defaults to `status: 'unread'` server-side — the question somebody opens an
 * inbox asking is "what have I not dealt with" — and to `-occurredAt`, which is
 * when the thing happened rather than when the projector noticed. Ordering by
 * `createdAt` would let a slow tick or a restart reorder the list for reasons
 * that have nothing to do with the platform.
 */
export async function listNotifications(
    query: NotificationListQuery = {},
    options?: RequestOptions,
): Promise<NotificationPage> {
    const page = await api.list<AdminNotification>(
        withQuery('/notifications', { ...query }),
        options,
    );

    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            // `pages: 0` on an empty list is the contract's rule, and the
            // fallback has to honour it or a "page 1 of 1" appears over nothing.
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
            unreadCount: Number(page.meta.unreadCount ?? 0),
        },
    };
}

/**
 * Just the number.
 *
 * A separate route because a dashboard polling for a badge should not fetch
 * twenty rows to get it. It takes the same narrowing vocabulary as the list minus
 * paging, sorting and `status` — the endpoint's whole subject is unread.
 */
export async function getUnreadCount(
    query: UnreadCountQuery = {},
    options?: RequestOptions,
): Promise<number> {
    const result = await api.get<{ unreadCount: number }>(
        withQuery('/notifications/unread-count', { ...query }),
        options,
    );
    return Number(result?.unreadCount ?? 0);
}

/**
 * The in-flight or resolved source registry.
 *
 * Memoised for the same two reasons the audit action catalog is: it is a handful
 * of rows that change only on a deploy, and more than one screen wants it — the
 * inbox's `source` and `type` filters, and the sources reference. Memoising the
 * **promise** rather than the value also makes concurrent callers and
 * StrictMode's double-effect share one request rather than racing two.
 */
let sourcesPromise: Promise<NotificationSource[]> | null = null;

/**
 * `GET /notifications/sources` — what this inbox can **ever** say, and what each
 * answer is derived from.
 *
 * `requiredPermission` on each source is the field that answers "why do I never
 * see these": it lets an administrator tell "none have happened" from "I am not
 * entitled to them", which is otherwise indistinguishable from an empty list.
 *
 * It is also the **only** honest way to populate the inbox's `?source=` filter.
 * That parameter is a `z.enum` over the *live registry ids*, not a bounded
 * string, so a hand-written list stops offering a source the day one is added and
 * — worse — sends a `400` if this build's transcription ever drifts.
 *
 * ── It takes no `AbortSignal`, deliberately ───────────────────────────────────
 * The promise is shared, so the *first* caller's signal would decide the fate of
 * every later caller's copy: one filter unmounting mid-flight would reject the
 * registry for the whole page. **A rejection clears the memo**, or one flaky
 * request costs every consumer its filter for the rest of the session.
 */
export async function listNotificationSources(): Promise<NotificationSource[]> {
    sourcesPromise ??= api
        .get<{ sources: NotificationSource[] } | null>('/notifications/sources')
        .then((result) => result?.sources ?? [])
        .catch((error: unknown) => {
            sourcesPromise = null;
            throw error;
        });

    return sourcesPromise;
}

/**
 * Drop the memoised registry.
 *
 * A test seam, in the shape `__resetApiClientState` and
 * `__resetAuditActionCache` already established: module state that survives
 * between tests is state one test can leak into the next.
 */
export function __resetNotificationSourceCache(): void {
    sourcesPromise = null;
}

export function markNotificationRead(
    notificationId: string,
    options?: RequestOptions,
): Promise<AdminNotification> {
    return api.patch<AdminNotification>(`/notifications/${notificationId}/read`, undefined, options);
}

export function markNotificationUnread(
    notificationId: string,
    options?: RequestOptions,
): Promise<AdminNotification> {
    return api.patch<AdminNotification>(
        `/notifications/${notificationId}/unread`,
        undefined,
        options,
    );
}

export function archiveNotification(
    notificationId: string,
    options?: RequestOptions,
): Promise<AdminNotification> {
    return api.post<AdminNotification>(
        `/notifications/${notificationId}/archive`,
        undefined,
        options,
    );
}

export function unarchiveNotification(
    notificationId: string,
    options?: RequestOptions,
): Promise<AdminNotification> {
    return api.post<AdminNotification>(
        `/notifications/${notificationId}/unarchive`,
        undefined,
        options,
    );
}

/**
 * Bulk mark-read, **scoped by the same filters the list takes**.
 *
 * ── Two things this call gets wrong if written the obvious way ────────────────
 * 1. **The count is `marked`, not `updated`.** `notification.controller.ts` ends
 *    with `sendSuccess(res, { marked }, …)`. Reading `updated` yields `undefined`
 *    on every call, so a confirmation built on it reports `0` however many rows
 *    it actually touched — silently, because `Number(undefined ?? 0)` is a
 *    perfectly good `0`.
 * 2. **Sending no body marks more than the operator asked for.** The contract:
 *    *"An unscoped 'mark everything read' is a button that silently discards
 *    whatever arrived between the page rendering and the click."* Pass the active
 *    filters and `before`, and the gesture means what the person making it thinks
 *    it means.
 *
 * `api.mutate` rather than `api.post` so the server's own sentence survives —
 * it composes *"7 notifications marked read"*, and re-deriving that client-side
 * would be a second copy of a number only the server can state.
 */
export async function markAllNotificationsRead(
    body: MarkAllReadBody = {},
    options?: RequestOptions,
): Promise<MarkAllReadResult> {
    const result = await api.mutate<{ marked: number } | null>(
        'POST',
        '/notifications/read-all',
        body,
        options,
    );

    return { marked: Number(result.data?.marked ?? 0), message: result.message };
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * `GET /notifications/preferences` · *self* — one entry per type, always all ten.
 *
 * No permission is checked, so this is the one read here that a caller without
 * `notifications.read` could still make. Nothing in the dashboard relies on that,
 * but it is why the preferences screen is mounted as a permission-free route
 * rather than under the notifications module's gate.
 */
export async function getNotificationPreferences(
    options?: RequestOptions,
): Promise<NotificationPreference[]> {
    const result = await api.get<{ preferences: NotificationPreference[] } | null>(
        '/notifications/preferences',
        options,
    );
    return result?.preferences ?? [];
}

/**
 * `PATCH /notifications/preferences` · *self* — the one audited write here.
 *
 * **Send only the keys the operator changed.** An absent key means "leave
 * whatever it had", so patching the full map would convert every untouched
 * default-tracking row into an explicit override — and `overridden` is exactly
 * what decides whether a type keeps following the catalog.
 *
 * `api.mutate` for the message: the server says *"Saved. Preferences apply to
 * notifications raised from now on; anything already in your inbox stays
 * there."* The contract's instruction about it is one word — **"Show it."** —
 * because the obvious reading of muting a type ("this cleans up my inbox") is
 * wrong.
 */
export async function updateNotificationPreferences(
    overrides: NotificationPreferenceOverrides,
    options?: RequestOptions,
): Promise<{ preferences: NotificationPreference[]; message: string | undefined }> {
    const result = await api.mutate<{ preferences: NotificationPreference[] } | null>(
        'PATCH',
        '/notifications/preferences',
        { overrides },
        options,
    );

    return { preferences: result.data?.preferences ?? [], message: result.message };
}
