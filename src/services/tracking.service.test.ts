import { describe, expect, it } from 'vitest';

import {
    getAgentLivePosition,
    getAgentTrackingPresence,
    getShipmentTrackingEvents,
    getShipmentTrackingTrail,
    isDoorClosed,
    isDoorRefused,
    isDoorUnavailable,
    isDoorUnconfigured,
    isPositionStale,
    upstreamCodeOf,
} from '@/services/tracking.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

const AGENT_ID = '66a1aabbccddeeff00112233';
const SHIPMENT_ID = '6670aabbccddeeff00112233';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

describe('the four data-door reads', () => {
    it('sends NO query parameters on tracking-presence', async () => {
        /**
         * The asymmetry that will bite. Its schema is `z.object({}).strict()`, so
         * `?reason=` — which its sibling *requires* — is a **400** here, not a
         * harmless extra. wi-admin sends its own fixed `reason=presence` to
         * geo-tracker so the two services' logs line up.
         */
        const calls = stubFetch(() =>
            successResponse({
                agentId: AGENT_ID,
                connected: true,
                trackingAllow: true,
                positionKnown: true,
                activeShipment: false,
                sessions: [],
            }),
        );

        await getAgentTrackingPresence(AGENT_ID);

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe(`/api/v1/agents/${AGENT_ID}/tracking-presence`);
        expect(url.search).toBe('');
    });

    it('carries the operator’s reason on the live position', async () => {
        // Stored verbatim in the audit trail, and enforced independently by both
        // services — neither may make an unattributed disclosure on the strength
        // of the other's validation.
        const calls = stubFetch(() =>
            successResponse({
                agentId: AGENT_ID,
                trackingAllow: true,
                position: { latitude: 4.0511, longitude: 9.7679 },
                recordedAt: '2026-08-24T09:14:02.000Z',
                ageSeconds: 12,
            }),
        );

        await getAgentLivePosition(AGENT_ID, 'Courier has not moved for an hour — ticket 4821');

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe(`/api/v1/agents/${AGENT_ID}/live-position`);
        expect(url.searchParams.get('reason')).toBe(
            'Courier has not moved for an hour — ticket 4821',
        );
    });

    it('reads a withheld position as a normal answer, not a failure', async () => {
        // The agent has not granted device-level Tracking Allow. `recordedAt` is
        // null too — that they are streaming at all is part of what the opt-out
        // withholds.
        stubFetch(() =>
            successResponse({
                agentId: AGENT_ID,
                trackingAllow: false,
                position: null,
                recordedAt: null,
                ageSeconds: null,
                withheld: 'tracking_allow_off',
            }),
        );

        const result = await getAgentLivePosition(AGENT_ID, 'Checking on a late delivery');

        expect(result.position).toBeNull();
        expect(result.recordedAt).toBeNull();
        expect(result.withheld).toBe('tracking_allow_off');
    });

    it('carries reason and limit on the trail', async () => {
        const calls = stubFetch(() =>
            successResponse({
                shipmentId: SHIPMENT_ID,
                sessions: [],
                checkpoints: [],
                truncated: false,
                limit: 1000,
            }),
        );

        await getShipmentTrackingTrail(SHIPMENT_ID, 'Dispute over the delivery address', 500);

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe(`/api/v1/shipments/${SHIPMENT_ID}/tracking-trail`);
        expect(url.searchParams.get('reason')).toBe('Dispute over the delivery address');
        expect(url.searchParams.get('limit')).toBe('500');
    });

    it('sends no reason on tracking-events, which discloses no coordinates', async () => {
        const calls = stubFetch(() =>
            successResponse({
                shipmentId: SHIPMENT_ID,
                sessions: [],
                transitions: [],
                connections: [],
                truncated: false,
                limit: 500,
            }),
        );

        await getShipmentTrackingEvents(SHIPMENT_ID);

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe(`/api/v1/shipments/${SHIPMENT_ID}/tracking-events`);
        expect(url.searchParams.get('reason')).toBeNull();
    });
});

describe('the three door codes', () => {
    /**
     * They are three codes because the remedies are three different people — an
     * operator's deployment, geo-tracker's scope configuration, and an on-call
     * engineer. Collapsing them into "tracking unavailable" makes all three look
     * like an outage, which is what the split exists to prevent.
     */
    async function failWith(status: number, code: string, details?: Record<string, unknown>) {
        stubFetch(() => errorResponse(status, code, details ? { details } : undefined));
        return getAgentTrackingPresence(AGENT_ID).catch((error: unknown) => error);
    }

    it('separates an unopened door from an outage', async () => {
        const unconfigured = await failWith(503, 'TRACKING_DOOR_UNCONFIGURED');
        expect(isDoorUnconfigured(unconfigured)).toBe(true);
        expect(isDoorUnavailable(unconfigured)).toBe(false);
        expect(isDoorRefused(unconfigured)).toBe(false);
        expect(isDoorClosed(unconfigured)).toBe(true);
    });

    it('surfaces geo-tracker’s own code on a refusal', async () => {
        // Usually a scope that was never granted: unset grants `agent:presence`
        // alone, so a deployment can serve presence and refuse position.
        const refused = await failWith(502, 'TRACKING_DOOR_REFUSED', {
            upstreamCode: 'SERVICE_SCOPE_FORBIDDEN',
            upstreamStatus: 403,
            scope: 'agent:position',
        });

        expect(isDoorRefused(refused)).toBe(true);
        expect(upstreamCodeOf(refused)).toBe('SERVICE_SCOPE_FORBIDDEN');
    });

    it('recognises an unreachable service', async () => {
        const down = await failWith(503, 'TRACKING_DOOR_UNAVAILABLE');
        expect(isDoorUnavailable(down)).toBe(true);
        expect(isDoorUnconfigured(down)).toBe(false);
    });

    it('does not claim an ordinary 404 is a door problem', async () => {
        // wi-admin loads the agent before calling geo-tracker, so a bad id is a
        // plain 404 and nothing is audited.
        const missing = await failWith(404, 'NOT_FOUND');
        expect(isDoorClosed(missing)).toBe(false);
    });
});

describe('the staleness threshold', () => {
    it('applies the client-side line, because the wire ships no verdict', () => {
        // geo-tracker reports `ageSeconds` as a fact; wi-admin owns the display
        // threshold so the platform does not end up with two definitions that
        // drift. Two minutes, shared with the agent detail read's own `isStale`.
        expect(isPositionStale(12)).toBe(false);
        expect(isPositionStale(120)).toBe(false);
        expect(isPositionStale(121)).toBe(true);
    });

    it('says nothing about an absent age', () => {
        expect(isPositionStale(null)).toBe(false);
        expect(isPositionStale(undefined)).toBe(false);
    });
});
