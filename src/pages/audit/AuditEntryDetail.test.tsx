import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { AuditEntryDetail } from '@/pages/audit/AuditEntryDetail';
import {
    auditEntryDetailFixture,
    truncatedAuditEntryFixture,
} from '@/test/audit-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';
import type { AuditEntryDetail as AuditEntryDetailRow } from '@/types/audit.types';

const ID = '66bc4f0a1d2e3f4a5b6c7d8e';

function renderDetail(row: Partial<AuditEntryDetailRow> = {}, tier: AdminTier = 1, id = ID) {
    stubFetch((call) => {
        if (call.url.includes('/audit/')) {
            return successResponse(auditEntryDetailFixture(row));
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/audit/:auditId" element={<AuditEntryDetail />} />
        </Routes>,
        {
            route: `/dashboard/audit/${id}`,
            auth: { admin: adminFixture({ tier }) },
            permissions: { held: heldFixture(tier), tier },
        },
    );
}

describe('the six things a row must identify', () => {
    it('names the actor and the level they held at the time', async () => {
        renderDetail();

        expect(await screen.findByText('Ada Nkemelu')).toBeInTheDocument();
        expect(screen.getByText('Tier 2')).toBeInTheDocument();
        // Not the level they hold now — the difference between a trail and a
        // directory lookup. The sentence is broken up by an emphasis element, so
        // it is matched on its own container.
        expect(screen.getByText(/not necessarily the level they hold now/i)).toBeInTheDocument();
    });

    it('names the action and its family', async () => {
        renderDetail();

        expect((await screen.findAllByText('money.payouts.mark_paid')).length).toBeGreaterThan(0);
        expect(screen.getByText('money')).toBeInTheDocument();
    });

    it('names the resource and its id', async () => {
        renderDetail();

        expect(await screen.findByText('PR-2026-004182')).toBeInTheDocument();
        expect(
            (await screen.findAllByText('66a1b2c3d4e5f60718293a4b')).length,
        ).toBeGreaterThan(0);
    });

    it('renders the timestamps, and says when an outcome never landed', async () => {
        renderDetail({ status: 'attempted', completedAt: null });

        expect(await screen.findByText(/the outcome never landed/i)).toBeInTheDocument();
        // Twice on purpose: the leading notice and the "Completed" field.
        expect(screen.getAllByText(/never landed/i).length).toBeGreaterThan(1);
    });

    it('prefers the platform’s own code on a delegated refusal', async () => {
        renderDetail({
            status: 'failed',
            outcome: {
                code: 'PLATFORM_OPERATION_REJECTED',
                statusCode: 409,
                message: 'The platform refused this',
                denialKind: null,
                requiredPermissions: [],
                platformCode: 'SHIPMENT_STATUS_CONFLICT',
            },
        });

        // Every delegated refusal answers the same `error.code`; the platform code
        // is the only handle on *why*.
        expect(await screen.findByText('SHIPMENT_STATUS_CONFLICT')).toBeInTheDocument();
    });

    it('names the permissions a denial would have needed', async () => {
        renderDetail({
            status: 'denied',
            outcome: {
                code: 'AUTHZ_PERMISSION_DENIED',
                statusCode: 403,
                message: null,
                denialKind: 'permission',
                requiredPermissions: ['money.payouts.mark_paid'],
                platformCode: null,
            },
        });

        expect(await screen.findByText(/would have needed/i)).toBeInTheDocument();
        // Several times over: the page subtitle, the Action field, and the
        // permission the denial names — the last is the one under test.
        expect(screen.getAllByText('money.payouts.mark_paid').length).toBeGreaterThan(1);
    });

    it('renders the request context', async () => {
        renderDetail();

        expect(await screen.findByText(/102\.244\.18\.7/)).toBeInTheDocument();
        expect(
            screen.getByText('8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d'),
        ).toBeInTheDocument();
    });

    /**
     * The values an operator carries off this screen — into a Mongo query, a
     * ticket, a colleague's chat window. Named individually rather than counted,
     * because the accessible name is the whole point: a row with six copy
     * buttons all called "Copy" tells a screen-reader user nothing.
     *
     * ⚠ Whole, not shortened. Every one of these renders in full today and the
     * assertions say so — the address especially, which is not an address once
     * it has lost its middle.
     */
    it('offers each value on the row for copying, under its own name', async () => {
        renderDetail();

        expect(
            await screen.findByRole('button', { name: 'Copy session ID' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy request ID' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy request IP' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy resource ID' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy actor email' })).toBeInTheDocument();

        expect(screen.getByText('0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a')).toBeInTheDocument();
        expect(screen.getByText('102.244.18.7')).toBeInTheDocument();
    });

    /**
     * The action name, the error code and the metadata dump are vocabulary and
     * dumps, not values. Sweeping them in would have put a copy button beside
     * every mono span on the screen.
     */
    it('does not offer one for the action name or the recorded state', async () => {
        renderDetail();

        await screen.findByRole('button', { name: 'Copy request ID' });

        expect(screen.queryByRole('button', { name: /copy action/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /copy payload/i })).not.toBeInTheDocument();
    });
});

describe('safe metadata', () => {
    it('renders the recorded before and after', async () => {
        renderDetail();

        expect(await screen.findByText(/"tier": 3/)).toBeInTheDocument();
        // Twice: the payload asked for tier 2 and the after-state records it.
        expect(screen.getAllByText(/"tier": 2/).length).toBeGreaterThan(0);
    });

    /**
     * The load-bearing one. The service strips credential-shaped fields before
     * storing them; this asserts the dashboard would not print one even if a
     * server regression let it through.
     */
    it('never prints a credential-shaped value, and says it hid one', async () => {
        renderDetail({
            payload: { email: 'ada@wimall.cm', newPassword: 'hunter2', apiKey: 'sk-live-1' },
        });

        await screen.findByText(/request payload/i);

        expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
        expect(screen.queryByText(/sk-live-1/)).not.toBeInTheDocument();
        // Hidden, not silently dropped — a blank reads as a rendering bug.
        expect(screen.getByText(/2 fields were hidden by this dashboard/i)).toBeInTheDocument();
        // The value it had no reason to hide is still there. (Also the actor's
        // own email field, hence `getAllByText`.)
        expect(screen.getAllByText(/ada@wimall\.cm/).length).toBeGreaterThan(0);
    });

    /**
     * When the writer caps an oversized value it **replaces** it with
     * `{ truncated, bytes, keys }`. Rendering that as JSON would put a three-key
     * object in front of an operator as though it were the request body.
     */
    it('explains a truncated value instead of rendering the summary as a payload', async () => {
        renderDetail(truncatedAuditEntryFixture());

        expect(await screen.findByText(/too large to store/i)).toBeInTheDocument();
        expect(screen.getByText(/never written to the trail/i)).toBeInTheDocument();
        // The key names survive, because knowing which fields changed is most of
        // the forensic value.
        expect(screen.getByText(/tier, status, reason/)).toBeInTheDocument();
    });

    it('says why a block is absent rather than leaving it blank', async () => {
        renderDetail({ payload: null, before: null, after: null });

        expect(await screen.findByText(/carried no request body/i)).toBeInTheDocument();
    });
});

describe('the joins', () => {
    it('links to the other rows from the same request', async () => {
        renderDetail();

        const link = await screen.findByRole('link', { name: /other rows recorded/i });
        expect(link).toHaveAttribute(
            'href',
            '/dashboard/audit?correlationId=8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
        );
    });

    it('links a four-eyes row to the approval that committed it', async () => {
        renderDetail({ viaApprovalId: '66a0f31c8b2d4e5f60718293' });

        const link = await screen.findByRole('link', { name: /committed through four eyes/i });
        expect(link).toHaveAttribute('href', '/dashboard/approvals/66a0f31c8b2d4e5f60718293');
    });

    it('links the resource to the module that owns it', async () => {
        renderDetail();

        const link = await screen.findByRole('link', { name: 'PR-2026-004182' });
        expect(link).toHaveAttribute(
            'href',
            '/dashboard/money/payouts/66a1b2c3d4e5f60718293a4b',
        );
    });

    /**
     * A link a caller cannot follow would land them on a refusal — and the *set*
     * of such links would itself describe the directory the audit scope withholds.
     */
    it('withholds the link, not the id, from a caller without the module’s permission', async () => {
        renderDetail({}, 3);

        expect(await screen.findByText('PR-2026-004182')).toBeInTheDocument();
        expect(
            screen.queryByRole('link', { name: 'PR-2026-004182' }),
        ).not.toBeInTheDocument();
    });

    /**
     * The name slot falls through to the raw id when the row carries no label —
     * on `relatedTarget` there is no other render of it anywhere on the screen.
     * It has to keep the navigation *and* gain the copy affordance; a copy that
     * navigated instead would be worse than no copy at all.
     */
    it('keeps the link and adds a copy button when the target has no name', async () => {
        renderDetail({
            target: {
                type: 'payout',
                id: '66a1b2c3d4e5f60718293a4b',
                label: null,
                subjectClass: 'platform_record',
            },
        });

        const link = await screen.findByRole('link', { name: /66a1b2/ });
        expect(link).toHaveAttribute('href', '/dashboard/money/payouts/66a1b2c3d4e5f60718293a4b');
        expect(screen.getAllByRole('button', { name: 'Copy record ID' })).not.toHaveLength(0);
    });

    it('does not link a target type this dashboard has no screen for', async () => {
        renderDetail({
            target: { type: 'ticket', id: '66a1b2c3d4e5f60718293a4b', label: 'TCK-1', subjectClass: 'platform_record' },
        });

        expect(await screen.findByText('TCK-1')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'TCK-1' })).not.toBeInTheDocument();
    });
});

describe('states', () => {
    /**
     * `AUDIT_ENTRY_NOT_FOUND` is *also* the out-of-scope denial: a 403 on an id
     * would confirm the id exists. So it must read as a refusal, not as a fault,
     * and must not offer a retry that cannot succeed.
     */
    it('renders a scoped 404 as a refusal with no retry', async () => {
        stubFetch(() => errorResponse(404, 'AUDIT_ENTRY_NOT_FOUND'));

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/audit/:auditId" element={<AuditEntryDetail />} />
            </Routes>,
            {
                route: `/dashboard/audit/${ID}`,
                auth: { admin: adminFixture({ tier: 3 }) },
                permissions: { held: heldFixture(3), tier: 3 },
            },
        );

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('refuses a malformed id without issuing a request', async () => {
        const calls = stubFetch(() => successResponse(auditEntryDetailFixture()));

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/audit/:auditId" element={<AuditEntryDetail />} />
            </Routes>,
            {
                route: '/dashboard/audit/not-an-id',
                auth: { admin: adminFixture() },
            },
        );

        expect(await screen.findByText(/not a valid audit entry id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});
