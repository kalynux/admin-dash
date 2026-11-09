/**
 * Service listings — `/api/v1/listings` (2026-11-07).
 *
 * A **service provider** (a vendor of kind `provider`) publishes listings whose
 * contact details customers unlock with a tap, paid for in the provider's
 * credits. Every listing, and every change to a live one, waits for an
 * administrator's decision; a provider's report on a lead opens a
 * `LISTING_LEAD_REPORT` ticket worked from a lead panel.
 *
 * Contract: `api-doc/admin/api/listings.md` and
 * `api-doc/admin/FRONTEND-CHANGELOG-service-listings.md`. ⚠ **That page gives
 * no response shapes**, so every interface here is taken from the source
 * mirrors beside it — `listing-dto.ts`, `listing-contacts-dto.ts`,
 * `listing-lead-dto.ts`, and the two validators — and
 * `listings.types.test.ts` diffs the fixtures' keys and these vocabularies
 * against them. A copy can be diffed; a transcription cannot.
 *
 * ── ⛔ No contact value lives in any shape but `ListingContacts` ──────────────
 * The queue row, the detail and every lead shape carry none, by construction on
 * the server. `availableFields` names WHICH fields a listing has, never their
 * values. The values arrive only from `GET /listings/:id/contacts`, behind its
 * own permission, and every call writes an audit row BEFORE the read.
 *
 * ── Every vocabulary is open ──────────────────────────────────────────────────
 * The DTOs type status, review state, field and channel as `string`, and an
 * added member is a non-breaking change upstream. Each label function prints an
 * unknown value in words rather than throwing.
 */

import { humaniseEnum } from '@/lib/format';
import type { FileDetail } from '@/types/files.types';

// ─── Vocabularies (verbatim from the validator mirrors, order included) ───────

export const LISTING_STATUSES = ['draft', 'pending_review', 'rejected', 'live', 'suspended', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_REVIEW_STATES = ['editing', 'pending_review', 'rejected'] as const;
export type ListingReviewState = (typeof LISTING_REVIEW_STATES)[number];

export const LISTING_SUSPENSION_REASONS = ['insufficient_credits', 'platform_oversight', 'plan_quota_exceeded'] as const;

/** The sensitive fields — names only. Their values are in `ListingContacts` and nowhere else. */
export const LISTING_CONTACT_FIELDS = ['whatsapp', 'phone', 'email', 'website', 'socials', 'location', 'video'] as const;

export const LISTING_LEAD_CHANNELS = ['web', 'whatsapp', 'telegram'] as const;

/** What a provider asks for in a report. */
export const LISTING_REPORT_WANTS = ['refund', 'check_customer'] as const;

export const PROVIDER_CONSENT_STATES = ['granted', 'not_granted', 'revoked'] as const;

/** The keys of the validator's `LISTING_SORT`. */
export const LISTING_SORT_KEYS = ['submittedAt', 'createdAt', 'updatedAt', 'publishedAt'] as const;

/** The keys of `LISTING_LEAD_SORT`. */
export const LISTING_LEAD_SORT_KEYS = ['createdAt', 'windowEnd'] as const;

/** `ListingAction` in the DTO — what `availableActions` may name. */
export const LISTING_ACTIONS = ['approve', 'reject', 'suspend', 'unsuspend'] as const;
export type ListingAction = (typeof LISTING_ACTIONS)[number];

// ─── Body limits (the validators') ────────────────────────────────────────────

/** Every free-text field on these routes: a reject reason, a note, a block reason. */
export const LISTING_NOTE_MIN = 3;
export const LISTING_NOTE_MAX = 500;
/** `RejectListingSchema`: one to five reasons. */
export const LISTING_REJECT_REASONS_MAX = 5;

// ─── Shared pieces ────────────────────────────────────────────────────────────

export interface ListingCategoryRef {
    id: string;
    /** `null` when the category was merged away or deleted — the listing still points at it. */
    name: string | null;
    slug: string | null;
}

/** Who did something. `source` is open (`admin`, `platform`, …). */
export interface ListingActorRef {
    id: string | null;
    source: string;
    name: string | null;
}

// ─── The queue row ────────────────────────────────────────────────────────────

export interface ListingQueueItem {
    id: string;
    slug: string;
    status: string;
    reviewState: string | null;
    /** A live listing carrying an edit under review — the row is a CHANGE to a live listing. */
    isRevision: boolean;
    /** Of the copy under review when one is waiting, else the live copy, else the draft. */
    title: string | null;
    companyName: string | null;
    city: string | null;
    submittedAt: string | null;
    /** How many contacts the automatic check found in the public text. */
    preflagCount: number;
    suspensionReason: string | null;
    vendor: { id: string; displayName: string | null };
    publishedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface ListingListQuery {
    reviewState?: string;
    status?: string;
    vendorId?: string;
    /** 1–120. The title and company name of either copy. */
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: string;
}

// ─── The detail ───────────────────────────────────────────────────────────────

export interface ListingOpeningHours {
    day: string | null;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
}

/** One copy of a listing's public content — the live one, or the one under review. */
export interface ListingContent {
    title: string | null;
    companyName: string | null;
    categories: ListingCategoryRef[];
    country: string | null;
    city: string | null;
    area: string | null;
    description: string | null;
    /** jovi-mall's rich description (`{ blocks }`), or `null`. Read with `RichDescription`. */
    descriptionRich: unknown;
    /** In the provider's order. A swept file drops out rather than rendering dead. */
    photos: FileDetail[];
    openingHours: ListingOpeningHours[] | null;
}

export interface ListingVendorSummary {
    id: string;
    displayName: string | null;
    status: string | null;
    kind: string;
    kycStatus: string;
    verified: boolean;
}

/** A contact the automatic check found in the public text. Help for the reviewer, never a decision. */
export interface ListingPreflag {
    /** `phone` · `email` · `url` (jovi-mall's `ListingPreflag`). Open. */
    kind: string | null;
    /** jovi-mall's storage name: `title`, `company_name`, `area`, `description`, `description_rich`. */
    field: string | null;
    excerpt: string | null;
}

export interface ListingReview {
    state: string | null;
    submittedAt: string | null;
    decidedAt: string | null;
    decidedBy: ListingActorRef | null;
    /** The reasons of the last rejection — the provider sees them. */
    reasons: string[];
    preflags: ListingPreflag[];
    /** The ledger row of the indexing fee taken at submission. A rejection refunds it. */
    indexFeeRef: string | null;
}

export interface ListingLastDecision {
    decision: string | null;
    at: string | null;
    by: ListingActorRef;
    reasons: string[];
}

export interface ListingSuspension {
    reason: string | null;
    previousStatus: string | null;
    at: string | null;
    /** The staff note on `platform_oversight` — ⚠ the provider sees it on their listing. */
    note: string | null;
    by: ListingActorRef;
}

export interface ListingDetail {
    id: string;
    slug: string;
    status: string;
    vendor: ListingVendorSummary;
    published: ListingContent | null;
    pending: ListingContent | null;
    isRevision: boolean;
    review: ListingReview | null;
    lastDecision: ListingLastDecision | null;
    suspension: ListingSuspension | null;
    /** The contact fields the live copy has — names, never values. */
    availableFields: string[];
    counts: { leads: number; reveals: number };
    /** From the listing's state alone. A button needs this AND the permission. */
    availableActions: string[];
    vectorisationStatus: string | null;
    publishedAt: string | null;
    archivedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

// ─── The hidden contacts ──────────────────────────────────────────────────────

export interface ListingContactLocation {
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    components: {
        street: string | null;
        neighbourhood: string | null;
        city: string | null;
        region: string | null;
        country: string | null;
        countryCode: string | null;
    };
}

export interface ListingContactSet {
    whatsapp: string | null;
    phone: string | null;
    /**
     * A second phone number (2026-11-08), or `null` for none. ⚠ **Part of the
     * one `phone` field** — unlocked and charged with it — so it is never an
     * eighth entry in `LISTING_CONTACT_FIELDS`, a reveal row or a report.
     * Read with `?? null`: a wi-admin older than this sends no key.
     */
    phone2: string | null;
    email: string | null;
    website: string | null;
    socials: Array<{ network: string | null; url: string | null }>;
    location: ListingContactLocation | null;
    video: { url: string | null; host: string | null; checkedAt: string | null } | null;
}

/** `GET /listings/:id/contacts`. Both copies, so a revision shows the number it REPLACES. */
export interface ListingContacts {
    listingId: string;
    published: ListingContactSet | null;
    pending: ListingContactSet | null;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

/** The customer IN FULL — what the provider never sees (they get "Jean-Paul K. · ••31"). */
export interface LeadCustomer {
    /** `customers._id` — the id the block route takes. */
    id: string;
    /** `users._id`. `null` when the profile is gone. */
    userId: string | null;
    name: string | null;
    /** The full login phone. */
    phone: string | null;
    email: string | null;
    profileStatus: string | null;
    accountStatus: string | null;
    /** When the customer role was made. A fresh role on an old account is its own signal. */
    profileCreatedAt: string | null;
    /** When the account was made — the drain signal. */
    accountCreatedAt: string | null;
    /** Set on a closed account; the identity fields are then anonymised. */
    accountClosedAt: string | null;
}

export interface LeadRevealRefund {
    at: string | null;
    by: ListingActorRef;
    ticketId: string | null;
    note: string | null;
}

/** One unlocked contact field and what it cost the provider. Never what the customer was shown. */
export interface LeadReveal {
    id: string;
    field: string;
    /** In credits. */
    cost: number;
    /** A grace reveal, paid through the provider's debt. */
    chargedIntoDebt: boolean;
    at: string | null;
    refunded: boolean;
    refund: LeadRevealRefund | null;
}

export interface LeadBlock {
    id: string;
    reason: string;
    ticketId: string | null;
    blockedAt: string | null;
    blockedBy: ListingActorRef;
}

export interface LeadConsent {
    state: string;
    askedAt: string | null;
    grantedAt: string | null;
    revokedAt: string | null;
    source: string | null;
}

/** A row of `GET /listings/:listingId/leads`, and what a refund answers with. */
export interface ListingLead {
    id: string;
    listingId: string;
    vendorId: string;
    customer: LeadCustomer;
    windowStart: string | null;
    windowEnd: string | null;
    /** The 30-day window is still running — the customer is still being served. */
    windowOpen: boolean;
    engagedWhileLive: boolean;
    channel: string | null;
    fieldsRevealed: string[];
    reveals: LeadReveal[];
    /** Summed by the SERVER — printed as sent. */
    credits: { charged: number; refunded: number };
    /** This customer's active block on THIS listing, or `null`. */
    activeBlock: LeadBlock | null;
    /** This customer's opt-in toward THIS provider. */
    consent: LeadConsent;
    createdAt: string | null;
}

export interface LeadListingSummary {
    id: string;
    slug: string | null;
    title: string | null;
    companyName: string | null;
    status: string | null;
}

export interface LeadProviderRef {
    id: string;
    displayName: string | null;
}

export interface LeadAccountRole {
    role: string;
    profileId: string | null;
    status: string | null;
    createdAt: string | null;
    /** On the account's roles with no profile behind it. */
    missing: boolean;
}

export interface OtherLead {
    id: string;
    listing: LeadListingSummary;
    provider: LeadProviderRef;
    windowStart: string | null;
    windowEnd: string | null;
    fieldsRevealed: string[];
    createdAt: string | null;
}

/** The customer's OTHER leads across every listing — how a drain with several numbers is spotted. */
export interface OtherLeads {
    total: number;
    providerCount: number;
    byProvider: Array<{ provider: LeadProviderRef; leads: number; firstAt: string | null; lastAt: string | null }>;
    /** The most recent, newest first. `truncated` when `total` is larger. */
    recent: OtherLead[];
    truncated: boolean;
}

/** `GET /listings/leads/:leadId`. */
export interface ListingLeadDetail extends ListingLead {
    listing: LeadListingSummary;
    provider: LeadProviderRef;
    accountRoles: LeadAccountRole[];
    otherLeads: OtherLeads;
}

/**
 * `listingLead` on a `LISTING_LEAD_REPORT` ticket's detail (`GET
 * /support/tickets/:id`), `null` on every other ticket.
 *
 * A summary and the ids — the customer in full and their other leads are
 * `GET /listings/leads/:leadId`. ⚠ `readable: false` means the caller lacks
 * `catalog.listings.read`: then `lead` is `null`, `namedReveals` `[]`, and only
 * `wants` (the ticket's own content) is real.
 */
export interface ListingLeadTicketContext {
    leadId: string;
    readable: boolean;
    wants: string[];
    listingId: string | null;
    /** The reveal ids the provider named, as stored on the ticket. */
    revealIds: string[];
    lead: {
        listing: LeadListingSummary;
        vendorId: string;
        customerId: string;
        windowStart: string | null;
        windowEnd: string | null;
        channel: string | null;
        fieldsRevealed: string[];
        createdAt: string | null;
    } | null;
    /** The named reveals that ARE on this lead, with their refund state. */
    namedReveals: LeadReveal[];
}

// ─── Write answers ────────────────────────────────────────────────────────────

/** `POST /listings/reveals/:revealId/refund`. The two numbers are `null` when jovi-mall sent none. */
export interface RefundRevealResult {
    revealId: string;
    refundedCredits: number | null;
    balanceAfter: number | null;
    lead: ListingLead;
}

/** `POST` and `DELETE /listings/:listingId/reveal-blocks/:customerId`. */
export interface RevealBlockState {
    listingId: string;
    customerId: string;
    activeBlock: LeadBlock | null;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export const LISTINGS_PATH = '/dashboard/listings';
export const listingPath = (listingId: string) => `${LISTINGS_PATH}/${encodeURIComponent(listingId)}`;
export const listingLeadPath = (leadId: string) => `${LISTINGS_PATH}/leads/${encodeURIComponent(leadId)}`;
/** The queue narrowed to one provider — the vendor page's link. */
export const providerListingsPath = (vendorId: string) =>
    `${LISTINGS_PATH}?view=all&vendorId=${encodeURIComponent(vendorId)}`;

// ─── Words ────────────────────────────────────────────────────────────────────

const label = (map: Record<string, string>, value: string | null | undefined, fallback = 'Unknown') =>
    value ? (map[value] ?? humaniseEnum(value) ?? value) : fallback;

const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    pending_review: 'Waiting for review',
    rejected: 'Rejected',
    live: 'Live',
    suspended: 'Offline',
    archived: 'Archived',
};
export const listingStatusLabel = (status: string | null | undefined) => label(STATUS_LABELS, status);

const REVIEW_STATE_LABELS: Record<string, string> = {
    editing: 'Being edited',
    pending_review: 'Waiting for review',
    rejected: 'Rejected',
};
export const listingReviewStateLabel = (state: string | null | undefined) =>
    label(REVIEW_STATE_LABELS, state, 'Never submitted');

const SUSPENSION_LABELS: Record<string, string> = {
    insufficient_credits: 'Out of credits',
    platform_oversight: 'Taken offline by staff',
    plan_quota_exceeded: 'Over the plan’s listing limit',
};
export const listingSuspensionLabel = (reason: string | null | undefined) => label(SUSPENSION_LABELS, reason);

/** What lifts each suspension — only one of the three is ours to lift. */
const SUSPENSION_REMEDIES: Record<string, string> = {
    insufficient_credits: 'It comes back by itself when the provider tops up their credits.',
    platform_oversight: 'An administrator took it offline. Put it back from here when the problem is fixed.',
    plan_quota_exceeded: 'It comes back by itself when the provider’s plan allows another listing.',
};
export const listingSuspensionRemedy = (reason: string | null | undefined) =>
    (reason && SUSPENSION_REMEDIES[reason]) || null;

const CONTACT_FIELD_LABELS: Record<string, string> = {
    whatsapp: 'WhatsApp',
    phone: 'Phone',
    email: 'Email',
    website: 'Website',
    socials: 'Social links',
    location: 'Location',
    video: 'Location video',
};
export const listingContactFieldLabel = (field: string | null | undefined) => label(CONTACT_FIELD_LABELS, field);

const PREFLAG_KIND_LABELS: Record<string, string> = {
    phone: 'Phone number',
    email: 'Email address',
    url: 'Link',
};
export const preflagKindLabel = (kind: string | null | undefined) => label(PREFLAG_KIND_LABELS, kind, 'Contact');

/** jovi-mall's storage names (`detectPreflags`), into the field names the screen shows. */
const PREFLAG_FIELD_LABELS: Record<string, string> = {
    title: 'Title',
    company_name: 'Company name',
    area: 'Area',
    description: 'Description',
    description_rich: 'Description',
};
export const preflagFieldLabel = (field: string | null | undefined) => label(PREFLAG_FIELD_LABELS, field, 'Text');

const WANT_LABELS: Record<string, string> = {
    refund: 'A refund',
    check_customer: 'Check this customer',
};
export const listingReportWantLabel = (want: string) => label(WANT_LABELS, want);

const CONSENT_LABELS: Record<string, string> = {
    granted: 'Agreed to be contacted by this provider',
    not_granted: 'Has not agreed to be contacted',
    revoked: 'Withdrew their agreement',
};
export const leadConsentLabel = (state: string | null | undefined) => label(CONSENT_LABELS, state);

const CHANNEL_LABELS: Record<string, string> = {
    web: 'Website',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
};
export const leadChannelLabel = (channel: string | null | undefined) => label(CHANNEL_LABELS, channel, 'Unknown channel');

const DECISION_LABELS: Record<string, string> = { approved: 'Approved', rejected: 'Rejected' };
export const listingDecisionLabel = (decision: string | null | undefined) => label(DECISION_LABELS, decision);

/** `"1 credit"` / `"3 credits"`. Credits, never money. */
export function formatCredits(value: number): string {
    return `${value.toLocaleString('en-US')} ${value === 1 ? 'credit' : 'credits'}`;
}

/** Who did it, in words. `admin` with no name is "An administrator"; `platform` is the platform. */
export function listingActorLabel(actor: ListingActorRef | null | undefined): string {
    if (!actor) return 'Unknown';
    if (actor.name?.trim()) return actor.name.trim();
    if (actor.source === 'admin') return 'An administrator';
    if (actor.source === 'platform' || actor.source === 'system') return 'The platform';
    return humaniseEnum(actor.source) ?? actor.source;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

/**
 * Whether the listing's state allows `action` now. The server's
 * `availableActions` is the answer — this only reads it. Whether THIS
 * administrator may is the permission's question; a button needs both.
 */
export function listingOffers(listing: Pick<ListingDetail, 'availableActions'>, action: ListingAction): boolean {
    return listing.availableActions.includes(action);
}

/** Waiting for an administrator's decision. */
export function isAwaitingReview(listing: Pick<ListingDetail, 'review'> | Pick<ListingQueueItem, 'reviewState'>): boolean {
    return 'reviewState' in listing ? listing.reviewState === 'pending_review' : listing.review?.state === 'pending_review';
}

/** The copy the reviewer is judging: the one under review if one waits, else the live copy, else the draft. */
export function copyUnderReview(listing: Pick<ListingDetail, 'review' | 'published' | 'pending'>): ListingContent | null {
    if (listing.review?.state === 'pending_review' && listing.pending) return listing.pending;
    return listing.published ?? listing.pending ?? null;
}

/** A name to call the listing by — never empty. */
export function listingName(listing: { title: string | null; companyName: string | null; slug?: string | null; id: string }): string {
    return listing.title?.trim() || listing.companyName?.trim() || listing.slug?.trim() || listing.id;
}

export type ListingContentField =
    | 'title'
    | 'companyName'
    | 'categories'
    | 'location'
    | 'description'
    | 'photos'
    | 'openingHours';

/**
 * Which public fields a revision changes — so a reviewer of a change to a live
 * listing sees WHAT changed instead of re-reading everything. Compared by value
 * (categories and photos by id, in order); no field is treated as unchanged
 * when it cannot be compared.
 */
export function changedListingFields(
    live: ListingContent | null,
    next: ListingContent | null,
): Set<ListingContentField> {
    const changed = new Set<ListingContentField>();
    if (!live || !next) return changed;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!same(live.title, next.title)) changed.add('title');
    if (!same(live.companyName, next.companyName)) changed.add('companyName');
    if (!same(live.categories.map((c) => c.id), next.categories.map((c) => c.id))) changed.add('categories');
    if (!same([live.country, live.city, live.area], [next.country, next.city, next.area])) changed.add('location');
    if (!same(live.description, next.description) || !same(live.descriptionRich, next.descriptionRich)) {
        changed.add('description');
    }
    if (!same(live.photos.map((p) => p.id), next.photos.map((p) => p.id))) changed.add('photos');
    if (!same(live.openingHours, next.openingHours)) changed.add('openingHours');
    return changed;
}

/** `true` when `value` is jovi-mall's `{ blocks: [...] }` rich description document. */
export function isRichDescription(value: unknown): value is { blocks: unknown[] } {
    return typeof value === 'object' && value !== null && Array.isArray((value as { blocks?: unknown }).blocks);
}

/** A reveal can be refunded once. */
export function canRefundReveal(reveal: Pick<LeadReveal, 'refunded'>): boolean {
    return !reveal.refunded;
}
