import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { LegacyAuditFeed } from '@/pages/audit/LegacyAuditFeed';
import {
    legacyAuditEntryFixture,
    legacyAuditMetaFixture,
    legacyRequestRowFixture,
} from '@/test/audit-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

/**
 * `GET /audit/legacy` — jovi-mall's own record, rendered as itself.
 */

function renderFeed(
    rows = [legacyAuditEntryFixture()],
    meta: Record<string, unknown> = {},
    route = '/dashboard/audit/legacy',
) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/audit/legacy')) {
            return successResponse(rows, { meta: { ...legacyAuditMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<LegacyAuditFeed />, {
        route,
        auth: { admin: adminFixture({ tier: 1 }) },
        permissions: { held: heldFixture(1), tier: 1 },
    });

    return calls;
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('rows, in jovi-mall’s own vocabulary', () => {
    it('renders a named action and its diff', async () => {
        renderFeed();

        expect(await screen.findByText('DELIVERY_AGENCY_DEACTIVATED')).toBeInTheDocument();
        // `field: from → to`, not a JSON blob.
        expect(screen.getByText(/active → inactive/)).toBeInTheDocument();
    });

    /**
     * The half a feed gets wrong. `action`, `resource` and `changes` are all null
     * on a `request` row, because the middleware recorded what was *called*, not
     * what it meant — so the screen must explain rather than show three blanks,
     * and must never synthesise an action.
     */
    it('explains a request-only row instead of blanking it', async () => {
        renderFeed([legacyRequestRowFixture()]);

        expect(await screen.findByText(/request only/i)).toBeInTheDocument();
        expect(screen.getByText(/no action was named/i)).toBeInTheDocument();
        expect(screen.queryByText('DELIVERY_AGENCY_DEACTIVATED')).not.toBeInTheDocument();
    });

    it('says body key names are names only', async () => {
        renderFeed();

        expect(await screen.findByText(/values are never stored/i)).toBeInTheDocument();
        expect(screen.getByText('reason')).toBeInTheDocument();
    });
});

describe('the actor, which is not one of ours', () => {
    it('renders the server-composed label rather than composing one', async () => {
        renderFeed();

        expect(
            await screen.findByText('Legacy admin session (jovi-mall)'),
        ).toBeInTheDocument();
    });

    /**
     * Two identity spaces with no mapping between them. A link into
     * `/dashboard/administrators` would assert a correspondence that does not
     * exist — the exact lie an audit trail exists to prevent.
     */
    it('never links the platform user id to an administrator', async () => {
        renderFeed();
        await screen.findByText('Legacy admin session (jovi-mall)');

        expect(
            screen.queryByRole('link', { name: /jean kamdem/i }),
        ).not.toBeInTheDocument();
        expect(
            document.querySelector('a[href*="/dashboard/administrators/"]'),
        ).toBeNull();
    });

    it('says on every page what this feed is, and how much is left to port', async () => {
        renderFeed();

        expect(await screen.findByText(/this is not the wi-admin trail/i)).toBeInTheDocument();
        expect(screen.getByText(/37 legacy endpoints remain unported/i)).toBeInTheDocument();
    });

    it('changes the banner once nothing is left to port', async () => {
        renderFeed([legacyAuditEntryFixture()], { unportedEndpoints: 0 });

        expect(await screen.findByText(/fully ported/i)).toBeInTheDocument();
    });
});

describe('the request it builds', () => {
    it('never sends a sort or a search parameter — the endpoint has neither', async () => {
        const calls = renderFeed();
        await screen.findByText('DELIVERY_AGENCY_DEACTIVATED');

        const query = queryOf(calls[0]);
        expect(query.get('sort')).toBeNull();
        expect(query.get('search')).toBeNull();
    });

    it('offers no sortable column', async () => {
        renderFeed();
        await screen.findByText('DELIVERY_AGENCY_DEACTIVATED');

        const sortable = screen
            .getAllByRole('columnheader')
            .filter((header) => within(header).queryByRole('button') !== null);
        expect(sortable).toHaveLength(0);
    });

    it('round-trips its own narrower filters', async () => {
        const calls = renderFeed(
            [legacyAuditEntryFixture()],
            {},
            '/dashboard/audit/legacy?action=DELIVERY_AGENCY_DEACTIVATED&resourceType=delivery_agency&source=service&actorUserId=6641aabbccddeeff00112233',
        );
        await screen.findByText('DELIVERY_AGENCY_DEACTIVATED');

        const query = queryOf(calls[0]);
        expect(query.get('action')).toBe('DELIVERY_AGENCY_DEACTIVATED');
        expect(query.get('resourceType')).toBe('delivery_agency');
        expect(query.get('source')).toBe('service');
        expect(query.get('actorUserId')).toBe('6641aabbccddeeff00112233');
    });

    /** Free text, not a select: these verbs are jovi-mall's own vocabulary. */
    it('takes the action as free text rather than offering a list', async () => {
        renderFeed();
        await screen.findByText('DELIVERY_AGENCY_DEACTIVATED');

        expect(screen.getByLabelText('Action')).toHaveAttribute('maxlength', '100');
    });
});

describe('the feature flag', () => {
    /**
     * `AUDIT_LEGACY_FEED_DISABLED` is a 404 so the route can pretend not to
     * exist. Everywhere else on this service a 404 is the scope denial, so
     * handing it to the generic path would render "Not available to you" — which
     * would be actively misleading about a switched-off feed.
     */
    it('explains a switched-off feed rather than calling it a refusal', async () => {
        stubFetch(() => errorResponse(404, 'AUDIT_LEGACY_FEED_DISABLED', {
            message: 'The legacy admin-action feed is switched off',
            category: 'business_rule',
        }));

        renderWithProviders(<LegacyAuditFeed />, {
            route: '/dashboard/audit/legacy',
            auth: { admin: adminFixture({ tier: 1 }) },
            permissions: { held: heldFixture(1), tier: 1 },
        });

        expect(await screen.findByText(/the legacy feed is switched off/i)).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
        // Retrying a feature flag does nothing.
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
});
