/**
 * `/agencies` — the delivery network: who carries shipments, and whether they may.
 *
 * Sources: `docs/admin/api/agencies.md`, `docs/admin/ADR-009-DELIVERY-NETWORK.md`,
 * and — where those disagree with the running service —
 * `backend/admin/src/modules/agencies/` plus
 * `backend/jovi-mall/src/modules/delivery/delivery-agency.model.ts`.
 * **Two shapes below are read from the code because the published contract is
 * wrong about them**; each is marked with the file that settles it.
 *
 * Three properties of this surface shape the types:
 *
 * 1. **An agency is never hard-deleted.** It is referenced by historical orders
 *    and shipments, so there is no `DELETE` and no create either — onboarding is a
 *    four-step flow that provisions a Magazin along the way, and a row inserted
 *    from here would report a business with no name. Deactivation is the model.
 * 2. **Deactivating cascades.** Every vendor product defaulting to the agency is
 *    suspended and their in-flight order items go on hold. The counts come back in
 *    `meta`, not `data` — see `CascadeCounts`.
 * 3. **`status` and `verified` are independent and can legitimately disagree.**
 *    Nothing enforces `legit_verified` today (`requireLegitBusiness` has no call
 *    sites), so an `active` unverified agency is a real, findable state — which is
 *    exactly why `?verified=` exists as its own filter beside `?status=`.
 *
 * ── What this surface deliberately does not offer ─────────────────────────────
 * Editing policies (an edit bumps `policyVersion`, which pauses every connected
 * vendor for re-approval — an administrator changing a price on the agency's
 * behalf would silently re-open every relationship it has), un-verifying, and
 * creating. Do not build affordances for them expecting an endpoint to appear.
 */

import { resolvePartyName, type ResolvedPartyName } from '@/lib/party';
import type { ActorStamp } from '@/types/actor.types';

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * May the agency operate?
 *
 * A **pinned** three-value enum, unlike the contract vocabulary next door — this
 * one wi-admin writes: `verify` moves `pending_verification → active` and
 * `deactivate` moves anything → `inactive`. A filter that could name a fourth
 * value would be a filter for a state no verb here produces.
 *
 * Verified: `agency.validator.ts` `AGENCY_STATUSES`, and the model's own enum.
 */
export type AgencyStatus = 'active' | 'pending_verification' | 'inactive' | (string & {});

export const AGENCY_STATUSES = ['active', 'pending_verification', 'inactive'] as const;

// ─── The policies block ───────────────────────────────────────────────────────

/**
 * The agency's own commercial terms — pricing, returns, damage and COD.
 *
 * **camelCase and field-by-field since the dashboard-request round.** It
 * previously shipped jovi-mall's raw sub-document — four nested blocks of
 * `snake_case` — because `agency.controller.ts` assigned `agency.policies`
 * whole. It is now named-field mapped, and `agencies.md` documents every field.
 * These types were pinned to the storage casing on purpose and were **meant** to
 * break when the mapper landed; this is that break, taken.
 *
 * ⚠ **Read-only here, and deliberately so.** Every edit bumps `policyVersion`,
 * which pauses every connected vendor's relationship for re-approval — an
 * administrator changing a price on the agency's behalf would silently re-open
 * every connection they have. `policyVersionPausedConnections` on the detail is
 * how many are sitting in that state right now.
 *
 * The projection stays wide — these are terms already visible to every connected
 * vendor, so there is no field that could be added which this surface should not
 * see — and the **mapper** is the lock: a field added upstream reaches the read
 * model and stops there rather than appearing on the wire uninvited.
 */
export interface AgencyStorageBasedPricing {
    /**
     * ⚠ **`false` means the agency does not offer warehousing at all** —
     * different from offering it at zero. Say so rather than printing a rate
     * nobody agreed to.
     */
    enabled: boolean;
    monthlyStorageFeePerSku: number;
    pickPackFeePerOrder: number;
    localDeliveryFee: number;
    outOfRegionDeliveryFee: number;
}

export interface AgencyPickupBasedPricing {
    /** As above: `false` is "not offered", not "offered free". */
    enabled: boolean;
    baseRateFirstKg: number;
    additionalPerKg: number;
    outOfRegionSurcharge: number;
}

export interface AgencyCodHandlingFee {
    /** `percentage` or `fixed` — **it decides how `value` reads**. */
    type: 'percentage' | 'fixed' | (string & {});
    value: number;
}

export interface AgencyAdditionalFees {
    codHandlingFee: AgencyCodHandlingFee;
    failedDeliveryFee: number;
    rtoFee: number;
    peakSeasonSurcharge?: number | null;
}

export interface AgencyPoliciesPricing {
    storageBased: AgencyStorageBasedPricing;
    pickupBased: AgencyPickupBasedPricing;
    additionalFees: AgencyAdditionalFees;
    notes?: string | null;
}

export interface AgencyPoliciesReturns {
    payer: 'vendor' | 'agency' | 'customer' | (string & {});
    handlingFee: number;
    returnWindowDays: number;
    notes?: string | null;
}

export interface AgencyPoliciesDamage {
    claimDeadlineDays: number;
    maxRefundPerItem: number;
    /** **Administrator-controlled upstream**, not the agency's to set. */
    inspector?: 'agency' | 'vendor' | 'admin' | (string & {});
    /** **Administrator-controlled upstream.** Defaults to 1000. */
    investigationFee?: number;
    notes?: string | null;
}

export interface AgencyPoliciesCod {
    enabled: boolean;
    /** ⚠ **`null` means no ceiling**, not zero — zero would block every COD order. */
    maxOrderAmount: number | null;
}

/**
 * ⚠ **Each inner block is independently `null`** when the agency has stored
 * none, and `policies` itself is `null` when it has stored nothing at all.
 */
export interface AgencyPolicies {
    pricing: AgencyPoliciesPricing | null;
    returns: AgencyPoliciesReturns | null;
    damage: AgencyPoliciesDamage | null;
    cod: AgencyPoliciesCod | null;
    /**
     * Up to two URLs to off-platform term sheets, for terms the blocks above do
     * not cover.
     *
     * **Rendered as links and never fetched.** This dashboard resolves no file
     * URLs anywhere (ADR-008 D-6) and these point outside the platform
     * entirely — wi-admin never fetches or previews them either.
     */
    documents?: string[];
}

// ─── The records ──────────────────────────────────────────────────────────────

/** A row on `GET /agencies`. */
export interface Agency {
    id: string;
    userId: string;
    /**
     * From the Magazin. `null`, never `""` — absent data is absent (ADR-005 D-16).
     *
     * **Not sortable.** It lives on a joined collection, so no index can serve an
     * order on it; the directory sorts a rendered page by name client-side instead.
     */
    businessName: string | null;
    /** An opaque id. This service resolves no file URLs (ADR-008 D-6). */
    logoFileId: string | null;
    /** The agency's contact person, not the business. */
    contactName: string | null;
    /** ISO-3166 alpha-2. */
    country: string | null;
    status: AgencyStatus;
    /** `onboarding_step === 0` is the COMPLETE sentinel, computed once server-side. */
    onboardingComplete: boolean;
    /**
     * The canonical business-verification flag (`kyc_details.legit_verified`).
     *
     * Independent of `status` — see this file's header.
     */
    verified: boolean;
    /**
     * The deprecated top-level mirror of `verified`.
     *
     * **Both are returned deliberately.** They are written together by the one
     * writer there is, so a disagreement means a hand-edited document — showing
     * both makes that visible instead of picking a winner and hiding the fact.
     * The UI calls a mismatch out rather than rendering either silently.
     */
    verifiedLegacyMirror: boolean;
    /** Whether the agency opted into auto-assignment. Defaults off; opt-in. */
    autoAssignEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

/** The business-verification record. */
export interface AgencyKyc {
    registrationNumber: string | null;
    transportLicenseId: string | null;
    verifiedAt: string | null;
    /**
     * ⚠ **Present only while verified.** An unverified agency carrying a stale
     * approver would read as approved on any screen that renders the block without
     * checking the flag first.
     *
     * ⚠ `source` is `'platform' | 'admin'` — **never `"wi-admin"`**, which is what
     * `agencies.md:188` shows. Same `ActorSource` the `/users` and `/vendors`
     * surfaces already model, written by the same `actorStampFields()` helper, so
     * this imports `ActorStamp` rather than declaring a third copy. An `admin` id
     * resolves only in the wi-admin database and must not be linked as a platform
     * user; `name` is a write-time snapshot and the only readable record of who acted.
     */
    verifiedBy: ActorStamp | null;
}

/** `GET /agencies/:agencyId` — every list field, plus these. */
export interface AgencyDetail extends Agency {
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean;
    /** From the Magazin. Region names, not a geometry. */
    coverageAreas: string[];
    kyc: AgencyKyc;
    /** `null` when unset. Read-only here — see this file's header. */
    policies: AgencyPolicies | null;
    /** Bumping it pauses every vendor connection for re-approval. */
    policyVersion: number;
    /**
     * How many vendor connections are sitting in `paused_reapproval` **right
     * now**.
     *
     * New in the dashboard-request round: `policyVersion` is the field with the
     * largest blast radius on this screen and there was previously no way to see
     * the consequence. The vendor side has carried
     * `counts.agencyConnections.pausedReapproval` all along — the two count the
     * same collection from opposite ends.
     */
    policyVersionPausedConnections: number;
    timezone: string | null;
    preferredLanguage: string | null;
}

/**
 * What a delegated agency write answers with.
 *
 * jovi-mall's own DTO, forwarded — narrower than `AgencyDetail` and in its own
 * shape. Modelled separately rather than pretending the two are one type, which
 * is how a screen renders `undefined`. Every write on this surface **refetches**
 * rather than merging this into the detail, following the Phase 6 rule.
 */
export interface PlatformAgency {
    id: string;
    status?: AgencyStatus;
    [key: string]: unknown;
}

/**
 * What a cascade moved.
 *
 * ⚠ **These arrive in `meta`, not `data`** — they describe what the write *did*,
 * not what the agency now *is* — so the two cascade writes go through `api.mutate`
 * rather than `api.post`, which discards `meta`.
 *
 * ⚠ **A missing count reads as `0`.** `agency.gateway.ts:216-226` normalises
 * jovi-mall's two differently-named pairs (`suspendedProductCount` /
 * `restoredProductCount`, `heldOrderItemCount` / `unheldOrderItemCount`) and
 * coerces anything non-numeric to zero, so "the count was absent" and "nothing
 * moved" are indistinguishable on the wire. Do not present `0` as a positive
 * assertion that nothing happened.
 */
export interface CascadeCounts {
    products: number;
    orderItems: number;
}

/** A cascade write's full answer: the agency, and what it did to everything else. */
export interface AgencyCascadeResult {
    agency: PlatformAgency;
    counts: CascadeCounts;
    /** wi-admin's own sentence, worth surfacing verbatim — it names both numbers. */
    message?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** `GET /agencies`. */
export interface AgencyListQuery {
    /**
     * Matches the business name (on the Magazin), the contact name, the email,
     * the phone, or — when the term is a 24-hex string — the agency id.
     *
     * Trimmed, 1–120 chars. An **empty `?search=` is rejected**, so send no
     * parameter instead.
     */
    search?: string;
    status?: AgencyStatus;
    /** The business-verification flag. Independent of `status`. */
    verified?: boolean;
    autoAssign?: boolean;
    /** ISO-3166 alpha-2, upper-cased. Exactly two letters. */
    country?: string;
    /** ISO-8601 instants with an explicit zone. Date-only values are refused. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** One key at a time from `AGENCY_SORT_KEYS`, `-` for descending. */
    sort?: string;
}

/** `GET /agencies/:agencyId/activity` — the administrators' audit feed. */
export interface AgencyActivityQuery {
    /** An `agencies.*` action name. See `AGENCY_AUDIT_ACTIONS`. */
    action?: string;
    /** `attempted` | `succeeded` | `failed` | `denied` | `queued`. */
    status?: string;
    /** ISO-8601 instants. Max 366 days — **not** `GET /audit`'s tighter 92. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

// ─── Write bodies ─────────────────────────────────────────────────────────────

/**
 * `POST /agencies/:agencyId/verify` takes **no body**, and the schema is strict —
 * sending any field is a `400`.
 *
 * Deliberate: the act is an approval, the actor is stamped on the agency and on
 * the audit row, and a free-text reason nobody is required to fill produces a
 * column of empty strings. Contrast `deactivate`, where the reason *is* the record.
 */
export type VerifyAgencyBody = Record<string, never>;

/**
 * `POST /agencies/:agencyId/reject` — the other half of the verification review.
 *
 * ⚠ **The reason is FORWARDED to jovi-mall and stored on the agency**, unlike
 * the deactivation reason below, which is audit-only. The distinction is who
 * reads it: a deactivation reason is for an administrator reviewing the decision
 * later, and a rejection reason is for the **agency**, who has to know what to
 * fix and cannot read this database. So the dialog must say the agency will see
 * it — the opposite of what `DeactivateAgencyBody` requires.
 *
 * ⚠ **Rejecting changes no status.** jovi-mall leaves the agency at
 * `pending_verification`; it is not deactivated and no cascade runs. And there
 * is deliberately **no un-reject** — the agency is still pending, so
 * `POST /verify` accepts them once they fix what the reason named.
 */
export interface RejectAgencyBody {
    /** Required. 3–500 characters. Shown to the agency. */
    reason: string;
}

/**
 * `POST /agencies/:agencyId/deactivate`.
 *
 * The reason requirement is **new in wi-admin** — jovi-mall's own endpoint takes
 * none. Vendors will ask why their listings went dark, and without it the only
 * answer available is "an administrator did it".
 *
 * ⚠ It is carried in the **audit row's payload and nowhere else**. No column is
 * added to the agency record, because no agency-facing screen shows a
 * deactivation reason — so the dialog must not imply the agency will be told.
 */
export interface DeactivateAgencyBody {
    /** Required. 3–500 characters. */
    reason: string;
}

/**
 * `POST /agencies/:agencyId/reactivate`.
 *
 * The asymmetry with `deactivate` is deliberate rather than an oversight: undoing
 * a restriction needs no justification; imposing one does.
 */
export interface ReactivateAgencyBody {
    /** Optional. 3–500 characters when given. */
    reason?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * What `GET /agencies` may be ordered by.
 *
 * **`businessName` is deliberately absent** — see `Agency['businessName']`.
 */
export const AGENCY_SORT_KEYS = ['createdAt', 'updatedAt', 'status'] as const;

export type AgencySortKey = (typeof AGENCY_SORT_KEYS)[number];

/** What `GET /agencies` orders by when the caller says nothing. */
export const AGENCY_SORT_DEFAULT = '-createdAt';

/**
 * How far back one query of the directory or the activity feed may reach.
 *
 * Note the activity feed does **not** inherit `GET /audit`'s tighter 92-day cap.
 */
export const AGENCY_MAX_RANGE_DAYS = 366;

/**
 * The three audited actions this surface writes.
 *
 * Derived on the backend from the audit catalog rather than typed out, so an
 * eighth `agencies.*` action would widen the filter automatically. Transcribed
 * here from `audit.catalog.ts:374-397`; if it drifts, the filter offers a value
 * the feed cannot return, which is visible immediately as an empty page.
 */
export const AGENCY_AUDIT_ACTIONS = [
    'agencies.verify',
    'agencies.deactivate',
    'agencies.reactivate',
] as const;

export type AgencyAuditAction = (typeof AGENCY_AUDIT_ACTIONS)[number];

export const AGENCY_AUDIT_ACTION_LABELS: Record<AgencyAuditAction, string> = {
    'agencies.verify': 'Verified',
    'agencies.deactivate': 'Deactivated',
    'agencies.reactivate': 'Reactivated',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * What to call an agency on screen, **and which of the three it is**.
 *
 * The business name when there is one, the contact's name when there is not, and
 * the id as a last resort — a Magazin is provisioned during onboarding, so an
 * agency mid-flow legitimately has no business name yet and must still be
 * identifiable in a list.
 *
 * ⚠ This is the fallthrough that made
 * [BR-006](../../docs/dashboard/backend-requests/BR-006-agency-name-on-contract-rows.md)
 * necessary: `contactName` is the agency's contact **person**, and a column
 * headed *"Agency"* rendering it has been showing a human where a company was
 * meant. The resolved form exists so that column can tell the difference —
 * `kind === 'contact'` means demote it to a sub-line labelled
 * `PARTY_NAME_SOURCE_LABELS.contactName` rather than pass it off as the
 * business. **This is the only one of the five helpers whose fallthrough names
 * a different entity**, which is why it is the only one with a resolved form.
 */
export function resolveAgencyDisplayName(
    agency: Pick<Agency, 'businessName' | 'contactName' | 'id'>,
): ResolvedPartyName {
    return resolvePartyName(
        [
            { source: 'businessName', value: agency.businessName },
            { source: 'contactName', value: agency.contactName },
        ],
        { source: 'id', value: agency.id },
    );
}

/**
 * The same answer as a bare string, for the many places that only want a label.
 *
 * ⚠ **Behaviour change**: this used `??`, so an empty or whitespace-only
 * `businessName` rendered a blank cell. It now falls through to `contactName`
 * and then to the id — see `lib/party.ts`.
 */
export function agencyDisplayName(agency: Pick<Agency, 'businessName' | 'contactName' | 'id'>): string {
    return resolveAgencyDisplayName(agency).value;
}

/**
 * Whether the canonical verification flag and its deprecated mirror disagree.
 *
 * They are written together, so `true` here means somebody edited the document by
 * hand. Surfaced rather than resolved — see `Agency['verifiedLegacyMirror']`.
 */
export function hasVerificationMismatch(agency: Pick<Agency, 'verified' | 'verifiedLegacyMirror'>): boolean {
    return agency.verified !== agency.verifiedLegacyMirror;
}

/**
 * Which of the three writes an agency in this state can accept.
 *
 * A label helper for deciding what to *offer*, never a gate — holding the
 * permission is necessary and never sufficient, and jovi-mall performs each of
 * these as a compare-and-set, so a `true` here means "show the button", not
 * "it will succeed".
 */
export function canVerifyAgency(agency: Pick<Agency, 'status' | 'verified'>): boolean {
    return agency.status === 'pending_verification' || !agency.verified;
}

export function canDeactivateAgency(agency: Pick<Agency, 'status'>): boolean {
    return agency.status !== 'inactive';
}

export function canReactivateAgency(agency: Pick<Agency, 'status'>): boolean {
    return agency.status === 'inactive';
}
