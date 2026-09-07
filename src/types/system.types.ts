/**
 * `/system` — the seventeen operations reads.
 *
 * **Every route in this group is a `GET` and none is audited.** Nothing here changes anything,
 * and nothing here discloses something a Developer could not read out of a config file.
 *
 * ── Who computes the answer ───────────────────────────────────────────────────
 * Three reads are **wi-admin's own** and keep answering during a jovi-mall incident:
 * `/system/health` pings its own connections, `/system/outbox` reads the platform collection
 * directly, `/system/config` is local. Twelve are **delegated** and return `502`/`503
 * SERVICE_DEPENDENCY_UNAVAILABLE` when the platform is unreachable. Two are **direct probes** of
 * geo-tracker, and those cannot fail at all. A screen composing several must therefore fetch
 * them independently rather than in one `Promise.all` — the whole point of the split is that the
 * local half survives the remote half.
 *
 * ── Where the shapes come from ────────────────────────────────────────────────
 * `api-doc/admin/api/system.md` publishes a response shape for six of the seventeen. Eight have
 * none anywhere in the bundle and five more are prose-only. The types below were read from
 * `backend/admin/src/modules/system/gateways/system.gateway.ts` — whose interfaces were
 * themselves written by reading jovi-mall — cross-checked against
 * `api-doc/jovi-mall/admin/system.md`. That is the exception to CLAUDE.md's *"api-doc/jovi-mall is
 * background only"*: on a delegated passthrough wi-admin forwards the platform's payload
 * verbatim, so the platform's page **is** the shape. Recorded as a backend dependency; the
 * shapes belong in `system.md`.
 *
 * Several nested blocks are `Record<string, unknown>` at wi-admin's own seam. Where this file
 * types them, the field names come from `api-doc/jovi-mall/admin/system.md` and are marked
 * partial — render defensively and never `switch` on a value from one.
 *
 * Design records: [ADR-014](../../api-doc/admin/ADR-014-SYSTEM-OPERATIONS.md),
 * [ADR-015](../../api-doc/admin/ADR-015-DEVELOPER-TOOLS.md),
 * [ADR-016](../../api-doc/admin/ADR-016-ERROR-SYSTEM.md).
 */

// ─── The operation taxonomy ───────────────────────────────────────────────────

/**
 * What an operation does to the platform — the organising distinction of both this module and
 * `/dev-tools`, kept as a type rather than a colour convention somebody can forget.
 *
 * - **`read`** — changes nothing, audits nothing. Every `/system` GET and both health probes.
 * - **`probe`** — *a read that costs something*. Only `GET /system/integrations?probe=`: an SMTP
 *   `verify()` is a TCP+TLS handshake some providers rate-limit, and Telegram's `getMe`
 *   authenticates the bot. ADR-014 D-2's rule is that a diagnostics read may never cause a side
 *   effect a customer would see, cost money, or consume a quota a real request needs — and this
 *   is the one place that rule is relaxed, by explicit opt-in. Never run on page load.
 * - **`mutating`** — audited, reversible, takes a real `reason`, **not** behind
 *   `dev_tools.enabled`. The feature-flag and maintenance writes.
 * - **`dangerous`** — audited, `destructive` permission, behind `dev_tools.enabled`, re-runs a
 *   side effect against live data. The five tools.
 */
export const DANGER_LEVELS = ['read', 'probe', 'mutating', 'dangerous'] as const;

export type DangerLevel = (typeof DANGER_LEVELS)[number];

// ─── GET /system/health · wi-admin's own ──────────────────────────────────────

/**
 * One dependency's answer on `GET /system/health`.
 *
 * **The field is `ok`, a boolean — not `status`.** `/health/ready` reports the same four
 * dependencies as `'up' | 'down' | 'not_configured'` (see `ReadinessReport` in
 * `services/api.ts`), and the two shapes are easy to conflate. They are different endpoints
 * answering different questions: one is an authenticated operations read, the other an
 * unauthenticated probe an orchestrator polls.
 *
 * **And the key sets invert.** This read calls them `admin` / `platform`; the probe calls the
 * same two `mongoAdmin` / `mongoPlatform` — so `admin` here is `mongoAdmin` there, and a screen
 * that maps by position rather than by meaning will label the wi-admin database as the
 * platform's. Label by meaning. See `SYSTEM_DEPENDENCY_LABELS`.
 */
export interface DependencyPing {
    ok: boolean;
    durationMs: number;
    /** Which database the connection reached. Absent on the Redis entry. */
    database?: string | null;
    /** Present only on failure. */
    error?: string;
}

/** jovi-mall's entry, which additionally says whether it is wired up at all. */
export interface PlatformPing extends DependencyPing {
    /** `false` is a steady state in a deployment without the platform, not a fault. */
    configured: boolean;
}

/**
 * The audit block on `GET /system/health`.
 *
 * A **dangling intent** is an `attempted` audit row whose outcome never landed —
 * a delegated call that crashed mid-flight, so the action may or may not have
 * happened on the platform side. Resolving one means grepping jovi-mall for the
 * same `correlationId`, which travels as `X-Request-Id` on every delegated call.
 */
export interface AuditHealth {
    danglingIntents: number;
    /**
     * **Render this next to the count.** The query stops counting here, so `100`
     * means "at least a hundred" and must never be read as "exactly a hundred".
     */
    danglingIntentsCappedAt: number;
    oldestDanglingAt: string | null;
    retentionDays: number;
}

export interface SystemHealth {
    dependencies: {
        /** wi-admin's own database. */
        admin: DependencyPing;
        /** The platform database this service reads directly. */
        platform: DependencyPing;
        redis: DependencyPing;
        /** The platform's HTTP surface, which every delegated call goes through. */
        joviMall: PlatformPing;
    };
    audit: AuditHealth;
}

/**
 * Readable names for the connection keys, which **differ between the two reads and invert**.
 *
 * Shared by the overview tile and the Health screen so the inversion is handled once.
 */
export const SYSTEM_DEPENDENCY_LABELS: Record<string, string> = {
    admin: 'wi-admin database',
    mongoAdmin: 'wi-admin database',
    platform: 'Platform database',
    mongoPlatform: 'Platform database',
    redis: 'Redis',
    joviMall: 'jovi-mall API',
};

// ─── GET /system/outbox · wi-admin's own direct read ──────────────────────────

/**
 * `GET /system/outbox` — the tracking-outbox depth, read **directly** from the
 * platform database.
 *
 * This route and `/system/queues` are both kept on purpose. `/queues` is
 * delegated and returns `503` during a platform incident — exactly when an
 * operator wants queue depth. This one reads the collection and still answers,
 * which is why it is the one on the overview.
 *
 * **`failed > 0` means events for geo-tracker were not delivered.** They are
 * replayed with `POST /dev-tools/outbox/replay`.
 */
export interface OutboxSummary {
    depth: {
        pending: number;
        failed: number;
        sent: number;
    };
    oldestPendingAt: string | null;
    maxAttempts: number;
    /** `pending + failed`, computed by the service. Do not recompute it. */
    totalUnsent: number;
}

// ─── GET /system/maintenance ──────────────────────────────────────────────────

/** Who put the platform into a maintenance window. */
export interface MaintenanceActor {
    id: string | null;
    name: string | null;
    source: string;
}

/**
 * The three modes, from [dev-tools.md](../../api-doc/admin/api/dev-tools.md) —
 * `PUT /dev-tools/maintenance` declares the vocabulary that
 * `GET /system/maintenance` reports back.
 *
 * Unusually for this service, `effectiveMode` really is closed: jovi-mall's
 * `effectiveMode()` **fails open**, returning `'off'` for any stored value it
 * does not recognise, so no fourth string can reach the client. That is what
 * makes `effectiveMode === 'off'` a safe test for "there is nothing to say".
 */
export const MAINTENANCE_MODES = ['off', 'readonly', 'down'] as const;

export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

/**
 * `GET /system/maintenance`.
 *
 * **Render `effectiveMode`, never `storedMode`.** They differ exactly when a
 * window has passed its expiry: a read path must never write, so an expired
 * window is still *stored* until something clears it. Showing the stored value
 * would tell an operator the platform is in maintenance when it is not.
 *
 * Both are typed `string` rather than `MaintenanceMode` even though the
 * vocabulary is closed today: widening on the way *in* costs nothing, and a
 * fourth mode added upstream should render as itself rather than fail a parse.
 * `MAINTENANCE_MODES` is what the rendering compares against.
 */
export interface MaintenanceWindow {
    storedMode: string;
    effectiveMode: string;
    reason: string | null;
    blockWebhooks: boolean;
    pauseWorkers: boolean;
    startedAt: string | null;
    expiresAt: string | null;
    setBy: MaintenanceActor | null;
}

// ─── GET /system/config · wi-admin's own ──────────────────────────────────────

/**
 * One entry of wi-admin's whitelisted runtime configuration.
 *
 * ⚠ **`system.md` documents this endpoint wrongly.** Its example shows `data.config` as a flat
 * object keyed by name (`"NODE_ENV": "production"`); the controller sends
 * `{ config: exposedConfig() }` and `exposed-config.ts:101-116` returns **an array of
 * `{ key, value }`**. A client written from the example reads `data.config.NODE_ENV` and gets
 * `undefined` on all thirteen keys. `getExposedConfig()` normalises both shapes.
 *
 * ⚠ **`ADMIN_DASHBOARD_ORIGINS` arrives comma-joined, not as an array.** Strings, numbers and
 * booleans pass through; anything else is `String()`d so the wire shape stays flat.
 *
 * Note this is **not** the same shape as the platform's twin — see {@link PlatformConfigReport},
 * which carries a third field, `set`.
 */
export interface ExposedConfigEntry {
    key: string;
    value: string | number | boolean | null;
}

/** `GET /system/platform/config` — the platform's, and shaped differently from wi-admin's own. */
export interface PlatformConfigReport {
    service: string;
    entries: Array<{ key: string; value: string | number | boolean | null; set: boolean }>;
    /**
     * The derived answer to "is this pointed at anything", filled in because every `*_URL` and
     * `*_URI` is deliberately withheld — they carry passwords in userinfo in any real
     * deployment. Every field here is a predicate that cannot carry a credential by
     * construction, plus the Stripe key *mode*.
     */
    wiring: Record<string, unknown>;
    note: string;
}

/**
 * **`set: false` is not the same as `value: null`.** Almost every key has a compiled-in default
 * applied by its own config module, so a bare null would read as "this sweep has no schedule"
 * when it means "the default applies". `/config` says what is *configured*; `/system/workers`
 * says what is *in force*.
 */
export const CONFIG_SET_NOTE =
    'A key that is not set still has a compiled-in default. This screen says what has been ' +
    'configured; Workers says what is in force.';

// ─── GET /system/workers · delegated ──────────────────────────────────────────

/**
 * One of the **thirteen** background workers — twelve triggerable, plus `inbound-calendar-sync`,
 * which is observable but not runnable because its work splits across two horizons and "run it
 * once" has no single honest meaning.
 *
 * ── The three booleans are three different questions ──────────────────────────
 * They exist separately because **three different things in the platform were all called
 * `running`**, and the old endpoint reported the least useful of them — a scheduled sweep
 * churning for ten minutes showed `running: false`. Never collapse them into one column.
 *
 * ⚠ **All three are PROCESS-LOCAL** (`scopeNote` says so on the wire): with several instances
 * behind a load balancer this describes the one that answered.
 *
 * ⚠ **`executing` is an observation, not a guard.** It answers "is a pass in flight *here*",
 * never "would a pass be allowed". Overlap is prevented separately by a shared lock, so a worker
 * can show `executing: false` and still be refusing passes because another instance holds its
 * lock — which surfaces as `ran: false` on a trigger, not as an error.
 *
 * Partial: `system.gateway.ts` types the element `Record<string, unknown>`. Field names are from
 * `api-doc/jovi-mall/admin/system.md`.
 */
export interface WorkerReport {
    key: string;
    label: string;
    /** A cron task or timer object exists — `start()` ran and `stop()` did not. */
    scheduled: boolean;
    /** A pass is in flight right now, whoever started it. */
    executing: boolean;
    /** A `POST /dev-tools/workers/:key/run` currently holds the claim. */
    manualClaim: boolean;
    /** Derived from the value the worker actually schedules with, never hand-typed. */
    schedules?: unknown;
    scheduleLabel?: string | null;
    /** The config master switch, reported separately — an unset URL reads identically otherwise. */
    enabled?: boolean;
    triggerable?: boolean;
    notTriggerableReason?: string | null;
    /** Without it, an operator in a `down` window sees a healthy-looking idle worker forever. */
    pausedByMaintenance?: boolean;
}

export interface WorkersReport {
    workers: WorkerReport[];
    scopeNote: string;
}

// ─── GET /system/dependencies · delegated ─────────────────────────────────────

/**
 * One logical Redis database as the platform's process sees it.
 *
 * **`idle` is not `down`.** Redis connects lazily there and never at boot, so a database this
 * process has not needed reports `idle` — and the endpoint deliberately does not open the
 * connection it is reporting on. *A probe observes; it does not provision.*
 *
 * `constant` is the upper-case NAME the cache tools address a database by, which makes this the
 * live catalogue the flush and inspect selects are populated from.
 */
export interface RedisDbEntry {
    db: number;
    constant: string;
    label: string;
    status: string;
    everOpened: boolean;
    latencyMs: number | null;
    connectionErrors: number;
    error: string | null;
}

/**
 * `GET /system/dependencies` — the platform's Mongo and Redis, as **its** process sees them.
 *
 * ⚠ **`mongo.server.available: false` is normal on managed Mongo**: `serverStatus` needs the
 * `clusterMonitor` role, which shared tiers do not grant. The endpoint still answers `200` with
 * a `reason` rather than inventing pool numbers.
 *
 * Partial — `mongo` and `maintenance` are `Record<string, unknown>` at wi-admin's seam.
 */
export interface DependenciesReport {
    mongo: {
        status?: string;
        readyState?: string;
        database?: string | null;
        host?: string | null;
        latencyMs?: number | null;
        error?: string | null;
        server?: {
            available?: boolean;
            reason?: string | null;
            replicaSet?: string | null;
            connections?: { current?: number; available?: number; totalCreated?: number };
            maxPoolSize?: number;
        };
    } & Record<string, unknown>;
    redis: {
        entries?: RedisDbEntry[];
        note?: string;
    } & Record<string, unknown>;
    maintenance: Record<string, unknown>;
}

// ─── GET /system/integrations · delegated, and the one read with an opt-in cost ─

/**
 * How an integration's reachability was determined. **The mode travels with every verdict**,
 * because "WhatsApp: unknown" reads as "WhatsApp is broken" when it means "we chose not to ask".
 *
 * - `probed` — checked this request against a real health path; cheap and side-effect free.
 * - `on_demand` — safe but not free; only checked when named in `?probe=`.
 * - `passive` — never checked. Reports what **real traffic** last learned, at zero cost.
 * - `never` — no safe probe exists. Configuration only, and the note says why.
 */
export const REACHABILITY_MODES = ['probed', 'on_demand', 'passive', 'never'] as const;

export type ReachabilityMode = (typeof REACHABILITY_MODES)[number];

/**
 * ⚠ **`configured` and reachability are two columns and must never be conflated.**
 *
 * ⚠ **NotchPay and MyCoolPay report `configured: false` even with an API key set, deliberately.**
 * Both gateways are placeholders whose HTTP call is commented out: unkeyed they return a mock
 * success and hand the customer a fake USSD code while no money moves; keyed, every call throws.
 * `configured` has to mean "this payment path works". A red row there is correct, not a
 * misconfiguration to chase.
 *
 * Partial — the element is `Record<string, unknown>` at wi-admin's seam.
 */
export interface Integration extends Record<string, unknown> {
    key?: string;
    label?: string;
    configured?: boolean;
    impact?: string | null;
    reachability?: {
        mode?: string;
        status?: string | null;
        checkedAt?: string | null;
        note?: string | null;
        error?: string | null;
    } & Record<string, unknown>;
}

/** `googleCalendar` and `rule` are real and documented nowhere. */
export interface IntegrationsReport {
    integrations: Integration[];
    googleCalendar: { connectedVendors: number; failingRefresh: number };
    /** The platform's own statement of the no-side-effects rule. Worth rendering verbatim. */
    rule: string;
}

/** The two probes that exist. Opt-in per request; never sent on page load. */
export const ON_DEMAND_PROBES = ['smtp', 'telegram'] as const;

// ─── GET /system/cache · delegated ────────────────────────────────────────────

/**
 * `GET /system/cache` — Redis key counts per logical database, **plus instance-wide memory**.
 *
 * ⚠ **The response is two-scoped deliberately, and the scope is on the wire.** Redis does not
 * track hits and misses per logical database — `keyspace_hits`, `keyspace_misses`,
 * `used_memory`, `maxmemory` and `evicted_keys` are instance-wide. The obvious shape, one row
 * per database with a hit rate on it, would be a lie in eight places and would send an operator
 * hunting a caching bug that does not exist.
 *
 * ⚠ **`hitRate` is `null` rather than `1` on an instance with zero lookups** — a ratio over zero
 * is not a number, and rendering 100% would be actively misleading.
 *
 * With no client open this returns `available: false` with a reason rather than connecting.
 */
export interface CacheReport {
    available: boolean;
    reason: string | null;
    instance: (Record<string, unknown> & { hitRate?: number | null }) | null;
    databases: Array<Record<string, unknown> & { db?: number; constant?: string; keys?: number }>;
    note: string;
}

// ─── GET /system/queues · delegated ───────────────────────────────────────────

/**
 * `GET /system/queues` — the tracking outbox **and** the assignment backlog.
 *
 * Sits **beside** `GET /system/outbox`, not in front of it: that one reads the collection
 * directly and still answers during a platform incident, which is exactly when an operator wants
 * queue depth. Render both, from two independent requests.
 *
 * Two counters worth knowing apart, and one number that matters more than it looks:
 * - **`stuckPending`** — pending *and* already out of attempts. **Should always be `0`**;
 *   non-zero means the dispatcher's parking logic did not run, which is a different fault from
 *   a backlog.
 * - **`exhausted`** — failed and out of attempts. These are what `POST /dev-tools/outbox/replay`
 *   is for.
 * - **`assignment.dueSessions`** — a sustained non-zero means the assignment sweep is dead,
 *   wedged, or slower than its own interval, and nothing else reports that. If it stops, nothing
 *   throws and nothing logs; shipments simply sit on offer forever.
 *
 * `dispatcherEnabled: false` means the platform has no geo-tracker URL set — the intended local
 * default, not a fault.
 *
 * Partial — both blocks are `Record<string, unknown>` at wi-admin's seam.
 */
export interface QueuesReport {
    trackingOutbox: Record<string, unknown> & {
        byStatus?: Record<string, number>;
        oldestPendingAt?: string | null;
        byType?: Record<string, number>;
        stuckPending?: number;
        exhausted?: number;
        dispatcherEnabled?: boolean;
    };
    assignment: Record<string, unknown> & { dueSessions?: number };
    note: string;
}

// ─── GET /system/metrics · delegated ──────────────────────────────────────────

/**
 * `GET /system/metrics` — the JSON projection of the platform's private Prometheus registry.
 *
 * Guarded by **`system.metrics.read`, its own permission rather than `system.health.read`**:
 * this carries per-route request volumes (order rate, payment rate), which is business
 * information rather than health.
 *
 * Labels are bounded by a closed allowlist: `route_group` never `route`, `status_class` never
 * `status`, and never a user, role, vendor or order id.
 *
 * ⚠ Two coverage caveats that are real misreading traps, both worth putting on screen:
 * **only four of thirteen workers are instrumented on their scheduled path**, so a missing
 * `worker_last_success_timestamp_seconds` is not evidence a worker failed; and
 * `mongo_operation_errors_total` counts **connection-level errors only**.
 */
export interface MetricSample {
    labels: Record<string, string | number>;
    value: number;
}

export interface MetricFamily {
    name: string;
    help: string;
    type: string;
    values: MetricSample[];
}

export interface MetricsReport {
    collectedAt: string;
    registrySize: number;
    metrics: MetricFamily[];
}

// ─── GET /system/geo-tracker · direct probe ───────────────────────────────────

/**
 * `GET /system/geo-tracker` — the narrow, service-level exception to *wi-admin has no
 * geo-tracker door*.
 *
 * ⚠ **This route can never fail.** The client cannot throw — making geo-tracker a readiness
 * dependency of wi-admin would recreate a coupled-failure amplifier. `configured: false` and an
 * unhealthy report are the two ways it says "no", so this needs no retry affordance and a
 * `configured: false` must not render as a fault.
 *
 * Service-level only: no position, no trail, no session content. Per-agent reads need a platform
 * user identity, which an administrator deliberately does not have.
 */
export interface GeoTrackerReport {
    service: string;
    configured: boolean;
    health: Record<string, unknown> | null;
    readiness: Record<string, unknown> | null;
    note: string;
}

// ─── GET /system/platform/logs · delegated, tier 1 only ───────────────────────

/**
 * `GET /system/platform/logs` — **the platform's** logs, not wi-admin's own.
 *
 * wi-admin has pino and no sinks; `/system/logs` is reserved for its own and is unbuilt. Do not
 * label this screen "logs" without qualification.
 *
 * Gated on `developer_tools.logs.read`, tier 1 only, and the reason is not squeamishness: a log
 * line is free text and can carry personal data — an email in an SMTP failure, a phone number in
 * a WhatsApp send error. A `system.*` name would reach tier 2 through family expansion, and an
 * unfiltered feed of every warning is a broader disclosure than any individual scoped read.
 * Not audited: a log search is diagnostics and high-volume, and auditing it would flood the trail
 * with rows saying nothing about what anybody *did*.
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ['ring', 'persisted'] as const;

export type LogSource = (typeof LOG_SOURCES)[number];

/** `q` is bounded as a **pattern-length defence**, not as a UI nicety. */
export const LOG_QUERY_MAX = 100;
export const LOG_LIMIT_MAX = 500;

export interface PlatformLogsQuery {
    /** **At-or-above**, never equal-to. Label it so. */
    level?: string;
    since?: string;
    until?: string;
    /** The cross-service join — an audit row's `correlationId` is this value. */
    requestId?: string;
    q?: string;
    source?: string;
    limit?: number;
    /** **A cursor, not an offset** — the capped collection evicts from the front. */
    before?: string;
}

/**
 * ⚠ **`sourceUsed` may not be what was asked for.** The platform defaults to `persisted` and
 * falls back to `ring`, saying so in `sourceReason`. A reader who does not see that is reading a
 * different store than they requested.
 *
 * **Page off `nextBefore` alone.** `meta.warning` states that log lines can contain personal
 * data and `meta.ring.scopeNote` that the buffer is process-local; both are standing copy rather
 * than tooltips.
 */
export interface PlatformLogsPage {
    sourceUsed: string;
    sourceReason: string | null;
    entries: Array<Record<string, unknown>>;
    nextBefore: string | null;
    meta: {
        persistence?: Record<string, unknown>;
        ring?: Record<string, unknown> & { scopeNote?: string };
        warning?: string;
    };
}

// ─── GET /system/errors · the one `any`-mode guard ────────────────────────────

/**
 * The nine error categories. `category` is the right key for generic handling and is always
 * present; branch on `code` for anything specific.
 */
export const ERROR_CATEGORIES = [
    'authentication',
    'authorization',
    'validation',
    'not_found',
    'conflict',
    'business_rule',
    'rate_limit',
    'external_service',
    'internal',
] as const;

/**
 * The support rung — **what the caller already saw**, plus a reference and a category.
 *
 * `message` is the **client** message, the sentence this person was actually shown; it is never
 * the log line and never the internal diagnosis. That distinction is load-bearing: log lines are
 * free text that may hold an email or a phone number, and Support talks to the public, so they
 * must never be handed text this platform did not compose. Label it as the customer-facing
 * message. `hint` is the per-category support line.
 *
 * ⚠ `method` and `routeGroup` are **omitted** when absent, not `null`.
 */
export interface SupportErrorEntry {
    at: string;
    requestId: string | null;
    category: string;
    code: string;
    statusCode: number;
    method?: string;
    routeGroup?: string;
    actorRole: string | null;
    message: string;
    hint: string;
}

/**
 * The admin rung — the operational diagnosis, without the shape of the codebase.
 *
 * `internalMessage` arrives **for every category, including the masked ones**, and that is the
 * point: *what did the payment gateway actually say* is precisely the question a masked `502`
 * leaves unanswered. `details` is the **unmasked** payload.
 *
 * ⚠ `path`, `errorType` and `internalMessage` are **omitted** when absent; `details` is `null`.
 */
export interface AdminErrorEntry extends SupportErrorEntry {
    path?: string;
    actorId: string | null;
    errorType?: string;
    /** Whether the client message was substituted. */
    masked: boolean;
    internalMessage?: string;
    details?: Record<string, unknown> | null;
}

/**
 * The developer rung — everything, verbatim.
 *
 * A stack names our files, our functions and our call graph: the shape of the codebase rather
 * than the state of the platform, and the one thing a Developer needs that an Admin does not.
 */
export interface DeveloperErrorEntry extends AdminErrorEntry {
    stack?: string | null;
    causeMessage?: string | null;
    /** The raw stored line, for anything the typed views do not name. */
    raw: Record<string, unknown>;
}

export type SystemErrorEntry = SupportErrorEntry | AdminErrorEntry | DeveloperErrorEntry;

/**
 * `GET /system/errors` — **one route, three answers.**
 *
 * The only `any`-mode guard on the service: reachable by any of `developer_tools.logs.read`
 * (T1), `system.errors.read` (T2) or `support.errors.lookup` (T3), with the projection decided
 * server-side. Splitting it into three URLs would make a dashboard choose based on the
 * administrator's own level, which is exactly what a server should be deciding.
 *
 * ── Narrow on `view`, never on the caller's tier ──────────────────────────────
 * `view` names which rung answered, and it is not decoration: without it a Support agent reading
 * a thin row cannot tell *"there is nothing more to know"* from *"I am not being shown it"*, and
 * would escalate a resolved incident. **Render it.** And branch the union on it rather than on
 * `usePermissions().tier` — a grant that changed mid-session would otherwise have the client
 * reading fields the response does not carry.
 *
 * ⚠ **`sourceUsed`, `sourceReason`, `nextBefore` and `meta` are undocumented.** `system.md`
 * shows only `view` and `entries`, and names the `before` *parameter* without ever naming the
 * response field that feeds it.
 *
 * ⚠ **A short page does not mean the end of the feed.** The tier-3 row filter runs in wi-admin
 * *after* the platform returned the page, so a support-level caller can get three rows with
 * `limit=100` and a non-null `nextBefore`. **Page off `nextBefore` alone**, never off
 * `entries.length`. Support additionally sees only rows whose actor was a vendor, agency, agent
 * or customer, or anonymous traffic — administrator-caused errors are invisible to them.
 */
export type SystemErrorsPage = {
    sourceUsed: string;
    sourceReason: string | null;
    nextBefore: string | null;
    meta: {
        persistence?: Record<string, unknown>;
        ring?: Record<string, unknown> & { scopeNote?: string };
        warning?: string;
    };
} & (
    | { view: 'support'; entries: SupportErrorEntry[] }
    | { view: 'admin'; entries: AdminErrorEntry[] }
    | { view: 'developer'; entries: DeveloperErrorEntry[] }
    | { view: string; entries: SupportErrorEntry[] }
);

export interface SystemErrorsQuery {
    since?: string;
    until?: string;
    requestId?: string;
    category?: string;
    code?: string;
    source?: string;
    limit?: number;
    before?: string;
}

/**
 * `400`, **not `403`** — the caller *holds* the permission and the request is simply too broad.
 * The remedy is a narrower query, not a different grant, so this belongs on the form as a
 * validation message and must never render as a refusal.
 */
export const ERROR_QUERY_TOO_BROAD_CODE = 'SYSTEM_ERROR_QUERY_TOO_BROAD';

// ─── GET /system/platform/cache/keys · delegated, tier 1 only ─────────────────

/**
 * Key **names**, types and TTLs in one named logical database. **Values are never returned, and
 * there is deliberately no single-key read** — it would be a disclosure oracle for download
 * tokens, WhatsApp idempotency keys and verification codes, which are exactly the three
 * databases the flush policy calls destructive.
 *
 * Guarded by `developer_tools.cache.inspect`, **not** `cache.flush`: *looking is not clearing*,
 * and one permission for both would mean an operator who may inspect may also delete.
 *
 * ⚠ **Takes no `confirm`, deliberately.** Requiring a database name to be typed in order to
 * *look* trains reflexive confirmation-typing, which would hollow out the guard on the path that
 * deletes. The ceremony stays attached to deletion or it stops meaning anything.
 *
 * `available: false` with a reason is a `200` — Redis connects lazily on the platform and an
 * idle database is not a down one.
 */
export interface CacheKeyEntry {
    key: string;
    type: string | null;
    ttlMs: number | null;
    sizeBytes: number | null;
}

export interface PlatformCacheKeysReport {
    available: boolean;
    reason: string | null;
    constant: string;
    matched: number;
    truncated: boolean;
    /** The platform's verdict, not a client table. Drives whether a prefix is mandatory. */
    destructive: boolean;
    blastRadius: string;
    keys: CacheKeyEntry[];
    note: string;
}

export interface CacheKeysQuery {
    /** **The database NAME, upper-case** — never its index. An index is a `400`. */
    db: string;
    prefix?: string;
    limit?: number;
    /** `MEMORY USAGE` is O(size), so it is off by default. String literals, not booleans. */
    withSize?: 'true' | 'false';
}

// ─── GET /system/platform/database · delegated, tier 1 only ───────────────────

/**
 * Collection stats and **index drift** — the read that earns this endpoint.
 *
 * `autoIndex` is on in the platform and **a failed index build fails silently at boot**. A
 * missing unique index does not throw; it lets a duplicate through, months later, in a
 * collection nobody watches.
 *
 * Three buckets, and they are not equally interesting:
 * - **`missing`** — declared, not built. **The actionable one.**
 * - `extra` — built, declared nowhere; usually migration residue.
 * - `mismatched` — same key, different options. The nastiest: a "unique" index that is not
 *   unique in production.
 *
 * ⚠ **Nothing here writes, and there is deliberately no repair.** A unique index build fails
 * outright on a collection that already holds duplicates, and a large build on a primary is an
 * availability event. Reporting is the useful 90%.
 *
 * ⚠ **Render `truncated` and `notReached` prominently** — silent truncation reads as
 * completeness. Two further caveats travel on the wire: drift reflects only the models that
 * process registered, and an index build in progress reads as `missing`.
 */
export interface PlatformDatabaseReport {
    database: string | null;
    collections: Array<
        Record<string, unknown> & {
            name?: string;
            indexes?: {
                missing?: unknown[];
                extra?: unknown[];
                mismatched?: unknown[];
            };
        }
    >;
    summary: Record<string, number>;
    truncated: boolean;
    notReached: string[];
    notes: string[];
}

export interface DatabaseInspectQuery {
    /** Lower-case snake_case names. Repeat the parameter or send an array. */
    collection?: string | string[];
}
