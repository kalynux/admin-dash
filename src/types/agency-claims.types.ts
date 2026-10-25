/**
 * `/agency-claims` — damage claims charged to a delivery agency (2026-10-22,
 * owner decision F-8).
 *
 * Contract: [agency-claims.md](../../api-doc/admin/api/agency-claims.md) and
 * [the changelog](../../api-doc/admin/FRONTEND-CHANGELOG-refund-fees-and-claims.md).
 * Wire shapes taken from wi-admin's `agencies/gateways/agency-claim.gateway.ts`
 * (`PlatformAgencyClaim`, `PlatformAgencyClaimEligibility`) — every route is
 * **delegated** to jovi-mall and passed through as it answers.
 *
 * A claim charges the agency for **one parcel** damaged in delivery and credits
 * the **vendor**. It is allowed only inside the agency's own window and up to
 * its own per-item limit; the agency pays the claim **plus its investigation
 * fee** (never its rider). **One claim per parcel**, and a claim cannot be
 * edited or undone.
 *
 * ── Who ─────────────────────────────────────────────────────────────────────
 * The three reads are `agencies.read` (Support answers *"why was this agency
 * charged"*); the charge is **`agencies.claims.charge`** — `financial`, tiers
 * 1–2, never Support.
 *
 * ⛔ **Nothing here decides eligibility.** `eligible` and `reason` are
 * jovi-mall's verdict; the one product this client forms — the ceiling
 * `maxPerItem × itemCount` — is what the contract asks the form to SHOW, and the
 * server refuses above it (`AGENCY_CLAIM_EXCEEDS_CAP`) regardless.
 */

import { ApiError } from '@/types/api.types';

export interface AgencyClaim {
    id: string;
    /** `damage` — the only kind today. Open. */
    kind: string;
    shipmentId: string;
    orderId: string;
    orderNumber: string | null;
    trackingNumber: string | null;
    agencyId: string;
    vendorId: string | null;
    refundRequestId: string | null;
    itemCount: number;
    /** What was asked for. */
    claimedAmount: number;
    maxPerItem: number;
    /** `maxPerItem × itemCount`, as the platform computed it. */
    cap: number;
    /** What was charged — the claim, without the fee. */
    amount: number;
    investigationFee: number;
    currency: string;
    deliveredAt: string;
    raisedAt: string;
    windowDays: number;
    note: string;
    createdBy: { id: string | null; name: string | null };
    reasonCode: string;
    reasonParams: Record<string, unknown>;
    /** The sentence the agency reads on its earnings screen. Print it as sent. */
    explanation: string;
    /** Where the agency's money came from: held for that parcel, reserve, available, then debt. */
    takenFrom: { pending: number; reserve: number; available: number; debt: number };
    createdAt: string;
}

/** `GET /agency-claims/eligibility?shipmentId=&refundRequestId=` */
export interface AgencyClaimEligibility {
    shipmentId: string;
    orderId: string;
    orderNumber: string | null;
    trackingNumber: string | null;
    agencyId: string | null;
    vendorId: string | null;
    currency: string;
    deliveredAt: string | null;
    firstProblemAt: string | null;
    raisedAt: string;
    windowDays: number;
    windowEndsAt: string | null;
    insideWindow: boolean;
    maxPerItem: number;
    investigationFee: number;
    existingClaimId: string | null;
    eligible: boolean;
    /** `not_delivered` · `no_agency` · `no_per_item_limit` · `outside_window` · `already_claimed`. Open. */
    reason: string | null;
}

/** `GET /agency-claims` — ⚠ a **strict** query: these keys and nothing else. */
export interface AgencyClaimListQuery {
    agencyId?: string;
    vendorId?: string;
    shipmentId?: string;
    page?: number;
    limit?: number;
}

/** `POST /agency-claims` — strict. */
export interface ChargeAgencyClaimBody {
    shipmentId: string;
    itemCount: number;
    /** Whole XAF, > 0, at most `maxPerItem × itemCount`. */
    amount: number;
    note: string;
    refundRequestId?: string;
}

export const CLAIM_ITEM_COUNT_MIN = 1;
export const CLAIM_ITEM_COUNT_MAX = 1000;
export const CLAIM_NOTE_MIN = 3;
export const CLAIM_NOTE_MAX = 1000;

/**
 * The ceiling the form shows — `maxPerItem × itemCount` (agency-claims.md:
 * *"Show `maxPerItem × items` as the ceiling"*). Display only: the server
 * re-checks and its `details.cap` wins when it refuses.
 */
export function claimCeiling(maxPerItem: number, itemCount: number): number {
    return maxPerItem * itemCount;
}

/**
 * Why a parcel cannot be claimed, in words. `outside_window` names when the
 * window closed. An unknown reason prints raw.
 */
export function claimIneligibleReason(
    eligibility: Pick<AgencyClaimEligibility, 'reason' | 'windowEndsAt' | 'windowDays'>,
    formatInstant: (iso: string | null) => string | null,
): string {
    switch (eligibility.reason) {
        case 'not_delivered':
            return 'This parcel has not been delivered, so nothing can have been damaged in its delivery yet.';
        case 'no_agency':
            return 'This parcel has no delivery agency to charge.';
        case 'no_per_item_limit':
            return 'The agency set no maximum refund per item, so its terms allow no damage claim.';
        case 'outside_window': {
            const ended = formatInstant(eligibility.windowEndsAt);
            return ended
                ? `The agency’s ${eligibility.windowDays}-day damage-claim window closed on ${ended}.`
                : `The problem was raised outside the agency’s ${eligibility.windowDays}-day damage-claim window.`;
        }
        case 'already_claimed':
            return 'This parcel already has a damage claim. Only one is allowed per parcel.';
        case null:
            return 'The platform did not say why.';
        default:
            return eligibility.reason.replace(/_/g, ' ');
    }
}

// ─── jovi-mall's refusals, as `details.platformCode` ─────────────────────────

/** `422` — raised after the agency's window; `details.windowEndsAt` when it survives the scrub. */
export const PLATFORM_CODE_AGENCY_CLAIM_OUTSIDE_WINDOW = 'AGENCY_CLAIM_OUTSIDE_WINDOW';
/** `422` — above `maxPerItem × itemCount`; `details.cap`. */
export const PLATFORM_CODE_AGENCY_CLAIM_EXCEEDS_CAP = 'AGENCY_CLAIM_EXCEEDS_CAP';
/** `409` — the parcel already has a claim. */
export const PLATFORM_CODE_AGENCY_CLAIM_EXISTS = 'AGENCY_CLAIM_EXISTS';
/** `422` — not delivered, no agency, or no per-item limit. */
export const PLATFORM_CODE_AGENCY_CLAIM_NOT_ELIGIBLE = 'AGENCY_CLAIM_NOT_ELIGIBLE';
/** `404` on `GET /agency-claims/:claimId`. */
export const PLATFORM_CODE_AGENCY_CLAIM_NOT_FOUND = 'AGENCY_CLAIM_NOT_FOUND';

/** The jovi-mall code on a delegated refusal, or `null`. Never `error.code` — it is `PLATFORM_OPERATION_REJECTED`. */
export function agencyClaimRefusalOf(error: unknown): string | null {
    if (!(error instanceof ApiError) || !error.isPlatformRejection) return null;
    return error.platformCode ?? null;
}

/** `details.cap` on an `AGENCY_CLAIM_EXCEEDS_CAP`, when it arrived. */
export function claimCapOf(error: unknown): number | null {
    if (!(error instanceof ApiError)) return null;
    const cap = error.details?.cap;
    return typeof cap === 'number' ? cap : null;
}
