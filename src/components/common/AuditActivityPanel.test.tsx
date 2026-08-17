import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { __resetAuditActionCache, type AuditPage } from '@/services/audit.service';
import { auditActionCatalogFixture } from '@/test/audit-fixtures';
import { auditEntryFixture, auditMetaFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AuditListMeta } from '@/types/audit.types';

/**
 * The shell six `/:id/activity` feeds share.
 *
 * Neither of the two panels this was extracted from had a test — these pin the
 * behaviour that used to live in two copies, so a future seventh call site
 * inherits it rather than re-deriving it.
 */

const ACTIONS = ['vendors.suspend', 'vendors.reinstate'] as const;
const LABELS: Record<string, string> = {
    'vendors.suspend': 'Suspended the vendor',
    'vendors.reinstate': 'Reinstated the vendor',
};

function panel(
    read: (query: unknown, options: { signal: AbortSignal }) => Promise<AuditPage>,
    props: Partial<{
        maxRangeDays: number;
        actions: readonly string[];
        actionPrefix: string;
    }> = {},
) {
    return renderWithProviders(
        <AuditActivityPanel
            read={read as never}
            basePath="/vendors/665f1c2a9b3e4a91c7d2e5f0/activity"
            actions={ACTIONS}
            actionLabels={LABELS}
            maxRangeDays={366}
            timeZone="Africa/Douala"
            reloadToken={0}
            caption="Administrative history for this vendor"
            emptyTitle="No administrator has acted on this vendor"
            emptyDescription="This feed records what administrators did. It is not the vendor's own activity."
            {...props}
        />,
    );
}

function page(rows = [auditEntryFixture()], meta: Partial<AuditListMeta> = {}): AuditPage {
    return { data: rows, meta: auditMetaFixture({ total: rows.length, pages: 1, ...meta }) };
}

describe('the feed', () => {
    it('asks for the documented defaults', async () => {
        const read = vi.fn().mockResolvedValue(page());
        panel(read);

        await waitFor(() => expect(read).toHaveBeenCalled());
        expect(read.mock.calls[0][0]).toMatchObject({ page: 1, limit: 20 });
        // No filter is a filter that is absent, not one sent empty.
        expect(read.mock.calls[0][0].action).toBeUndefined();
        expect(read.mock.calls[0][0].status).toBeUndefined();
    });

    it('renders the action label, and an uncatalogued action verbatim', async () => {
        const read = vi.fn().mockResolvedValue(
            page([
                auditEntryFixture({ id: 'a', action: 'vendors.suspend' }),
                // An action added to the catalog after this deploy. A closed lookup
                // here would blank the row.
                auditEntryFixture({ id: 'b', action: 'billing.subscriptions.assign_vendor' }),
            ]),
        );
        panel(read);

        expect(await screen.findByText('Suspended the vendor')).toBeInTheDocument();
        expect(screen.getByText('billing.subscriptions.assign_vendor')).toBeInTheDocument();
    });

    /**
     * On a failed delegated write `platformCode` is the only handle on *why* —
     * `error.code` is `PLATFORM_OPERATION_REJECTED` for every one of them.
     */
    it('prefers the platform code over the envelope code on a failure', async () => {
        const read = vi.fn().mockResolvedValue(
            page([
                auditEntryFixture({
                    status: 'failed',
                    outcome: {
                        code: 'PLATFORM_OPERATION_REJECTED',
                        platformCode: 'VENDOR_STATUS_CONFLICT',
                        message: null,
                        statusCode: 409,
                    },
                } as never),
            ]),
        );
        panel(read);

        expect(await screen.findByText('VENDOR_STATUS_CONFLICT')).toBeInTheDocument();
        expect(screen.queryByText('PLATFORM_OPERATION_REJECTED')).not.toBeInTheDocument();
    });

    it('renders the tier the actor held at the time, not a current one', async () => {
        const read = vi.fn().mockResolvedValue(page());
        panel(read);

        expect(await screen.findByText(/tier 2 at the time/i)).toBeInTheDocument();
    });

    /** Why the feed stops where it does, rather than looking broken at the boundary. */
    it('explains the retention boundary when the server states one', async () => {
        const read = vi.fn().mockResolvedValue(page());
        panel(read);

        expect(await screen.findByText(/kept for 365 days/i)).toBeInTheDocument();
    });

    it('says nothing about retention when the server did not state it', async () => {
        const read = vi.fn().mockResolvedValue(
            page([auditEntryFixture({ action: 'vendors.suspend' })], { oldestRetainedAt: null }),
        );
        panel(read);

        await screen.findByText('Suspended the vendor');
        expect(screen.queryByText(/kept for/i)).not.toBeInTheDocument();
    });
});

describe('filters', () => {
    it('sends a chosen action and resets to page 1', async () => {
        const read = vi.fn().mockResolvedValue(page());
        panel(read);
        await waitFor(() => expect(read).toHaveBeenCalled());

        await userEvent.click(screen.getByRole('combobox', { name: 'Action' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Suspended the vendor' }));

        await waitFor(() => {
            const last = read.mock.calls[read.mock.calls.length - 1][0];
            expect(last).toMatchObject({ action: 'vendors.suspend', page: 1 });
        });
    });

    /**
     * The server pins the outcome enum. Offering a subset this client decided is
     * how a filter stops matching a row that is already on screen.
     */
    it('offers the whole audit outcome vocabulary, including queued', async () => {
        panel(vi.fn().mockResolvedValue(page()));

        await userEvent.click(await screen.findByRole('combobox', { name: 'Outcome' }));
        for (const value of ['attempted', 'succeeded', 'failed', 'denied', 'queued']) {
            expect(await screen.findByRole('option', { name: value })).toBeInTheDocument();
        }
    });

    /**
     * The endpoint's own cap is handed down rather than shared with `GET /audit`,
     * which caps at 92 where these six cap at 366. One constant between them would
     * silently widen the tighter of the two.
     *
     * The over-cap behaviour itself is pinned where it is reachable without
     * driving a calendar popover: `DateRangeFilter.test.tsx` covers the inline
     * refusal at 366, at 92 and exactly at the cap, and the list screens cover
     * "an over-cap range makes no request" through their URL-held filters. This
     * panel's filters are local state, so it has no equivalent seam.
     */
    it('hands its own cap to the date filter rather than assuming one', async () => {
        panel(vi.fn().mockResolvedValue(page()), { maxRangeDays: 92 });

        expect(await screen.findByRole('button', { name: 'When' })).toBeInTheDocument();
    });
});

describe('states', () => {
    it('distinguishes an empty feed from an empty filtered feed', async () => {
        const read = vi.fn().mockResolvedValue(page([], { total: 0, pages: 0 }));
        panel(read);

        // Unfiltered: the caller's own sentence, which says what the feed is not.
        expect(
            await screen.findByText('No administrator has acted on this vendor'),
        ).toBeInTheDocument();
        expect(screen.getByText(/not the vendor's own activity/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('combobox', { name: 'Action' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Suspended the vendor' }));

        expect(await screen.findByText(/nothing matches these filters/i)).toBeInTheDocument();
    });

    /** `pages: 0` on an empty list is the contract's rule, not `1`. */
    it('renders no pager over an empty result', async () => {
        panel(vi.fn().mockResolvedValue(page([], { total: 0, pages: 0 })));

        await screen.findByText('No administrator has acted on this vendor');
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });
});

/**
 * A feed may legitimately have no action vocabulary to offer.
 *
 * `GET /administrators/:id/activity` is the actor half — what somebody did
 * anywhere on the platform — so it spans all 21 permission families and no list
 * this client could hard-code would cover it. An empty list means "no filter",
 * not "a filter with one option".
 */
describe('a feed with no action vocabulary', () => {
    it('renders no action filter at all', async () => {
        panel(vi.fn().mockResolvedValue(page()), { actions: [] });

        await screen.findByRole('table');

        expect(screen.queryByRole('combobox', { name: 'Action' })).not.toBeInTheDocument();
    });

    it('keeps the outcome filter working', async () => {
        const read = vi.fn().mockResolvedValue(page());
        panel(read, { actions: [] });

        await screen.findByRole('table');
        await userEvent.click(screen.getByRole('combobox', { name: 'Outcome' }));
        await userEvent.click(await screen.findByRole('option', { name: 'denied' }));

        await waitFor(() =>
            expect(read.mock.calls[read.mock.calls.length - 1][0]).toMatchObject({
                status: 'denied',
            }),
        );
    });
});

/**
 * The `actionPrefix` opt-in, added in Phase 12.
 *
 * Every test above passes no prefix and therefore issues **no** catalog request —
 * which is the property that let this land without touching nine call sites or a
 * single existing assertion.
 */
describe('backfilling the action vocabulary from the catalog', () => {
    beforeEach(() => {
        __resetAuditActionCache();
    });

    it('issues no catalog request when no prefix is given', async () => {
        const calls = stubFetch(() => successResponse(auditActionCatalogFixture()));
        const read = vi.fn().mockResolvedValue(page());
        panel(read);

        await screen.findByRole('table');

        expect(calls.filter((call) => call.url.includes('/audit/actions'))).toHaveLength(0);
    });

    /**
     * ⚠ The prefix rule, at the call site. `billing.subscriptions.assign_vendor`
     * carries `target: 'vendor'` and appears on this very feed, but the feed's
     * `?action=` enum is prefix-derived and would refuse it.
     */
    it('offers catalogued vendors.* actions and never one merely targeting a vendor', async () => {
        stubFetch(() => successResponse(auditActionCatalogFixture()));
        const read = vi.fn().mockResolvedValue(page());
        panel(read, { actionPrefix: 'vendors.' });

        await screen.findByRole('table');
        await userEvent.click(await screen.findByRole('combobox', { name: 'Action' }));

        expect(await screen.findByRole('option', { name: 'Suspended the vendor' })).toBeInTheDocument();
        expect(
            screen.queryByRole('option', { name: /assign a plan to a vendor/i }),
        ).not.toBeInTheDocument();
    });

    it('keeps the hand-written label where one exists', async () => {
        stubFetch(() => successResponse(auditActionCatalogFixture()));
        const read = vi.fn().mockResolvedValue(page());
        panel(read, { actionPrefix: 'vendors.' });

        await screen.findByRole('table');
        await userEvent.click(await screen.findByRole('combobox', { name: 'Action' }));

        // The short domain phrase, not the catalog's sentence.
        expect(await screen.findByRole('option', { name: 'Suspended the vendor' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Suspend a vendor account' })).not.toBeInTheDocument();
    });

    it('falls back to the declared list when the catalog fails', async () => {
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));
        const read = vi.fn().mockResolvedValue(page());
        panel(read, { actionPrefix: 'vendors.' });

        await screen.findByRole('table');

        // A dead catalog costs nothing: the filter is exactly what it was before.
        expect(await screen.findByRole('combobox', { name: 'Action' })).toBeInTheDocument();
    });
});
