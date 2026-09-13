import { describe, expect, it } from 'vitest';

import { getAutomationSummary, listAutomationFailures } from '@/services/automation.service';
import {
    automationFailuresPageFixture,
    automationSummaryFixture,
    developerFailureFixture,
    executionFailedFixture,
    unconfiguredSummaryFixture,
} from '@/test/automation-fixtures';
import { stubFetch, successResponse, type FetchCall } from '@/test/utils';

const url = (call: FetchCall) => new URL(call.url, 'http://localhost');
const params = (call: FetchCall) => url(call).searchParams;
/** The path below `VITE_API_BASE_URL`, so these read as the contract writes them. */
const path = (call: FetchCall) => url(call).pathname.replace(/^\/api\/v1/, '');

describe('the two paths', () => {
    it('sends both reads to their documented paths, as GETs with no CSRF header', async () => {
        const calls = stubFetch(() => successResponse({}));

        await listAutomationFailures();
        await getAutomationSummary();

        expect(calls.map((call) => path(call))).toEqual([
            '/automation/failures',
            '/automation/summary',
        ]);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        // Safe methods take no CSRF token, and neither route is audited.
        expect(calls.every((call) => call.headers.get('X-CSRF-Token') === null)).toBe(true);
    });

    it('sends no query at all for an unfiltered read', async () => {
        const calls = stubFetch(() => successResponse(automationFailuresPageFixture()));

        await listAutomationFailures();

        // Rather than `?windowHours=24&limit=50`: the service owns those defaults, and
        // restating them here would freeze a client copy of a value the contract may move.
        expect(calls[0].url).not.toContain('?');
    });
});

describe('GET /automation/failures — the query', () => {
    it('serialises every documented filter and omits what was not asked for', async () => {
        const calls = stubFetch(() => successResponse(automationFailuresPageFixture()));

        await listAutomationFailures({
            workflowId: 'vvbouV2136P5weCs',
            kind: 'execution_failed',
            windowHours: 168,
            limit: 200,
        });

        const query = params(calls[0]);
        expect(path(calls[0])).toBe('/automation/failures');
        expect(query.get('workflowId')).toBe('vvbouV2136P5weCs');
        expect(query.get('kind')).toBe('execution_failed');
        expect(query.get('windowHours')).toBe('168');
        expect(query.get('limit')).toBe('200');
        expect(query.has('channel')).toBe(false);
    });

    /**
     * ⚠ `unknown` is a real filter value, not an absent one.
     *
     * It is the stored default, and an `execution_failed` report has no envelope to read a
     * channel out of — so dropping it on the way to the wire would make the died-outright rows
     * unfilterable, which is the half of the feed that matters most.
     */
    it('sends channel=unknown rather than treating it as no filter', async () => {
        const calls = stubFetch(() => successResponse(automationFailuresPageFixture()));

        await listAutomationFailures({ channel: 'unknown' });

        expect(params(calls[0]).get('channel')).toBe('unknown');
    });

    /**
     * The contract answers `400 VALIDATION_ERROR` outside 1–720 / 1–200 and does **not** clamp.
     * Neither does this — a silently corrected window would mean the screen's own label and the
     * data it displays disagreed, which is worse than a refusal the operator can see.
     */
    it('does not clamp an out-of-range window or limit', async () => {
        const calls = stubFetch(() => successResponse(automationFailuresPageFixture()));

        await listAutomationFailures({ windowHours: 999, limit: 500 });

        expect(params(calls[0]).get('windowHours')).toBe('999');
        expect(params(calls[0]).get('limit')).toBe('500');
    });

    it('unwraps the envelope and keeps the projection name', async () => {
        stubFetch(() =>
            successResponse(
                automationFailuresPageFixture({
                    view: 'developer',
                    count: 1,
                    entries: [developerFailureFixture()],
                }),
            ),
        );

        const page = await listAutomationFailures();

        expect(page.view).toBe('developer');
        expect(page.configured).toBe(true);
        expect(page.entries).toHaveLength(1);
    });

    it('carries configured: false through rather than flattening it to an empty page', async () => {
        stubFetch(() =>
            successResponse(
                automationFailuresPageFixture({ configured: false, count: 0, entries: [] }),
            ),
        );

        const page = await listAutomationFailures();

        // The whole reason the flag is on the wire: this is not "nothing failed".
        expect(page.configured).toBe(false);
        expect(page.entries).toHaveLength(0);
    });

    it('returns the died-outright row with its unknown channel intact', async () => {
        stubFetch(() =>
            successResponse(
                automationFailuresPageFixture({
                    view: 'admin',
                    count: 1,
                    entries: [executionFailedFixture()],
                }),
            ),
        );

        const page = await listAutomationFailures();

        expect(page.entries[0].channel).toBe('unknown');
        expect(page.entries[0].kind).toBe('execution_failed');
    });
});

describe('GET /automation/summary — the query', () => {
    it('serialises the window and nothing else', async () => {
        const calls = stubFetch(() => successResponse(automationSummaryFixture()));

        await getAutomationSummary({ windowHours: 720 });

        expect(path(calls[0])).toBe('/automation/summary');
        expect(params(calls[0]).get('windowHours')).toBe('720');
        // There is no `limit`, no `kind`, no cursor and no page on this route.
        expect([...params(calls[0]).keys()]).toEqual(['windowHours']);
    });

    it('returns distinctCustomers, which exists nowhere else', async () => {
        stubFetch(() => successResponse(automationSummaryFixture()));

        const summary = await getAutomationSummary();

        // 47 reports from 12 customers — a platform incident, not one person retrying, and the
        // digest that answers the question never leaves the service.
        expect(summary.groups[0].count).toBe(47);
        expect(summary.groups[0].distinctCustomers).toBe(12);
        expect(summary.since).toBe('2026-09-06T11:00:00.000Z');
    });

    it('carries configured: false on an empty summary', async () => {
        stubFetch(() => successResponse(unconfiguredSummaryFixture()));

        const summary = await getAutomationSummary();

        expect(summary.configured).toBe(false);
        expect(summary.groups).toEqual([]);
    });

    /**
     * ⚠ There is no `view` on this response, at any tier, and a client must not invent one.
     * A count carries no machine detail and no identifier, so nothing is withheld — which is
     * why a Support administrator sees more here than on the feed.
     */
    it('has no projection field to branch on', async () => {
        stubFetch(() => successResponse(automationSummaryFixture()));

        const summary = await getAutomationSummary();

        expect('view' in summary).toBe(false);
    });
});
