/**
 * `/dev-tools` — the nine operations writes, and the one read that gates them.
 *
 * **Almost everything here is Developer (tier 1) only, and every write is audited.**
 * Nine of the thirteen `developer_tools.*` permissions carry the `destructive` flag, which
 * means they can never be granted by family expansion — a human has to type the name.
 *
 * ── Two gates, answering different questions ──────────────────────────────────
 * The **permission** asks *may this person?*. The **`dev_tools.enabled` feature flag**, which
 * defaults **off**, asks *is the service accepting these right now?*. When it is off the answer
 * is `409 DEV_TOOLS_DISABLED`, **not `403`** — you hold the permission and the service is
 * refusing. A 403 would send an administrator to look at their own grants, which is the wrong
 * place. See {@link DEV_TOOLS_FLAG}.
 *
 * Three routes are deliberately **not** behind the flag: both feature-flag routes (a switch
 * must not be able to turn off its own switch), `PUT /maintenance` (its failure mode is losing
 * the ability to undo it), and `GET /workers` (a read).
 *
 * Design records: [ADR-014](../../api-doc/docs/ADR-014-SYSTEM-OPERATIONS.md),
 * [ADR-015](../../api-doc/docs/ADR-015-DEVELOPER-TOOLS.md).
 */

// ─── Feature flags ────────────────────────────────────────────────────────────

/**
 * The whole catalog. **Closed** — a flag with no consumer stops the service booting, and
 * `PUT /dev-tools/feature-flags/:flag` pins the path parameter to a `z.enum` over exactly
 * these, so a typo is a `400` naming the valid values rather than an upsert that silently
 * creates a flag nothing reads.
 *
 * Transcribed from `backend/admin/src/modules/dev-tools/domain/feature-flag.catalog.ts`.
 */
export const FEATURE_FLAG_NAMES = [
    'audit.route_probe',
    'audit.legacy_feed',
    'dev_tools.enabled',
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

/**
 * The master switch, and the only flag in the catalog defaulting to **off**.
 *
 * It gates five of the seven writes — worker triggers, outbox replay, outbox prune, catalogue
 * vectorise and cache flush. `GET /dev-tools/feature-flags` is *not* behind it, which is what
 * lets the dashboard always know its state and offer the one screen that can turn it on.
 */
export const DEV_TOOLS_FLAG: FeatureFlagName = 'dev_tools.enabled';

/**
 * One row of `GET /dev-tools/feature-flags`.
 *
 * **Ten fields, not the five the docs show.** `dev-tools.md`'s example lists `name`, `enabled`,
 * `default`, `consumer` and `summary` with no ellipsis, so it reads as complete;
 * `feature-flag.service.ts:36-48` returns five more, and they are precisely what a flags table
 * wants. `BACKEND-INTEGRATION-MATRIX.md` repeats the same omission.
 *
 * The four provenance fields are all `null` while `isDefault` is true, because there is no row
 * to have written them.
 */
export interface FeatureFlag {
    name: FeatureFlagName;
    enabled: boolean;
    /**
     * **True when no row exists** and the value is the catalog's.
     *
     * Not derivable from `enabled === default`: a flag deliberately set to the same value the
     * catalog already had is *overridden*, and the difference is the whole provenance question
     * — somebody made a decision here, and `reason` says why.
     */
    isDefault: boolean;
    /** The catalog's value, i.e. what the code was written against. */
    default: boolean;
    /** The file that reads this flag. A flag with no consumer refuses to boot. */
    consumer: string;
    summary: string;
    /** Required 10–500 chars on every write, so it is present on every overridden flag. */
    reason: string | null;
    updatedBy: string | null;
    updatedByEmail: string | null;
    updatedAt: string | null;
}

/**
 * `PUT /dev-tools/feature-flags/:flag` · `developer_tools.feature_flags.set` · **destructive**.
 *
 * `reason` is **required, 10–500 characters** — enough to refuse "test" and "x" without
 * demanding an essay. It is the only place the context for a flipped flag can live.
 */
export interface SetFeatureFlagBody {
    enabled: boolean;
    reason: string;
}

export const FEATURE_FLAG_REASON_MIN = 10;
export const FEATURE_FLAG_REASON_MAX = 500;

// ─── Worker triggers ──────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/workers/:workerKey/run`.
 *
 * **`ran` is optional and its ABSENCE means `true`.** A jovi-mall predating the F-19 overlap
 * lock always ran, so `result.ran !== false` is the only correct reading and it is safe in
 * either deploy order. The rule is stated in `dev-tools.gateway.ts:108-118` and nowhere in
 * `dev-tools.md`; a screen branching on `ran === true` reports "did not run" against an older
 * platform. `services/dev-tools.service.ts` resolves it so no call site can get it wrong.
 *
 * **A refused trigger is a `200`, not an error.** `ran: false` means the sweep is already in
 * flight here or on another instance and yours changed nothing — a neutral outcome, not a
 * failure. That is a different answer from `409 DEV_TOOLS_WORKER_BUSY`, which says *this
 * instance* is already doing it for someone.
 */
export interface WorkerRunResult {
    worker: string;
    durationMs: number;
    ran?: boolean;
    processed?: number;
    note?: string;
}

/** The worker-key shape the service validates before the network hop: `^[a-z][a-z0-9-]*$`, 1–64. */
export const WORKER_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * The two worker verdicts, which arrive as **`details.platformCode`** on a forwarded rejection
 * rather than as `error.code`. Branch on the platform code.
 *
 * `DEV_TOOLS_WORKER_UNKNOWN` (404) carries `details.known` — the registry's valid keys, which
 * is worth rendering because the registry lives in the platform and this client never pins it.
 */
export const WORKER_UNKNOWN_CODE = 'DEV_TOOLS_WORKER_UNKNOWN';
export const WORKER_BUSY_CODE = 'DEV_TOOLS_WORKER_BUSY';

// ─── Outbox ───────────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/outbox/replay` · **destructive**, and irreversible in the sense that matters:
 * **downstream services will see these events a second time.**
 *
 * Omitting `eventIds` means "the oldest failed rows up to `limit`", which is the common case
 * after an outage. Only `failed` rows are eligible, and `attempts` is reset so the dispatcher's
 * backoff starts fresh.
 */
export interface ReplayOutboxBody {
    /** 1–1000. The platform defaults to 100. */
    limit?: number;
    /** 1–1000 entries. Specific rows, when an operator knows which. */
    eventIds?: string[];
}

export interface ReplayOutboxResult {
    replayed: number;
    requested?: number;
    note?: string;
}

/**
 * `POST /dev-tools/outbox/prune` · **destructive and irreversible** — it permanently deletes
 * delivered rows.
 *
 * `status` is absent from this type on purpose: it is the **literal `"sent"`** and
 * `pruneOutbox()` supplies it, because pruning `failed` destroys the input to replay and
 * pruning `pending` destroys undelivered events. A field that could take another value is one
 * somebody eventually passes another value to.
 *
 * `confirm` must repeat `olderThanDays` **as a string** — the age is the only variable deciding
 * this operation's blast radius, so it is the thing worth re-typing. (The cache flush's
 * `confirm` repeats a database name for the same reason applied to a different variable.)
 */
export interface PruneOutboxBody {
    /** **7–365.** The 7-day floor is the platform's, repeated so the refusal beats the hop. */
    olderThanDays: number;
    limit?: number;
    /** **Defaults to `true` on the platform's side.** Send it explicitly. */
    dryRun?: boolean;
    confirm: string;
}

export const PRUNE_MIN_DAYS = 7;
export const PRUNE_MAX_DAYS = 365;

/**
 * Three of these eight keys — `status`, `cutoff`, `oldestRemainingSentAt` — are absent from
 * `dev-tools.md`'s example.
 *
 * `oldestRemainingSentAt` exists so "is another pass worth it" does not require re-deriving the
 * cutoff by hand, and `truncated: true` means the limit was reached and the run must be
 * repeated.
 */
export interface PruneOutboxResult {
    status: string;
    olderThanDays: number;
    cutoff: string;
    dryRun: boolean;
    matched: number;
    deleted: number;
    truncated: boolean;
    oldestRemainingSentAt: string | null;
}

/** `422 DEV_TOOLS_OUTBOX_PRUNE_REFUSED` carries `details.code`, one of these four. */
export const PRUNE_REFUSAL_REASONS = [
    'status_not_prunable',
    'age_below_floor',
    'age_above_ceiling',
    'confirmation_mismatch',
] as const;

// ─── Maintenance ──────────────────────────────────────────────────────────────

/**
 * `PUT /dev-tools/maintenance` · **the single most consequential thing an operator can do to
 * this platform**, and the one write here that is *not* behind `dev_tools.enabled`.
 *
 * The carve-out is deliberate and its reasoning is worth keeping: with the flag applied, an
 * operator could not enter maintenance during an incident without first flipping an unrelated
 * switch — and anybody turning `dev_tools.enabled` off mid-window would **lock the exit**.
 *
 * `reason` is **required for anything but `off`**, 8–500 characters. It is shown to every
 * refused caller in the `503` body as well as recorded in the audit row, so it is read by people
 * who are not administrators.
 */
export interface SetMaintenanceBody {
    mode: 'off' | 'readonly' | 'down';
    reason?: string;
    /** 1–1440 (24 h). An unbounded window is the one everybody forgets is open. */
    expiresInMinutes?: number;
    /** The platform defaults this to `false` — webhooks stay open in both modes. */
    blockWebhooks?: boolean;
    /** The platform defaults this to `mode === 'down'`. `readonly` deliberately does not pause. */
    pauseWorkers?: boolean;
}

export const MAINTENANCE_REASON_MIN = 8;
export const MAINTENANCE_REASON_MAX = 500;
export const MAINTENANCE_MAX_MINUTES = 1440;

/**
 * **This result carries no `setBy`**, unlike the read's `MaintenanceWindow` — so a screen that
 * wants to show who opened the window must refetch `GET /system/maintenance` after the write.
 *
 * `convergenceSeconds` is stated rather than discovered: other instances read the singleton
 * through a short cache and there is a real window in which they disagree. **Show it.**
 * Re-issuing the current mode answers `changed: false` and does not restart the clock.
 */
export interface SetMaintenanceResult {
    changed: boolean;
    previousMode: string;
    mode: string;
    reason: string | null;
    blockWebhooks: boolean;
    pauseWorkers: boolean;
    startedAt: string | null;
    expiresAt: string | null;
    convergenceSeconds: number;
}

/**
 * The two path groups that stay reachable in **every** mode, and are cross-service.
 *
 * Both are read-only verdicts geo-tracker depends on. Blocking them means geo-tracker cannot
 * answer *"may this viewer track this agent"*, so every live subscription fails authorization
 * and every watcher is dropped — **a maintenance window would become a geo-tracker outage.**
 * Rendered on the maintenance screen so an operator opening a `down` window knows tracking
 * stays authorised rather than assuming it goes dark.
 */
export const MAINTENANCE_EXEMPT_PATHS = ['/api/internal/agents/*', '/api/tracking/*'] as const;

// ─── Cache flush ──────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/cache/flush` · **destructive and irreversible.**
 *
 * `db` is the database **NAME**, upper-case (`^[A-Z][A-Z0-9_]*$`) — never its index. A numeric
 * field invites `0`, and a typo turning `7` into `8` silently flushes live download links
 * instead of booking holds.
 *
 * **The valid names are never hard-coded in this client.** The three doc sources disagree on
 * membership, so the select is populated from `GET /system/dependencies` →
 * `redis.entries[].constant`, which is the live factory catalogue. See
 * `services/system.service.ts`.
 *
 * `confirm` must repeat `db` exactly. `prefix` is optional in general and **mandatory on the
 * destructive databases**, which the platform enforces — read `destructive` off the response
 * rather than keeping a client copy of which three they are.
 */
export interface FlushCacheBody {
    /** The upper-case NAME. */
    db: string;
    prefix?: string;
    /** 1–10 000. */
    limit?: number;
    /** **Defaults to `true` on the platform's side.** Send it explicitly. */
    dryRun?: boolean;
    /** Must repeat `db`. */
    confirm: string;
}

/**
 * **`db` here is the numeric Redis index**, while `db` on the way *in* is the upper-case name.
 * Same key, two types, opposite directions. The name comes back as `constant`.
 *
 * `cursor` is typed `string` in wi-admin's gateway but shown as `null` in `dev-tools.md`'s
 * example; `string | null` is the safe reading and the only one that survives both.
 *
 * `blastRadius` is jovi-mall's own statement of what these keys were for. It lands in the audit
 * row and should be rendered beside the counts — it is the sentence that makes "8412 keys
 * matched" mean something.
 */
export interface FlushCacheResult {
    db: number;
    constant: string;
    match: string;
    dryRun: boolean;
    matched: number;
    deleted: number;
    /** The scan stopped at a bound. `cursor` resumes it. A partial scan reading as "done" is the worst outcome here. */
    truncated: boolean;
    cursor: string | null;
    /** A capped sample of key **names**. Values are never returned, anywhere. */
    sample: string[];
    blastRadius: string;
    destructive: boolean;
}

/** Platform codes behind `PLATFORM_OPERATION_REJECTED` on the flush. */
export const CACHE_DB_UNKNOWN_CODE = 'DEV_TOOLS_CACHE_DB_UNKNOWN';
export const CACHE_FLUSH_REFUSED_CODE = 'DEV_TOOLS_CACHE_FLUSH_REFUSED';
export const CACHE_UNAVAILABLE_CODE = 'DEV_TOOLS_CACHE_UNAVAILABLE';

// ─── Catalogue ────────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/catalogue/vectorise` — rebuilds search vectors for the **entire** product
 * catalogue.
 *
 * **Synchronous**, so the request is long-running by design and must not be aborted or treated
 * as fire-and-forget. The platform's result is a genuinely opaque pass-through — wi-admin types
 * it `Record<string, unknown>` — so it is rendered as key/value rather than parsed.
 *
 * The only destructive tool with no pre-flight of any kind: no `dryRun`, no count to read first.
 */
export type VectoriseResult = Record<string, unknown>;

// ─── The flag refusal ─────────────────────────────────────────────────────────

/**
 * `409 DEV_TOOLS_DISABLED`, category **`business_rule`** rather than `conflict`.
 *
 * The category override is deliberate: nothing changed underneath the caller, so `conflict`
 * would send them hunting a race that is not there. The remedy is to turn the flag on, and the
 * screen that does it is `/dashboard/dev-tools/feature-flags`.
 */
export const DEV_TOOLS_DISABLED_CODE = 'DEV_TOOLS_DISABLED';

/**
 * Did this failure come from the gate rather than from the caller's grants?
 *
 * Lives here rather than beside the notice that renders it, because a file under `components/`
 * that exports both a component and a plain function fails `react-refresh/only-export-components`
 * — the same reason `isPayoutNotPending` sits in `money.types.ts`.
 */
export function isDevToolsDisabled(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === DEV_TOOLS_DISABLED_CODE
    );
}
