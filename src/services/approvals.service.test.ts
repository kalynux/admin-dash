import { describe, expect, it } from 'vitest';

import {
    approveApproval,
    getApproval,
    listApprovals,
    rejectApproval,
    withdrawApproval,
} from '@/services/approvals.service';
import { approvalFixture } from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

const ID = '66a0f31c8b2d4e5f60718293';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listApprovals', () => {
    it('sends status explicitly rather than leaning on the server default', async () => {
        const calls = stubFetch(() =>
            successResponse([approvalFixture()], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            }),
        );

        await listApprovals({ status: 'pending', action: 'administrators.tier.set', page: 2 });

        const query = queryOf(calls[0]);
        expect(query.get('status')).toBe('pending');
        expect(query.get('action')).toBe('administrators.tier.set');
        expect(query.get('page')).toBe('2');
    });

    it('preserves pages: 0 on an empty queue', async () => {
        stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));

        const page = await listApprovals();

        expect(page.meta.pages).toBe(0);
    });
});

describe('the decisions', () => {
    /**
     * None of these is `api.dualControl`. The queue is where dual control ends —
     * approving *performs* the action and answers 200, so a `queued` result here
     * would be meaningless.
     */
    it('approves with a note, at the documented path', async () => {
        const calls = stubFetch(() =>
            successResponse(approvalFixture({ status: 'approved', decisionNote: 'Checked' })),
        );

        const decided = await approveApproval(ID, { note: 'Checked' });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(`/approvals/${ID}/approve`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ note: 'Checked' });
        expect(decided.status).toBe('approved');
    });

    it('rejects at its own path', async () => {
        const calls = stubFetch(() => successResponse(approvalFixture({ status: 'rejected' })));

        await rejectApproval(ID, { note: 'Not this month' });

        expect(calls[0].url).toContain(`/approvals/${ID}/reject`);
    });

    it('withdraws with DELETE and no body', async () => {
        const calls = stubFetch(() => successResponse(approvalFixture({ status: 'withdrawn' })));

        await withdrawApproval(ID);

        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toContain(`/approvals/${ID}`);
        expect(calls[0].body).toBeUndefined();
    });

    it('reads one request by id', async () => {
        const calls = stubFetch(() => successResponse(approvalFixture()));

        await getApproval(ID);

        expect(calls[0].url).toContain(`/approvals/${ID}`);
    });
});

describe('the refusals a decision can meet', () => {
    it('types self-approval as an authorization refusal', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_APPROVAL_SELF_APPROVAL'));

        await expect(approveApproval(ID)).rejects.toMatchObject({
            code: 'AUTHZ_APPROVAL_SELF_APPROVAL',
            status: 403,
        });
    });

    it('types an already-resolved request as a conflict, not a fault', async () => {
        stubFetch(() => errorResponse(409, 'AUTHZ_APPROVAL_ALREADY_RESOLVED'));

        await expect(approveApproval(ID)).rejects.toMatchObject({
            code: 'AUTHZ_APPROVAL_ALREADY_RESOLVED',
            category: 'conflict',
        });
    });

    it('types an expired request as a conflict too', async () => {
        stubFetch(() => errorResponse(409, 'AUTHZ_APPROVAL_EXPIRED'));

        await expect(rejectApproval(ID)).rejects.toMatchObject({
            code: 'AUTHZ_APPROVAL_EXPIRED',
            category: 'conflict',
        });
    });

    /**
     * The precondition is re-checked at commit, so this arrives as a `200`
     * carrying `failureReason` — not as a rejected promise. Approval is not a
     * promise the action succeeded.
     */
    it('returns an approved-but-refused request as a success with a failureReason', async () => {
        stubFetch(() =>
            successResponse(
                approvalFixture({
                    status: 'approved',
                    failureReason: 'The payout was resolved while this was queued',
                }),
            ),
        );

        const decided = await approveApproval(ID);

        expect(decided.status).toBe('approved');
        expect(decided.failureReason).toContain('resolved while this was queued');
    });
});
