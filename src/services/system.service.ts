/**
 * `/system` — all seventeen operations reads.
 *
 * **Every route in this group is a `GET` and none is audited.** Every write lives next door in
 * `dev-tools.service.ts`; that separation is a mount on the service's side, not a convention, and
 * it is worth preserving here — a mutation added to this file would look like it belonged.
 *
 * ── The split that matters: who computes the answer ───────────────────────────
 * `/system/health`, `/system/outbox` and `/system/config` are **wi-admin's own** — it pings its
 * own connections, reads the platform collection directly, and returns local configuration. They
 * keep answering during a jovi-mall incident. Twelve routes are **delegated** and return
 * `502`/`503 SERVICE_DEPENDENCY_UNAVAILABLE` when the platform is unreachable. Two are **direct
 * probes** of geo-tracker and cannot fail at all.
 *
 * That is why a screen composing several of these issues **independent requests** rather than one
 * `Promise.all`: the entire point of keeping `/system/outbox` beside `/system/queues` is that the
 * local read still answers when the delegated one has stopped.
 *
 * ── Where these shapes came from ──────────────────────────────────────────────
 * `api-doc/admin/api/system.md` publishes a response shape for six of the seventeen. The rest were
 * read from `backend/admin/src/modules/system/gateways/system.gateway.ts` and cross-checked
 * against `api-doc/jovi-mall/admin/system.md`. See the header of `types/system.types.ts`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    CacheReport,
    DatabaseInspectQuery,
    DependenciesReport,
    ExposedConfigEntry,
    GeoTrackerReport,
    IntegrationsReport,
    MaintenanceWindow,
    MetricsReport,
    OutboxSummary,
    PlatformCacheKeysReport,
    PlatformConfigReport,
    PlatformDatabaseReport,
    PlatformLogsPage,
    PlatformLogsQuery,
    QueuesReport,
    SystemErrorsPage,
    SystemErrorsQuery,
    SystemHealth,
    WorkersReport,
    CacheKeysQuery,
} from '@/types/system.types';

// ─── wi-admin's own reads ─────────────────────────────────────────────────────

/**
 * `GET /system/health` · `system.health.read`.
 *
 * wi-admin's own health: four dependency pings plus the dangling-intent count.
 * **Each dependency reports `ok: boolean`**, not the `'up' | 'down' |
 * 'not_configured'` that the unauthenticated `/health/ready` probe uses for the
 * same four names — see `fetchReadiness` in `services/api.ts`. The two also use
 * *inverted* key names for the two Mongo entries, so label by meaning.
 */
export function getSystemHealth(options?: RequestOptions): Promise<SystemHealth> {
    return api.get<SystemHealth>('/system/health', options);
}

/**
 * `GET /system/outbox` · `system.outbox.read`.
 *
 * The tracking-outbox depth, read **directly** from the platform database rather
 * than asked for over HTTP. That redundancy with `/system/queues` is deliberate:
 * the delegated one returns `503` during a platform incident, which is exactly
 * when somebody wants queue depth.
 */
export function getOutboxSummary(options?: RequestOptions): Promise<OutboxSummary> {
    return api.get<OutboxSummary>('/system/outbox', options);
}

/** Warn once per session rather than per render — the same shape arrives on every refresh. */
let warnedAboutConfigShape = false;

/**
 * `GET /system/config` · **`developer_tools.config.read`** — Developer only, despite living under
 * `/system`. Runtime configuration says how the service is wired, which is tier-1 information;
 * the route group and the permission family do not have to agree, and here they do not.
 *
 * ── Why this one is not a plain passthrough ───────────────────────────────────
 * **The documented shape is wrong.** `system.md` shows `data.config` as a flat object keyed by
 * name; the service sends `{ config: exposedConfig() }` and that returns an **array of
 * `{ key, value }`**. A client written from the example reads `data.config.NODE_ENV` and gets
 * `undefined` on all thirteen keys.
 *
 * So this normalises both shapes to the array and warns once in development when it meets the
 * documented one. Four lines, and it means the screen survives the backend being corrected
 * upstream in either direction. Same move `lib/password-policy.ts` makes for the same class of
 * drift.
 */
export async function getExposedConfig(options?: RequestOptions): Promise<ExposedConfigEntry[]> {
    const body = await api.get<{ config?: unknown }>('/system/config', options);
    const config = body?.config;

    if (Array.isArray(config)) return config as ExposedConfigEntry[];

    if (config && typeof config === 'object') {
        if (import.meta.env.DEV && !warnedAboutConfigShape) {
            warnedAboutConfigShape = true;
            console.warn(
                '[system] GET /system/config answered the documented object shape rather than ' +
                    'the array the service is known to send. Normalising.',
            );
        }
        return Object.entries(config as Record<string, ExposedConfigEntry['value']>).map(
            ([key, value]) => ({ key, value }),
        );
    }

    return [];
}

/** Test seam — drop the once-per-session warning between cases. */
export function __resetConfigShapeWarning(): void {
    warnedAboutConfigShape = false;
}

// ─── Delegated reads ──────────────────────────────────────────────────────────

/**
 * `GET /system/workers` · `system.workers.read` · **delegated**.
 *
 * All thirteen workers with **three distinct state booleans** rather than one. It supersedes
 * `GET /dev-tools/workers`, which returns a narrower legacy shape whose single `running` flag
 * conflates three conditions — that route is deliberately not called anywhere in this client.
 */
export function getWorkers(options?: RequestOptions): Promise<WorkersReport> {
    return api.get<WorkersReport>('/system/workers', options);
}

/**
 * `GET /system/dependencies` · `system.health.read` · **delegated**.
 *
 * The platform's Mongo and Redis as **its** process sees them. Also the live catalogue of Redis
 * database names — `redis.entries[].constant` is what the cache inspector and flush address a
 * database by, and is why neither hard-codes that list.
 */
export function getDependencies(options?: RequestOptions): Promise<DependenciesReport> {
    return api.get<DependenciesReport>('/system/dependencies', options);
}

/**
 * `GET /system/integrations` · `system.health.read` · **delegated**.
 *
 * ⚠ **The one read on this service that can cost something**, and only when asked. `probe` names
 * the on-demand checks to run *this request*: an SMTP `verify()` is a TCP+TLS handshake some
 * providers rate-limit, and Telegram's `getMe` authenticates the bot. Passing nothing is the
 * ordinary case and touches no third party at all — so a screen must never send a probe on page
 * load.
 *
 * Everything else reports either a free health path or what real traffic last learned.
 */
export function getIntegrations(
    probe: readonly string[] = [],
    options?: RequestOptions,
): Promise<IntegrationsReport> {
    return api.get<IntegrationsReport>(
        withQuery('/system/integrations', {
            probe: probe.length > 0 ? probe.join(',') : undefined,
        }),
        options,
    );
}

/**
 * `GET /system/cache` · `system.health.read` · **delegated**.
 *
 * Per-database key counts plus **instance-wide** memory, two-scoped on purpose because Redis does
 * not report hits and misses per logical database.
 */
export function getCacheReport(options?: RequestOptions): Promise<CacheReport> {
    return api.get<CacheReport>('/system/cache', options);
}

/**
 * `GET /system/queues` · `system.outbox.read` · **delegated**.
 *
 * The tracking outbox **and** the assignment backlog. Sits beside `/system/outbox` rather than in
 * front of it — fetch both, independently, and expect this one to be the half that fails during a
 * platform incident.
 */
export function getQueues(options?: RequestOptions): Promise<QueuesReport> {
    return api.get<QueuesReport>('/system/queues', options);
}

/**
 * `GET /system/metrics` · **`system.metrics.read`** · **delegated**.
 *
 * Its own permission rather than `system.health.read`, because this carries per-route request
 * volumes — business information rather than health. Somebody who should see whether Redis is up
 * does not automatically need to see how many orders an hour the platform takes.
 */
export function getMetrics(options?: RequestOptions): Promise<MetricsReport> {
    return api.get<MetricsReport>('/system/metrics', options);
}

/**
 * `GET /system/maintenance` · `system.maintenance.read` · **delegated**.
 *
 * Reports `storedMode` and `effectiveMode` separately, and **`effectiveMode` is
 * the one to render**. They differ exactly when a window has passed its expiry:
 * a read path must never write, so the expired window stays *stored* until
 * something clears it.
 *
 * Refetch this after `setMaintenance()` — the write's result carries no `setBy`.
 */
export function getMaintenanceWindow(options?: RequestOptions): Promise<MaintenanceWindow> {
    return api.get<MaintenanceWindow>('/system/maintenance', options);
}

/**
 * `GET /system/errors` · **any of** `developer_tools.logs.read`, `system.errors.read`,
 * `support.errors.lookup` · **delegated**.
 *
 * The only `any`-mode guard on the service, and the only endpoint that answers a **different
 * projection per level**. Branch on `data.view`, never on the caller's tier.
 *
 * ⚠ **Page off `nextBefore` alone.** `before` is a cursor rather than an offset, and the tier-3
 * row filter runs *after* the platform returned the page — so a short page with a non-null
 * `nextBefore` is normal and stopping on `entries.length < limit` silently hides rows.
 *
 * ⚠ A caller holding only `support.errors.lookup` must supply a `requestId`, or a `code` **and** a
 * `since`, or the service answers **`400 SYSTEM_ERROR_QUERY_TOO_BROAD` — a validation failure,
 * not a refusal.** The screen requires it before firing; this function does not, because deciding
 * that needs the held set and a service has no business reading one.
 */
export function listSystemErrors(
    query: SystemErrorsQuery = {},
    options?: RequestOptions,
): Promise<SystemErrorsPage> {
    return api.get<SystemErrorsPage>(withQuery('/system/errors', { ...query }), options);
}

/**
 * `GET /system/platform/config` · `developer_tools.config.read` · **delegated**.
 *
 * The platform's whitelisted configuration, and **shaped differently from wi-admin's own**: this
 * one carries `service`, a `set` flag per entry, and a derived `wiring` block. `set: false` means
 * a compiled-in default applies, not that there is no value.
 */
export function getPlatformConfig(options?: RequestOptions): Promise<PlatformConfigReport> {
    return api.get<PlatformConfigReport>('/system/platform/config', options);
}

/**
 * `GET /system/platform/logs` · `developer_tools.logs.read` · **delegated**, tier 1 only.
 *
 * **The platform's** logs — wi-admin's own are unbuilt and `/system/logs` is reserved for them.
 *
 * `level` is **at-or-above**, never equal-to. `q` is bounded at 100 characters as a pattern-length
 * defence: the term is escaped and applied literally, and an unbounded one would be a scan
 * amplifier against a collection with no text index. Page off `nextBefore`.
 */
export function listPlatformLogs(
    query: PlatformLogsQuery = {},
    options?: RequestOptions,
): Promise<PlatformLogsPage> {
    return api.get<PlatformLogsPage>(withQuery('/system/platform/logs', { ...query }), options);
}

/**
 * `GET /system/platform/cache/keys` · **`developer_tools.cache.inspect`** · **delegated**.
 *
 * Not `cache.flush`: **looking is not clearing**, and one permission for both would mean an
 * operator who may inspect may also delete. Returns key **names**, types and TTLs — never values,
 * and there is deliberately no single-key read.
 *
 * `db` is the database **NAME**, upper-case (e.g. `SLOT_LOCK_DB`), never its index. Takes **no
 * `confirm`** by design.
 */
export function listCacheKeys(
    query: CacheKeysQuery,
    options?: RequestOptions,
): Promise<PlatformCacheKeysReport> {
    return api.get<PlatformCacheKeysReport>(
        withQuery('/system/platform/cache/keys', { ...query }),
        options,
    );
}

/**
 * `GET /system/platform/database` · `developer_tools.database.inspect` · **delegated**.
 *
 * Collection stats and index drift. `collection` may be repeated or sent as an array — `buildQuery`
 * repeats array keys and the service joins them into a comma-separated list either way.
 *
 * Nothing here writes: there is no index repair, deliberately.
 */
export function inspectDatabase(
    query: DatabaseInspectQuery = {},
    options?: RequestOptions,
): Promise<PlatformDatabaseReport> {
    return api.get<PlatformDatabaseReport>(
        withQuery('/system/platform/database', { ...query }),
        options,
    );
}

// ─── Direct probes of geo-tracker ─────────────────────────────────────────────

/**
 * `GET /system/geo-tracker` · `system.health.read` · **direct probe**.
 *
 * ⚠ **This route can never fail.** wi-admin's geo-tracker client cannot throw — making
 * geo-tracker a readiness dependency would recreate a coupled-failure amplifier — so
 * `configured: false` and an unhealthy report are the two ways it says "no". A screen should give
 * it no retry affordance and must not render `configured: false` as a fault.
 *
 * Service-level only: no position, no trail, no session content.
 */
export function getGeoTrackerHealth(options?: RequestOptions): Promise<GeoTrackerReport> {
    return api.get<GeoTrackerReport>('/system/geo-tracker', options);
}

/**
 * `GET /system/geo-tracker/metrics` · **`system.metrics.read`** · **direct probe**.
 *
 * Session and websocket counts are the same business/reconnaissance class that gave the
 * platform's metrics their own permission. Parsed from Prometheus text against a closed
 * allowlist on the service's side, so a new geo-tracker instrument is invisible here until that
 * allowlist learns about it.
 */
export function getGeoTrackerMetrics(options?: RequestOptions): Promise<Record<string, unknown>> {
    return api.get<Record<string, unknown>>('/system/geo-tracker/metrics', options);
}
