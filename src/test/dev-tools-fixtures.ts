/**
 * Wire-shaped fixtures for `/dev-tools`.
 *
 * Each is the doc's own worked example where one exists, **corrected to what the service
 * actually sends** where the two disagree — the flag rows carry all ten fields rather than the
 * five `dev-tools.md` shows, and the prune result carries all eight rather than five. A fixture
 * that matched the docs would let a bug through on exactly the fields this phase had to go
 * looking for.
 */

import type {
    FeatureFlag,
    FlushCacheResult,
    PruneOutboxResult,
    ReplayOutboxResult,
    SetMaintenanceResult,
    WorkerRunResult,
} from '@/types/dev-tools.types';

/** A flag tracking its catalog default: `isDefault: true`, so all four provenance fields are null. */
export function featureFlagFixture(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
    return {
        name: 'dev_tools.enabled',
        enabled: false,
        isDefault: true,
        default: false,
        consumer: 'modules/dev-tools/gateways/dev-tools.gateway.ts',
        summary:
            'Allow the developer tools to run workers, replay outbox rows and rebuild search vectors',
        reason: null,
        updatedBy: null,
        updatedByEmail: null,
        updatedAt: null,
        ...overrides,
    };
}

/** A flag somebody has overridden — the provenance fields are populated exactly here. */
export function overriddenFlagFixture(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
    return featureFlagFixture({
        enabled: true,
        isDefault: false,
        reason: 'Enabling dev tools to replay the outbox after the 13/08 outage',
        updatedBy: '665f1a2b3c4d5e6f70819200',
        updatedByEmail: 'dev@wimall.cm',
        updatedAt: '2026-08-13T09:14:02.331Z',
        ...overrides,
    });
}

export const FEATURE_FLAGS_FIXTURE: FeatureFlag[] = [
    featureFlagFixture({
        name: 'audit.route_probe',
        enabled: true,
        default: true,
        consumer: 'api/route-manifest.ts',
        summary: 'Warn when a route succeeds without recording the action it declares',
    }),
    featureFlagFixture({
        name: 'audit.legacy_feed',
        enabled: true,
        default: true,
        consumer: 'modules/legacy-audit/routes/legacy-audit.routes.ts',
        summary:
            'Serve the interim feed of administrative actions still performed on jovi-mall',
    }),
    featureFlagFixture(),
];

/**
 * A worker run that happened.
 *
 * **`ran` is deliberately absent**, which is the ordinary shape from a platform predating the
 * overlap lock and the case the `ran !== false` rule exists for.
 */
export function workerRunFixture(overrides: Partial<WorkerRunResult> = {}): WorkerRunResult {
    return {
        worker: 'file-cleanup',
        durationMs: 4182,
        note: 'Expired uploads removed',
        ...overrides,
    };
}

/** A run the shared overlap lock refused. A `200`, and a neutral outcome rather than a failure. */
export function workerRefusedFixture(): WorkerRunResult {
    return {
        worker: 'earnings-release',
        durationMs: 4,
        ran: false,
        note: 'Not run — this sweep was already in progress, here or on another instance. Nothing was changed. Try again once it finishes.',
    };
}

export function replayResultFixture(
    overrides: Partial<ReplayOutboxResult> = {},
): ReplayOutboxResult {
    return { replayed: 4, requested: 50, ...overrides };
}

/** `status`, `cutoff` and `oldestRemainingSentAt` are the three the docs' example omits. */
export function pruneResultFixture(overrides: Partial<PruneOutboxResult> = {}): PruneOutboxResult {
    return {
        status: 'sent',
        olderThanDays: 30,
        cutoff: '2026-07-17T00:00:00.000Z',
        dryRun: true,
        matched: 412088,
        deleted: 0,
        truncated: false,
        oldestRemainingSentAt: '2026-07-17T04:12:00.000Z',
        ...overrides,
    };
}

/** No `setBy` — that is the point, and why a write is followed by a refetch. */
export function setMaintenanceResultFixture(
    overrides: Partial<SetMaintenanceResult> = {},
): SetMaintenanceResult {
    return {
        changed: true,
        previousMode: 'off',
        mode: 'readonly',
        reason: 'Migrating the orders collection index — writes paused',
        blockWebhooks: false,
        pauseWorkers: true,
        startedAt: '2026-08-16T09:14:02.331Z',
        expiresAt: '2026-08-16T09:59:02.331Z',
        convergenceSeconds: 30,
        ...overrides,
    };
}

/** `db` is the numeric index on the way back; the name returns as `constant`. */
export function flushResultFixture(overrides: Partial<FlushCacheResult> = {}): FlushCacheResult {
    return {
        db: 7,
        constant: 'SLOT_LOCK_DB',
        match: 'slot:*',
        dryRun: true,
        matched: 8412,
        deleted: 0,
        truncated: false,
        cursor: null,
        sample: ['slot:665f1a2b:2026-08-16', 'slot:665f1a2b:2026-08-17'],
        blastRadius:
            'DESTRUCTIVE. Drops live booking holds. Degraded, not broken: the double-sale guard is the in-transaction overlap re-check.',
        destructive: true,
        ...overrides,
    };
}
