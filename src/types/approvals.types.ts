/**
 * `/approvals` — the dual-control queue.
 *
 * The overview reads the pending queue; approving and rejecting are Phase 8.
 *
 * **Exactly three actions queue**, and quorum sits on the *irreversible*
 * direction only: promoting an administrator to tier 1, suspending or
 * reinstating a tier-1 administrator, and marking a payout ≥ 2 000 000 XAF as
 * paid. Rejecting a payout and demoting an administrator are never queued.
 *
 * **There is no `approvals.approve` permission, deliberately.** An approver must
 * hold the permission the pending action itself names, checked per request — a
 * single "may approve things" grant would let someone commit an action they
 * could not have performed themselves. So `approvals.read` gets you the queue
 * and says nothing about whether you may act on any row in it.
 */

export type ApprovalStatus =
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'withdrawn'
    | (string & {});

export interface Approval {
    /** 24-hex. Unlike session and challenge ids, an approval id is not a UUID. */
    id: string;
    /** The permission name of the queued action, e.g. `money.payouts.mark_paid`. */
    action: string;
    /**
     * One line written **for the approver** — *"Mark payout request 66a1… PAID —
     * XAF 3,400,000 to agency 665c…"*. Render it verbatim; it is the only field
     * that explains a row without a lookup table.
     */
    description: string;
    status: ApprovalStatus;
    requestedBy: string;
    requestedByTier: number;
    requestedByTierLabel: string;
    targetType: string;
    /** Whatever the queued action operates on — **not necessarily a Mongo id**. */
    targetId: string;
    /** The validated payload the action will be performed with. */
    payload: Record<string, unknown>;
    approverId: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    /**
     * Set when an approved action was then **refused on re-check** — the payout
     * was resolved while the request sat in the queue. Approval is not a promise
     * that the action succeeded.
     */
    failureReason: string | null;
    /** `createdAt` + 24 h by default. */
    expiresAt: string;
    createdAt: string;
}

/**
 * `GET /approvals` query parameters.
 *
 * `status` **defaults to `pending`** server-side — "what is waiting" is the
 * overwhelmingly common read. No `sort` is offered; the queue is newest first.
 */
export interface ApprovalListQuery {
    status?: ApprovalStatus;
    action?: string;
    /** Free-form; not validated as an ObjectId. */
    targetId?: string;
    page?: number;
    limit?: number;
}

/**
 * The body of `POST /approvals/:approvalId/approve` and `/reject`.
 *
 * `note` is optional to the schema and close to mandatory in practice: it is
 * *"the field a later audit review actually reads — an approval with no note is
 * a signature with no reason"*.
 */
export interface ApprovalDecisionBody {
    /** 1–500 characters, trimmed. */
    note?: string;
}

// ─── The codes this module owns ───────────────────────────────────────────────

/**
 * The `AUTHZ_APPROVAL_*` codes live here rather than in `api.types.ts`, which
 * says so in as many words: three of them are `409 / conflict` and one is
 * `404 / not_found`, so filing them beside the five 403s under
 * `AUTHORIZATION_CODES` would miscategorise them permanently.
 */

/** `404` — no such approval. */
export const CODE_APPROVAL_NOT_FOUND = 'AUTHZ_APPROVAL_NOT_FOUND';

/**
 * `403` — **you are the requester.** That is the entire point of four eyes, so
 * this is not a bug to work around; the UI should never offer Approve on your
 * own request in the first place.
 */
export const CODE_APPROVAL_SELF_APPROVAL = 'AUTHZ_APPROVAL_SELF_APPROVAL';

/** `409` — already approved, rejected or withdrawn. Reload rather than retry. */
export const CODE_APPROVAL_ALREADY_RESOLVED = 'AUTHZ_APPROVAL_ALREADY_RESOLVED';

/** `409` — past `expiresAt`. Re-submit the original action if it is still wanted. */
export const CODE_APPROVAL_EXPIRED = 'AUTHZ_APPROVAL_EXPIRED';

/** The two that mean "this row moved underneath you" — both want a reload, not a retry. */
export const APPROVAL_STALE_CODES: readonly string[] = [
    CODE_APPROVAL_ALREADY_RESOLVED,
    CODE_APPROVAL_EXPIRED,
];

/**
 * Which act a queued **payout** approval is a signature on — ADR-024.
 *
 * ⚠ **The approver is agreeing to one of two different things.** `gateway`
 * instructs the platform to move money now; `manual` records that a human
 * already moved it. The backend treats them as distinct — `mode` is hashed into
 * the approval's idempotency key, so a signature given for one cannot be spent on
 * the other — and an approver who cannot see which one they are signing has to
 * read the raw payload to find out.
 *
 * ⚠ **A narrowing, not a cast.** `payload` is `Record<string, unknown>`: the
 * DTO forwards the stored payload verbatim, so nothing guarantees the key is
 * there. An approval queued by an older build carries no `mode`, and every
 * caller drops its sentence rather than asserting one of the two.
 *
 * Lives here rather than in either screen that renders it, because both do — the
 * `202` notice on the payout screens and the approval card itself — and two
 * readings of one field are two things to keep in step.
 */
export function payoutApprovalMode(approval: Approval): 'gateway' | 'manual' | null {
    const mode = approval.payload?.mode;
    return mode === 'gateway' || mode === 'manual' ? mode : null;
}
