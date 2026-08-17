import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApprovalsList } from '@/pages/approvals/ApprovalsList';
import { adminFixture, approvalFixture, heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

/**
 * The four-eyes queue, and the sharpest example of the read-only complaint:
 * approve and reject already existed one click away on the detail screen, and
 * the queue rendered the same verdict as two **inert badges** — telling an
 * operator they could approve, then making them open the row to do it.
 *
 * The verdict itself is unchanged. `approvalAffordances` is the same function
 * the detail screen asks, over the same held set, so the two cannot disagree
 * about what is offered; only the affordance is different.
 */

/** The requester on the fixture. An approver must be somebody else. */
const REQUESTER = '665f1c2a9b3e4a91c7d2e5f0';
const OTHER_ADMIN = '665f1c2a9b3e4a91c7d2e5ff';

const META = { total: 1, page: 1, limit: 20, pages: 1 };

function stubList(rows = [approvalFixture()]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/approvals')) return successResponse(rows, { meta: META });
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function queue({ adminId = OTHER_ADMIN, held = heldFixture(1) } = {}) {
    return renderWithProviders(<ApprovalsList />, {
        route: '/dashboard/approvals',
        auth: {
            status: 'authenticated',
            admin: adminFixture({ id: adminId, timezone: 'Africa/Douala' }),
        },
        permissions: { held },
    });
}

describe('row actions', () => {
    it('offers the decision to an administrator who may make it', async () => {
        stubList();

        queue();

        expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('refuses to let the requester approve their own request', async () => {
        /*
         * The escalation rule the whole mechanism exists for. Rendering the
         * button and letting the server refuse would make four eyes look like a
         * formality.
         */
        stubList();

        queue({ adminId: REQUESTER });

        expect(await screen.findByText('Your own request')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('offers nothing to somebody who does not hold the pending action’s permission', async () => {
        /*
         * There is deliberately no `approvals.approve`: an approver must hold the
         * permission the *pending action* names, or a single "may approve things"
         * grant would let somebody commit an action they could not perform
         * themselves. Tier 3 holds no financial permission.
         */
        stubList();

        queue({ held: heldFixture(3) });

        await screen.findByText(/mark payout request/i);
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers nothing on a request that is no longer pending', async () => {
        stubList([
            approvalFixture({
                status: 'approved',
                approverId: OTHER_ADMIN,
                decidedAt: '2026-08-14T10:00:00.000Z',
            }),
        ]);

        queue();

        await screen.findByText(/mark payout request/i);
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('opens the approve dialog on the row it was pressed for', async () => {
        stubList();

        queue();

        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(/approve and perform/i);
    });

    it('still links the row through to its detail screen', async () => {
        // Acting from the queue is the addition, not the replacement — the
        // description is written for the approver and the detail carries the
        // payload behind it.
        stubList();

        queue();

        expect(await screen.findByRole('link', { name: /mark payout request/i })).toHaveAttribute(
            'href',
            '/dashboard/approvals/66a0f31c8b2d4e5f60718293',
        );
    });
});
