/**
 * `GET /{vendors,agencies,agents}/:id/verification` — **the evidence behind a KYC
 * verdict**, and the review model the dashboard builds on top of it.
 *
 * Source: [`verification.md`](../../api-doc/admin/api/verification.md), plus the
 * three party pages that each carry the route. Not a route group of its own —
 * one read hangs off each party domain.
 *
 * ── What this closes ──────────────────────────────────────────────────────────
 * Until 2026-09-14 a verification verdict rested on a string. `verification.md`
 * puts the whole of what a reviewer could see in one table:
 *
 * | Role | What was visible | Checkable against |
 * |---|---|---|
 * | Vendor | `kyc_details.national_id_number` | nothing |
 * | Agency | `registration_number`, `transport_license_id` | nothing — and both describe a *company*, not the person holding the cash |
 * | Agent | `kyc.reference` — a free-text note an **administrator** wrote themselves | itself |
 *
 * So every verdict was *"either a rubber stamp or a refusal, and neither was
 * evidence"*. This read returns the documents.
 *
 * ── 🔴 The backend grades nothing, and that is a decision ────────────────────
 * There is **no `estimatedVerdict`, no `complete`, no `required` column** on any
 * role under any query parameter — *"The response is facts; the badge is
 * yours."* The required/optional rules are a **review policy**: they change when
 * the reviewers change their minds, and the people who change their minds own
 * this dashboard. `jovi-mall test:kyc` § 4 fails if a completeness check appears
 * on that side, so one turning up would be a regression rather than a feature.
 *
 * Two consequences this module exists to absorb:
 *
 * 1. **An applicant can submit an empty record** and it arrives in the queue.
 *    Badge it and reject it with a reason. That is expected, not a fault.
 * 2. **Nothing will ever say a submission is "valid".** `POST /submit` succeeds
 *    on anything.
 *
 * ⚠ **The permission is the ordinary `{vendors,agencies,agents}.read`, not the
 * review permission — so tier 3 Support can read this.** Deliberate: Support
 * answers *"why was my shop rejected"* tickets and cannot answer one from a
 * status alone. The **verdict** keeps its own permission, because that is the
 * act with consequences. A screen that hid the evidence behind the review gate
 * would take away the thing the Support grant was chosen for.
 *
 * ⚠ **This read is NOT audited and the content route is.** They disclose
 * different things: this hands over names, sizes, types and handles — roughly
 * what `files.resolve` already gives every tier. **Looking at the picture is the
 * disclosure**, and `GET /files/:fileId/content` is the act the audit row
 * describes. So the checklist resolves nothing on mount and every document waits
 * for a click.
 */

import type { ActorStamp } from '@/types/actor.types';
import type { FileDetail } from '@/types/files.types';

// ─── Which party is being reviewed ────────────────────────────────────────────

/**
 * The three surfaces that publish a verdict.
 *
 * It **is** on the wire here, as `data.role` — unusually, since no other read on
 * this service carries a party discriminator. Trust the field rather than the
 * route you called: they agree, and a payload that names itself survives being
 * passed around.
 */
export type VerificationParty = 'vendor' | 'agency' | 'agent';

/**
 * The verdict.
 *
 * ⚠ **`unverified` exists for an agent only**, and its absence on the other two
 * is exactly what makes `status` unsafe as a queue filter — see
 * {@link isAwaitingReview}. Left open like every enum on this wire.
 */
export type VerificationStatus = 'pending' | 'unverified' | 'verified' | 'rejected' | (string & {});

// ─── The wire shape ───────────────────────────────────────────────────────────

/**
 * One address, with the only field that answers *"is this real"*.
 *
 * ⚠ **`geocoded` is the badge input and it is not `coordinates !== null`.** Read
 * the flag: it is what the service computes, the two agree today, and a client
 * that re-derives it owns a second definition that can drift from the first.
 *
 * 🔴 **`coordinates` is GeoJSON `[longitude, latitude]`** — longitude first.
 * Hand it to `googleMapsUrlFromGeoJson`, which does the inversion in the one
 * tested place: `[9.7043, 4.0286]` is Douala and the same pair read the other
 * way round is a point in Nigeria, and **both render as a plausible pin**.
 */
export interface VerificationAddress {
    /** The applicant's own name for it — "Home", "Main Shop", "Warehouse". */
    label: string | null;
    /** The provider's one-line form, or what the applicant typed if never geocoded. */
    formattedAddress: string | null;
    /** `[longitude, latitude]`, or `null` on an address that was never geocoded. */
    coordinates: number[] | null;
    /** `locationiq` · `nominatim` · … `null` when ungeocoded. Informational. */
    provider: string | null;
    /** ⭐ Whether this resolved to a place. The one field the checklist reads. */
    geocoded: boolean;
}

/**
 * The document slots.
 *
 * ⚠ **Two of the six are ARRAYS.** The sketches are `[]` when empty, never
 * `null`, and `limits.multiSlotMaxFiles` is their ceiling — an applicant may
 * legitimately send four photographs of one hand-drawn map. The other four are a
 * single file or `null`.
 *
 * ⚠ **Every one has `url: null` and `access: "authorized"`**, because they live
 * in jovi-mall's private `kyc/` storage tree. That is the normal answer, not a
 * fault: *"a client that renders it shows a broken icon on every identity
 * document in the system."* The `id` is the handle; the bytes come from the
 * audited content route.
 */
export interface VerificationDocuments {
    idCardFront: FileDetail | null;
    idCardBack: FileDetail | null;
    selfieWithId: FileDetail | null;
    /**
     * **Agent only, and `null` on the other two.**
     *
     * ⚠ **Not `agent.vehicle.photoFileId`.** That one is public, set during
     * onboarding, and shown to agencies browsing the directory; this is a
     * private KYC document showing the rider standing beside the vehicle. *"Two
     * pictures, two questions"* — do not substitute one for the other.
     */
    vehicleWithAgent: FileDetail | null;
    homeAddressSketches: FileDetail[];
    /** `[]` for an agent, who has no premises to sketch. */
    storeAddressSketches: FileDetail[];
}

/** Who reached the verdict. `null` while nobody has. */
export interface VerificationReview {
    /**
     * ⚠ Populated only once `status` leaves `pending` / `unverified`. An
     * applicant carrying a stale reviewer would read as decided on any screen
     * that renders the block without checking the status first.
     */
    reviewedBy: ActorStamp | null;
}

/** `GET /{party}/:id/verification`. */
export interface PartyVerification {
    role: VerificationParty;
    status: VerificationStatus;
    /**
     * 🔴 **`null` until the applicant pressed submit — and this is the queue
     * filter, not `status`.**
     *
     * `verification.md` is emphatic: `status: "pending"` is also the **schema
     * default** on a vendor and an agency, so it means *"this account has never
     * touched verification"* as well as *"waiting for you"*. Filtering a review
     * queue on `status` alone lists every vendor who ever registered. An agent's
     * enum has a separate `unverified` and does not carry the ambiguity — the
     * timestamp works for all three, which is why it exists. Use
     * {@link isAwaitingReview}.
     */
    submittedAt: string | null;
    /**
     * Whether the applicant can still change anything. Derived server-side.
     *
     * | `status` | `submittedAt` | `locked` | |
     * |---|---|---|---|
     * | `pending` / `unverified` | `null` | `false` | a **draft** — nobody has asked you to look |
     * | `pending` | set | `true` | waiting for you, frozen while you decide |
     * | `verified` | set | `true` | frozen, so an approved ID cannot be swapped for somebody else's |
     * | `rejected` | set | `false` | unfrozen, so they can fix it and resubmit |
     */
    locked: boolean;
    /**
     * What the applicant was last told. ⚠ **Cleared on resubmission** — the old
     * text describes documents that have been replaced — while the *verdict*
     * stays `rejected` until a reviewer moves it. An applicant cannot promote
     * their own record.
     */
    rejectionReason: string | null;
    verifiedAt: string | null;
    idNumber: string | null;
    /** **Agent only.** Absent on the other two. */
    driversLicenseNumber?: string | null;
    /** **Agent only**, read from `vehicle_info`. Optional *by the reviewing rule*. */
    plateNumber?: string | null;
    /** The applicant's own home. `null` when they have recorded none. */
    homeAddress: VerificationAddress | null;
    /**
     * The business addresses on the account.
     *
     * ⚠ **ABSENT for an agent, not `[]`** — an agent has no premises on this
     * platform. `undefined` and `[]` are different answers here and the
     * checklist must not collapse them: the first means *the question does not
     * apply*, the second means *they have no shop*, which for a vendor is what
     * makes the home address required.
     *
     * ⚠ For an **agency** these come from the **Magazin**, not from the agency
     * profile — which is one of the two reasons this read is delegated.
     */
    storeAddresses?: VerificationAddress[];
    documents: VerificationDocuments;
    review: VerificationReview;
    limits: { multiSlotMaxFiles: number };
}

/**
 * Is this record actually waiting for a reviewer?
 *
 * 🔴 **The one predicate that keeps drafts out of the queue.** See
 * `submittedAt`. A screen that asks `status === 'pending'` instead will treat
 * every account that ever registered as an application, and will then badge all
 * of them *evidence incomplete* — which is true, and is not a finding.
 */
export function isAwaitingReview(record: Pick<PartyVerification, 'submittedAt'>): boolean {
    return record.submittedAt !== null;
}

/** A record the applicant has never submitted. The reviewer should not act on it. */
export function isDraft(record: Pick<PartyVerification, 'submittedAt'>): boolean {
    return record.submittedAt === null;
}

/**
 * `PLATFORM_OPERATION_REJECTED` · `details.platformCode` on all three routes.
 *
 * ⚠ **`verification.md` lists it as an `error.code` at 404 and it is not one.**
 * It is declared in `jovi-mall/src/core/error-codes.ts`, appears in neither
 * wi-admin registry, and this read is **delegated** — so it arrives the way
 * every delegated refusal does, at jovi-mall's original status with its code in
 * `details.platformCode`. Branching on `error.code` would never match.
 *
 * It means *"no such party, **or** an account in a state that has no
 * verification record"* — the second is ordinary, so render it as an absence
 * rather than a fault.
 */
export const PLATFORM_CODE_KYC_SUBJECT_NOT_FOUND = 'KYC_SUBJECT_NOT_FOUND';

// ─── The checklist ────────────────────────────────────────────────────────────

/**
 * What one row of the checklist reports.
 *
 * 🔴 **Four values, and the fourth is still the one that matters.** `missing` is
 * a statement about the *applicant* — they were asked and did not supply it.
 * `unavailable` is a statement about *this screen*: the evidence read has not
 * happened, failed, or was refused. Collapsing them would turn "we could not
 * load it" into "they did not send it", and the rejection reason drafted from
 * that is forwarded to the applicant under the operator's name.
 */
export type EvidenceState =
    /** The applicant supplied it and it is in front of the reviewer. */
    | 'provided'
    /** The applicant was asked for it and it is absent. */
    | 'missing'
    /** Not asked of this role — the condition that would require it does not hold. */
    | 'not_applicable'
    /** Not loaded, not permitted, or the read failed. Nothing is known. */
    | 'unavailable';

/**
 * How much a row weighs.
 *
 * ⚠ These are **the reviewing rule, and the rule is ours** — `verification.md`
 * says so in as many words: *"the API enforces none of it and returns every
 * field for every role regardless."*
 */
export type CheckRequirement = 'required' | 'optional';

/** What kind of thing the row is showing, so the panel knows how to render it. */
export type CheckEvidenceKind = 'file' | 'files' | 'address' | 'text' | 'none';

/** One line of the review checklist. */
export interface VerificationCheck {
    /** Stable across renders and roles; a React key and a test handle. */
    key: string;
    /** What the operator is checking, in their words. */
    label: string;
    /**
     * The same thing named for **the applicant**, who reads the rejection reason.
     *
     * Two labels because the two readers are not the same person: a reason
     * forwarded to a vendor reading *"selfie_with_id: missing"* is the
     * unactionable message `agents.md` spends a paragraph refusing to send.
     */
    applicantLabel?: string;
    requirement: CheckRequirement;
    state: EvidenceState;
    /** Why this row is required, optional or not applicable — rendered beside it. */
    condition?: string;
    /** A sentence naming what is actually there, or what is not. */
    detail?: string;
    kind: CheckEvidenceKind;
    /** For `kind: 'file'`. */
    file?: FileDetail | null;
    /** For `kind: 'files'` — the sketch slots, which are arrays. */
    files?: FileDetail[];
    /** For `kind: 'address'`. */
    addresses?: VerificationAddress[];
    /** For `kind: 'text'` — an ID number, a plate. Rendered copyable. */
    text?: string | null;
}

// ─── The estimate ─────────────────────────────────────────────────────────────

/**
 * What the dashboard thinks the verdict should be.
 *
 * ⚠ **An estimate, and the word is load-bearing.** It reads presence, never
 * content: it cannot tell a legible ID card from a photograph of a wall, and it
 * cannot tell whether the face in the selfie is the face on the card. It answers
 * one mechanical question — *did this applicant supply everything the reviewing
 * rule asks of their role* — because that is the question an operator otherwise
 * answers by opening seven things and remembering which.
 *
 * It never decides. Every verdict stays available whatever it says.
 */
export type VerdictEstimateLevel =
    /** Every required item is present. Nothing here says any of it is genuine. */
    | 'approve'
    /** At least one required item the applicant was asked for is absent. */
    | 'reject'
    /** Nothing is loaded, or the record is a draft. No verdict is suggested. */
    | 'indeterminate';

export interface VerdictEstimate {
    level: VerdictEstimateLevel;
    requiredTotal: number;
    requiredSatisfied: number;
    /** Required rows the applicant did not supply. Drives the drafted reason. */
    missing: VerificationCheck[];
    /** Rows this screen could not read. Drives `indeterminate`. */
    unavailable: VerificationCheck[];
    /** Optional rows not supplied. Never changes `level`. */
    optionalMissing: VerificationCheck[];
    /** One sentence, for the badge's tooltip and the panel's summary line. */
    summary: string;
}

// ─── The verdict the dialog submits ───────────────────────────────────────────

/**
 * What the reviewer may do, and what text that act needs.
 *
 * The three write surfaces disagree on all of it — a vendor approval takes an
 * optional internal `note`, an agency approval takes **no body at all** (`{}`,
 * strict), an agent verdict takes four statuses plus an optional off-platform
 * `reference` — so the dialog is told rather than inferring. Inferring is how a
 * strict body gets an unexpected key and a `400`.
 */
export type VerdictTextMode =
    /** No text field. `POST /agencies/:agencyId/verify` takes `{}` and rejects any key. */
    | 'none'
    /** Optional, internal — the applicant never sees it. */
    | 'optional-note'
    /** Required 3–500 and **forwarded to the applicant**. */
    | 'required-reason';

export interface VerdictOption {
    value: string;
    label: string;
    /** What this verdict does, said before it is chosen. */
    description: string;
    textMode: VerdictTextMode;
    textLabel?: string;
    textHint?: string;
    textPlaceholder?: string;
    destructive?: boolean;
    /** Which estimate level this verdict corresponds to, if any. */
    estimates?: VerdictEstimateLevel;
}

/** The verdict on the record now, so the dialog can say what it is changing. */
export interface CurrentVerdict {
    status: string;
    reason: string | null;
    decidedAt: string | null;
    decidedBy: ActorStamp | null;
}

/** wi-admin's `reasonText` bounds, so a refusal costs no round trip. */
export const VERDICT_REASON_MIN = 3;
export const VERDICT_REASON_MAX = 500;
