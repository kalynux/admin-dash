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
 * - Agencies use a `DELIVERY_` prefix, so a branch on `AGENCY_STATUS_CONFLICT`
 *   never fires.
 *
 * A code absent from this map is not a failure: `resolveErrorMessage` falls
 * through to jovi-mall's own sentence, which is English but specific, and warns
 * once in development naming the code to add.
 */

const platform = {
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
    AGENT_COD_THRESHOLD_BELOW_ALLOCATED:
        'That is below what this agent’s contracts already hold. Lower the contract slices first.',
    AGENT_COD_THRESHOLD_OUT_OF_BOUNDS: 'The platform refused that figure as out of bounds.',
    AGENT_MEMBERSHIP_ALREADY_EXISTS: 'This agent already holds a contract with that agency.',
    AGENT_MEMBERSHIP_NOT_FOUND: 'These two are not working together',
    CONTRACT_NOT_FOUND: 'The platform has no such contract.',
    CONTRACT_INVALID_TRANSITION: 'The contract cannot move to that state from where it is.',
    // The three administrative interventions are chosen to be ones the agency
    // holds unilaterally, so this is a platform-side guard rather than something
    // an operator can talk their way past — it is not a missing permission.
    CONTRACT_TRANSITION_NOT_PERMITTED:
        'The platform does not allow this party to make that change, whatever permission you hold here.',
    CONTRACT_REQUEST_ALREADY_PENDING:
        'A request is already open on this contract. It has to be answered before another can be raised.',
    CONTRACT_HAS_OUTSTANDING_COD:
        'The agent still owes this agency cash. It has to be settled before they can be moved.',
    CONTRACT_HAS_UNPAID_EARNINGS:
        'This agency still owes the agent earnings. They have to be paid before the agent can be moved.',

    // ─── Agencies ────────────────────────────────────────────────────────────
    DELIVERY_AGENCY_NOT_FOUND: 'The platform has no such delivery agency.',
    DELIVERY_AGENCY_STATUS_CONFLICT: 'Another administrator changed this agency first.',

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

    // ─── Credential recovery ─────────────────────────────────────────────────
    // `USER_CREDENTIAL_LINK_THROTTLED` deliberately says nothing about who was
    // throttled: `details.scope` is `party` or `administrator` and the two have
    // different remedies, so the dialog appends the specific sentence. This is
    // the floor for the case where scope is missing.
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
