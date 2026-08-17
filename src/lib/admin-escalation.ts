/**
 * Layer 2: may this administrator act on **that** administrator?
 *
 * Pure functions over two tiers and an action. **No React, no fetching** — the
 * same shape as `lib/authorization.ts`, which is layer 1, and for the same
 * reason: the screens, the dialogs and the tests can all depend on this without
 * depending on each other.
 *
 * ── This only hides affordances. It never grants anything. ────────────────────
 * The server runs `assertMayActOn` on **every** write, after the permission
 * check, and it is not overridable. A `true` here means "worth offering"; it
 * never means "it will work". A `false` means "do not draw the button" — the
 * request would be refused anyway, and offering it teaches people the screen is
 * broken. Deleting this file would make the UI noisier, not less safe.
 *
 * ── Never call it alone ───────────────────────────────────────────────────────
 * The composition at every call site is
 *
 *     can(permission) && offerAction(actor, target, action).allowed
 *
 * in that order. Layer 1 answers "may you manage administrators at all"; this
 * answers "may you manage *this* one". Either alone draws a button that 403s.
 * Layers 3 (row scope, which refuses as a 404) and 4 (dual control, which
 * answers 202) refuse independently and cannot be decided here either.
 *
 * ── A hand-maintained mirror ──────────────────────────────────────────────────
 * Transcribed from `backend/admin/src/modules/authorization/domain/escalation.rules.ts`,
 * whose own `mayActOn` says *"The dashboard uses this to decide whether to draw a
 * 'Suspend' button beside a row"* — but it is server-side with no endpoint
 * exposing it, so the rules have to live here too. It diverges in exactly **two**
 * places, both marked `⚠ DIVERGENCE` below and both pinned by a named case in
 * `admin-escalation.test.ts`, so the divergence cannot quietly spread.
 *
 * ── Remember the inversion ────────────────────────────────────────────────────
 * **Lower tier number = more privilege.** 1 Developer, 2 Admin, 3 Support. So
 * `target.tier > actor.tier` means "the target is less privileged", which is the
 * only direction in which action is ordinarily allowed.
 */

import {
    CODE_SELF_ACTION_FORBIDDEN,
    CODE_TARGET_TIER_PROTECTED,
    CODE_TIER_ESCALATION_FORBIDDEN,
} from '@/types/api.types';
import { tierLabel, type AdminTier } from '@/types/auth.types';

/**
 * `409` — creating an administrator directly at Developer level.
 *
 * Declared here rather than imported from `types/administrators.types.ts` to
 * keep this module's dependencies one-way: it may reach into `auth.types` and
 * `api.types`, and nothing reaches back. See `REFUSAL_CODE`.
 */
export const CODE_APPROVAL_REQUIRED = 'AUTHZ_APPROVAL_REQUIRED';

// ─── The vocabulary ───────────────────────────────────────────────────────────

export type AdminAction =
    | 'create'
    | 'update'
    | 'suspend'
    | 'reinstate'
    | 'set_tier'
    /**
     * Listing another administrator's sessions.
     *
     * A **read**, and still governed by rule 2 — which the other reads on this
     * surface are not. The difference is what it discloses: IP addresses and
     * user agents, i.e. where a colleague is working from and on what. So a
     * tier-2 Admin cannot enumerate a Developer's devices, and the Sessions tab
     * is not rendered for them at all.
     */
    | 'read_sessions'
    | 'revoke_sessions'
    | 'reset_password'
    /**
     * Clearing another administrator's two-factor enrolment.
     *
     * Named separately from `reset_password` because it removes a **different**
     * control — the thing they have, not the thing they know.
     */
    | 'reset_mfa';

/**
 * Actions against an administrator who already exists.
 *
 * `create` is excluded because it has no target: the rules about acting on
 * somebody else cannot apply to somebody who does not exist yet. It gets
 * `mayCreate` instead of a synthetic target whose tier is the level being
 * assigned — which would read as if rule 2 were doing the work when rule 4 is.
 */
export type ExistingAdminAction = Exclude<AdminAction, 'create'>;

export interface AdminRef {
    adminId: string;
    tier: AdminTier;
}

export type EscalationRefusal =
    | 'self_action_forbidden'
    | 'target_tier_protected'
    | 'tier_escalation_forbidden'
    /** ⚠ DIVERGENCE 2 — create only. See `mayCreate`. */
    | 'approval_required_no_path';

export interface EscalationVerdict {
    allowed: boolean;
    /**
     * True when the server will answer **202** and queue the action for a second
     * administrator rather than performing it.
     *
     * A hint for copy only. `api.dualControl` branches on the actual response
     * status, so a dialog is never *wrong* because this was — it would only have
     * failed to warn.
     */
    dualControlRequired: boolean;
    /** Which rule decided. `null` when allowed. */
    refusal: EscalationRefusal | null;
    /**
     * One line, for a dialog warning or a hidden-affordance note.
     *
     * **Names the rule, never the caller's standing** — "administrators at or
     * above your own level", not "you are tier 2 and the target is tier 1". The
     * server's messages keep that property and copy written over them must too.
     */
    reason: string | null;
}

/** The 403 (or 409) code the server would answer with, per refusal. */
export const REFUSAL_CODE: Readonly<Record<EscalationRefusal, string>> = {
    self_action_forbidden: CODE_SELF_ACTION_FORBIDDEN,
    target_tier_protected: CODE_TARGET_TIER_PROTECTED,
    tier_escalation_forbidden: CODE_TIER_ESCALATION_FORBIDDEN,
    approval_required_no_path: CODE_APPROVAL_REQUIRED,
};

// ─── The self rules ───────────────────────────────────────────────────────────

/**
 * Verbatim from the server (`escalation.rules.ts` · `SELF_FORBIDDEN`).
 *
 * `update` is absent on purpose: editing your own display name is not an
 * escalation, and forbidding it would mean an administrator cannot maintain
 * their own profile. `reinstate` is absent because a suspended administrator
 * cannot authenticate at all, so self-reinstatement is unreachable rather than
 * forbidden. `read_sessions` is absent because `GET /auth/sessions` is what
 * reading your own sessions is for.
 *
 * **Do not widen this** — widen `UI_SELF_FORBIDDEN` instead, or the parity test
 * against the server stops meaning anything.
 */
export const SELF_FORBIDDEN: ReadonlySet<AdminAction> = new Set<AdminAction>([
    'suspend',
    'set_tier',
    'revoke_sessions',
    'reset_password',
]);

/**
 * What **this UI** additionally declines to offer on your own record.
 *
 * A superset of `SELF_FORBIDDEN`, and each addition has a reason:
 *
 * - `reset_mfa` — the server's set omits it, but `administrators.md` lists
 *   `AUTHZ_SELF_ACTION_FORBIDDEN` among mfa-reset's errors. A docs/code
 *   discrepancy; be conservative. There is no coherent self-story either way —
 *   you cannot clear your own authenticator using a session you needed that
 *   authenticator to obtain.
 * - `read_sessions` — same discrepancy shape, and your own devices belong on
 *   `/dashboard/account/security`, which renders a "this device" badge the
 *   admin-on-admin projection cannot produce (`current` is always `false` there).
 * - `update` — allowed by the server, but a self-edit must go through
 *   `PATCH /administrators/me` so it audits as `administrators.profile.update_self`
 *   rather than `administrators.update`. Refusing it here is what makes routing
 *   self-edits to the `/me` service function unforgettable.
 */
export const UI_SELF_FORBIDDEN: ReadonlySet<AdminAction> = new Set<AdminAction>([
    ...SELF_FORBIDDEN,
    'update',
    'read_sessions',
    'reset_mfa',
]);

// ─── Verdict constructors ─────────────────────────────────────────────────────

const ALLOWED: EscalationVerdict = {
    allowed: true,
    dualControlRequired: false,
    refusal: null,
    reason: null,
};

const QUEUED_PEER_DEVELOPER: EscalationVerdict = {
    allowed: true,
    dualControlRequired: true,
    refusal: null,
    reason: 'One Developer acting on another needs a second Developer’s approval.',
};

function refuse(refusal: EscalationRefusal, reason: string): EscalationVerdict {
    return { allowed: false, dualControlRequired: false, refusal, reason };
}

const SELF_REFUSAL = refuse(
    'self_action_forbidden',
    'You cannot perform this action on your own account.',
);

const TARGET_PROTECTED = refuse(
    'target_tier_protected',
    'You cannot perform this action on an administrator at or above your own level.',
);

const TIER_ESCALATION = refuse(
    'tier_escalation_forbidden',
    'You cannot assign a level at or above your own.',
);

// ─── Rule 4, shared by create and set_tier ────────────────────────────────────

/**
 * Never assign a level at or above your own.
 *
 * Caps what an actor can **mint**, which rule 2 alone does not: without it an
 * Admin could create a Support account and immediately promote it to Admin,
 * acquiring a peer it is then forbidden to touch.
 *
 * The single exception is a Developer assigning tier 1 — minting a peer
 * Developer — permitted precisely *because* it is dual-controlled.
 */
function assignmentVerdict(actorTier: AdminTier, newTier: AdminTier): EscalationVerdict {
    const mintingPeerDeveloper = actorTier === 1 && newTier === 1;

    if (newTier <= actorTier && !mintingPeerDeveloper) return TIER_ESCALATION;

    return mintingPeerDeveloper
        ? {
              allowed: true,
              dualControlRequired: true,
              refusal: null,
              reason: 'Granting Developer level needs a second Developer’s approval.',
          }
        : ALLOWED;
}

// ─── The predicates ───────────────────────────────────────────────────────────

/**
 * The exact server mirror. **Screens should call `offerAction` instead.**
 *
 * Exported so `admin-escalation.test.ts` can assert the full matrix against
 * `escalation.rules.ts` — a backend policy change then shows up as a red test
 * rather than as drift. `offerAction` wraps it with this UI's own conservatism;
 * merging the two would make that parity test impossible to write.
 *
 * ⚠ **DIVERGENCE 1 — this never throws.** The server raises a 500 for
 * `set_tier` with no `newTier` ("fail closed and loudly"). A UI predicate is
 * called during render, once per row and once per toolbar button, and a throw
 * there would blank the screen through `ErrorBoundary`. Here, omitting `newTier`
 * means **"answer rules 1 and 2 only"** — which is exactly the question the
 * toolbar asks ("may I open the Change level dialog at all?"), while the
 * dialog's own `<Select>` asks rule 4 per option through `assignableTiers`. A
 * difference in the *question*, not in the *policy*.
 */
export function mayActOn(
    actor: AdminRef,
    target: AdminRef,
    action: ExistingAdminAction,
    opts: { newTier?: AdminTier } = {},
): EscalationVerdict {
    // ── Rule 1: never act on yourself ────────────────────────────────────────
    if (actor.adminId === target.adminId) {
        if (SELF_FORBIDDEN.has(action)) return SELF_REFUSAL;

        /*
         * Everything else on yourself — in practice `update` — stops here. It
         * must NOT fall through to rule 2: your own level is by definition equal
         * to your own level, so the peer-protection rule would refuse an
         * administrator the right to edit their own display name.
         */
        return ALLOWED;
    }

    // ── Rule 2: never act on an equal or more privileged administrator ───────
    // Equality is refused as firmly as superiority: two Admins who can suspend
    // each other is a denial of service between peers, and two Developers who
    // can demote each other is a coin flip for control of the platform.
    //
    // ── Rule 3, the exception that makes Developers recoverable ──────────────
    // A Developer acting on another Developer is allowed, but always with a
    // second Developer's approval. Without it a compromised Developer account
    // could never be contained through the API — rule 2 would protect it from
    // every other Developer, and rule 1 from itself.
    const peerDeveloperAction = actor.tier === 1 && target.tier === 1;

    if (target.tier <= actor.tier && !peerDeveloperAction) return TARGET_PROTECTED;

    const base = peerDeveloperAction ? QUEUED_PEER_DEVELOPER : ALLOWED;

    if (action !== 'set_tier') return base;

    // ⚠ DIVERGENCE 1 — no level named, so rules 1–2 are the whole answer.
    if (opts.newTier === undefined) return base;

    // ── Rule 4: never assign a level at or above your own ────────────────────
    const assignment = assignmentVerdict(actor.tier, opts.newTier);
    if (!assignment.allowed) return assignment;

    /*
     * Dual control is only ever RAISED here, never cleared — which is why a
     * Developer demoting a peer Developer to Support is queued even though the
     * requested level is not 1. `administrators.md` documents the queue as
     * firing "when the requested tier is 1" and is incomplete on this point;
     * rule 2 above set the flag and nothing below lowers it.
     */
    return {
        allowed: true,
        dualControlRequired: base.dualControlRequired || assignment.dualControlRequired,
        refusal: null,
        reason: assignment.dualControlRequired ? assignment.reason : base.reason,
    };
}

/**
 * The server mirror plus this UI's own conservatism. **Screens call this.**
 *
 * The only difference is `UI_SELF_FORBIDDEN` in place of `SELF_FORBIDDEN`; see
 * that constant for why each addition is there.
 */
export function offerAction(
    actor: AdminRef,
    target: AdminRef,
    action: ExistingAdminAction,
    opts: { newTier?: AdminTier } = {},
): EscalationVerdict {
    if (actor.adminId === target.adminId && UI_SELF_FORBIDDEN.has(action)) return SELF_REFUSAL;
    return mayActOn(actor, target, action, opts);
}

/**
 * Whether this actor may create an administrator at `newTier`.
 *
 * Only rule 4 applies — there is no target yet to protect.
 *
 * ⚠ **DIVERGENCE 2.** The server's `assertMayCreate` returns
 * `dualControlRequired: true` for a Developer minting a peer Developer, because
 * it shares `assertMayAssignTier` with `set_tier`. But `POST /administrators`
 * answers **`409 AUTHZ_APPROVAL_REQUIRED`** for `tier: 1`, not a 202: *"There is
 * no approval path from here — create the account at a lower level and then
 * request a promotion, which the four-eyes queue reviews. One reviewed step
 * instead of two."* So this refuses, and `assignableTiers(1, 'create')` excludes
 * tier 1. Anything else would offer a form whose only outcome is an error.
 */
export function mayCreate(actor: AdminRef, newTier: AdminTier): EscalationVerdict {
    if (actor.tier === 1 && newTier === 1) {
        return refuse(
            'approval_required_no_path',
            'An administrator cannot be created directly at Developer level. Create the account at a lower level, then request a promotion.',
        );
    }

    return assignmentVerdict(actor.tier, newTier);
}

// ─── Rule 4, as something renderable ──────────────────────────────────────────

export interface AssignableTier {
    tier: AdminTier;
    /** From `tierLabel()` — never a second label map. */
    label: string;
    /** Whether picking this one queues the action instead of performing it. */
    dualControlRequired: boolean;
}

export type TierAssignmentPurpose = 'create' | 'set_tier';

/** Every level, so the tables below are derived rather than typed out. */
const ALL_TIERS: readonly AdminTier[] = [1, 2, 3];

/**
 * The levels a `<Select>` may offer, each flagged with whether it queues.
 *
 * `create` and `set_tier` differ only at tier 1, and only because of
 * ⚠ DIVERGENCE 2 above:
 *
 * | actor | `create`            | `set_tier`                          |
 * |-------|---------------------|-------------------------------------|
 * | 1     | Admin, Support      | **Developer (queues)**, Admin, Support |
 * | 2     | Support             | Support                             |
 * | 3     | *(none)*            | *(none)*                            |
 *
 * An empty list is the signal to hide the affordance entirely rather than open
 * a dialog with nothing in it.
 */
export function assignableTiers(
    actorTier: AdminTier,
    purpose: TierAssignmentPurpose,
): readonly AssignableTier[] {
    const decide = purpose === 'create' ? mayCreate : null;

    return ALL_TIERS.flatMap((tier) => {
        const verdict = decide
            ? decide({ adminId: '', tier: actorTier }, tier)
            : assignmentVerdict(actorTier, tier);

        if (!verdict.allowed) return [];

        return [{ tier, label: tierLabel(tier), dualControlRequired: verdict.dualControlRequired }];
    });
}
