/**
 * `/audit` — the trail: the list row, the entry detail, the action catalog, the
 * exports and the interim jovi-mall feed.
 *
 * The list row is field for field what `docs/admin/api/audit.md` documents for
 * `GET /audit`, and it is shared verbatim with `GET /administrators/me/activity`,
 * whose *"query parameters, response shape, pagination and sorting are
 * identical"* — and which carries **no permission at all**, because an audit
 * trail people cannot see their own entry in is one they have no way to
 * challenge.
 *
 * Two things about this feed that shape the UI:
 *
 * - **Support sees a narrowed feed, per row, in the query.** Rows whose subject
 *   is internal — administrators, sessions, approvals, exports, feature flags,
 *   workers, maintenance windows — are invisible to tier 3. So a short feed is
 *   not evidence of a quiet platform, and an out-of-scope row answers `404`
 *   rather than `403`, because a 403 would confirm it exists.
 * - **`payload`, `before` and `after` are not on list rows.** The detail
 *   endpoint carries those. Nothing here should pretend to show a diff.
 */

/** `attempted` is an intent whose outcome never landed — see `AuditHealth`. */
export type AuditStatus =
    | 'attempted'
    | 'succeeded'
    | 'failed'
    | 'denied'
    | 'queued'
    | (string & {});

/**
 * The five outcomes, in the order the server pins them.
 *
 * Offered by every status filter on the dashboard. The server owns this enum;
 * second-guessing it with a subset is how a filter stops matching a row already
 * on screen.
 */
export const AUDIT_STATUSES: readonly AuditStatus[] = [
    'attempted',
    'succeeded',
    'failed',
    'denied',
    'queued',
];

/**
 * The 22 `targetType` values, verbatim from `audit.md`.
 *
 * `none` is a real member, not a placeholder for absent: an action that concerns
 * no record — a login, a health probe — records it deliberately.
 */
export const AUDIT_TARGET_TYPES: readonly string[] = [
    'user',
    'vendor',
    'agency',
    'agent',
    'customer',
    'order',
    'shipment',
    'remittance',
    'deposit',
    'discrepancy',
    'payout',
    'ticket',
    'article',
    'plan',
    'administrator',
    'admin_session',
    'approval_request',
    'audit_export',
    'feature_flag',
    'worker',
    'maintenance_window',
    'none',
];

/**
 * The read-scoping axis.
 *
 * Support sees `platform_actor` and `platform_record` rows plus their own
 * actions; `internal` rows are invisible to them, filtered in the query. This is
 * rendered on the detail screen so an operator can see *why* a row is or is not
 * in a colleague's feed.
 */
export type AuditSubjectClass = 'platform_actor' | 'platform_record' | 'internal' | (string & {});

export interface AuditActor {
    kind: string;
    id: string | null;
    email: string | null;
    displayName: string | null;
    tier: number | null;
    sessionId: string | null;
}

export interface AuditTarget {
    type: string;
    id: string | null;
    /** A human label for the record — an order number, a payout reference. */
    label: string | null;
    /** `platform_record` vs `internal`, which is what the Support narrowing keys on. */
    subjectClass: AuditSubjectClass | null;
}

export interface AuditOutcome {
    code: string | null;
    statusCode: number | null;
    message: string | null;
    /** Present on `denied` rows. */
    denialKind: string | null;
    requiredPermissions: string[];
    /** jovi-mall's own code on a delegated refusal — the only handle on *why*. */
    platformCode: string | null;
}

export interface AuditRequest {
    method: string;
    path: string;
    ip: string | null;
    userAgent: string | null;
}

export interface AuditEntry {
    id: string;
    /** When the thing happened. The feed's only sort key, newest first. */
    occurredAt: string;
    /** When the outcome landed. `null` on an `attempted` row that never resolved. */
    completedAt: string | null;
    /** The originating request's id. Join on this to follow one action across rows. */
    correlationId: string;
    action: string;
    /**
     * The catalog's one-line description, **so a feed reads without a lookup
     * table**. `null` for a row whose action is no longer catalogued — fall back
     * to `action`.
     */
    actionSummary: string | null;
    actionFamily: string;
    status: AuditStatus;
    /** Money, escalation, destructive or four-eyes. The `sensitiveOnly` filter's subject. */
    sensitive: boolean;
    actor: AuditActor;
    target: AuditTarget;
    relatedTarget: { type: string; id: string | null } | null;
    request: AuditRequest;
    outcome: AuditOutcome;
    /** Set when the action was performed by approving a dual-control request. */
    viaApprovalId: string | null;
    delegated: boolean;
    exportedAt: string | null;
    /** `null` until the row has been exported — retention is exported-AND-aged. */
    purgeAfter: string | null;
}

/** `GET /audit` query parameters. The overview sends only `limit` and `sort`. */
export interface AuditListQuery {
    actorId?: string;
    action?: string;
    actionFamily?: string;
    status?: AuditStatus;
    targetType?: string;
    targetId?: string;
    correlationId?: string;
    sensitiveOnly?: boolean;
    search?: string;
    /** ISO-8601 instants. **Maximum span 92 days here**, not the usual 366. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

/**
 * `meta` on the audit feed.
 *
 * **`oldestRetainedAt` is worth rendering**: it is why the feed stops where it
 * does, rather than the feed looking broken at the retention boundary.
 */
export interface AuditListMeta {
    total: number;
    page: number;
    limit: number;
    /** `0` on an empty list, not `1`. */
    pages: number;
    retentionDays: number | null;
    oldestRetainedAt: string | null;
}

// ─── The entry detail ─────────────────────────────────────────────────────────

/**
 * `GET /audit/:auditId` — every list field, plus the recorded state.
 *
 * ── The three fields the list withholds ───────────────────────────────────────
 * `payload`, `before` and `after` are the *only* place this dashboard renders
 * data the server recorded from a request body. They arrive already sanitised —
 * ADR-006 D-5's `sanitiseState()` strips credential-shaped fields at any depth,
 * deriving its set from the logger's `REDACTED_PATHS` — and the dashboard
 * redacts again on the way out through `lib/audit-redaction.ts`. Two nets,
 * because this is the one screen where a server-side regression would be
 * invisible until it had already been read.
 *
 * A row records what **moved** — `before: { tier: 3 }`, `after: { tier: 2 }` —
 * never a whole document. Do not render these as if they were the record.
 */
export interface AuditEntryDetail extends AuditEntry {
    /** The request payload, with credential-shaped fields already redacted by name. */
    payload: Record<string, unknown> | null;
    /** The changed fields as they were. */
    before: Record<string, unknown> | null;
    /** The changed fields as they became. */
    after: Record<string, unknown> | null;
    /**
     * A value was too large to store and was replaced by a summary.
     *
     * Distinct from redaction: nothing was hidden for being secret, something was
     * dropped for being big. The two get separate notices.
     */
    stateTruncated: boolean;
}

// ─── The action catalog ───────────────────────────────────────────────────────

/**
 * Where the change lands, which decides how it can be audited.
 *
 * `wi_admin_txn` — row and change commit in one transaction, so an unaudited
 * action is impossible · `delegated` — jovi-mall over HTTP, intent then outcome ·
 * `external` — Redis or the platform connection, intent then outcome ·
 * `observation` — nothing to roll back, best-effort.
 */
export type AuditTransport =
    | 'wi_admin_txn'
    | 'delegated'
    | 'external'
    | 'observation'
    | (string & {});

export interface AuditActionCatalogEntry {
    name: string;
    /** The first segment of `name`, denormalised server-side. */
    family: string;
    /** The `targetType` rows for this action carry. */
    target: string;
    transport: AuditTransport;
    /** The permission that governs the action. */
    permission: string;
    summary: string;
}

/**
 * `GET /audit/actions` — the vocabulary, so a dashboard builds its filter from
 * the catalog instead of discovering it by collecting 400s.
 *
 * **`data` is an object here, not an array** — the only list-shaped read on the
 * service that is not paginated, so it goes through `api.get`, not `api.list`.
 */
export interface AuditActionCatalog {
    actions: AuditActionCatalogEntry[];
    total: number;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * `running` means the file is not durable yet and `failed` means it never will
 * be; only `complete` may be downloaded. Open, like every other server enum
 * here — a fourth state is an additive change.
 */
export type AuditExportStatus = 'running' | 'complete' | 'failed' | (string & {});

/** `api` for one made here; `cli` for one made by `npm run audit:export`. */
export type AuditExportSource = 'api' | 'cli' | (string & {});

/**
 * An export manifest.
 *
 * ── An export is not a purge ──────────────────────────────────────────────────
 * It writes an NDJSON file and **stamps** the rows it covered as exported. It
 * deletes nothing: `purgedAt` and `purgedCount` are always `null` on an API
 * export, and purging lives in the CLI behind `--purge`. Retention is
 * exported-**and**-aged, which is why a row's `purgeAfter` stays `null` until a
 * manifest has stamped it — nothing can age out of the trail without first
 * having been written to a file.
 *
 * **`fileName`, never a path.** A server filesystem path is nothing a dashboard
 * can use and something an attacker can, so the service does not send one.
 */
export interface AuditExport {
    id: string;
    status: AuditExportStatus;
    source: AuditExportSource;
    requestedBy: string | null;
    requestedByName: string | null;
    rangeFrom: string | null;
    rangeTo: string | null;
    fileName: string | null;
    byteSize: number | null;
    rowCount: number | null;
    /** Checksum of the file, so a client can verify what it downloaded. */
    sha256: string | null;
    retentionDays: number;
    startedAt: string;
    completedAt: string | null;
    /** When the covered rows were marked exported, and how many. */
    stampedAt: string | null;
    stampedCount: number | null;
    /** Always `null` on an API export — purging is the CLI's. */
    purgedAt: string | null;
    purgedCount: number | null;
    failureReason: string | null;
    /** True once the file is durable. The only reliable gate on the download. */
    downloadable: boolean;
}

/** `POST /audit/exports`. **Both bounds are required here**, unlike the feed's. */
export interface CreateAuditExportBody {
    from: string;
    to: string;
}

/** `GET /audit/exports`. Sort is `startedAt` or `-startedAt`; there are no filters. */
export interface AuditExportListQuery {
    page?: number;
    limit?: number;
    sort?: string;
}

