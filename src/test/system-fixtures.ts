/**
 * Wire-shaped fixtures for `/system`.
 *
 * `systemHealthFixture`, `readinessFixture`, `outboxSummaryFixture` and `maintenanceFixture`
 * already live in `fixtures.ts` from Phase 5 and are not repeated here.
 *
 * Where `docs/admin/api/system.md` publishes no shape — eight routes have none anywhere in the
 * bundle — these follow `system.gateway.ts` and `docs/jovi-mall/admin/system.md`, which is the
 * same evidence `types/system.types.ts` was written from.
 */

import type {
    AdminErrorEntry,
    CacheReport,
    DependenciesReport,
    DeveloperErrorEntry,
    ExposedConfigEntry,
    GeoTrackerReport,
    IntegrationsReport,
    MetricsReport,
    PlatformCacheKeysReport,
    PlatformConfigReport,
    PlatformDatabaseReport,
    PlatformLogsPage,
    QueuesReport,
    SupportErrorEntry,
    SystemErrorsPage,
    WorkerReport,
    WorkersReport,
} from '@/types/system.types';

// ─── Workers ──────────────────────────────────────────────────────────────────

export function workerFixture(overrides: Partial<WorkerReport> = {}): WorkerReport {
    return {
        key: 'tracking-dispatch',
        label: 'Tracking dispatch',
        scheduled: true,
        executing: false,
        manualClaim: false,
        scheduleLabel: 'every 2 seconds',
        enabled: true,
        triggerable: true,
        notTriggerableReason: null,
        pausedByMaintenance: false,
        ...overrides,
    };
}

/** The one worker that is observable but not runnable. */
export function untriggerableWorkerFixture(): WorkerReport {
    return workerFixture({
        key: 'inbound-calendar-sync',
        label: 'Inbound calendar sync',
        scheduled: true,
        triggerable: false,
        notTriggerableReason:
            'Its work splits across two horizons with per-instance state, so "run it once" has no single meaning.',
    });
}

export function workersReportFixture(overrides: Partial<WorkersReport> = {}): WorkersReport {
    return {
        workers: [
            workerFixture(),
            workerFixture({
                key: 'earnings-release',
                label: 'Earnings release',
                executing: true,
                scheduleLabel: 'daily at 01:00',
            }),
            untriggerableWorkerFixture(),
        ],
        scopeNote:
            'scheduled, executing and manualClaim are process-local — they describe the instance that answered.',
        ...overrides,
    };
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export function dependenciesFixture(
    overrides: Partial<DependenciesReport> = {},
): DependenciesReport {
    return {
        mongo: {
            status: 'up',
            readyState: 'connected',
            database: 'jovi_mall',
            host: 'localhost:27017',
            latencyMs: 3,
            error: null,
            server: {
                available: true,
                reason: null,
                replicaSet: 'rs0',
                connections: { current: 12, available: 838, totalCreated: 240 },
                maxPoolSize: 100,
            },
        },
        redis: {
            entries: [
                {
                    db: 3,
                    constant: 'EMAIL_VERIFY_DB',
                    label: 'Email verification tokens',
                    status: 'idle',
                    everOpened: false,
                    latencyMs: null,
                    connectionErrors: 0,
                    error: null,
                },
                {
                    db: 7,
                    constant: 'SLOT_LOCK_DB',
                    label: 'Booking slot holds',
                    status: 'up',
                    everOpened: true,
                    latencyMs: 1,
                    connectionErrors: 0,
                    error: null,
                },
            ],
            note: 'Connections are lazy — "idle" means this process has not needed that database, not that it is down.',
        },
        maintenance: { storedMode: 'off', effectiveMode: 'off', reason: null, expiresAt: null },
        ...overrides,
    };
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export function integrationsFixture(
    overrides: Partial<IntegrationsReport> = {},
): IntegrationsReport {
    return {
        integrations: [
            {
                key: 'geo-tracker',
                label: 'geo-tracker',
                configured: true,
                reachability: { mode: 'probed', status: 'ok', checkedAt: '2026-08-16T09:14:02.331Z' },
            },
            {
                key: 'smtp',
                label: 'SMTP',
                configured: true,
                reachability: {
                    mode: 'on_demand',
                    status: null,
                    note: 'Not checked this request. Name it in ?probe= to run it.',
                },
            },
            {
                key: 'stripe',
                label: 'Stripe',
                configured: true,
                reachability: {
                    mode: 'never',
                    status: null,
                    note: 'A probe is an authenticated call against a live merchant account.',
                },
            },
            {
                key: 'notchpay',
                label: 'NotchPay',
                // `false` even with a key set — the gateway is a placeholder that completes no
                // payment, and `configured` has to mean "this payment path works".
                configured: false,
                impact: 'NOT IMPLEMENTED',
                reachability: { mode: 'never', status: null, note: 'Not implemented.' },
            },
        ],
        googleCalendar: { connectedVendors: 12, failingRefresh: 1 },
        rule: 'A diagnostics read never causes a side effect a customer would see, costs money, or consumes a quota a real request needs.',
        ...overrides,
    };
}

// ─── Cache and queues ─────────────────────────────────────────────────────────

export function cacheReportFixture(overrides: Partial<CacheReport> = {}): CacheReport {
    return {
        available: true,
        reason: null,
        instance: {
            keyspaceHits: 41028,
            keyspaceMisses: 3311,
            // `null` rather than 1 on an instance with no lookups — a ratio over zero is not a
            // number. Present here so a renderer that prints `hitRate * 100` is exercised.
            hitRate: 0.925,
            usedMemory: 41_943_040,
            maxmemory: 0,
            evictedKeys: 0,
        },
        databases: [
            { db: 3, constant: 'EMAIL_VERIFY_DB', keys: 12 },
            { db: 7, constant: 'SLOT_LOCK_DB', keys: 8412 },
        ],
        note: 'Hit rate and memory are instance-wide. Redis does not report them per logical database.',
        ...overrides,
    };
}

export function queuesFixture(overrides: Partial<QueuesReport> = {}): QueuesReport {
    return {
        trackingOutbox: {
            byStatus: { pending: 3, failed: 1, sent: 412088 },
            oldestPendingAt: '2026-08-16T09:12:44.000Z',
            byType: { 'shipment.delivered': 2, 'shipment.assigned': 2 },
            stuckPending: 0,
            exhausted: 1,
            dispatcherEnabled: true,
        },
        assignment: { dueSessions: 0 },
        note: 'The tracking outbox is also readable directly at GET /system/outbox, which still answers during a platform incident.',
        ...overrides,
    };
}

// ─── Metrics, geo-tracker, config ─────────────────────────────────────────────

export function metricsFixture(overrides: Partial<MetricsReport> = {}): MetricsReport {
    return {
        collectedAt: '2026-08-16T09:14:02.331Z',
        registrySize: 31,
        metrics: [
            {
                name: 'jovimall_http_requests_total',
                help: 'HTTP requests by route group and status class',
                type: 'counter',
                values: [
                    {
                        labels: { method: 'GET', route_group: '/api/products', status_class: '2xx' },
                        value: 4821,
                    },
                    {
                        labels: { method: 'POST', route_group: '/api/payments', status_class: '5xx' },
                        value: 3,
                    },
                ],
            },
        ],
        ...overrides,
    };
}

export function geoTrackerFixture(overrides: Partial<GeoTrackerReport> = {}): GeoTrackerReport {
    return {
        service: 'geo-tracker',
        configured: true,
        health: { status: 'ok' },
        readiness: { status: 'ready' },
        note: 'Service-level operations reads only — no live position, no trail, no session content.',
        ...overrides,
    };
}

/** The thirteen keys, in `EXPOSED_CONFIG_KEYS` order — and note the comma-joined origins. */
export function exposedConfigFixture(): ExposedConfigEntry[] {
    return [
        { key: 'NODE_ENV', value: 'production' },
        { key: 'PORT', value: 8033 },
        { key: 'LOG_LEVEL', value: 'info' },
        { key: 'TRUST_PROXY', value: 1 },
        { key: 'ADMIN_DASHBOARD_ORIGINS', value: 'https://admin.wimall.cm,https://ops.wimall.cm' },
        { key: 'ADMIN_APPROVAL_TTL_S', value: 86400 },
        { key: 'ADMIN_APPROVAL_SWEEP_MIN_INTERVAL_MS', value: 60000 },
        { key: 'ADMIN_AUDIT_RETENTION_DAYS', value: 365 },
        { key: 'ADMIN_AUDIT_MAX_STATE_BYTES', value: 16384 },
        { key: 'ADMIN_AUDIT_DANGLING_INTENT_S', value: 300 },
        { key: 'ADMIN_AUDIT_EXPORT_API_MAX_ROWS', value: 50000 },
        { key: 'ADMIN_AUDIT_EXPORT_DIR', value: './var/audit-exports' },
        { key: 'SHUTDOWN_TIMEOUT_MS', value: 15000 },
    ];
}

export function platformConfigFixture(
    overrides: Partial<PlatformConfigReport> = {},
): PlatformConfigReport {
    return {
        service: 'jovi-mall',
        entries: [
            { key: 'NODE_ENV', value: 'production', set: true },
            { key: 'EARNINGS_CRON', value: null, set: false },
        ],
        wiring: {
            geoTrackerConfigured: true,
            storageProvider: 'local',
            geoProvider: 'nominatim',
            fcmConfigured: true,
            stripeKeyMode: 'test',
        },
        note: 'No URL or URI is exposed. The wiring block is derived from configuration predicates.',
        ...overrides,
    };
}

// ─── Logs, errors, cache keys, database ───────────────────────────────────────

export function platformLogsFixture(overrides: Partial<PlatformLogsPage> = {}): PlatformLogsPage {
    return {
        sourceUsed: 'persisted',
        sourceReason: null,
        entries: [
            {
                at: '2026-08-16T09:14:02.331Z',
                level: 'error',
                msg: 'Payment gateway did not respond',
                requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
            },
        ],
        nextBefore: '665f1a2b3c4d5e6f70819200',
        meta: {
            persistence: { state: 'capped', levelFloor: 'info', capped: true, dropped: 0 },
            ring: { capacity: 1000, stored: 412, droppedSinceBoot: 0, scopeNote: 'Process-local.' },
            warning: 'Log lines are free text and can contain personal data.',
        },
        ...overrides,
    };
}

export function supportErrorFixture(overrides: Partial<SupportErrorEntry> = {}): SupportErrorEntry {
    return {
        at: '2026-08-16T09:14:02.331Z',
        requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
        category: 'external_service',
        code: 'PAYMENT_GATEWAY_TIMEOUT',
        statusCode: 502,
        method: 'POST',
        routeGroup: '/api/payments',
        actorRole: 'customer',
        message: 'A required dependency is unavailable',
        hint: 'A service we depend on did not respond. Not the caller’s fault and not fixable by them — escalate with the reference.',
        ...overrides,
    };
}

/**
 * A leaked bearer token, used across the masking tests.
 *
 * Deliberately one constant rather than a literal per test: every assertion that
 * says "this must not appear anywhere in the document" has to be checking the
 * *same* string the fixture put there, or it passes vacuously.
 */
export const LEAKED_TOKEN = 'dXNlcjpwYXNzd29yZDEyMw==';

/**
 * The tier-2 projection, carrying a credential in **both** ways it can arrive:
 * `authorization` gives itself away by its key name, `note` does not and has to
 * be caught by the value shape. `attempt` and `requestId` are the controls — they
 * must survive.
 */
export function adminErrorFixture(overrides: Partial<AdminErrorEntry> = {}): AdminErrorEntry {
    return {
        ...supportErrorFixture(),
        path: '/api/payments/checkout',
        actorId: '665f1a2b3c4d5e6f70819200',
        errorType: 'GatewayError',
        masked: true,
        internalMessage: `Stripe rejected the call for ops@wimall.cm with Bearer ${LEAKED_TOKEN}`,
        details: {
            authorization: `Bearer ${LEAKED_TOKEN}`,
            note: `retrying with Bearer ${LEAKED_TOKEN}`,
            attempt: 3,
            requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
        },
        ...overrides,
    };
}

/** The tier-1 projection: adds the stack, the cause chain and the whole record. */
export function developerErrorFixture(
    overrides: Partial<DeveloperErrorEntry> = {},
): DeveloperErrorEntry {
    return {
        ...adminErrorFixture(),
        causeMessage: 'connect ECONNREFUSED 10.0.0.5:587',
        stack: [
            'GatewayError: upstream refused',
            '    at StripeClient.charge (/app/dist/stripe.js:44:11)',
            `    at retry (/app/dist/retry.js:12:3) [Authorization: Bearer ${LEAKED_TOKEN}]`,
        ].join('\n'),
        // Never rendered by the dialog. The sentinel proves that stays true.
        raw: { neverRendered: 'raw-sentinel-value' },
        ...overrides,
    };
}

/**
 * A support-view page.
 *
 * **One row and a non-null `nextBefore`** on purpose: the tier-3 filter runs after the platform
 * returned the page, so a short page is the ordinary case and is exactly what a client stopping
 * on `entries.length < limit` would mis-handle.
 */
export function systemErrorsPageFixture(
    overrides: Partial<SystemErrorsPage> = {},
): SystemErrorsPage {
    return {
        view: 'support',
        entries: [supportErrorFixture()],
        sourceUsed: 'persisted',
        sourceReason: null,
        nextBefore: '665f1a2b3c4d5e6f70819200',
        meta: { warning: 'Log lines are free text and can contain personal data.' },
        ...overrides,
    } as SystemErrorsPage;
}

export function cacheKeysFixture(
    overrides: Partial<PlatformCacheKeysReport> = {},
): PlatformCacheKeysReport {
    return {
        available: true,
        reason: null,
        constant: 'SLOT_LOCK_DB',
        matched: 2,
        truncated: false,
        destructive: true,
        blastRadius: 'DESTRUCTIVE. Drops live booking holds.',
        keys: [
            { key: 'slot:665f1a2b:2026-08-16', type: 'string', ttlMs: 540_000, sizeBytes: null },
            { key: 'slot:665f1a2b:2026-08-17', type: 'string', ttlMs: 900_000, sizeBytes: null },
        ],
        note: 'Key names, types and TTLs only. Values are never returned.',
        ...overrides,
    };
}

export function databaseReportFixture(
    overrides: Partial<PlatformDatabaseReport> = {},
): PlatformDatabaseReport {
    return {
        database: 'jovi_mall',
        collections: [
            {
                name: 'orders',
                documents: 412_088,
                storageSizeBytes: 8_412_000,
                indexes: { missing: [], extra: [], mismatched: [] },
            },
            {
                name: 'shipments',
                documents: 88_120,
                storageSizeBytes: 2_100_000,
                indexes: {
                    missing: [{ name: 'tracking_number_1', key: { tracking_number: 1 }, unique: true }],
                    extra: [],
                    mismatched: [],
                },
            },
        ],
        summary: { collections: 2, missing: 1, extra: 0, mismatched: 0 },
        truncated: false,
        notReached: [],
        notes: ['Drift reflects the models this process registered. A build in progress reads as missing.'],
        ...overrides,
    };
}
