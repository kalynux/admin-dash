/**
 * `/vendors` — the shop, the person behind it, and the catalogue they sell.
 *
 * Sources: `docs/admin/api/vendors.md`, `docs/admin/ADR-008-VENDOR-MANAGEMENT.md`,
 * and — where those two disagree with the running service —
 * `backend/admin/src/modules/vendors/`. **Four shapes below are read from the
 * code because the published contract is wrong about them**; each is marked with
 * the file that settles it. Guessing any of them would have shipped a screen
 * that renders `undefined`.
 *
 * Three properties of this surface shape the types more than usual:
 *
 * 1. **A vendor has four independent state axes**, and the API refuses to
 *    collapse them: `status` (may the shop trade), `account.status` (may the
 *    person sign in), `store.isOpen` (the vendor's own vacation switch) and
 *    `kycStatus` (is the business verified). `vendors.md:29` calls confusing them
 *    "the commonest mistake here", so they are four separate fields on three
 *    separate objects and no helper merges them.
 * 2. **Reads and writes disagree on shape, deliberately.** The reads are answered
 *    by wi-admin from jovi-mall's collections; all seven writes are executed by
 *    jovi-mall and forwarded, returning its own narrower DTO. Both are modelled,
 *    because pretending they are one type is how a screen renders `undefined`.
 * 3. **There is no create and no delete.** Suspension is the model. A vendor is
 *    referenced by historical orders, shipments and payouts, so nothing on this
 *    surface removes one.
 */

import type { ActorStamp } from '@/types/actor.types';

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * May the shop trade?
 *
 * jovi-mall's vocabulary verbatim — **`inactive`, not a friendlier
 * `suspended`** (`vendors.md:41-44`). `pending_verification` is the schema
 * default at vendor registration and is *not* written by any admin endpoint;
 * only `active` and `inactive` are reachable from this dashboard.
 *
 * ⚠ Enforcement is narrow by design: jovi-mall's auth path refuses
 * `=== 'inactive'`, never `!== 'active'`
 * ([ADR-008 D-2](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)), so a
 * `pending_verification` vendor still trades.
 */
export type VendorStatus = 'active' | 'pending_verification' | 'inactive' | (string & {});

/**
 * The business-verification verdict — three-valued on purpose.
 *
 * The old boolean could not tell **never reviewed** from **reviewed and
 * rejected**: both were `false`, which makes a review queue unbuildable
 * ([ADR-008 D-5](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)). `pending` is
 * also what rows written before the field existed report.
 */
export type VendorKycStatus = 'pending' | 'verified' | 'rejected' | (string & {});

/** The `?onboarding=` filter. Note the response field is `onboardingComplete`. */
export type VendorOnboardingFilter = 'complete' | 'incomplete' | (string & {});

/** A listing's own status. A separate axis again — the vendor's does not imply it. */
export type ProductStatus =
    | 'draft'
    | 'active'
    | 'archived'
    | 'pending_review'
    | 'suspended'
    | (string & {});

export type ProductType = 'physical' | 'digital' | 'service' | (string & {});

/** `'advanced'` is what a document predating the field reports. */
export type ProductMode = 'simple' | 'advanced' | (string & {});

/**
 * Why a listing is off sale — **four disjoint reason sets, one union**.
 *
 * The first four are the delivery/agency sweeps; `vendor_suspended` is the
 * cascade from suspending the shop; `platform_oversight` is one listing taken
 * down by an administrator. [ADR-008 D-3](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)
 * forbids widening any set to include another's members, and the consequence the
 * UI must respect is: **reinstating a vendor never republishes a
 * `platform_oversight` takedown.**
 */
export type ProductSuspensionReason =
    | 'default_delivery_agency_removed'
    | 'product_delivery_agency_removed'
    | 'agency_connection_paused'
    | 'agency_storage_suspended'
    | 'vendor_suspended'
    | 'platform_oversight'
    | (string & {});

// ─── Read shapes ──────────────────────────────────────────────────────────────

/**
 * A row of `GET /vendors`.
 *
 * Nullability is **not annotated in the docs** and is read instead from
 * `toVendorListItemDto` in
 * `backend/admin/src/modules/vendors/controllers/vendor.controller.ts`, which
 * builds every field by name with an explicit `?? null`. Six of the fifteen are
 * genuinely nullable — including all four candidates for a display name, which
 * is why `vendorDisplayName` falls through to the id.
 */
export interface Vendor {
    id: string;
    /** The `users` row. Every other admin screen identifies this person by it. */
    userId: string;
    /** Lives on `stores`, not `vendors` — which is why it is not a sort key. */
    businessName: string | null;
    storeSlug: string | null;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    /** ISO-3166 alpha-2, upper-case. */
    country: string | null;
    status: VendorStatus;
    kycStatus: VendorKycStatus;
    /** The boolean projection of `kycStatus === 'verified'`; written together. */
    verified: boolean;
    /**
     * jovi-mall's raw step number. **`0` means COMPLETE** — the inversion is easy
     * to read backwards, which is why `onboardingComplete` is computed for you.
     */
    onboardingStep: number;
    onboardingComplete: boolean;
    createdAt: string;
    updatedAt: string;
}

/** The shop front. `null` when the vendor has not created one yet. */
export interface VendorStore {
    id: string;
    name: string | null;
    slug: string | null;
    description: string | null;
    logoFileId: string | null;
    bannerFileId: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    supportWhatsapp: string | null;
    /**
     * **The vendor's own vacation switch, not an admin suspension.** Two
     * different things that both make a shop look closed, and no admin endpoint
     * writes this one.
     */
    isOpen: boolean;
    createdAt: string | null;
}

/**
 * The suspension of the **sign-in account**, not of the shop.
 *
 * Note it carries no `fromStatus` — a `users` row only ever moves between
 * `active` and `suspended`, so there is nothing to record. `VendorSuspension`
 * does carry one. Two shapes, deliberately not merged.
 */
export interface AccountSuspension {
    at: string | null;
    reason: string | null;
    by: ActorStamp | null;
}

/**
 * The `users` row behind the vendor.
 *
 * `null` if it is missing — **which would stop them signing in**, and is
 * otherwise invisible, so the detail screen reports it prominently.
 * `account.status` is written only on the `/users` surface under `users.suspend`;
 * nothing on `/vendors` touches it.
 */
export interface VendorAccount {
    id: string;
    email: string | null;
    phone: string | null;
    roles: string[];
    /** `active` | `suspended` — the sign-in axis. */
    status: string;
    /** Keyed on `status === 'suspended'`; `null` on an active account. */
    suspension: AccountSuspension | null;
}

/**
 * Why the shop is not trading. **Present only when `status === 'inactive'`.**
 *
 * `fromStatus` is `active` or `pending_verification` — **never `inactive`**
 * (`jovi-mall/src/modules/vendors/vendor.model.ts`, the `suspended_from_status`
 * enum). It is what a restore puts back, which is why a vendor who was never
 * verified does not silently become verified by being reinstated.
 */
export interface VendorSuspension {
    at: string | null;
    reason: string | null;
    fromStatus: VendorStatus | null;
    by: ActorStamp | null;
}

/**
 * The business-verification verdict and who reached it.
 *
 * **Verification gates nothing today.** It is visible to agencies and it is now
 * settable and explicable, but no vendor behaviour depends on it — gating selling
 * on it would lock out the entire existing roster until each vendor is reviewed
 * ([ADR-008 D-5](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)). The UI says so
 * rather than implying a rejected vendor is blocked from trading.
 */
export interface VendorVerification {
    status: VendorKycStatus;
    verified: boolean;
    /** Stored in jovi-mall, not only in the audit row, so the vendor can be told. */
    rejectionReason: string | null;
    verifiedAt: string | null;
    /** `null` while the verdict is still `pending`. */
    reviewedBy: ActorStamp | null;
}

export interface VendorContact {
    emailVerified: boolean;
    phoneVerified: boolean;
    whatsappVerified: boolean;
    /** IANA. The vendor's own, not the operator's — do not format dates with it. */
    timezone: string | null;
    preferredLanguage: string | null;
}

/**
 * A business address.
 *
 * **Never payout details** — those are excluded by the read projection *and* by
 * the DTO naming its own fields, and `test-vendors.ts` asserts the string
 * `payout_details` appears nowhere in the module. The geo coordinates are
 * excluded too.
 */
export interface VendorAddress {
    id: string;
    label: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
}

/**
 * **Presence, not content.** About thirty fields of the vendor's own commercial
 * terms exist; the question a detail screen asks is "have they set this up".
 *
 * Editing them is deliberately not offered: writing `policies` bumps
 * `policyVersion`, which pauses every agency connection pending reapproval, and
 * that cascade belongs to the vendor's own policy path.
 */
export interface VendorPolicies {
    policyVersion: number;
    hasReturnPolicy: boolean;
    hasCancellationPolicy: boolean;
    hasSupportPolicy: boolean;
}

/**
 * The platform-governed order settings — what the **read** returns.
 *
 * Four fields here, **three writable**. The rule that picked them
 * ([ADR-008 D-8](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)): a setting is
 * the administrator's when its effect lands on somebody other than the vendor.
 * `notifyDaysBeforeExpiry` is a notification to the vendor, about the vendor, so
 * it is theirs — see `UpdateVendorSettingsBody`.
 *
 * jovi-mall creates `vendor_settings` lazily, so an untouched vendor reports its
 * schema defaults (`false` / `null` / `3` / `7`) rather than nulls.
 */
export interface VendorSettings {
    autoRedirectOrdersToAgency: boolean;
    /** `null` means no cap: every order auto-dispatches while the flag is on. */
    autoRedirectThresholdAmount: number | null;
    autoCancelUnpaidDays: number;
    /** Read-only here. The PATCH rejects it by name. */
    notifyDaysBeforeExpiry: number;
}

/**
 * The catalogue, by status.
 *
 * ⚠ **`vendors.md:241` is wrong**: it says "only non-zero statuses appear" and
 * shows four keys. `ProductStatusCounts` in
 * `backend/admin/src/modules/vendors/repositories/vendor-product.read.repository.ts:77-84`
 * always emits **six**, zeros included — and the doc's example omits
 * `pendingReview` entirely. Rendering only truthy keys would hide a status that
 * genuinely reads zero, which is a different fact from "not applicable".
 */
export interface VendorProductCounts {
    total: number;
    draft: number;
    active: number;
    archived: number;
    pendingReview: number;
    suspended: number;
}

/**
 * A tally, **deliberately never a sum**.
 *
 * The order projection behind this carries no amount field at all, and
 * `test-vendors.ts` asserts it — revenue belongs behind `money.*`, not behind
 * `vendors.read`.
 */
export interface VendorOrderCounts {
    total: number;
    lastOrderAt: string | null;
}

/**
 * The vendor's relationships with delivery agencies.
 *
 * ⚠ **`vendors.md:223` is wrong**: it shows `{ active, pending, paused }`.
 * `ConnectionCounts` in
 * `backend/admin/src/modules/vendors/repositories/vendor-context.read.repository.ts:89-97`
 * always emits **seven**, and **there is no `paused` key** — the real name is
 * `pausedReapproval`, which is the state a policy-version bump puts a connection
 * into.
 */
export interface VendorConnectionCounts {
    total: number;
    active: number;
    pending: number;
    pausedReapproval: number;
    rejected: number;
    withdrawn: number;
    terminated: number;
}

export interface VendorCounts {
    products: VendorProductCounts;
    orders: VendorOrderCounts;
    agencyConnections: VendorConnectionCounts;
}

/** `GET /vendors/:vendorId` — every list field, plus the operational picture. */
export interface VendorDetail extends Vendor {
    /** `null` when the vendor has no store yet. */
    store: VendorStore | null;
    /** `null` if the `users` row is missing — which stops them signing in. */
    account: VendorAccount | null;
    /** **Non-null only while `status === 'inactive'`.** */
    suspension: VendorSuspension | null;
    verification: VendorVerification;
    contact: VendorContact;
    addresses: VendorAddress[];
    policies: VendorPolicies;
    settings: VendorSettings;
    defaultDeliveryAgencyId: string | null;
    counts: VendorCounts;
}

/** Why one listing is off sale. `null` unless the listing is suspended. */
export interface ProductSuspension {
    reason: ProductSuspensionReason;
    /** What it will return to, if it returns. */
    previousStatus: ProductStatus | null;
    at: string | null;
    /** Set when an **agency** caused it, rather than the platform or the vendor. */
    byAgencyId: string | null;
    note: string | null;
}

/** A row of `GET /vendors/:vendorId/products` — the catalogue as oversight sees it. */
export interface VendorProduct {
    id: string;
    title: string | null;
    slug: string | null;
    category: string | null;
    type: ProductType;
    status: ProductStatus;
    mode: ProductMode;
    hasVariants: boolean;
    suspension: ProductSuspension | null;
    deliveryAgencyId: string | null;
    lastOrderedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

// ─── Delegated-write shapes ───────────────────────────────────────────────────

/**
 * What a **delegated vendor write** answers: jovi-mall's own admin DTO.
 *
 * Narrower than `VendorDetail` — no `store`, no `account`, no `settings`, no
 * `counts` — and carrying four fields that exist on **one response each**. Same
 * facts, different shape (`backend/admin/src/modules/vendors/gateways/vendor.gateway.ts`,
 * verified against jovi-mall's `toAdminVendorDto`).
 *
 * Modelled but barely used: every write on this dashboard refetches the detail
 * rather than merging this into a cache, so no second mapper exists to drift.
 * The four cascade fields are the exception — they are read straight off the
 * response, because **no later read reports them**.
 */
export interface PlatformVendor {
    id: string;
    userId: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
    status: VendorStatus;
    suspension: VendorSuspension | null;
    verification: VendorVerification;
    onboardingStep: number;
    createdAt: string;
    updatedAt: string;

    /** **Suspend response only.** How many listings the cascade took off sale. */
    suspendedProductCount?: number;
    /** **Suspend response only.** */
    suspendedProductIds?: string[];
    /**
     * **Restore response only.** Routinely fewer than went down: the activation
     * gate re-runs on every listing rather than republishing blindly.
     */
    restoredProductCount?: number;
    /** **Restore response only.** */
    restoredProducts?: RestoredProduct[];
}

export interface RestoredProduct {
    productId: string;
    status: ProductStatus;
}

/**
 * What the two **product** writes answer.
 *
 * ⚠ **`vendors.md:536` describes this as "the product".** It is not — the
 * gateway's own return types are `{ productId }` and `{ productId, status }`
 * (`vendor.gateway.ts:289` and `:315`). There is no product object to merge, so
 * the catalogue panel refetches after a write. That is the honest shape rather
 * than a convenience.
 */
export interface ProductSuspendResult {
    productId: string;
}

export interface ProductRestoreResult {
    productId: string;
    status: ProductStatus;
}

/** `PATCH /vendors/:vendorId/settings` answers **only the three writable fields**. */
export interface VendorSettingsResult {
    autoCancelUnpaidDays: number;
    autoRedirectOrdersToAgency: boolean;
    autoRedirectThresholdAmount: number | null;
}

/**
 * One reason a listing cannot go back on sale.
 *
 * Arrives as `details.blockers` on a `422 VENDOR_PRODUCT_UNSUSPEND_BLOCKED`, and
 * it is the literal answer to *why won't this republish* — the richest error on
 * the surface, and the only one worth rendering as a list rather than a sentence.
 * A known member is `CATALOG_PRODUCT_VENDOR_SUSPENDED`, the guard that stops an
 * agency problem resolving while the vendor is suspended from walking their
 * listings back onto the storefront ([ADR-008 D-4](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)).
 */
export interface ActivationBlocker {
    code: string;
    message: string;
    details?: unknown;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/** `GET /vendors` query parameters. */
export interface VendorListQuery {
    /**
     * 1–120 characters. Matches the **business name** (resolved against `stores`
     * first), the display name, the email, the phone, or — when the term is
     * 24-hex — the **vendor id or its user id**.
     *
     * Both id branches are deliberate: every other admin screen identifies this
     * person by their *user* id, so that is what gets pasted in.
     *
     * An empty string is a `400`, so send no parameter instead. `buildQuery`
     * already drops `''`, which makes `{ search: input }` safe as the box clears.
     */
    search?: string;
    status?: VendorStatus;
    kycStatus?: VendorKycStatus;
    /** Note: **`onboarding`**, while the response field is `onboardingComplete`. */
    onboarding?: VendorOnboardingFilter;
    /** Two letters. The service upper-cases it; any other length is a `400`. */
    country?: string;
    /** ISO-8601 **instants** over `createdAt`, half-open `[from, to)`. Max 366 days. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** One key at a time from `VENDOR_SORT_KEYS`, `-` for descending. */
    sort?: string;
}

/** `GET /vendors/:vendorId/products` query parameters. */
export interface VendorProductListQuery {
    search?: string;
    status?: ProductStatus;
    type?: ProductType;
    mode?: ProductMode;
    /**
     * Only meaningful alongside `status=suspended`; harmless otherwise.
     *
     * This filter earns its place: *which of this vendor's listings did **we**
     * take down, and which did their agency* is unanswerable without it, and the
     * two have very different remedies.
     */
    suspensionReason?: ProductSuspensionReason;
    page?: number;
    limit?: number;
    sort?: string;
}

/**
 * `GET /vendors/:vendorId/activity` query parameters.
 *
 * A deliberate subset of the audit query: no `targetType`/`targetId` (the path
 * pins both, so a caller cannot widen the feed), no `actorId`, no `search`.
 */
export interface VendorActivityQuery {
    /** A `vendors.*` action name. See `VENDOR_AUDIT_ACTIONS`. */
    action?: string;
    /** `attempted` | `succeeded` | `failed` | `denied` | `queued`. */
    status?: string;
    /** ISO-8601 instants. Max 366 days — **not** the 92 that `GET /audit` caps at. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

/** `POST /vendors/:vendorId/suspend`. */
export interface SuspendVendorBody {
    /** Required, trimmed, 3–500 characters. */
    reason: string;
}

/**
 * `POST /vendors/:vendorId/kyc/approve`. The body is **strict** — an unknown key
 * is a `400`, not a silent strip.
 */
export interface ApproveVendorKycBody {
    /** Optional, ≤ 500 characters. */
    note?: string;
}

/**
 * `POST /vendors/:vendorId/kyc/reject`.
 *
 * A rejection requires a reason where an approval does not: a rejection the
 * vendor cannot see the cause of is one they can only respond to by re-submitting
 * blind. It is stored in **jovi-mall**, not only in wi-admin's audit row, for
 * exactly that reason — jovi-mall cannot read this database.
 */
export interface RejectVendorKycBody {
    /** Required, trimmed, 3–500 characters. */
    reason: string;
}

/**
 * `POST /vendors/:vendorId/products/:productId/suspend`.
 *
 * **The field is `note`, not `reason`** — required, 3–500, despite the name
 * (`SuspendVendorProductSchema` in `vendor.validator.ts`).
 */
export interface SuspendVendorProductBody {
    note: string;
}

/**
 * `PATCH /vendors/:vendorId/settings` — the **only** vendor fields an
 * administrator may edit, and the body is `.strict()`.
 *
 * Strict is load-bearing rather than tidy: naming an excluded field is a `400`
 * *before the request reaches jovi-mall*, so a call that looks like it changed a
 * commission can never come back `200` having changed nothing.
 *
 * Deliberately absent: `notifyDaysBeforeExpiry` (a notification to the vendor,
 * about the vendor), `customerFlags` (their private CRM vocabulary), and
 * **commission** — which lives on the billing `PricingPlan` and moves only by
 * assigning a plan. Nothing here should be extended to reach it.
 */
export interface UpdateVendorSettingsBody {
    /** 1–90. Drives a platform sweep worker, which is why it is not the vendor's. */
    autoCancelUnpaidDays?: number;
    /** Decides whether shipments advance without vendor confirmation. */
    autoRedirectOrdersToAgency?: boolean;
    /** ≥ 0, or **`null` to clear the cap** — every order then auto-dispatches. */
    autoRedirectThresholdAmount?: number | null;
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The `?status=` allowlist, verbatim from `vendor.validator.ts` · `VENDOR_STATUSES`. */
export const VENDOR_STATUSES = ['active', 'pending_verification', 'inactive'] as const;

export const VENDOR_KYC_STATUSES = ['pending', 'verified', 'rejected'] as const;

export const VENDOR_ONBOARDING_FILTERS = ['complete', 'incomplete'] as const;

/**
 * The `?sort=` allowlist, verbatim from `vendor.validator.ts` · `VENDOR_SORT`.
 *
 * **Business name is deliberately absent.** It lives on `stores`, so sorting by
 * it would need a `$lookup` before the `$sort` — which cannot use an index and
 * cannot carry the `_id` tiebreaker that keeps skip/limit paging stable
 * ([ADR-008 D-6](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)). The backend's
 * own suite asserts it stays absent, so the UI offers exactly these three.
 */
export const VENDOR_SORT_KEYS = ['createdAt', 'updatedAt', 'email'] as const;

export type VendorSortKey = (typeof VENDOR_SORT_KEYS)[number];

/** What `GET /vendors` orders by when the caller says nothing. */
export const VENDOR_SORT_DEFAULT = '-createdAt';

/**
 * How far back one query of either list may reach.
 *
 * The same 366 on the directory and on the activity feed — note the activity
 * feed does **not** inherit `GET /audit`'s tighter 92-day cap.
 */
export const VENDOR_MAX_RANGE_DAYS = 366;

export const PRODUCT_STATUSES = [
    'draft',
    'active',
    'archived',
    'pending_review',
    'suspended',
] as const;

export const PRODUCT_TYPES = ['physical', 'digital', 'service'] as const;

export const PRODUCT_MODES = ['simple', 'advanced'] as const;

export const PRODUCT_SUSPENSION_REASONS = [
    'default_delivery_agency_removed',
    'product_delivery_agency_removed',
    'agency_connection_paused',
    'agency_storage_suspended',
    'vendor_suspended',
    'platform_oversight',
] as const;

/** The `?sort=` allowlist for the catalogue, from `VENDOR_PRODUCT_SORT`. */
export const PRODUCT_SORT_KEYS = ['createdAt', 'updatedAt', 'lastOrderedAt'] as const;

export const PRODUCT_SORT_DEFAULT = '-createdAt';

/**
 * The `vendors.*` audit actions, for the activity feed's filter.
 *
 * Exactly seven today (`backend/admin/src/modules/audit/domain/audit.catalog.ts:447-495`).
 * The backend **derives** its own filter from the catalog so it widens
 * automatically; this list cannot, so it is a filter vocabulary only.
 *
 * ⚠ **The feed carries at least one action this filter cannot select.**
 * `billing.subscriptions.assign_vendor` is catalogued with `target: 'vendor'`
 * (`audit.catalog.ts:602`), and the feed is pinned to `targetType: 'vendor'` —
 * but the `?action=` enum is `AUDIT_ACTION_NAMES.filter(a => a.startsWith('vendors.'))`.
 * So an incoming row naming an eighth action still renders, because nothing here
 * switches on `action`.
 */
export const VENDOR_AUDIT_ACTIONS = [
    'vendors.suspend',
    'vendors.reinstate',
    'vendors.kyc.approve',
    'vendors.kyc.reject',
    'vendors.products.suspend',
    'vendors.products.restore',
    'vendors.settings.update',
] as const;

/**
 * How the actions read to a person. Falls back to the raw name for anything new
 * — including `billing.subscriptions.assign_vendor`, which the feed carries.
 */
export const VENDOR_AUDIT_ACTION_LABELS: Record<string, string> = {
    'vendors.suspend': 'Suspended',
    'vendors.reinstate': 'Reinstated',
    'vendors.kyc.approve': 'Verification approved',
    'vendors.kyc.reject': 'Verification rejected',
    'vendors.products.suspend': 'Listing taken off sale',
    'vendors.products.restore': 'Listing put back on sale',
    'vendors.settings.update': 'Order settings changed',
    'billing.subscriptions.assign_vendor': 'Subscription plan assigned',
};

/**
 * What each onboarding step is, from
 * `backend/jovi-mall/src/core/constants/onboarding-steps.ts:25-35`.
 *
 * Only the number crosses the wire. **`0` is COMPLETED**, not "not started" —
 * the step counts *down* to done, and reading it the other way is the mistake
 * `onboardingComplete` exists to prevent.
 */
export const VENDOR_ONBOARDING_STEP_LABELS: Record<number, string> = {
    0: 'Complete',
    1: 'Basic setup',
    2: 'Delivery linking',
    3: 'Branding',
    4: 'Policy setup',
};

/** How the six suspension reasons read. */
export const PRODUCT_SUSPENSION_REASON_LABELS: Record<string, string> = {
    default_delivery_agency_removed: 'Default delivery agency removed',
    product_delivery_agency_removed: 'Product delivery agency removed',
    agency_connection_paused: 'Agency connection paused',
    agency_storage_suspended: 'Agency storage suspended',
    vendor_suspended: 'Vendor suspended',
    platform_oversight: 'Platform oversight',
};

/**
 * A suspension reason, as a person reads it.
 *
 * Falls back to the raw value: the six sets are the platform's to extend, and a
 * seventh reason arriving should say what it is rather than blank the cell.
 */
export function productSuspensionReasonLabel(reason: string): string {
    return PRODUCT_SUSPENSION_REASON_LABELS[reason] ?? reason;
}

/**
 * Who an operator should go to about a takedown.
 *
 * The whole point of [ADR-008 D-3](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)'s
 * four disjoint reason sets is that the remedy differs, and *"which of these did
 * **we** do?"* is the question the catalogue's `suspensionReason` filter exists to
 * answer. `null` for an unknown reason rather than a guess.
 */
export function productSuspensionOwner(reason: string): 'platform' | 'agency' | 'vendor' | null {
    if (reason === 'platform_oversight') return 'platform';
    if (reason === 'vendor_suspended') return 'vendor';
    if (
        reason === 'default_delivery_agency_removed' ||
        reason === 'product_delivery_agency_removed' ||
        reason === 'agency_connection_paused' ||
        reason === 'agency_storage_suspended'
    ) {
        return 'agency';
    }
    return null;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * What to call a vendor on screen.
 *
 * All four candidates are individually nullable — a vendor with no store yet has
 * no `businessName`, and `displayName`, `email` and `phone` are each `?? null` in
 * the serializer — so a name has to fall through all of them before landing on
 * the id. The id is a genuine last resort rather than a placeholder: it is one of
 * the two things the search box accepts, so showing it is useful even when ugly.
 */
export function vendorDisplayName(
    vendor: Pick<Vendor, 'id' | 'businessName' | 'displayName' | 'email' | 'phone'>,
): string {
    return (
        vendor.businessName ?? vendor.displayName ?? vendor.email ?? vendor.phone ?? vendor.id
    );
}

/** The identifier not used as the display name, when there is a distinct one. */
export function vendorSecondaryLabel(
    vendor: Pick<Vendor, 'businessName' | 'storeSlug' | 'displayName'>,
): string | null {
    if (vendor.businessName && vendor.storeSlug) return vendor.storeSlug;
    if (vendor.businessName && vendor.displayName) return vendor.displayName;
    return null;
}

/**
 * How far through onboarding they are.
 *
 * Reads `onboardingComplete` rather than testing `onboardingStep === 0`: the
 * server computes the boolean once precisely so nobody re-derives the inversion
 * wrongly, and an unnamed step still renders as its number.
 */
export function vendorOnboardingLabel(
    vendor: Pick<Vendor, 'onboardingStep' | 'onboardingComplete'>,
): string {
    if (vendor.onboardingComplete) return 'Complete';
    return VENDOR_ONBOARDING_STEP_LABELS[vendor.onboardingStep] ?? `Step ${vendor.onboardingStep}`;
}

/**
 * May an administrator take this listing off sale?
 *
 * Only a listing that is actually on sale. jovi-mall answers `422
 * VENDOR_PRODUCT_NOT_SUSPENDABLE` for anything else, so offering the action on a
 * draft or an archived listing buys a guaranteed refusal.
 */
export function canSuspendProduct(product: Pick<VendorProduct, 'status'>): boolean {
    return product.status === 'active';
}

/**
 * May an administrator put this listing back on sale?
 *
 * **Only a `platform_oversight` takedown.** That endpoint lifts one reason and
 * refuses every other with `422 VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED` — an
 * agency-caused suspension is the agency's to lift, and a `vendor_suspended` one
 * is cleared by reinstating the vendor.
 */
export function canRestoreProduct(
    product: Pick<VendorProduct, 'status' | 'suspension'>,
): boolean {
    return product.status === 'suspended' && product.suspension?.reason === 'platform_oversight';
}
