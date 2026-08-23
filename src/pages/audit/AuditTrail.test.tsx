import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { AuditTrail } from '@/pages/audit/AuditTrail';
import { __resetAuditActionCache } from '@/services/audit.service';
import { auditActionCatalogFixture } from '@/test/audit-fixtures';
import { adminFixture, auditEntryFixture, auditMetaFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

/**
 * `GET /audit` — the whole trail.
 *
 * The assertions worth having here are about **the request it builds**: this
 * screen carries twelve filters, three contract rules that a naive
 * implementation breaks (the empty `?search=`, the serialised `false`, the
 * 92-day cap), and exactly one legal sort key.
 */

const LIST_META = auditMetaFixture({ total: 1, page: 1, limit: 20, pages: 1 });

function stubTrail(rows = [auditEntryFixture()], meta = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/audit/actions')) {
            return successResponse(auditActionCatalogFixture());
        }
        if (call.url.includes('/audit')) {
            return successResponse(rows, { meta: { ...LIST_META, ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * The screen reads `admin.timezone` to resolve every instant it renders, so the
 * session has to be stood up — the default `auth` carries no profile.
 */
function renderTrail(route: string, tier: AdminTier = 1) {
    return renderWithProviders(<AuditTrail />, {
        route,
        auth: { admin: adminFixture({ tier }) },
        permissions: { held: heldFixture(tier), tier },
    });
}

/** The trail read, ignoring the catalog request that runs beside it. */
function trailCall(calls: FetchCall[]): FetchCall {
    const call = calls.find((entry) => !entry.url.includes('/audit/actions'));
    if (!call) throw new Error('no trail request was issued');
    return call;
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

beforeEach(() => {
    // The catalog is memoised for the life of the module, so without this the
    // second test in the file sees a resolved promise from the first one's stub.
    __resetAuditActionCache();
});

describe('the trail', () => {
    it('renders an entry, preferring the catalog’s own description', async () => {
        stubTrail();
        renderTrail('/dashboard/audit');

        expect(
            await screen.findByText(/mark a payout request as paid/i),
        ).toBeInTheDocument();
        expect(screen.getByText('money.payouts.mark_paid')).toBeInTheDocument();
    });

    it('renders an action the catalog no longer describes rather than blanking the row', async () => {
        // A closed lookup here would leave an empty cell on a routine deploy.
        stubTrail([auditEntryFixture({ action: 'money.retired.action', actionSummary: null })]);
        renderTrail('/dashboard/audit');

        expect((await screen.findAllByText('money.retired.action')).length).toBeGreaterThan(0);
    });

    it('says the level was the one held at the time', async () => {
        stubTrail();
        renderTrail('/dashboard/audit');

        expect(await screen.findByText(/tier 2 at the time/i)).toBeInTheDocument();
    });
});

describe('the request it builds', () => {
    it('sends the default sort and no filters on a clean load', async () => {
        const calls = stubTrail();
        renderTrail('/dashboard/audit');
        await screen.findByText(/mark a payout request as paid/i);

        const query = queryOf(trailCall(calls));
        expect(query.get('sort')).toBe('-occurredAt');
        expect(query.get('page')).toBe('1');
        expect(query.get('limit')).toBe('20');
        expect(query.get('search')).toBeNull();
        expect(query.get('sensitiveOnly')).toBeNull();
    });

    it('round-trips every filter from the URL under its wire name', async () => {
        const calls = stubTrail();
        renderTrail(
            '/dashboard/audit?search=ada&action=money.payouts.mark_paid&actionFamily=money&status=denied&targetType=payout&actorId=665f1c2a9b3e4a91c7d2e5f0&targetId=66a1b2c3d4e5f60718293a4b&correlationId=8f14c2a0',
        );
        // `findAllByText`: with `?action=` set, the selected option's label is the
        // same catalog summary the row renders, so the text legitimately appears
        // twice.
        await screen.findAllByText(/mark a payout request as paid/i);

        const query = queryOf(trailCall(calls));
        expect(query.get('search')).toBe('ada');
        expect(query.get('action')).toBe('money.payouts.mark_paid');
        expect(query.get('actionFamily')).toBe('money');
        expect(query.get('status')).toBe('denied');
        expect(query.get('targetType')).toBe('payout');
        expect(query.get('actorId')).toBe('665f1c2a9b3e4a91c7d2e5f0');
        expect(query.get('targetId')).toBe('66a1b2c3d4e5f60718293a4b');
        expect(query.get('correlationId')).toBe('8f14c2a0');
    });

    /**
     * `buildQuery` deliberately serialises booleans, because `false` is a real
     * filter value elsewhere on this service. So `sensitiveOnly` has to be
     * *absent*, not `false`, or the screen quietly applies a filter nobody asked
     * for. This is the one place that rule bites.
     */
    it('sends sensitiveOnly only when it is on, never as false', async () => {
        const calls = stubTrail();
        renderTrail('/dashboard/audit?sensitiveOnly=true');
        await screen.findByText(/mark a payout request as paid/i);

        expect(queryOf(trailCall(calls)).get('sensitiveOnly')).toBe('true');
    });

    it.each(['', 'false', '1', 'yes'])(
        'treats ?sensitiveOnly=%s as no filter rather than as false',
        async (value) => {
            const calls = stubTrail();
            renderTrail(`/dashboard/audit?sensitiveOnly=${value}`);
            await screen.findByText(/mark a payout request as paid/i);

            expect(queryOf(trailCall(calls)).get('sensitiveOnly')).toBeNull();
        },
    );

    /**
     * `GET /audit` caps a range at 92 days — every other feed on this service
     * allows 366. Over the cap the screen sends no range at all, so the list keeps
     * showing the last good page instead of flashing a 400.
     */
    it('sends no range at all when the span exceeds 92 days', async () => {
        const calls = stubTrail();
        renderTrail('/dashboard/audit?from=2026-01-01&to=2026-12-31');
        await screen.findByText(/mark a payout request as paid/i);

        const query = queryOf(trailCall(calls));
        expect(query.get('from')).toBeNull();
        expect(query.get('to')).toBeNull();
        expect(screen.getByText(/92 days or fewer/i)).toBeInTheDocument();
    });

    it('resolves a range inside the cap into instants, not bare dates', async () => {
        const calls = stubTrail();
        renderTrail('/dashboard/audit?from=2026-08-01&to=2026-08-13');
        await screen.findByText(/mark a payout request as paid/i);

        const query = queryOf(trailCall(calls));
        // The contract refuses date-only values — `2026-08-01` is not an instant.
        expect(query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('sorting', () => {
    /**
     * The endpoint's allowlist has exactly one entry, and an undeclared field is
     * a 400 naming the permitted set. So exactly one header may be a button.
     */
    it('offers exactly one sortable column', async () => {
        stubTrail();
        renderTrail('/dashboard/audit');
        await screen.findByText(/mark a payout request as paid/i);

        const headers = screen.getAllByRole('columnheader');
        const sortable = headers.filter(
            (header) => within(header).queryByRole('button') !== null,
        );

        expect(sortable).toHaveLength(1);
        expect(sortable[0]).toHaveTextContent(/when/i);
    });
});

describe('states', () => {
    /** An empty list reports `pages: 0`, not 1 — so the pager claims no page. */
    it('draws a disabled pager over an empty list', async () => {
        stubTrail([], { total: 0, pages: 0 });
        renderTrail('/dashboard/audit');

        expect(await screen.findByText(/nothing on record/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
    });

    it('distinguishes an empty trail from a filtered one with no matches', async () => {
        stubTrail([], { total: 0, pages: 0 });
        renderTrail('/dashboard/audit?status=denied');

        expect(await screen.findByText(/nothing matches these filters/i)).toBeInTheDocument();
    });

    /**
     * Support's feed is narrowed per row, in the query. Without saying so, a short
     * feed reads as a quiet platform rather than as a scoped view.
     */
    it('tells a Support administrator their view of the trail is narrowed', async () => {
        stubTrail([], { total: 0, pages: 0 });
        renderTrail('/dashboard/audit', 3);

        expect(await screen.findByText(/plus anything you did yourself/i)).toBeInTheDocument();
    });

    it('renders why the trail stops where it does', async () => {
        stubTrail();
        renderTrail('/dashboard/audit');

        expect(await screen.findByText(/the trail is kept for 365 days/i)).toBeInTheDocument();
    });

    it('shows a removable chip for a filter that has no control', async () => {
        stubTrail();
        renderTrail('/dashboard/audit?correlationId=8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d');

        expect(
            await screen.findByRole('button', { name: /clear request filter/i }),
        ).toBeInTheDocument();
    });

    /**
     * The catalog is an enhancement, not a dependency. Losing it costs the action
     * select and nothing else — the client-pinned vocabularies still work.
     */
    it('stays usable when the action catalog fails', async () => {
        stubFetch((call) => {
            if (call.url.includes('/audit/actions')) {
                return errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE');
            }
            return successResponse([auditEntryFixture()], { meta: { ...LIST_META } });
        });

        renderTrail('/dashboard/audit');

        expect(await screen.findByText(/mark a payout request as paid/i)).toBeInTheDocument();
        expect(screen.queryByLabelText('Action')).not.toBeInTheDocument();
        // The pinned ones are unaffected.
        expect(screen.getByLabelText('Result')).toBeInTheDocument();
        expect(screen.getByLabelText('Family')).toBeInTheDocument();
    });

    it('offers no retry on a refusal, and one on a dependency failure', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));
        const denied = renderTrail('/dashboard/audit');

        expect(await screen.findByText(/could not load this|not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
        denied.unmount();

        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));
        renderTrail('/dashboard/audit');

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
