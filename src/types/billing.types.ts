/**
 * `/billing` — the pricing-plan catalog, and who is on it.
 *
 * Sources: `docs/admin/api/billing.md` and, for the field-by-field shape,
 * `backend/admin/src/modules/billing/read-models/billing.dto.ts` — which is the
 * authority, because the doc is wrong in twenty-four places on this surface.
 *
 * ── Three traps worth knowing before writing anything against this ────────────
 *
 * 1. **The writes do not answer these types.** `POST /plans`, `PATCH /plans/:id`
 *    and `POST /subscriptions/:ownerType/:ownerId` return jovi-mall's **raw
 *    Mongoose document** — `_id`, `__v`, `term_days`, no `id`, no nested
 *    `limits`, no `owner`/`plan` objects. So `billing.service.ts` returns no
 *    document at all from any of them and every caller refetches.
 *
 * 2. **An archived plan cannot be edited or deleted.** wi-admin's read repository
 *    deliberately returns archived rows so "which plan is this vendor on" can
 *    name one; jovi-mall's write queries filter `deletedAt: null`. So the local
 *    404 passes and the delegated call refuses — the UI must not offer the
 *    affordance. `archivedAt` is always present on the wire precisely so a client
 *    can tell the two apart.
 *
 * 3. **The limits are flat on the way in and nested on the way out.** Five
 *    top-level keys in a `.strict()` request body; one `limits` object in the
 *    response. Sending `{ limits: {...} }` is a `400`.
 */

import type { ActorStamp } from '@/types/actor.types';

/** A plan belongs to exactly one role, and carries only the limits that role uses. */
export const PLAN_ROLES = ['vendor', 'agency', 'agent'] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];

/**
 * What a plan allows.
 *
 * ⚠ **`null` does not mean the same thing in all five.** `maxActiveProducts`,
 * `commissionPercent` and `maxUnterminatedShipments` are genuinely "not limited
 * by this plan"; **`maxStorageBytes: null` falls back to the platform's own
 * default cap**, which is not the same as unlimited; and `liveTrackingEnabled` is
 * a flag rather than a cap at all. `billing.md:99` flattens all five into "null
 * means unlimited", which is wrong for two of them.
 */
export interface PlanLimits {
    maxActiveProducts: number | null;
    /** `null` → the platform's default cap applies, **not** unlimited. */
    maxStorageBytes: number | null;
    /** **The multiplier every future order's split uses.** */
    commissionPercent: number | null;
    maxUnterminatedShipments: number | null;
    /** A flag, not a cap. */
    liveTrackingEnabled: boolean | null;
}

export interface Plan {
    id: string;
    role: string;
    /** Immutable after creation — `PATCH` refuses it. */
    code: string;
    name: string;
    price: number;
    /** ⚠ Nullable; the doc's field table never mentions this field at all. */
    currency: string | null;
    /** **`null` = never expires.** */
    termDays: number | null;
    creditAllowance: number;
    limits: PlanLimits;
    /** `false` is a **defined-but-not-purchasable** tier — a real state. */
    isActive: boolean;
    sortOrder: number;
    /**
     * The soft-delete stamp. **Always present**, so a client reading
     * `?includeArchived=true` can tell a live plan from an archived one without
     * inferring it from a missing key — which is exactly what gates Edit and
     * Archive in the UI.
     */
    archivedAt: string | null;
    /** ⚠ Nullable, despite the doc's examples. */
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * One owner's term on one plan.
 *
 * ⚠ `assignedBy.source` is `'platform' | 'admin'` — **never `"wi-admin"`**, which
 * `billing.md:182` shows and which is not a value the enum contains. This is the
 * fifth doc page carrying that same error, which is why `ActorStamp` is shared
 * from `actor.types.ts` rather than redeclared here.
 */
export interface Subscription {
    id: string;
    owner: { type: string; id: string; name: string | null };
    plan: {
        id: string;
        /** Denormalised on the subscription row, so it answers even when the plan lookup fails. */
        code: string | null;
        /** `null` when the plan lookup found nothing — a dangling reference. */
        name: string | null;
    };
    status: string;
    /** ⚠ Nullable — `null` while `pending_activation`. */
    startedAt: string | null;
    /** **`null` on the never-expiring free tier** — not "unknown". */
    expiresAt: string | null;
    /** `null` when nobody assigned it: a self-service purchase, or the lazy free default. */
    assignedBy: ActorStamp | null;
    paymentReference: string | null;
    /** Guards a double grant. */
    allowanceGranted: boolean;
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * The four states a term can be in.
 *
 * Read from the model's enum (`subscriber-plan.model.ts:22,62`); `billing.md`
 * names only `pending_activation`, in prose. A bounded string on the wire, so
 * render raw and never `switch` exhaustively.
 */
export const SUBSCRIPTION_STATUSES = [
    'active',
    'pending_activation',
    'expired',
    'cancelled',
] as const;

export const PLAN_SORT_KEYS = ['sortOrder', 'price', 'name', 'createdAt'] as const;
/** ⚠ Ascending `sortOrder`, **not** `-createdAt` — a catalog listed newest-first shows the tiers in creation order. */
export const PLAN_SORT_DEFAULT = 'sortOrder';

export const SUBSCRIPTION_SORT_KEYS = ['createdAt', 'startedAt', 'expiresAt', 'updatedAt'] as const;
export const SUBSCRIPTION_SORT_DEFAULT = '-createdAt';

/** Every `from`/`to` pair under `/billing` caps at this span. */
export const BILLING_MAX_RANGE_DAYS = 366;

// ─── Request shapes ───────────────────────────────────────────────────────────

/**
 * `POST /billing/plans` — **strict**, and the limits are **flat here**.
 *
 * `termDays` is required and, when non-null, must be **at least 1** — `0` is a
 * `400`, which `billing.md:223` does not say. `currency` is length-3 only, so
 * `"123"` passes validation.
 */
export interface CreatePlanBody {
    role: PlanRole;
    /** 2–40 chars, `[a-z0-9_-]`, lower-cased at the edge. */
    code: string;
    name: string;
    price: number;
    currency?: string;
    /** Required. `null` = never expires; otherwise `>= 1`. */
    termDays: number | null;
    creditAllowance: number;
    maxActiveProducts?: number | null;
    maxStorageBytes?: number | null;
    commissionPercent?: number | null;
    maxUnterminatedShipments?: number | null;
    liveTrackingEnabled?: boolean;
    isActive?: boolean;
    sortOrder?: number;
}

/**
 * `PATCH /billing/plans/:planId` — every create field **except `role` and
 * `code`**, all optional, at least one required.
 *
 * ⚠ **`null` clears, an omitted key leaves alone — but only on five keys.**
 * `termDays`, `maxActiveProducts`, `maxStorageBytes`, `commissionPercent` and
 * `maxUnterminatedShipments` accept `null`. `null` on `name`, `price`,
 * `currency`, `creditAllowance`, `liveTrackingEnabled`, `isActive` or `sortOrder`
 * is a **`400`**, which `billing.md:233-235` states unconditionally and wrongly.
 */
export type UpdatePlanBody = Partial<Omit<CreatePlanBody, 'role' | 'code'>>;

export interface AssignSubscriptionBody {
    planId: string;
    paymentReference?: string;
}

export interface PlanListQuery {
    role?: string;
    isActive?: boolean;
    /** Soft-deleted plans are **excluded by default, not gone**. */
    includeArchived?: boolean;
    /** Matches the plan code, the display name, or — for a 24-hex term — the id. */
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface SubscriptionListQuery {
    status?: string;
    ownerType?: string;
    ownerId?: string;
    planId?: string;
    planCode?: string;
    /** ⚠ Compiles to `expires_at: { $ne: null, $lt: … }` — **never matches the free tier**. */
    expiringBefore?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Platform error codes ─────────────────────────────────────────────────────

/** `409` — the code is already taken. Codes are unique and immutable. */
export const PLATFORM_CODE_PLAN_CODE_EXISTS = 'BILLING_PLAN_CODE_EXISTS';

/** `409` — the plan is defined but not purchasable. */
export const PLATFORM_CODE_PLAN_INACTIVE = 'BILLING_PLAN_INACTIVE';

/** `409` — a vendor plan cannot be assigned to an agency. */
export const PLATFORM_CODE_PLAN_ROLE_MISMATCH = 'BILLING_PLAN_ROLE_MISMATCH';

/**
 * `409` — **undocumented, and reachable on a completely normal path.**
 *
 * The owner already has a queued term, because their paid one has not lapsed
 * (`subscriber-plan.service.ts:156-162`). `billing.md` lists only the two codes
 * above, so an operator assigning a plan to an active subscriber would otherwise
 * get a generic platform refusal with no explanation.
 */
export const PLATFORM_CODE_PENDING_PLAN_EXISTS = 'BILLING_PENDING_PLAN_EXISTS';

/**
 * `404` — jovi-mall cannot find the plan.
 *
 * ⚠ **The likeliest cause is that the plan is archived**, not that the id is
 * wrong: wi-admin's read repository returns archived rows and jovi-mall's write
 * queries filter them out. Editing or re-deleting an archived plan lands here
 * every time, which is why the UI hides both affordances instead.
 */
export const PLATFORM_CODE_PLAN_NOT_FOUND = 'BILLING_PLAN_NOT_FOUND';

/** A plan the platform will refuse to write to. */
export function isArchived(plan: Plan): boolean {
    return plan.archivedAt !== null;
}
