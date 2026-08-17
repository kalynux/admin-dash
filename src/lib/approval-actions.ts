/**
 * Which of the three decisions to offer on one approval row.
 *
 * Pure, like `authorization.ts` and `admin-escalation.ts` beside it, and an
 * **affordance hint in exactly the same sense**: the server decides, per
 * request, and every one of these can still be refused. Hiding Approve on your
 * own request saves a `403 AUTHZ_APPROVAL_SELF_APPROVAL` that would have been
 * correct; it does not make the rule true.
 *
 * ── Seeing the queue is not being able to act on it ───────────────────────────
 * **There is no `approvals.approve` permission, deliberately.** The approver
 * must hold the permission the *pending action* itself names — a single "may
 * approve things" grant would let someone commit an action they could not have
 * performed themselves, which turns four eyes from a second signature into an
 * escalation path. So `approvals.read` gets you the list and says nothing about
 * any row in it, and the check below is against `approval.action`.
 *
 * ── Why `action` is a plain string ────────────────────────────────────────────
 * `HeldPermissions` is a `ReadonlySet<string>` precisely so a name this build
 * has never heard of can still be looked up. `approval.action` is a wire value;
 * casting it to `RoutedPermissionName` would be claiming knowledge we do not
 * have, and a queueable action added by a routine deploy would then be
 * un-approvable from this dashboard until it shipped again.
 *
 * ── Expiry does not appear here ───────────────────────────────────────────────
 * `expiresAt` is deliberately not consulted. A client clock is not the
 * authority, and `409 AUTHZ_APPROVAL_EXPIRED` is — the same reason the payout
 * dialogs warn about the dual-control threshold without ever disabling the
 * button. Show the expiry as a warning; let the server refuse.
 */

import { hasPermission, type HeldPermissions } from '@/lib/authorization';
import type { Approval } from '@/types/approvals.types';

export interface ApprovalAffordances {
    /**
     * **Approving performs the action.** Offered only to somebody who is not the
     * requester and who holds the permission the queued action names.
     */
    canApprove: boolean;
    /**
     * Rejecting is never itself queued — that direction is reversible. Permitted
     * to a holder of the action's permission **or** to the requester.
     */
    canReject: boolean;
    /** Withdrawing is the requester's alone. */
    canWithdraw: boolean;
    /**
     * True when the only reason Approve is missing is that you asked for it.
     *
     * Worth distinguishing so the UI can say *"you requested this — that is the
     * entire point"* rather than silently omitting the control, which reads as a
     * missing permission.
     */
    isOwnRequest: boolean;
}

/**
 * @param approval the row.
 * @param held the caller's permission set, from `GET /permissions/me`.
 * @param adminId the caller's own id.
 */
export function approvalAffordances(
    approval: Approval,
    held: HeldPermissions,
    adminId: string,
): ApprovalAffordances {
    const isOwnRequest = approval.requestedBy === adminId;
    // Every decision is a write against a row that has not been decided yet.
    // A resolved or expired row answers 409 whatever you hold.
    const isPending = approval.status === 'pending';
    const holdsActionPermission = hasPermission(held, approval.action);

    return {
        canApprove: isPending && holdsActionPermission && !isOwnRequest,
        canReject: isPending && (holdsActionPermission || isOwnRequest),
        canWithdraw: isPending && isOwnRequest,
        isOwnRequest,
    };
}
