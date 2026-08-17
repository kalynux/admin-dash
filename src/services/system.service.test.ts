import { afterEach, describe, expect, it } from 'vitest';

import {
    __resetConfigShapeWarning,
    getCacheReport,
    getDependencies,
    getExposedConfig,
    getGeoTrackerHealth,
    getIntegrations,
    getMetrics,
    getQueues,
    getWorkers,
    inspectDatabase,
    listCacheKeys,
    listPlatformLogs,
    listSystemErrors,
} from '@/services/system.service';
import {
    cacheKeysFixture,
    cacheReportFixture,
    databaseReportFixture,
    dependenciesFixture,
    exposedConfigFixture,
    geoTrackerFixture,
    integrationsFixture,
    metricsFixture,
    platformLogsFixture,
    queuesFixture,
    systemErrorsPageFixture,
    workersReportFixture,
} from '@/test/system-fixtures';
import { stubFetch, successResponse, type FetchCall } from '@/test/utils';

const url = (call: FetchCall) => new URL(call.url, 'http://localhost');
const params = (call: FetchCall) => url(call).searchParams;
/** The path below `VITE_API_BASE_URL`, so these assertions read as the contract writes them. */
const path = (call: FetchCall) => url(call).pathname.replace(/^\/api\/v1/, '');

afterEach(() => __resetConfigShapeWarning());

describe('the paths each read calls', () => {
    it('sends every route to its documented path, as a GET with no CSRF header', async () => {
        const calls = stubFetch(() => successResponse({}));

        await getWorkers();
        await getDependencies();
        await getCacheReport();
        await getQueues();
        await getMetrics();
        await getGeoTrackerHealth();

        expect(calls.map((call) => path(call))).toEqual([
            '/system/workers',
            '/system/dependencies',
            '/system/cache',
            '/system/queues',
            '/system/metrics',
            '/system/geo-tracker',
        ]);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        // Safe methods take no CSRF token — the contract requires it only on writes.
        expect(calls.every((call) => call.headers.get('X-CSRF-Token') === null)).toBe(true);
    });

    it('unwraps the envelope rather than handing back the whole body', async () => {
        stubFetch(() => successResponse(workersReportFixture()));

        const report = await getWorkers();

        expect(report.workers).toHaveLength(3);
        expect(report.scopeNote).toContain('process-local');
    });
});

describe('GET /system/integrations — the one read that can cost something', () => {
    it('sends no probe parameter at all when none is asked for', async () => {
        const calls = stubFetch(() => successResponse(integrationsFixture()));

        await getIntegrations();

        // Not `?probe=`, not `?probe=""` — absent. An empty value would still be a parameter,
        // and the point is that the ordinary read touches no third party.
        expect(params(calls[0]).has('probe')).toBe(false);
    });

    it('joins the opted-in probes into one comma-separated parameter', async () => {
        const calls = stubFetch(() => successResponse(integrationsFixture()));

        await getIntegrations(['smtp', 'telegram']);

        expect(params(calls[0]).get('probe')).toBe('smtp,telegram');
    });

    it('carries the two fields the docs never mention', async () => {
        stubFetch(() => successResponse(integrationsFixture()));

        const report = await getIntegrations();

        expect(report.googleCalendar).toEqual({ connectedVendors: 12, failingRefresh: 1 });
        expect(report.rule).toContain('never causes a side effect');
    });
});

describe('GET /system/config — the shape the docs get wrong', () => {
    /**
     * The service sends an array of `{key, value}`; `system.md` documents a flat object keyed by
     * name. A client written from the example reads `data.config.NODE_ENV` and gets `undefined`
     * on all thirteen keys, so the service normalises both.
     */
    it('passes the array shape the service actually sends straight through', async () => {
        stubFetch(() => successResponse({ config: exposedConfigFixture() }));

        const entries = await getExposedConfig();

        expect(entries).toHaveLength(13);
        expect(entries[0]).toEqual({ key: 'NODE_ENV', value: 'production' });
    });

    it('normalises the documented object shape to the same array', async () => {
        stubFetch(() =>
            successResponse({ config: { NODE_ENV: 'production', PORT: 8033, TRUST_PROXY: 1 } }),
        );

        const entries = await getExposedConfig();

        expect(entries).toEqual([
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: 8033 },
            { key: 'TRUST_PROXY', value: 1 },
        ]);
    });

    it('survives a body with no config at all rather than throwing', async () => {
        stubFetch(() => successResponse({}));

        await expect(getExposedConfig()).resolves.toEqual([]);
    });

    it('keeps ADMIN_DASHBOARD_ORIGINS as the comma-joined string the service sends', async () => {
        stubFetch(() => successResponse({ config: exposedConfigFixture() }));

        const entries = await getExposedConfig();
        const origins = entries.find((entry) => entry.key === 'ADMIN_DASHBOARD_ORIGINS');

        // Documented as an array; the mapper `String()`s anything non-scalar. Typing it as an
        // array would put `.map` on a string.
        expect(typeof origins?.value).toBe('string');
        expect(origins?.value).toContain(',');
    });
});

describe('GET /system/errors — the cursor and the query', () => {
    it('serialises the cursor and the filters, and omits what was not asked for', async () => {
        const calls = stubFetch(() => successResponse(systemErrorsPageFixture()));

        await listSystemErrors({
            code: 'PAYMENT_GATEWAY_TIMEOUT',
            since: '2026-08-16T00:00:00.000Z',
            before: '665f1a2b3c4d5e6f70819200',
            limit: 100,
        });

        const query = params(calls[0]);
        expect(path(calls[0])).toBe('/system/errors');
        expect(query.get('code')).toBe('PAYMENT_GATEWAY_TIMEOUT');
        expect(query.get('since')).toBe('2026-08-16T00:00:00.000Z');
        expect(query.get('before')).toBe('665f1a2b3c4d5e6f70819200');
        expect(query.get('limit')).toBe('100');
        expect(query.has('requestId')).toBe(false);
        expect(query.has('category')).toBe(false);
    });

    it('sends no query at all for an unfiltered read', async () => {
        const calls = stubFetch(() => successResponse(systemErrorsPageFixture()));

        await listSystemErrors();

        expect(calls[0].url).not.toContain('?');
    });

    it('returns nextBefore, which is the only correct paging key and is undocumented', async () => {
        stubFetch(() => successResponse(systemErrorsPageFixture()));

        const page = await listSystemErrors();

        // A single row with a cursor still attached: for a support-level caller the row filter
        // runs after the platform returned the page, so a short page is the ordinary case.
        expect(page.entries).toHaveLength(1);
        expect(page.nextBefore).toBe('665f1a2b3c4d5e6f70819200');
        expect(page.view).toBe('support');
    });
});

describe('the two tier-1 platform inspectors', () => {
    it('bounds and serialises the log query', async () => {
        const calls = stubFetch(() => successResponse(platformLogsFixture()));

        await listPlatformLogs({ level: 'warn', q: 'timeout', source: 'ring', limit: 200 });

        const query = params(calls[0]);
        expect(path(calls[0])).toBe('/system/platform/logs');
        expect(query.get('level')).toBe('warn');
        expect(query.get('q')).toBe('timeout');
        expect(query.get('source')).toBe('ring');
        expect(query.get('limit')).toBe('200');
    });

    it('sends the cache database as its NAME and no confirm', async () => {
        const calls = stubFetch(() => successResponse(cacheKeysFixture()));

        await listCacheKeys({ db: 'SLOT_LOCK_DB', prefix: 'slot:', limit: 200 });

        const query = params(calls[0]);
        expect(path(calls[0])).toBe('/system/platform/cache/keys');
        expect(query.get('db')).toBe('SLOT_LOCK_DB');
        expect(query.get('prefix')).toBe('slot:');
        // Looking is not clearing: requiring a typed confirmation to *read* would train
        // reflexive confirmation-typing and hollow out the guard on the path that deletes.
        expect(query.has('confirm')).toBe(false);
    });

    it('repeats the collection parameter for an array', async () => {
        const calls = stubFetch(() => successResponse(databaseReportFixture()));

        await inspectDatabase({ collection: ['orders', 'shipments'] });

        expect(params(calls[0]).getAll('collection')).toEqual(['orders', 'shipments']);
    });

    it('omits the collection parameter entirely when inspecting everything', async () => {
        const calls = stubFetch(() => successResponse(databaseReportFixture()));

        await inspectDatabase();

        expect(calls[0].url).not.toContain('collection');
    });
});

describe('the reads a screen composes independently', () => {
    /**
     * The reason `/system/outbox` is kept beside `/system/queues` at all: one is a direct read
     * of the platform collection and the other is delegated, so during a platform incident the
     * delegated one is the half that fails. A screen must be able to render the survivor.
     */
    it('lets the delegated read fail without touching the direct one', async () => {
        stubFetch((call) => {
            if (call.url.includes('/system/queues')) {
                return successResponse(null, { status: 503 });
            }
            return successResponse(cacheReportFixture());
        });

        await expect(getCacheReport()).resolves.toBeTruthy();
    });

    it('geo-tracker reports "not configured" as data rather than as a failure', async () => {
        stubFetch(() =>
            successResponse(geoTrackerFixture({ configured: false, health: null, readiness: null })),
        );

        const report = await getGeoTrackerHealth();

        // `configured: false` and an unhealthy report are the two ways this route says "no".
        // It cannot throw — making geo-tracker a readiness dependency would couple the failures.
        expect(report.configured).toBe(false);
        expect(report.service).toBe('geo-tracker');
    });

    it('reads the live Redis catalogue off the dependencies report', async () => {
        stubFetch(() => successResponse(dependenciesFixture()));

        const report = await getDependencies();

        // This is where the cache screens get their database list, rather than from a client
        // constant — the three doc sources disagree on which databases exist.
        expect(report.redis.entries?.map((entry) => entry.constant)).toEqual([
            'EMAIL_VERIFY_DB',
            'SLOT_LOCK_DB',
        ]);
    });

    it('keeps the metrics projection as families with labelled samples', async () => {
        stubFetch(() => successResponse(metricsFixture()));

        const report = await getMetrics();

        expect(report.metrics[0].name).toBe('jovimall_http_requests_total');
        expect(report.metrics[0].values[0].labels.route_group).toBe('/api/products');
        // `route_group`, never `route`; `status_class`, never `status`. Cardinality is bounded
        // by a closed allowlist on the platform's side.
        expect(report.metrics[0].values[0].labels).not.toHaveProperty('route');
    });

    it('reports a queue depth of zero stuck rows distinctly from a backlog', async () => {
        stubFetch(() => successResponse(queuesFixture()));

        const report = await getQueues();

        expect(report.trackingOutbox.stuckPending).toBe(0);
        expect(report.trackingOutbox.exhausted).toBe(1);
        expect(report.assignment.dueSessions).toBe(0);
    });
});
