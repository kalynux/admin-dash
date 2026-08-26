import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotificationSources } from '@/pages/notifications/NotificationSources';
import { __resetNotificationSourceCache } from '@/services/notifications.service';
import { notificationSourceFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { NotificationSource } from '@/types/notifications.types';

// Memoised at module scope, so one test's registry would serve the next.
beforeEach(__resetNotificationSourceCache);
afterEach(__resetNotificationSourceCache);

function stubSources(sources: NotificationSource[]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/notifications/sources')) return successResponse({ sources });
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function sourcesPage(held?: ReadonlySet<string>) {
    return renderWithProviders(<NotificationSources />, {
        route: '/dashboard/notifications/sources',
        ...(held ? { permissions: { held } } : {}),
    });
}

describe('the sources reference', () => {
    it('describes each source and what it is derived from', async () => {
        stubSources([notificationSourceFixture()]);

        sourcesPage();

        expect(await screen.findByText('cod_discrepancy_opened')).toBeInTheDocument();
        expect(
            screen.getByText('A cash discrepancy was opened against an agent or agency'),
        ).toBeInTheDocument();
        expect(screen.getByText('cod_discrepancies')).toBeInTheDocument();
        expect(screen.getByText('cod.discrepancy.opened')).toBeInTheDocument();
    });

    it('says you receive a source whose permission you hold', async () => {
        stubSources([notificationSourceFixture()]);

        // The default permissions state is tier 1 with all 114.
        sourcesPage();

        expect(await screen.findByText(/you hold cod\.discrepancies\.read/i)).toBeInTheDocument();
    });

    it('says you receive an ungated source without naming a permission', async () => {
        stubSources([notificationSourceFixture({ requiredPermission: null })]);

        sourcesPage(new Set<string>());

        expect(await screen.findByText(/ungated/i)).toBeInTheDocument();
    });

    it('names the permission behind a source you do not receive', async () => {
        // This is the whole point of the screen: an empty inbox otherwise reads
        // the same whether nothing happened or everything was withheld.
        stubSources([
            notificationSourceFixture({
                id: 'payout_requested',
                requiredPermission: 'money.payouts.read',
            }),
        ]);

        sourcesPage(new Set<string>(['notifications.read']));

        expect(await screen.findByText(/you do not receive these/i)).toBeInTheDocument();
        expect(
            screen.getByText(/gated on money\.payouts\.read, which your level does not hold/i),
        ).toBeInTheDocument();
    });

    it('gives no verdict on a permission this build has never heard of', async () => {
        // `requiredPermission` is a raw server string and the catalog can gain a
        // name on a routine deploy. Reporting an unrecognised one as "you do not
        // hold this" would tell an operator they are excluded when the truth is
        // that this dashboard cannot say.
        stubSources([
            notificationSourceFixture({
                id: 'brand_new_source',
                requiredPermission: 'telemetry.beacons.read',
            }),
        ]);

        sourcesPage(new Set<string>(['notifications.read']));

        expect(
            await screen.findByText(/gated on a permission this dashboard does not know/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/you do not receive these/i)).not.toBeInTheDocument();
    });

    it('renders an unrecognised severity raw rather than hiding the source', async () => {
        stubSources([notificationSourceFixture({ severity: ['catastrophic'] })]);

        sourcesPage();

        expect(await screen.findByText('catastrophic')).toBeInTheDocument();
    });

    it('reports a failed registry read instead of claiming there are no sources', async () => {
        // "No sources declared" would mean nothing can ever reach this inbox,
        // which is a very different statement from "the read failed".
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));

        sourcesPage();

        expect(await screen.findByText(/could not load this/i)).toBeInTheDocument();
        expect(screen.queryByText(/no sources declared/i)).not.toBeInTheDocument();
    });
});
