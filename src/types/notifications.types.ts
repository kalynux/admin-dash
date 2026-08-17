/**
 * `/notifications` — the administrator inbox.
 *
 * Field for field what `docs/admin/api/notifications.md` documents.
 *
 * Two properties of this surface shape the types more than usual:
 *
 * 1. **Nothing here creates a notification.** There is no `POST /notifications`
 *    and no `DELETE`; every row is derived by a background projector from a row
 *    another part of the platform already committed. So there is no create or
 *    delete payload to model, and there never will be.
 * 2. **`notifications.read` does not decide which rows you see.** That is settled
 *    per row from the permission its source declares, re-checked on every read —
 *    two administrators at the same level can legitimately have different
 *    inboxes. Nothing client-side can predict the contents from the held set, so
 *    nothing here tries.
 */

/**
 * The ten declared types, as a value.
 *
 * Transcribed from `NOTIFICATION_TYPES` in
 * `backend/admin/src/modules/notifications/domain/notification.types.ts`, which
 * `notifications.md` calls "ten, and the list is closed". It is *closed* in the
 * sense that a declared type with no producing source fails the service's boot —
 * not in the sense that it can never grow.
 *
 * Kept as a constant because two screens must render every type on first paint:
 * the inbox's type filter and the preferences list. It is the **known half** of
 * the vocabulary, not the whole of it — see `NotificationType`.
 */
export const NOTIFICATION_TYPES = [
    'cod.discrepancy.opened',
    'cod.remittance.declared',
    'money.payout.requested',
    'orders.dispute.opened',
    'agencies.verification.pending',
    'vendors.kyc.pending',
    'system.tracking_dispatch.failed',
    'approvals.requested',
    'approvals.decided',
    'audit.export.finished',
] as const;

/**
 * The ten declared types.
 *
 * `string`-widened on purpose. Adding a type is an additive, non-breaking change
 * on this service, so a closed union would turn a routine deploy into a render
 * fault — the contract's own instruction is to treat an unknown enum value as
 * unknown and render the raw string.
 */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number] | (string & {});

/** One of the ten, narrowly — for the places a *known* type is required. */
export type DeclaredNotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationSeverity = 'info' | 'warning' | 'critical' | (string & {});

/**
 * What the list may be narrowed to. `unread` is the service's default.
 *
 * **`all` does not mean all.** The repository maps it to
 * `{ archived_at: { $exists: false } }` — read *and* unread, but never archived —
 * and `?status=archived` is how the archive is opened. `notifications.md`'s query
 * table names the value and says nothing; only `ADR-013-NOTIFICATIONS.md` states
 * it. Labelling this "All" in a UI is therefore a lie, which is why the inbox
 * calls it "Read and unread".
 */
export type NotificationStatusFilter = 'unread' | 'read' | 'archived' | 'all';

/**
 * The record a notification is about.
 *
 * **Both members are nullable and the object itself is not** — `target_type` is
 * `required: true` on the model while `target_id` and `target_label` default to
 * `null`, so `toNotificationDto` always builds the object. `notifications.md`
 * does not promise its presence, so the field is still declared nullable here;
 * what the doc's example does hide is that `id` can be absent from a target that
 * exists.
 */
export interface NotificationTarget {
    type: string;
    id: string | null;
    label: string | null;
}

export interface AdminNotification {
    id: string;
    type: NotificationType;
    severity: NotificationSeverity;
    title: string;
    /** `default: null` on the model — a notification may be a headline alone. */
    body: string | null;
    /** The registry id of whatever derived this row. */
    source: string;
    target: NotificationTarget | null;
    /**
     * Where to send the administrator — **a dashboard route, and relative**.
     *
     * It arrives without this application's `/dashboard` prefix
     * (`/cod/discrepancies/:id`), so it is never handed to the router directly.
     * `src/lib/notification-path.ts` maps and validates it.
     */
    actionPath: string | null;
    /** When the thing happened — not when the projector noticed. */
    occurredAt: string;
    /** Always present, `null` when unset. Never absent, so never feature-detect. */
    readAt: string | null;
    archivedAt: string | null;
    isRead: boolean;
    isArchived: boolean;
}

/** `GET /notifications` query parameters. */
export interface NotificationListQuery {
    status?: NotificationStatusFilter;
    type?: NotificationType;
    severity?: NotificationSeverity;
    source?: string;
    /** ISO-8601 instants. The span may not exceed 366 days. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** One key at a time: `occurredAt`, `createdAt` or `severity`, `-` for descending. */
    sort?: string;
}

/** The narrowing `GET /notifications/unread-count` accepts — no paging, no status. */
export type UnreadCountQuery = Pick<NotificationListQuery, 'type' | 'severity' | 'source'>;

/**
 * `POST /notifications/read-all` — the body, and it is **not** the list query.
 *
 * Four fields: the three narrowing filters and `before`. No `status` (the subject
 * is unread by definition), and no `from`/`to`.
 *
 * ── Why sending nothing is the wrong default ──────────────────────────────────
 * The contract's own reasoning: *"An unscoped 'mark everything read' is a button
 * that silently discards whatever arrived between the page rendering and the
 * click."* Passing the filters the operator is looking at, plus `before`, makes
 * the gesture mean *"mark read what I was looking at"* — which is what it means
 * to the person making it.
 */
export interface MarkAllReadBody {
    type?: NotificationType;
    severity?: NotificationSeverity;
    source?: string;
    /**
     * An ISO-8601 instant. **Inclusive** — the repository filters
     * `occurred_at: { $lte: before }`.
     *
     * Note this is the opposite bound to the identically-named cursor on
     * `GET /accounts/:ownerType/:ownerId/activity`, which `README.md` defines as
     * "strictly older than. Never inclusive". Two fields, one name.
     */
    before?: string;
}

/** What `POST /notifications/read-all` answers. */
export interface MarkAllReadResult {
    /** The field is `marked`, **not** `updated`. */
    marked: number;
    /** The server's own sentence, e.g. "7 notifications marked read". */
    message: string | undefined;
}

/**
 * `meta` on the list.
 *
 * **`unreadCount` rides alongside the pagination fields and is computed with the
 * same filters**, which is the service's way of guaranteeing the badge and the
 * list cannot disagree.
 */
export interface NotificationListMeta {
    total: number;
    page: number;
    limit: number;
    /** `0` on an empty list, not `1`. */
    pages: number;
    unreadCount: number;
}

/** One entry of `GET /notifications/sources`. */
export interface NotificationSource {
    id: string;
    describe: string;
    collection: string;
    produces: NotificationType[];
    /** What you must hold to receive it. `null` when ungated. */
    requiredPermission: string | null;
    severity: NotificationSeverity[];
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * One row of `GET /notifications/preferences` — **always all ten**, whether or
 * not the administrator has ever touched them.
 *
 * The three booleans are genuinely independent and the contract says so in bold:
 * **`enabled === defaultEnabled` does not imply `overridden === false`**. An
 * administrator can hold an explicit override that happens to agree with the
 * catalog today and would keep agreeing with the old value if the catalog moved.
 * So a control that reads its state from value equality is wrong — read
 * `overridden`.
 */
export interface NotificationPreference {
    type: NotificationType;
    /** The catalog's one-line description of what raises this. */
    summary: string;
    /** Singular here. On a `NotificationSource` the same-named field is an array. */
    severity: NotificationSeverity;
    /** The **effective** value: the override if there is one, else the default. */
    enabled: boolean;
    /** The catalog's value, which this administrator may or may not be tracking. */
    defaultEnabled: boolean;
    /** Whether an explicit override exists at all. The only honest source of state. */
    overridden: boolean;
}

/**
 * `PATCH /notifications/preferences` — the `overrides` map.
 *
 * **Three states, and the third is the one that matters:**
 *
 * | Value | Means |
 * |---|---|
 * | key absent | leave whatever it had |
 * | `true` / `false` | set an explicit override |
 * | **`null`** | **remove the override** — track the catalog again from now on |
 *
 * Without `null` the only way to say "stop overriding this" is to override it to
 * whatever the default happens to be today, which silently stops tracking. So the
 * `| null` is load-bearing and must not be tidied into `boolean`.
 *
 * The body is **strict** and validated against the ten declared types, so this is
 * keyed on `DeclaredNotificationType` rather than the widened union — a type this
 * build invented would be a `400`.
 */
export type NotificationPreferenceOverrides = Partial<
    Record<DeclaredNotificationType, boolean | null>
>;

export const NOTIFICATION_STATUS_FILTERS: readonly NotificationStatusFilter[] = [
    'unread',
    'read',
    'archived',
    'all',
] as const;

export const NOTIFICATION_SEVERITIES: readonly string[] = ['info', 'warning', 'critical'] as const;
