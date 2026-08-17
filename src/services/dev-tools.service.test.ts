import { describe, expect, it } from 'vitest';

import {
    flushCache,
    getFeatureFlags,
    pruneOutbox,
    replayOutbox,
    runWorker,
    setFeatureFlag,
    setMaintenance,
    vectoriseCatalogue,
} from '@/services/dev-tools.service';
import {
    FEATURE_FLAGS_FIXTURE,
    featureFlagFixture,
    flushResultFixture,
    overriddenFlagFixture,
    pruneResultFixture,
    replayResultFixture,
    setMaintenanceResultFixture,
    workerRefusedFixture,
    workerRunFixture,
} from '@/test/dev-tools-fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';

const body = (call: FetchCall) => JSON.parse(call.body ?? '{}') as Record<string, unknown>;

describe('GET /dev-tools/feature-flags', () => {
    it('unwraps the flags array and keeps all ten fields', async () => {
        const calls = stubFetch(() => successResponse({ flags: FEATURE_FLAGS_FIXTURE }));

        const flags = await getFeatureFlags();

        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/dev-tools/feature-flags');
        expect(flags).toHaveLength(3);
        // The five `dev-tools.md` omits without an ellipsis. `isDefault` in particular is not
        // derivable from `enabled === default`.
        expect(Object.keys(flags[0])).toEqual(
            expect.arrayContaining([
                'isDefault',
                'reason',
                'updatedBy',
                'updatedByEmail',
                'updatedAt',
            ]),
        );
    });

    it('falls back to an empty list rather than undefined', async () => {
        stubFetch(() => successResponse({}));

        await expect(getFeatureFlags()).resolves.toEqual([]);
    });

    it('distinguishes a flag tracking its default from one somebody overrode', async () => {
        stubFetch(() => successResponse({ flags: [featureFlagFixture(), overriddenFlagFixture()] }));

        const [tracking, overridden] = await getFeatureFlags();

        expect(tracking.isDefault).toBe(true);
        expect(tracking.reason).toBeNull();
        expect(overridden.isDefault).toBe(false);
        expect(overridden.reason).toContain('outbox');
    });
});

describe('PUT /dev-tools/feature-flags/:flag', () => {
    it('sends the flag name in the path with the reason, and keeps the server message', async () => {
        const calls = stubFetch(() =>
            successResponse(overriddenFlagFixture(), {
                message:
                    '"dev_tools.enabled" is now on on this instance. Other instances converge within the flag cache TTL.',
            }),
        );

        const result = await setFeatureFlag('dev_tools.enabled', {
            enabled: true,
            reason: 'Enabling dev tools to replay the outbox after the 13/08 outage',
        });

        expect(calls[0].method).toBe('PUT');
        expect(calls[0].url).toContain('/dev-tools/feature-flags/dev_tools.enabled');
        expect(body(calls[0])).toEqual({
            enabled: true,
            reason: 'Enabling dev tools to replay the outbox after the 13/08 outage',
        });
        // The message states the fleet has NOT converged. `api.post` would discard it.
        expect(result.message).toContain('converge');
    });
});

describe('POST /dev-tools/workers/:key/run — the `ran` rule', () => {
    /**
     * `ran` is optional and its ABSENCE means `true`: a platform predating the overlap lock
     * always ran. A screen branching on `ran === true` would report "did not run" against it.
     * Resolved in the service so no call site can repeat the mistake.
     */
    it('reports a run when `ran` is absent entirely', async () => {
        stubFetch(() => successResponse(workerRunFixture()));

        const result = await runWorker('file-cleanup');

        expect(result.data.ran).toBeUndefined();
        expect(result.ran).toBe(true);
    });

    it('reports a run when `ran` is explicitly true', async () => {
        stubFetch(() => successResponse(workerRunFixture({ ran: true })));

        await expect(runWorker('file-cleanup')).resolves.toMatchObject({ ran: true });
    });

    it('reports a refusal only when `ran` is explicitly false', async () => {
        stubFetch(() => successResponse(workerRefusedFixture()));

        const result = await runWorker('earnings-release');

        // A 200 and a neutral outcome — the sweep is in flight elsewhere and yours changed
        // nothing. Not a failure, and distinct from a 409 on this instance.
        expect(result.ran).toBe(false);
        expect(result.data.note).toContain('already in progress');
    });

    it('encodes the worker key into the path and sends no body', async () => {
        const calls = stubFetch(() => successResponse(workerRunFixture()));

        await runWorker('agent-capacity-reconcile');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/dev-tools/workers/agent-capacity-reconcile/run');
        expect(calls[0].body).toBeUndefined();
    });

    it('surfaces a busy verdict as a platform code, not as error.code', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: { platformCode: 'DEV_TOOLS_WORKER_BUSY' },
            }),
        );

        const error = await runWorker('earnings-release').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        // Branching on `error.code` here would match every delegated refusal on the service.
        expect((error as ApiError).platformCode).toBe('DEV_TOOLS_WORKER_BUSY');
    });
});

describe('POST /dev-tools/outbox/prune — the literal status', () => {
    /**
     * Pruning `failed` destroys the evidence replay exists to act on, and pruning `pending`
     * destroys undelivered events. Neither is a variant of this operation, so the client cannot
     * express one.
     */
    it('always sends status "sent", and the body type offers no way to say otherwise', async () => {
        const calls = stubFetch(() => successResponse(pruneResultFixture()));

        await pruneOutbox({ olderThanDays: 30, confirm: '30', dryRun: false });

        expect(body(calls[0])).toEqual({
            olderThanDays: 30,
            confirm: '30',
            dryRun: false,
            status: 'sent',
        });
    });

    it('sends dryRun explicitly rather than relying on the platform default', async () => {
        const calls = stubFetch(() => successResponse(pruneResultFixture()));

        await pruneOutbox({ olderThanDays: 30, confirm: '30', dryRun: true });

        expect(body(calls[0]).dryRun).toBe(true);
    });

    it('keeps the three result fields the docs example omits', async () => {
        stubFetch(() =>
            successResponse(pruneResultFixture(), {
                message:
                    'DRY RUN — 412088 delivered row(s) older than 30 days matched; nothing was deleted',
            }),
        );

        const result = await pruneOutbox({ olderThanDays: 30, confirm: '30' });

        expect(result.data.status).toBe('sent');
        expect(result.data.cutoff).toBeTruthy();
        expect(result.data.oldestRemainingSentAt).toBeTruthy();
        // The message leads with the dry-run state, deliberately.
        expect(result.message).toContain('DRY RUN');
    });
});

describe('the remaining writes', () => {
    it('replays with the limit, and omits eventIds when none were named', async () => {
        const calls = stubFetch(() =>
            successResponse(replayResultFixture(), {
                message: '4 outbox row(s) queued for redelivery',
            }),
        );

        const result = await replayOutbox({ limit: 50 });

        expect(calls[0].url).toContain('/dev-tools/outbox/replay');
        expect(body(calls[0])).toEqual({ limit: 50 });
        expect(result.data.replayed).toBe(4);
        expect(result.message).toContain('queued for redelivery');
    });

    it('vectorises with no body and keeps the platform result opaque', async () => {
        const calls = stubFetch(() =>
            successResponse({ products: 8412, durationMs: 91_204 }, {
                message: 'Catalogue search vectors rebuilt',
            }),
        );

        const result = await vectoriseCatalogue();

        expect(calls[0].url).toContain('/dev-tools/catalogue/vectorise');
        expect(calls[0].body).toBeUndefined();
        expect(result.data).toEqual({ products: 8412, durationMs: 91_204 });
        expect(result.message).toBe('Catalogue search vectors rebuilt');
    });

    it('sets maintenance with a reason, and the result carries no setBy', async () => {
        const calls = stubFetch(() =>
            successResponse(setMaintenanceResultFixture(), {
                message:
                    'Platform maintenance is now "readonly" (was "off"). Other jovi-mall instances converge within 30s.',
            }),
        );

        const result = await setMaintenance({
            mode: 'readonly',
            reason: 'Migrating the orders collection index — writes paused',
            expiresInMinutes: 45,
            pauseWorkers: true,
        });

        expect(calls[0].method).toBe('PUT');
        expect(body(calls[0]).mode).toBe('readonly');
        expect(result.data.convergenceSeconds).toBe(30);
        // No `setBy` here, unlike the read — which is why a screen refetches after writing.
        expect(result.data).not.toHaveProperty('setBy');
    });

    it('flushes with the database NAME going out and a numeric index coming back', async () => {
        const calls = stubFetch(() =>
            successResponse(flushResultFixture(), {
                message: 'DRY RUN — 8412 key(s) matched in SLOT_LOCK_DB; nothing was deleted',
            }),
        );

        const result = await flushCache({
            db: 'SLOT_LOCK_DB',
            prefix: 'slot:',
            confirm: 'SLOT_LOCK_DB',
            dryRun: true,
        });

        expect(body(calls[0]).db).toBe('SLOT_LOCK_DB');
        expect(body(calls[0]).confirm).toBe('SLOT_LOCK_DB');
        // Same key, two types, opposite directions. The name returns as `constant`.
        expect(result.data.db).toBe(7);
        expect(result.data.constant).toBe('SLOT_LOCK_DB');
        expect(result.data.destructive).toBe(true);
        expect(result.data.blastRadius).toContain('booking holds');
    });

    it('sends a CSRF header on every write, which the reads do not', async () => {
        const calls = stubFetch((call) => {
            if (call.method === 'GET') return successResponse({ flags: [] });
            return successResponse(replayResultFixture());
        });
        document.cookie = 'admin_csrf_token=csrf-value';

        await getFeatureFlags();
        await replayOutbox({ limit: 1 });

        expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
        expect(calls[1].headers.get('X-CSRF-Token')).toBe('csrf-value');
    });
});

describe('the flag gate', () => {
    /**
     * `409 DEV_TOOLS_DISABLED`, not `403`. The category is overridden to `business_rule` so a
     * reader does not go hunting a race: nothing changed underneath the caller, the service is
     * simply not accepting these right now.
     */
    it('refuses a gated tool as a business rule rather than a permission problem', async () => {
        stubFetch(() =>
            errorResponse(409, 'DEV_TOOLS_DISABLED', {
                message: 'Developer tools are switched off',
                category: 'business_rule',
            }),
        );

        const error = await vectoriseCatalogue().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('DEV_TOOLS_DISABLED');
        expect((error as ApiError).isBusinessRule).toBe(true);
        // The distinction the screens rely on: this must not render as "not available to you".
        expect((error as ApiError).isPermissionDenied).toBe(false);
    });
});
