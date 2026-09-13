/**
 * `/dev-tools` — the operations writes.
 *
 * Feature flags, worker triggers, outbox replay and prune, catalogue vectorise, maintenance mode
 * and cache flush. **Almost everything here is Developer (tier 1) only, and every write is
 * audited.**
 *
 * ── Every write goes through `api.mutate`, and that is not a style choice ─────
 * All seven return a `message` the contract says in as many words to show: the feature-flag
 * message states the fleet has **not** converged, the maintenance message names the convergence
 * window, and the prune and flush messages **lead with the dry-run state** because an operator
 * who cannot tell at a glance whether anything was deleted will assume the worse and act on it.
 * `api.post`/`api.put` return `data` alone and would throw all of that away.
 *
 * ── Two gates, and this file only knows about one ─────────────────────────────
 * The permission is enforced server-side and mirrored by the nav. The **`dev_tools.enabled`
 * feature flag** — off by default — is enforced in wi-admin's gateway and refuses five of these
 * seven with `409 DEV_TOOLS_DISABLED`, **not `403`**. That is a *service state*, not a permission
 * problem, and the screens render it as one. `getFeatureFlags` is deliberately not behind the
 * gate, which is what lets the dashboard always know the flag's state.
 *
 * Design records: [ADR-014](../../api-doc/docs/ADR-014-SYSTEM-OPERATIONS.md),
 * [ADR-015](../../api-doc/docs/ADR-015-DEVELOPER-TOOLS.md).
 */

import { api, type RequestOptions } from '@/services/api';
import type {
    FeatureFlag,
    FeatureFlagName,
    FlushCacheBody,
    FlushCacheResult,
    PruneOutboxBody,
    PruneOutboxResult,
    ReplayOutboxBody,
    ReplayOutboxResult,
    SetFeatureFlagBody,
    SetMaintenanceBody,
    SetMaintenanceResult,
    VectoriseResult,
    WorkerRunResult,
} from '@/types/dev-tools.types';

/** What every write here answers with: the platform's result plus the sentence to show. */
export interface ToolOutcome<T> {
    data: T;
    message: string | undefined;
}

// ─── Feature flags ────────────────────────────────────────────────────────────

/**
 * `GET /dev-tools/feature-flags` · `developer_tools.feature_flags.read`.
 *
 * **Not behind `dev_tools.enabled`** — this is how you turn it on, and a switch that turns off
 * its own switch is a trap. The catalog is small and closed, so there is no pagination.
 *
 * Returns **ten fields per flag**, not the five `dev-tools.md` shows without an ellipsis. The
 * five undocumented ones are exactly what a flags table wants: `isDefault` plus the four
 * provenance fields, which are `null` while the flag is tracking its catalog default.
 */
export async function getFeatureFlags(options?: RequestOptions): Promise<FeatureFlag[]> {
    const body = await api.get<{ flags?: FeatureFlag[] }>('/dev-tools/feature-flags', options);
    return body?.flags ?? [];
}

/**
 * `PUT /dev-tools/feature-flags/:flag` · `developer_tools.feature_flags.set` · **destructive**.
 *
 * `reason` is required, 10–500 characters, and is the only place the context for a flipped flag
 * can live.
 *
 * ⚠ **Show the message.** The change is **not instant across the fleet**: the flag cache is
 * in-process and this write clears only the answering instance's, so the server's own sentence
 * says other instances converge within the cache TTL. An administrator turning something off
 * during an incident has to know that.
 */
export async function setFeatureFlag(
    flag: FeatureFlagName,
    body: SetFeatureFlagBody,
    options?: RequestOptions,
): Promise<ToolOutcome<FeatureFlag>> {
    const { data, message } = await api.mutate<FeatureFlag>(
        'PUT',
        `/dev-tools/feature-flags/${encodeURIComponent(flag)}`,
        body,
        options,
    );
    return { data, message };
}

// ─── Worker triggers ──────────────────────────────────────────────────────────

/** `runWorker`'s answer, with the `ran` rule already applied. */
export interface WorkerRunOutcome extends ToolOutcome<WorkerRunResult> {
    /**
     * Did the sweep actually run? **Resolved here rather than at the call site**, because the
     * rule is counter-intuitive enough that a screen would get it wrong.
     */
    ran: boolean;
}

/**
 * `POST /dev-tools/workers/:workerKey/run` · `developer_tools.workers.trigger` ·
 * **destructive**, behind `dev_tools.enabled`. Runs a background worker immediately, **against
 * live data**.
 *
 * ── The `ran` rule ───────────────────────────────────────────────────────────
 * ⚠ **`ran` is optional and its ABSENCE means `true`.** A platform predating the overlap lock
 * always ran, so `result.ran !== false` is the only correct reading and it is safe in either
 * deploy order. Stated in wi-admin's gateway comment and nowhere in the docs; a screen branching
 * on `ran === true` would report "did not run" against an older platform. Resolved here so no
 * call site can repeat it.
 *
 * ⚠ **`ran: false` is a `200`, and a neutral outcome rather than a failure** — the sweep is
 * already in flight here or on another instance and yours changed nothing. That is a *different*
 * answer from `409 DEV_TOOLS_WORKER_BUSY`, which says this instance is already doing it for
 * somebody. Both worker verdicts arrive as **`details.platformCode`** on a forwarded rejection,
 * so branch on that and never on `error.code`.
 *
 * The worker key is deliberately not pinned client-side: the registry lives in the platform, and
 * a second copy would drift the moment a worker is added or renamed. A bad key is a `404` whose
 * `details.known` lists the valid ones.
 *
 * A manual run **works during a maintenance window but cannot beat the overlap lock**. The two
 * guards sit in different places on purpose: maintenance is a policy an operator may override,
 * overlap is a correctness constraint.
 */
export async function runWorker(
    workerKey: string,
    options?: RequestOptions,
): Promise<WorkerRunOutcome> {
    const { data, message } = await api.mutate<WorkerRunResult>(
        'POST',
        `/dev-tools/workers/${encodeURIComponent(workerKey)}/run`,
        undefined,
        options,
    );
    return { data, message, ran: data?.ran !== false };
}

// ─── Outbox ───────────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/outbox/replay` · `developer_tools.outbox.replay` · **destructive**, behind
 * `dev_tools.enabled`.
 *
 * Puts `failed` tracking-outbox rows back to `pending` for the dispatcher's next drain, resetting
 * `attempts` so the backoff starts fresh.
 *
 * ⚠ **Downstream services will see these events a second time.** geo-tracker dedups on
 * `eventId`, but relying on the far side's dedup to make a local mistake harmless is not a
 * design — say it in the confirmation.
 *
 * Omitting `eventIds` means "the oldest failed rows up to `limit`", the common case after an
 * outage. Find the candidates first with `getQueues()` → `trackingOutbox.exhausted`; there is no
 * `dryRun` on this route, so that read is the only pre-flight available.
 */
export async function replayOutbox(
    body: ReplayOutboxBody = {},
    options?: RequestOptions,
): Promise<ToolOutcome<ReplayOutboxResult>> {
    const { data, message } = await api.mutate<ReplayOutboxResult>(
        'POST',
        '/dev-tools/outbox/replay',
        body,
        options,
    );
    return { data, message };
}

/**
 * `POST /dev-tools/outbox/prune` · `developer_tools.outbox.prune` · **destructive**, behind
 * `dev_tools.enabled`. **Permanently deletes delivered rows.**
 *
 * ── `status` is supplied here, not by the caller ──────────────────────────────
 * It is the **literal `"sent"`**, and it is not a parameter of this function on purpose. Pruning
 * `failed` destroys the evidence `replayOutbox` exists to act on — the operator would delete the
 * backlog they were about to retry — and pruning `pending` destroys undelivered events outright.
 * Neither is a variant of this operation. **A field that could take another value is one somebody
 * eventually passes another value to**, so this client cannot express one.
 *
 * `confirm` must repeat `olderThanDays` as a string: the age is the only variable that decides
 * this operation's blast radius, which is what makes it the thing worth re-typing.
 *
 * ⚠ **`dryRun` defaults to `true` on the platform's side.** Send it explicitly, and show the
 * server's message verbatim — it leads with the dry-run state precisely so nobody has to know
 * that default. `truncated: true` means the limit was reached and the run must be repeated.
 */
export async function pruneOutbox(
    body: PruneOutboxBody,
    options?: RequestOptions,
): Promise<ToolOutcome<PruneOutboxResult>> {
    const { data, message } = await api.mutate<PruneOutboxResult>(
        'POST',
        '/dev-tools/outbox/prune',
        { ...body, status: 'sent' },
        options,
    );
    return { data, message };
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/catalogue/vectorise` · `developer_tools.catalogue.vectorise` ·
 * **destructive**, behind `dev_tools.enabled`.
 *
 * Rebuilds search vectors across the **entire** product catalogue.
 *
 * ⚠ **Synchronous and long-running.** It is awaited rather than fired and forgotten, so the
 * caller must expect a slow request and must not abort it. Deliberately takes no `AbortSignal`
 * from a component's unmount path for that reason — pass one only if the caller genuinely means
 * to cancel.
 *
 * The result is an opaque pass-through of the platform's own, so it is rendered as key/value
 * rather than parsed.
 */
export async function vectoriseCatalogue(
    options?: RequestOptions,
): Promise<ToolOutcome<VectoriseResult>> {
    const { data, message } = await api.mutate<VectoriseResult>(
        'POST',
        '/dev-tools/catalogue/vectorise',
        undefined,
        options,
    );
    return { data, message };
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

/**
 * `PUT /dev-tools/maintenance` · `developer_tools.maintenance.set` · **destructive**.
 *
 * **The single most consequential thing an operator can do to this platform**, and the one write
 * here that is **not** behind `dev_tools.enabled`. The carve-out exists because this tool's
 * failure mode is losing the ability to undo it: with the flag applied, an operator could not
 * enter maintenance during an incident without first flipping an unrelated switch, and anybody
 * turning that flag off mid-window would lock the exit.
 *
 * `reason` is required for anything but `off`, 8–500 characters, and is shown to **every refused
 * caller** in the `503` body as well as recorded in the audit row.
 *
 * ⚠ **The result carries no `setBy`** — refetch `getMaintenanceWindow()` afterwards to show who
 * opened the window. And show `convergenceSeconds`: other instances read the singleton through a
 * short cache and there is a real window in which they disagree. Re-issuing the current mode
 * answers `changed: false` and does not restart the clock.
 */
export async function setMaintenance(
    body: SetMaintenanceBody,
    options?: RequestOptions,
): Promise<ToolOutcome<SetMaintenanceResult>> {
    const { data, message } = await api.mutate<SetMaintenanceResult>(
        'PUT',
        '/dev-tools/maintenance',
        body,
        options,
    );
    return { data, message };
}

// ─── Cache flush ──────────────────────────────────────────────────────────────

/**
 * `POST /dev-tools/cache/flush` · `developer_tools.cache.flush` · **destructive**, behind
 * `dev_tools.enabled`. Deletes cached keys from one named Redis database on the platform.
 *
 * `db` is the database **NAME**, upper-case — never its index. A numeric field invites `0`, and a
 * typo turning `7` into `8` silently flushes live download links instead of booking holds.
 * **The valid names are never hard-coded in this client**: they come from `getDependencies()` →
 * `redis.entries[].constant`, which is the live factory catalogue. The three doc sources disagree
 * on which databases exist, so a client constant would be wrong on day one.
 *
 * `confirm` must repeat `db` exactly. `dryRun` defaults to `true` on the platform's side — send it
 * explicitly and show the message, which leads with that state.
 *
 * ⚠ The platform refuses a whole-database flush on the three databases whose keys are load-bearing
 * for correctness or for money, and returns its own `blastRadius` note either way. **Read
 * `destructive` off the response** rather than keeping a client copy of which three they are.
 *
 * ⚠ `db` comes back as a **number** while it goes out as a name; the name returns as `constant`.
 */
export async function flushCache(
    body: FlushCacheBody,
    options?: RequestOptions,
): Promise<ToolOutcome<FlushCacheResult>> {
    const { data, message } = await api.mutate<FlushCacheResult>(
        'POST',
        '/dev-tools/cache/flush',
        body,
        options,
    );
    return { data, message };
}
