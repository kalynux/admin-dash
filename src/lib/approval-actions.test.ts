import { describe, expect, it } from 'vitest';

import { approvalAffordances } from '@/lib/approval-actions';
import { approvalFixture } from '@/test/fixtures';
import type { Approval, ApprovalStatus } from '@/types/approvals.types';

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SOMEBODY_ELSE = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACTION = 'administrators.tier.set';

function row(overrides: Partial<Approval> = {}): Approval {
    return approvalFixture({ action: ACTION, requestedBy: SOMEBODY_ELSE, ...overrides });
}

const holding = new Set([ACTION]);
const holdingNothing = new Set<string>();

describe('approvalAffordances', () => {
    it('offers every decision to nobody who holds nothing', () => {
        const can = approvalAffordances(row(), holdingNothing, ME);

        expect(can).toEqual({
            canApprove: false,
            canReject: false,
            canWithdraw: false,
            isOwnRequest: false,
        });
    });

    it('offers approve and reject to a holder who did not request it', () => {
        const can = approvalAffordances(row(), holding, ME);

        expect(can.canApprove).toBe(true);
        expect(can.canReject).toBe(true);
        expect(can.canWithdraw).toBe(false);
    });

    /*
     * The whole point of four eyes. The server answers
     * 403 AUTHZ_APPROVAL_SELF_APPROVAL; not offering it is the honest UI.
     */
    it('never offers approve on your own request, even holding the permission', () => {
        const can = approvalAffordances(row({ requestedBy: ME }), holding, ME);

        expect(can.canApprove).toBe(false);
        expect(can.isOwnRequest).toBe(true);
    });

    it('still offers reject and withdraw on your own request', () => {
        const can = approvalAffordances(row({ requestedBy: ME }), holding, ME);

        expect(can.canReject).toBe(true);
        expect(can.canWithdraw).toBe(true);
    });

    /** Rejecting is permitted to the requester even without the action's permission. */
    it('offers the requester reject and withdraw without the permission', () => {
        const can = approvalAffordances(row({ requestedBy: ME }), holdingNothing, ME);

        expect(can.canApprove).toBe(false);
        expect(can.canReject).toBe(true);
        expect(can.canWithdraw).toBe(true);
    });

    it('offers nothing on a row that is no longer pending', () => {
        const resolved: ApprovalStatus[] = ['approved', 'rejected', 'expired', 'withdrawn'];

        for (const status of resolved) {
            const can = approvalAffordances(row({ status, requestedBy: ME }), holding, ME);

            expect(can.canApprove, status).toBe(false);
            expect(can.canReject, status).toBe(false);
            expect(can.canWithdraw, status).toBe(false);
        }
    });

    /**
     * A queueable action this build has never heard of must still be approvable
     * by somebody whose permission set names it — the held set is `string`s for
     * exactly this reason.
     */
    it('checks the action name as a plain string, not against a known catalogue', () => {
        const unknown = 'something.nobody.shipped_yet';
        const can = approvalAffordances(row({ action: unknown }), new Set([unknown]), ME);

        expect(can.canApprove).toBe(true);
    });

    /**
     * The client clock is not the authority — `409 AUTHZ_APPROVAL_EXPIRED` is.
     * A past `expiresAt` warns; it does not withdraw the affordance.
     */
    it('ignores expiresAt entirely', () => {
        const can = approvalAffordances(
            row({ expiresAt: '2020-01-01T00:00:00.000Z' }),
            holding,
            ME,
        );

        expect(can.canApprove).toBe(true);
    });
});
