import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ApprovalDetail } from '@/pages/approvals/ApprovalDetail';
import { adminFixture, approvalFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Approval } from '@/types/approvals.types';

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SOMEBODY_ELSE = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ID = '66a0f31c8b2d4e5f60718293';
const ACTION = 'administrators.tier.set';

function renderDetail(
    overrides: Partial<Approval> = {},
    held: ReadonlySet<string> = new Set([ACTION]),
) {
    const approval = approvalFixture({
        id: ID,
        action: ACTION,
        requestedBy: SOMEBODY_ELSE,
        description: 'Promote 665f1c2a9b3e4a91c7d2e5f0 to Developer',
        ...overrides,
    });

    stubFetch(() => successResponse(approval));

    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/approvals/:approvalId" element={<ApprovalDetail />} />
        </Routes>,
        {
            route: `/dashboard/approvals/${ID}`,
            auth: { admin: adminFixture({ id: ME, tier: 1 }) },
            permissions: { held },
        },
    );
}

describe('the decisions on offer', () => {
    it('offers approve and reject to a holder who did not request it', async () => {
        renderDetail();

        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    });

    /** The entire point of four eyes, and the server answers 403 if forced. */
    it('never offers approve on your own request, and says why', async () => {
        renderDetail({ requestedBy: ME });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/you requested this, so you cannot approve it/i)).toBeInTheDocument();
    });

    it('still offers reject and withdraw on your own request', async () => {
        renderDetail({ requestedBy: ME });

        expect(await screen.findByRole('button', { name: /^reject$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /withdraw/i })).toBeInTheDocument();
    });

    /**
     * There is deliberately no `approvals.approve`. The approver must hold the
     * permission the *pending action* names, so the absence is explained rather
     * than left as a gap that reads like a bug.
     */
    it('names the permission a decision needs when the caller lacks it', async () => {
        renderDetail({}, new Set(['approvals.read']));

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/no general "may approve" permission/i)).toBeInTheDocument();
    });

    it('offers nothing on a request that is already decided', async () => {
        renderDetail({ status: 'approved', requestedBy: ME });

        await screen.findByRole('heading', { level: 1 });

        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    });

    /**
     * A client clock is not the authority — `409 AUTHZ_APPROVAL_EXPIRED` is. The
     * expiry warns; it never withdraws the affordance.
     */
    it('keeps the buttons live past expiresAt', async () => {
        renderDetail({ expiresAt: '2020-01-01T00:00:00.000Z' });

        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    });
});

describe('what the screen has to be honest about', () => {
    /** Approval is not a promise the action succeeded. */
    it('leads with a failureReason on an approved-but-refused request', async () => {
        renderDetail({
            status: 'approved',
            failureReason: 'The payout was resolved while this was queued',
        });

        expect(await screen.findByText(/approved, but the action was refused/i)).toBeInTheDocument();
        expect(screen.getByText(/resolved while this was queued/i)).toBeInTheDocument();
    });

    it('renders the description verbatim', async () => {
        renderDetail();

        expect(
            await screen.findByText('Promote 665f1c2a9b3e4a91c7d2e5f0 to Developer'),
        ).toBeInTheDocument();
    });

    it('shows the payload the action will run with', async () => {
        renderDetail({ payload: { adminId: '665f1c2a9b3e4a91c7d2e5f0', tier: 1 } });

        await screen.findByText(/what will be performed/i);

        expect(screen.getByText(/"tier": 1/)).toBeInTheDocument();
    });

    it('refuses a malformed id without firing a request', async () => {
        const calls = stubFetch(() => successResponse(approvalFixture()));

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/approvals/:approvalId" element={<ApprovalDetail />} />
            </Routes>,
            { route: '/dashboard/approvals/nope' },
        );

        expect(await screen.findByText(/24 hexadecimal characters/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

describe('the approve dialog', () => {
    it('says plainly that approving performs the action now', async () => {
        renderDetail();

        await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));

        expect(await screen.findByText(/approving performs the action now/i)).toBeInTheDocument();
        expect(screen.getByText(/a signature with no reason/i)).toBeInTheDocument();
    });
});
