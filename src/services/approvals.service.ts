/**
 * `/approvals` — the dual-control queue.
 *
 * Source: `docs/admin/api/authorization.md`.
 *
 * ── Approving performs the action ─────────────────────────────────────────────
 * A `200` from `/approve` means the promotion **happened**, the payout **was**
 * marked paid — not that either was scheduled. Nothing here is `api.dualControl`:
 * the queue is where dual control ends, so these answer `200` or they fail.
 *
 * ── The permission is dynamic, and there is no `approvals.approve` ────────────
 * The approver must hold the permission the *pending action* names, checked per
 * request. A single "may approve things" grant would let someone commit an
 * action they could not have performed themselves, which turns four eyes from a
 * second signature into an escalation path. So `approvals.read` gets you the
 * queue and says **nothing** about whether you may act on any row in it —
 * `Approval.action` is the permission name to check, and it is a wire string,
 * not a `RoutedPermissionName`.
 *
 * ── The precondition is re-checked at commit ──────────────────────────────────
 * An approval may sit for 24 hours. The queued action's precondition is
 * evaluated **again** when it is approved, so a payout resolved in the meantime
 * is refused rather than paid twice. When that happens the approval is
 * `approved` **and** carries a `failureReason` — approval is not a promise that
 * the action succeeded.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Approval, ApprovalDecisionBody, ApprovalListQuery } from '@/types/approvals.types';
import type { PaginationMeta } from '@/types/api.types';

export interface ApprovalPage {
    data: Approval[];
    meta: PaginationMeta;
}

/**
 * `GET /approvals` · `approvals.read`.
 *
 * **`status` defaults to `pending` server-side**, which the docs call out as
 * what "keeps the dashboard's polling call trivial". The overview sends it
 * explicitly anyway, so the request says what it means and a later change to the
 * default cannot silently repoint the tile at every approval ever made.
 *
 * No `sort` is offered — the queue is newest first.
 */
export async function listApprovals(
    query: ApprovalListQuery = {},
    options?: RequestOptions,
): Promise<ApprovalPage> {
    const page = await api.list<Approval>(withQuery('/approvals', { ...query }), options);

    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
        },
    };
}

const base = (approvalId: string) => `/approvals/${encodeURIComponent(approvalId)}`;

/**
 * `GET /approvals/:approvalId` · `approvals.read`.
 *
 * `400 VALIDATION_ERROR` on a malformed id (24-hex — unlike session and
 * challenge ids, an approval id is not a UUID), `404 AUTHZ_APPROVAL_NOT_FOUND`.
 */
export function getApproval(approvalId: string, options?: RequestOptions): Promise<Approval> {
    return api.get<Approval>(base(approvalId), options);
}

/**
 * `POST /approvals/:approvalId/approve` · **dynamic permission**.
 *
 * **This performs the queued action.** The response is the approval, now
 * `approved` — but check `failureReason` before reporting success, because the
 * re-checked precondition can refuse the action after the signature lands.
 *
 * Refusals worth branching on: `403 AUTHZ_APPROVAL_SELF_APPROVAL` (you are the
 * requester — the UI should not have offered this), `403 AUTHZ_PERMISSION_DENIED`
 * (you do not hold the permission the pending action names),
 * `409 AUTHZ_APPROVAL_ALREADY_RESOLVED` and `409 AUTHZ_APPROVAL_EXPIRED` (the
 * row moved underneath you — reload, do not retry).
 */
export function approveApproval(
    approvalId: string,
    body: ApprovalDecisionBody = {},
    options?: RequestOptions,
): Promise<Approval> {
    return api.post<Approval>(`${base(approvalId)}/approve`, body, options);
}

/**
 * `POST /approvals/:approvalId/reject` · **dynamic permission, or the requester**.
 *
 * Rejecting is **never itself queued** — that direction is reversible, and a
 * quorum belongs on the irreversible one. The requester may reject their own
 * request, which is why this is offered where `approve` is not.
 */
export function rejectApproval(
    approvalId: string,
    body: ApprovalDecisionBody = {},
    options?: RequestOptions,
): Promise<Approval> {
    return api.post<Approval>(`${base(approvalId)}/reject`, body, options);
}

/**
 * `DELETE /approvals/:approvalId` · *self* — the requester takes their own
 * request back.
 *
 * Scoped to the caller's **own** requests; withdrawing someone else's is not
 * possible and answers `403 AUTHZ_PERMISSION_DENIED`. No body.
 */
export function withdrawApproval(approvalId: string, options?: RequestOptions): Promise<Approval> {
    return api.delete<Approval>(base(approvalId), undefined, options);
}
