/**
 * The pre-screen stamp, shared by payouts and COD — ADR-024.
 *
 * One wire shape, defined once. `toPayoutListItemDto`, `toRemittanceDto` and
 * `toDepositDto` all emit the identical object, because it is the same review
 * step recorded against three different kinds of record.
 *
 * ── ⛔ What it is not ────────────────────────────────────────────────────────
 * **A precondition.** Endorsement is advisory on every surface it appears on: a
 * payout nobody has endorsed is exactly as payable as one that has been
 * (ADR-024 D-2), and an un-endorsed remittance is exactly as confirmable. The
 * pre-screen exists to save the approving administrator work, not to gate them —
 * an empty Support queue must never stall payments or settlements. **No control
 * on this dashboard may key its enabled-ness on a `null` here.**
 *
 * **A state.** Endorsement is a FIELD beside the status, never a value of it
 * (D-6). An endorsed payout is still `pending`; an endorsed remittance is still
 * `declared`. Three things key on those statuses and all three break if a new one
 * is invented — which is also what makes the advisory rule true by construction.
 *
 * **Half a decision.** There is no `rejected` verdict and there must be no
 * "recommend rejection" flow: a reviewer who rejects calls the ordinary reject
 * endpoint, which they reach because it takes the triage permission as an
 * alternative. Their rejection is terminal, and terminal outcomes are statuses.
 * Storing a rejected verdict beside a rejected status would be two fields free to
 * disagree about whether a request is closed (D-1).
 */
export interface TriageStamp {
    /**
     * `endorsed`, and there is no second value today.
     *
     * Read as a bounded string like every other vocabulary on this wire — the
     * absence of a sibling is a decision rather than a gap waiting to be filled,
     * but that is the backend's decision to revisit, not a reason for a closed
     * union here.
     */
    verdict: string;
    note: string | null;
    /**
     * Who vouched.
     *
     * Both members are nullable because the mapper defaults each one: a row whose
     * administrator name never resolved still renders rather than throwing.
     */
    by: { id: string | null; name: string | null };
    at: string | null;
}
