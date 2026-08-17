import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useNotificationSources } from '@/hooks/use-notification-sources';
import { __resetNotificationSourceCache } from '@/services/notifications.service';
import { notificationSourceFixture } from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { NOTIFICATION_TYPES, type NotificationSource } from '@/types/notifications.types';

/**
 * The registry, and the asymmetry between the two filters it feeds.
 *
 * `?source=` is a `z.enum` over the *live registry ids*, so the source filter can
 * only ever offer what this read answered. `?type=` is a `z.enum` over the ten
 * declared types, which this build transcribes — so the type filter is seeded
 * from the constants and *widened* by the registry rather than replaced by it.
 */

beforeEach(__resetNotificationSourceCache);
afterEach(__resetNotificationSourceCache);

function stubSources(sources: NotificationSource[]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/notifications/sources')) return successResponse({ sources });
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

describe('the source registry', () => {
    it('offers every declared type before the read has answered', async () => {
        // The select has to be usable on first paint. Waiting for a network round
        // trip to populate a filter over a constant is a filter that flickers.
        stubSources([notificationSourceFixture()]);

        const { result } = renderHook(() => useNotificationSources());

        expect(result.current.typeOptions).toEqual([...NOTIFICATION_TYPES]);
        expect(result.current.sources).toEqual([]);

        await waitFor(() => expect(result.current.sources).toHaveLength(1));
    });

    it('widens the type options with anything the registry produces that we do not know', async () => {
        // Adding a type is an additive backend change. A closed list would stop
        // offering it while still displaying rows that carry it.
        stubSources([
            notificationSourceFixture({
                id: 'brand_new_source',
                produces: ['telemetry.beacon.lost'],
            }),
        ]);

        const { result } = renderHook(() => useNotificationSources());

        await waitFor(() =>
            expect(result.current.typeOptions).toContain('telemetry.beacon.lost'),
        );
        // Declared first, discovered after — a stable, legible order.
        expect(result.current.typeOptions.slice(0, NOTIFICATION_TYPES.length)).toEqual([
            ...NOTIFICATION_TYPES,
        ]);
    });

    it('lists a type produced by two sources once', async () => {
        stubSources([
            notificationSourceFixture({ id: 'a', produces: ['telemetry.beacon.lost'] }),
            notificationSourceFixture({ id: 'b', produces: ['telemetry.beacon.lost'] }),
        ]);

        const { result } = renderHook(() => useNotificationSources());

        await waitFor(() => expect(result.current.sources).toHaveLength(2));
        expect(
            result.current.typeOptions.filter((type) => type === 'telemetry.beacon.lost'),
        ).toHaveLength(1);
    });

    it('requests the registry once across two consumers', async () => {
        // It is a constant that several screens want; a request per mount would
        // be identical round trips for something that changes on a deploy.
        const calls = stubSources([notificationSourceFixture()]);

        const first = renderHook(() => useNotificationSources());
        const second = renderHook(() => useNotificationSources());

        await waitFor(() => expect(first.result.current.sources).toHaveLength(1));
        await waitFor(() => expect(second.result.current.sources).toHaveLength(1));

        expect(calls.filter((call) => call.url.includes('/notifications/sources'))).toHaveLength(1);
    });

    it('keeps the declared types when the registry cannot be read', async () => {
        // The degraded path is "the type filter still works and there is no
        // source filter", not "the screen has no filters".
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));

        const { result } = renderHook(() => useNotificationSources());

        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.sources).toEqual([]);
        expect(result.current.typeOptions).toEqual([...NOTIFICATION_TYPES]);
    });

    it('indexes sources by id', async () => {
        stubSources([notificationSourceFixture()]);

        const { result } = renderHook(() => useNotificationSources());

        await waitFor(() =>
            expect(result.current.byId['cod_discrepancy_opened']?.collection).toBe(
                'cod_discrepancies',
            ),
        );
    });
});
