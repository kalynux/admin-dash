/**
 * Delegated refusals, keyed on `details.platformCode`.
 *
 * When wi-admin forwards a jovi-mall refusal it answers
 * `PLATFORM_OPERATION_REJECTED` at the platform's original status, and
 * `details.platformCode` is **the only handle on why**. jovi-mall's registry is
 * ~541 codes and wi-admin passes them through unmapped; only **seven** are
 * published on the admin surface. The rest of these were read from
 * `backend/jovi-mall` source across phases 6–11.
 *
 * ── Where this copy came from ─────────────────────────────────────────────────
 * Most sentences were written in the phase that built the screen and are moved
 * here verbatim, not rewritten. Several are load-bearing in ways that are not
 * obvious from the code name, and the notes below are the reason each survived
 * review:
 *
 * - `SHIPMENT_NO_ELIGIBLE_AGENTS` is a **partial success, not a refusal**. By
 *   the time it throws, the previous agent has been detached, the session
 *   deleted and capacity recomputed — the shipment is now unassigned. Copy that
 *   says "nothing happened" is the bug.
 * - `COD_DEPOSIT_*` copy is the dashboard's own. jovi-mall sends a
 *   `details.hint` written for the **agent's** dashboard ("hand it to your
 *   agency instead"); rendered to an administrator it addresses the wrong
 *   person about the wrong screen. The figures beside it are unambiguous, so
 *   these sentences use those. Do not "simplify" this into showing `hint`.
 * - `COD_DEPOSIT_WRONG_RECIPIENT` is a **403 no permission can fix** — only the
 *   party the cash was handed to may confirm, and `agency` is the normal route.
 *   The affordance is withheld up front; this copy is for the race.
 * - Agencies use a `DELIVERY_` prefix, so a branch on
 *   `AGENCY_VERIFICATION_CONFLICT` never fires.
 *
 * A code absent from this map is not a failure: `resolveErrorMessage` falls
 * through to jovi-mall's own sentence, which is English but specific, and warns
 * once in development naming the code to add.
 */

const platform = {
    // ─── Identity verification ────────────────────────────────────────────────
    /*
      ⚠ **An absence, not a fault, and the copy has to say so.** It means "no such
      party, **or** an account in a state that has no verification record" — and
      the second is the ordinary case, because most accounts never start one.
      Worded for the second.
    */
    KYC_SUBJECT_NOT_FOUND: 'This account has no verification record',

    // ─── Shipments ────────────────────────────────────────────────────────────
    SHIPMENT_STATUS_CONFLICT: 'The shipment moved while this was open',
    SHIPMENT_NOT_FOUND: 'The platform has no such shipment',
    SHIPMENT_REASSIGN_SAME_AGENT: 'That is the agent already carrying this shipment.',
    SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT:
        'This shipment is past pickup, so the platform will not pick an agent for it. Choose one.',
    SHIPMENT_NOT_REASSIGNABLE:
        'No agent is bound to this shipment, so there is nothing to reassign from. Cancel it instead, or wait for the offer to be accepted.',
    SHIPMENT_REASSIGNMENT_NOT_ALLOWED: 'This shipment cannot be reassigned in its current state.',
    SHIPMENT_REASSIGNMENT_CONFLICT: 'The shipment moved while this was open',
    SHIPMENT_NO_ELIGIBLE_AGENTS: 'No replacement is available',
    SHIPMENT_REJECTION_NOT_ALLOWED: 'This shipment cannot be cancelled in its current state.',
    AGENT_NOT_ELIGIBLE_FOR_ASSIGNMENT: 'The platform will not dispatch to that agent right now.',

    // ─── Orders and refunds ──────────────────────────────────────────────────
    ORDER_ALREADY_CANCELLED: 'This order is already cancelled.',
    ORDER_CANCEL_REQUIRES_REFUND:
        'This order has been paid. Refund it first, then cancel — the money and the fulfilment are two separate acts, deliberately.',
    ORDER_NOT_CANCELLABLE: 'The platform refuses to cancel this order in its current state.',
    ORDER_DISPUTE_NOT_ACTIVE:
        'This order has no open dispute to resolve. Another administrator may have resolved it already.',
    ORDER_WRONG_TYPE: 'A digital order has nothing to dispatch.',
    ORDER_PAYMENT_REQUIRED:
        'The platform dispatches an unpaid order only when it is cash on delivery.',
    ORDER_DISPUTE_HOLD: 'This order is frozen by a payment dispute. Resolve the dispute first.',
    REFUND_POLICY_OVERRIDE_REQUIRED:
        'This refund crosses the vendor’s policy. Override it deliberately, or decline.',
    REFUND_AMOUNT_EXCEEDS_MAX:
        'That is more than is left to refund. This is a money invariant — no override waives it.',
    REFUND_ORDER_IS_COD:
        'This is a cash-on-delivery order. The money never went through a gateway, so there is nothing here to reverse.',
    REFUND_ORDER_NOT_PAID: 'This order was never paid, so there is nothing to refund.',
    REFUND_GATEWAY_NOT_SUPPORTED:
        'This order’s payment gateway has no refund API. That is an expected outcome, not a fault — only Stripe implements one today.',
    REFUND_GATEWAY_FAILED:
        'The payment gateway refused the refund. Nothing was taken from the vendor; check the gateway before retrying.',
    REFUND_ALREADY_FULLY_REFUNDED: 'This order has already been fully refunded.',

    // ─── Cash on delivery ────────────────────────────────────────────────────
    COD_DEPOSIT_INVALID_AMOUNT: 'The platform refused the amount',
    COD_DEPOSIT_EXCEEDS_BALANCE: 'That is more cash than the agent is holding',
    COD_DEPOSIT_AGENCY_ALREADY_SETTLED: 'The platform is no longer owed this',
    COD_DEPOSIT_WRONG_RECIPIENT:
        'This cash was handed to the agency, so only the agency can confirm it. No permission changes that.',
    COD_DEPOSIT_ALREADY_RESOLVED: 'This deposit has already been settled.',
    COD_REMITTANCE_ALREADY_RESOLVED: 'This remittance has already been settled.',
    COD_DISCREPANCY_ALREADY_RESOLVED: 'This discrepancy has already been resolved.',
    CONTRACT_SETTLEMENT_EXCEEDS_OUTSTANDING: 'This agency is not owed that much',

    // ─── Agents and contracts ────────────────────────────────────────────────
    AGENT_NOT_FOUND: 'The platform has no such agent.',
    AGENT_KYC_NOT_VERIFIED: 'This agent’s identity has not been verified yet.',
    AGENT_PLATFORM_BANNED: 'This agent is banned platform-wide.',
    // Raised by the pin AND by the release since 2026-09-21 — a release is refused
    // when the plan's value is below what the contracts hold — so the sentence
    // names the resulting pool rather than "that figure".
    AGENT_COD_THRESHOLD_BELOW_ALLOCATED:
        'The COD pool would fall below what this agent’s contracts already hold. Lower the contract slices first.',
    AGENT_COD_THRESHOLD_OUT_OF_BOUNDS: 'The platform refused that figure as out of bounds.',
    AGENT_COD_POOL_CONFLICT:
        'The agent’s COD pool changed while this was being saved. Reload it and try again — nothing was changed.',
    AGENT_MEMBERSHIP_ALREADY_EXISTS: 'This agent already holds a contract with that agency.',
    AGENT_MEMBERSHIP_NOT_FOUND: 'These two are not working together',
    CONTRACT_NOT_FOUND: 'The platform has no such contract.',
    CONTRACT_INVALID_TRANSITION: 'The contract cannot move to that state from where it is.',
    // The three administrative interventions are chosen to be ones the agency
    // holds unilaterally, so this is a platform-side guard rather than something
    // an operator can talk their way past — it is not a missing permission.
    //
    // ⚠ Kept for the record, and unreachable: this one is forwarded at 403, and
    // the `authorization` allowlist drops `platformCode`. Nothing can key on
    // it — the dialogs branch on the status and render the server's sentence.
    CONTRACT_TRANSITION_NOT_PERMITTED:
        'The platform does not allow this party to make that change, whatever permission you hold here.',
    // ⚠ `CONTRACT_STATUS_REQUEST_…`. The shorter `CONTRACT_REQUEST_…` was a
    // name this dashboard invented; jovi-mall has never declared it.
    CONTRACT_STATUS_REQUEST_ALREADY_PENDING:
        'A request is already open on this contract. It has to be answered before another can be raised.',
    CONTRACT_HAS_OUTSTANDING_COD:
        'The agent still owes this agency cash. It has to be settled before they can be moved.',
    CONTRACT_HAS_UNPAID_EARNINGS:
        'This agency still owes the agent earnings. They have to be paid before the agent can be moved.',

    // ─── Agencies ────────────────────────────────────────────────────────────
    DELIVERY_AGENCY_NOT_FOUND: 'The platform has no such delivery agency.',
    // Renamed from `DELIVERY_AGENCY_STATUS_CONFLICT` on 2026-09-15 (BR-026 § 3) — the
    // compare-and-set moved off `status` onto the verdict, so the old name named the
    // wrong field. It now refuses only a repeat of the SAME verdict, so this sentence
    // must not say "changed this agency": nothing changed, and the remedy is to re-read
    // the verdict rather than to look for a deactivation.
    DELIVERY_AGENCY_VERIFICATION_CONFLICT:
        'Another administrator has already recorded this verdict.',

    // ─── Vendors ─────────────────────────────────────────────────────────────
    VENDOR_NOT_FOUND: 'The platform has no such vendor.',
    VENDOR_STATUS_CONFLICT: 'Another administrator changed this vendor first.',
    VENDOR_KYC_STATUS_CONFLICT: 'Another administrator decided it first.',
    VENDOR_PRODUCT_NOT_SUSPENDABLE: 'It is no longer on sale.',
    VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED:
        'This product was not taken down by an administrator, so restoring it here would overrule the vendor’s own decision.',
    VENDOR_PRODUCT_UNSUSPEND_BLOCKED: 'Something still blocks putting this product back on sale.',
    CATALOG_PRODUCT_NOT_FOUND: 'The platform has no such product.',

    // ─── Users ───────────────────────────────────────────────────────────────
    USER_STATUS_CONFLICT: 'Another administrator changed this account first.',
    USER_CONTACT_REQUIRED: 'An account must keep at least one login identifier',
    AUTH_EMAIL_TAKEN: 'That email already belongs to another account',
    AUTH_PHONE_TAKEN: 'That phone number already belongs to another account',

    // ─── An administrator's own phone (WhatsApp OTP) ──────────────────────────
    /*
      ✅ **All six arrive now.** Two of them could not until 2026-09-15: wi-admin's
      `projectDetails` ran a `rate_limit` refusal through an allowlist of
      `retryAfterSeconds`/`limit`/`windowSeconds` with `platformCode` left off, so
      both 429s (`RESEND_TOO_SOON`, `TOO_MANY_ATTEMPTS`) reached us as a bare
      `PLATFORM_OPERATION_REJECTED` with nothing to key on, and these two keys
      were dead copy kept for the day the allowlist widened. **BR-025 § 2 widened
      it** (`detail-policy.ts:68`), and it is every delegated 429 on the service,
      not just this flow.

      ⚠ **The keys earn their difference now, so keep the two sentences opposite.**
      The cooldown leaves the code in the operator's hand working; the spent
      attempt limit has **destroyed** it. Before the fix both rendered as the
      category line plus a retry line — a fair landing for the first and a wrong
      one for the second, which is the argument that carried the change.

      `DELIVERY_FAILED` always arrived: it is a 502, and the 5xx branch of the same
      function keeps `platformCode` on purpose. ⚠ Its *message* is replaced with a
      registry default, so this sentence must carry the explanation itself — do not
      write "the message below says which".
    */
    PHONE_VERIFICATION_NO_TARGET:
        'There is no phone number on your account to send a code to. Save one first.',
    PHONE_VERIFICATION_CODE_INVALID: 'That code is not right. Check the digits and try again.',
    /* Deliberately distinct from INVALID: the remedy is a new code, not a retype. */
    PHONE_VERIFICATION_CODE_EXPIRED:
        'That code has expired, or there is none in flight. Send a new one.',
    PHONE_VERIFICATION_TOO_MANY_ATTEMPTS:
        'Too many wrong codes. That one has been destroyed — send a new one.',
    PHONE_VERIFICATION_RESEND_TOO_SOON:
        'A code was just sent. Wait a moment before asking for another.',
    /*
      ⚠ **This sentence used to name the ordinary cause and must not any more.**
      It read "this usually means nobody has messaged the platform from that number
      in the last 24 hours", which was true while the deployment had no approved
      AUTHENTICATION template: every administrator was outside WhatsApp's window and
      every send failed. Both faults closed on 2026-09-15 — the template was approved
      in `en` and `fr`, and the window is now recorded on every inbound message — so
      a failure here is the edge case it reads as, and telling somebody their own
      silence caused it would send them chasing a remedy they do not need.

      ⛔ **And never add "message the platform on WhatsApp first" as a remedy.**
      Until 2026-09-21 that advice was actively harmful — a window-key mismatch in
      jovi-mall made texting the bot the one thing that guaranteed this failure —
      and `phone-verification.md` now says to remove it from every frontend. By the
      time this code arrives every route has been tried; retry, then report it.
    */
    PHONE_VERIFICATION_DELIVERY_FAILED:
        'WhatsApp would not deliver the code. Nothing is wrong with your number — try again in a moment.',

    // ─── Credential recovery ─────────────────────────────────────────────────
    // ⚠ `USER_CREDENTIAL_LINK_THROTTLED` **became reachable on 2026-09-15** and
    // is still not worth branching on. `rate_limit`'s allowlist gained
    // `platformCode` (BR-025 § 2) but not `scope`, and `scope` — `party` versus
    // `administrator` — is the whole distinction: *this person has been sent too
    // many* versus *you have sent too many*, two different remedies.
    // `SendCredentialLinkDialog` therefore still matches the status and renders
    // jovi-mall's own sentence, which is the only thing that says which. This
    // copy says nothing about that on purpose, and nothing should be added: it
    // cannot know. ⚠ `errors.md`'s row still claims both keys are dropped;
    // `detail-policy.ts:68` says otherwise and source wins.
    USER_CHANNEL_UNAVAILABLE:
        'This person has no address on that channel. Telegram only works once they have connected the bot themselves.',
    USER_CREDENTIAL_LINK_THROTTLED: 'Too many recovery links have been sent recently.',
    USER_LOGIN_LINK_ROLE_UNSUPPORTED:
        'Sign-in links are for customers only. Vendors, agencies and agents reach money and other people’s data, so send a password-reset link instead.',
    // Distinct from MESSAGING_DELIVERY_FAILED next door on purpose: this one is
    // 'there is nobody to send to' and retrying will not help, while that one is
    // 'try again'. The legacy handler flattened both into one 400.
    MESSAGING_CONNECTION_NOT_FOUND:
        'They have not connected Telegram, so there is no chat to send to. Only accounts that ran /connect with the bot can be messaged.',
    MESSAGING_DELIVERY_FAILED:
        'The channel accepted the request and did not deliver it. Nothing was sent — try another channel.',
    // jovi-mall raises this at 409 here, where its own login path uses 403. The
    // account has to be reinstated before there is anything to send them into.
    AUTH_ACCOUNT_SUSPENDED: 'This account is suspended, so there is nothing to send them back into.',

    // ─── Billing ─────────────────────────────────────────────────────────────
    BILLING_PLAN_CODE_EXISTS: 'That code is already taken by another tier',
    BILLING_PLAN_NOT_FOUND:
        'The platform cannot find this plan. It has most likely been archived — an archived tier cannot be assigned, though its existing subscribers keep running on it.',
    BILLING_PLAN_INACTIVE: 'This plan is not purchasable.',
    BILLING_PLAN_ROLE_MISMATCH: 'This plan is for a different kind of owner.',
    BILLING_PENDING_PLAN_EXISTS:
        'This owner already has a term waiting to start, because their current one has not lapsed yet. Wait for it to activate, or cancel it on the platform first.',

    // ─── Money ───────────────────────────────────────────────────────────────
    EARNINGS_PAYOUT_REQUEST_NOT_PENDING: 'This payout is no longer pending.',

    /*
      ── The gateway-transfer refusals, ADR-024 ──────────────────────────────

      ⚠ **These are the fallback, not the primary rendering.** `SendPayoutDialog`
      branches on each of these codes and draws a notice with the right
      affordances — a retry where one is safe, a route to the manual path where
      it is not — because the difference between them is *what to do next*, which
      a sentence alone cannot carry. What is here is what reaches a toast or a
      generic form error if one of them ever surfaces somewhere else.

      ⛔ **Every sentence below has to survive being read on its own.** The two
      that must never imply the money came back are `TRANSFER_FAILED` and the
      `failed` status it produces: a failed transfer has returned nothing.
    */

    /** `409`. ⛔ Never offer a retry beside this one — sending again risks a second transfer. */
    EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT:
        'A transfer is already in progress for this payout. Reload to see where it got to — it cannot be sent again, or rejected, until the provider confirms.',

    /*
      ⚠ **One code, two situations, and this sentence has to cover both.** At
      `422` it is the destination (a bank or card the gateway cannot reach); at
      `503` it is the deployment (automatic payouts switched off). The dialog
      separates them on the status; this fallback names the remedy they share,
      which is the manual path.
    */
    EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED:
        'This payout cannot be sent automatically. Move the money yourself and record it with Mark paid.',

    /*
      ⚠ **"Still held" is the load-bearing half.** The gateway refused the
      transfer and nothing was returned to the owner — the request is still open
      and still needs a retry or a rejection.
    */
    EARNINGS_PAYOUT_TRANSFER_FAILED:
        'The gateway refused this transfer. The funds are still held — nothing has been returned to the owner. Retry it, or reject the request to release the money back to them.',

    /** `409` on the send path — the same fact `EARNINGS_PAYOUT_REQUEST_NOT_PENDING` reports on the others. */
    EARNINGS_PAYOUT_NOT_SENDABLE: 'This payout has already been resolved.',

    /*
      `409`. A request carries one endorsement, and losing this race costs
      nothing — hence "already", not "cannot".
    */
    EARNINGS_PAYOUT_ALREADY_TRIAGED:
        'Somebody has already reviewed this request. Reload to see their endorsement.',

    // ─── Files ───────────────────────────────────────────────────────────────
    /**
     * `POST /files/upload`, arrived with BR-015 on 2026-08-26.
     *
     * ⚠ **The only one of the four upload constraints wi-admin cannot check.**
     * It never parses the body, so max files, field name and the accepted MIME
     * list are enforced by jovi-mall's pipeline and arrive here as a delegated
     * refusal. `details.violations[]` names the offending file, which the upload
     * panel renders — this sentence is the frame around that list, so it says
     * what to do rather than repeating what was wrong.
     */
    UPLOAD_POLICY_VIOLATION: 'The platform would not accept one of these files.',
};

export default platform;
