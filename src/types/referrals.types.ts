import { humaniseEnum } from '@/lib/format';
import type { RoutedPermissionName } from '@/types/permissions.types';

/**
 * The referral program (2026-11-02) — `api-doc/admin/api/referrals.md`, with the
 * shapes taken from `backend/admin/src/modules/referrals/read-models/referral.dto.ts`.
 *
 * Partners earn a percentage of the vendor commission Wi-Mall earns on accounts
 * they referred. ⛔ **Nothing here can change who referred whom** — no such
 * route exists, on purpose.
 *
 * Every vocabulary is read from jovi-mall's `referral-rules.ts` and is **open**:
 * the query filters are bounded strings rather than enums, and an unknown value
 * renders in words instead of breaking a closed switch.
 */

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const REFERRAL_PARTNER_STATUSES = [
    'pending',
    'active',
    'rejected',
    'suspended',
    'terminated',
] as const;

/**
 * The categories that can earn, and so the rows of terms. `provider` since
 * 2026-11-08: a service provider, who earns their partner a percentage of the
 * **full price** they pay Wi-Mall for a plan or credit pack — not a commission.
 * ⚠ Against a wi-admin older than that, `terms.provider` is absent: screens show
 * and edit only the categories the server reports (`referralTermCategories`).
 */
export const REFERRAL_EARNING_CATEGORIES = ['vendor', 'customer', 'agency', 'provider'] as const;
export type ReferralEarningCategory = (typeof REFERRAL_EARNING_CATEGORIES)[number];

/**
 * ⚠ **One more than can earn.** An `agent` relationship is recorded for
 * traceability and never earns: `expiresAt` is `null` and `earning` is `false`
 * from the day it is written.
 */
export const REFERRED_CATEGORIES = [...REFERRAL_EARNING_CATEGORIES, 'agent'] as const;

export const REFERRAL_REWARD_STATUSES = ['held', 'released', 'reversed'] as const;

export const REFERRAL_PARTNER_SORT_DEFAULT = '-appliedAt';
export const REFERRAL_REWARD_SORT_DEFAULT = '-earnedAt';
export const REFERRAL_REFERRED_SORT_DEFAULT = '-registeredAt';

/** The widest `from`/`to` span on the rewards list and the summary. */
export const REFERRAL_MAX_RANGE_DAYS = 366;

export const REFERRAL_REASON_MIN = 3;
export const REFERRAL_REASON_MAX = 1000;

export const REFERRAL_RATE_MAX = 25;
export const REFERRAL_DURATION_MIN = 1;
export const REFERRAL_DURATION_MAX = 120;
export const REFERRAL_WAIT_MAX = 365;

// ─── Labels ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
    pending: 'Waiting for a decision',
    active: 'Active',
    rejected: 'Rejected',
    suspended: 'Suspended',
    terminated: 'Terminated',
};

const REWARD_STATUS_LABELS: Record<string, string> = {
    held: 'Waiting',
    released: 'Released',
    reversed: 'Reversed',
};

const CATEGORY_LABELS: Record<string, string> = {
    vendor: 'Vendor',
    customer: 'Customer',
    agency: 'Agency',
    agent: 'Agent',
    provider: 'Service provider',
};

const CHANNEL_LABELS: Record<string, string> = {
    web: 'Web link',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
};

const SOURCE_LABELS: Record<string, string> = {
    order: 'Order',
    booking: 'Booking',
    cod_collection: 'Cash collected at delivery',
    shipment: 'Delivery',
    agency_claim: 'Damage claim',
    // A provider reward's source (2026-11-08).
    plan_purchase: 'Plan purchase',
    credit_topup: 'Credit pack',
};

const PAYMENT_KIND_LABELS: Record<string, string> = {
    plan: 'Plan purchase',
    credits: 'Credit pack',
};

const labelOf = (labels: Record<string, string>, value: string | null | undefined): string =>
    (value ? labels[value] : undefined) ?? humaniseEnum(value) ?? 'Unknown';

export const referralPartnerStatusLabel = (status: string | null | undefined) =>
    labelOf(STATUS_LABELS, status);
export const referralRewardStatusLabel = (status: string | null | undefined) =>
    labelOf(REWARD_STATUS_LABELS, status);
export const referralCategoryLabel = (category: string | null | undefined) =>
    labelOf(CATEGORY_LABELS, category);
export const referralChannelLabel = (channel: string | null | undefined) =>
    labelOf(CHANNEL_LABELS, channel);
export const referralSourceLabel = (source: string | null | undefined) =>
    labelOf(SOURCE_LABELS, source);
export const referralPaymentKindLabel = (kind: string | null | undefined) =>
    labelOf(PAYMENT_KIND_LABELS, kind);

// ─── Wire shapes ──────────────────────────────────────────────────────────────

export interface ReferralGlobalCategoryTerms {
    ratePercent: number;
    durationMonths: number;
}

/** `GET /referrals/settings`. The defaults arrive when no settings document exists yet. */
export interface ReferralSettings {
    enabled: boolean;
    terms: Record<string, ReferralGlobalCategoryTerms>;
    minPayoutAmount: number;
    rewardWaitDays: number;
    updatedAt: string | null;
    updatedBy: string | null;
}

/** `PATCH /referrals/settings` — any subset, and strict. */
export interface UpdateReferralSettingsBody {
    enabled?: boolean;
    terms?: Partial<Record<ReferralEarningCategory, Partial<ReferralGlobalCategoryTerms>>>;
    minPayoutAmount?: number;
    rewardWaitDays?: number;
}

export interface ReferralBalances {
    currency: string;
    pending: number;
    available: number;
    requested: number;
    clawback: number;
}

/** A row of `GET /referrals/partners`. */
export interface ReferralPartnerRow {
    id: string;
    userId: string;
    /** Whichever role profile holds one; `null` on a closed or unresolved account. */
    name: string | null;
    phone: string | null;
    email: string | null;
    appliedAsRole: string;
    status: string;
    /** `null` until the first approval. A person approved again keeps the same code. */
    code: string | null;
    appliedAt: string;
    approvedAt: string | null;
    balances: ReferralBalances;
}

export interface ReferralPartnerCategoryTerms {
    ratePercent: number;
    rateIsCustom: boolean;
    durationMonths: number;
    durationIsCustom: boolean;
}

export interface ReferralStatusChange {
    /** `null` on the first entry, the application itself. */
    from: string | null;
    to: string;
    at: string;
    /** `null` when nobody acted for the platform: the person applying. */
    by: string | null;
    reason: string | null;
}

export interface ReferralBalanceRelease {
    at: string;
    by: string | null;
    reason: string;
}

/** `GET /referrals/partners/:partnerId` — the row plus the rest of the record. */
export interface ReferralPartner extends ReferralPartnerRow {
    motivation: string | null;
    termsAcceptedAt: string | null;
    statusReason: string | null;
    canReapply: boolean;
    /**
     * ⚠ **Also `true` on a `pending` or `rejected` partner**: the service computes
     * `status !== 'active' && !balanceReleased`. Read it with
     * {@link isReferralBalanceFrozen}, never directly.
     */
    balanceFrozen: boolean;
    balanceReleased: ReferralBalanceRelease | null;
    terms: Record<string, ReferralPartnerCategoryTerms>;
    referred: { referred: number; earning: number };
    history: ReferralStatusChange[];
}

/** A row of `GET /referrals/partners/:partnerId/referred`. */
export interface ReferredAccount {
    id: string;
    partnerId: string;
    userId: string;
    name: string | null;
    phone: string | null;
    category: string;
    codeUsed: string;
    channel: string;
    registeredAt: string;
    expiresAt: string | null;
    earning: boolean;
    /** Net of refunds. The row names no currency: it is the partner's wallet's. */
    totalEarned: number;
}

export interface ReferralRewardAdjustment {
    at: string;
    refundKey: string | null;
    /** ⚠ `null` below tier 1, like `commissionEarned`. */
    commissionRetained: number | null;
    amountBefore: number;
    amountAfter: number;
}

export interface ReferralRewardPayment {
    kind: string;
    id: string;
    /** The full price paid, the reward's base. Printed as sent. */
    amountPaid: number;
}

/** A row of `GET /referrals/rewards`, and of `onSameCommission`. */
export interface ReferralReward {
    id: string;
    partnerId: string;
    relationshipId: string;
    referredUserId: string;
    referredName: string | null;
    category: string;
    sourceType: string;
    orderId: string | null;
    bookingId: string | null;
    /** On a provider reward, the provider. */
    vendorId: string;
    /** ⚠ `null` on a provider reward (2026-11-08), which comes from a payment. */
    commissionId: string | null;
    /**
     * ⚠ `true` below tier 1, where the commission figures are `null` and never zero.
     * 🔴 **Also `true` below tier 1 on a provider reward**, which has no commission
     * at all — so never render "Hidden" from it alone: read it with
     * {@link referralCommissionWithheld}.
     */
    commissionWithheld: boolean;
    commissionEarned: number | null;
    /**
     * A provider reward's source (2026-11-08): `plan` | `credits`, `null` on a
     * commission reward. Optional: an older wi-admin sends neither key.
     */
    paymentKind?: string | null;
    /** The plan purchase or credit top-up and the full price paid — every tier sees it. */
    payment?: ReferralRewardPayment | null;
    sharePercent: number;
    ratePercent: number;
    rateSource: string;
    amount: number;
    clawedAmount: number;
    remaining: number;
    currency: string;
    status: string;
    earnedAt: string;
    availableFrom: string;
    releasedAt: string | null;
    reversedAt: string | null;
    adjustments: ReferralRewardAdjustment[];
}

/**
 * `GET /referrals/rewards/:rewardId`. ⚠ `reward` can be `null`: the service reads
 * at most fifty rewards of one commission and looks for this one among them.
 * ⚠ For a provider reward `onSameCommission` holds the rewards on the same
 * **payment** — the key kept its name; `reward.payment` says which it is.
 */
export interface ReferralRewardDetail {
    reward: ReferralReward | null;
    onSameCommission: ReferralReward[];
}

/** The payment a provider reward came from, or `null` on a commission reward. */
export function referralRewardPayment(reward: Pick<ReferralReward, 'payment'>): ReferralRewardPayment | null {
    return reward.payment ?? null;
}

/**
 * Whether a commission figure is being held back from this reader. ⚠ Never on a
 * provider reward: it has no commission, so there is nothing to hide, even though
 * wi-admin still sets `commissionWithheld` below tier 1.
 */
export function referralCommissionWithheld(reward: Pick<ReferralReward, 'commissionWithheld' | 'payment'>): boolean {
    return reward.commissionWithheld && !reward.payment;
}

/**
 * The earning categories whose terms the server reported — the rows to show and
 * edit. A category it does not report (an older wi-admin and `provider`) is
 * neither shown as "not set" nor sent, because a strict body would refuse it.
 */
export function referralTermCategories(terms: Record<string, unknown>): ReferralEarningCategory[] {
    return REFERRAL_EARNING_CATEGORIES.filter((category) => terms[category] !== undefined);
}

export interface ReferralSummaryRewardRow {
    currency: string;
    status: string;
    /** Net of refunds. */
    amount: number;
    count: number;
}

/** `GET /referrals/summary`. `partners` names only the statuses somebody is in. */
export interface ReferralSummary {
    rewards: ReferralSummaryRewardRow[];
    partners: Record<string, number>;
}

export interface ReferralPartnerListQuery {
    status?: string;
    search?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface ReferredListQuery {
    category?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface ReferralRewardListQuery {
    status?: string;
    category?: string;
    orderId?: string;
    bookingId?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface ReferralSummaryQuery {
    from?: string;
    to?: string;
}

/** `PATCH /partners/:id/terms` — `null` returns a field to the global value. */
export type UpdatePartnerTermsBody = {
    terms: Partial<
        Record<
            ReferralEarningCategory,
            { ratePercent?: number | null; durationMonths?: number | null }
        >
    >;
};

/** jovi-mall's acknowledgement, passed through as `result`. */
export interface ReferralPartnerAck {
    id: string;
    status: string;
    code: string | null;
    canReapply: boolean;
    balanceReleased: boolean;
}

/**
 * What every partner write answers: the fresh detail, and the server's sentence.
 * ⚠ `partner` is `null` when the re-read after the commit found nothing, so the
 * screen reloads rather than reporting a failure that did not happen.
 */
export interface ReferralPartnerWriteResult {
    partner: ReferralPartner | null;
    result: ReferralPartnerAck;
    message: string | undefined;
}

/** A partner's own page. Also where the money screens send a `referral_partner` owner. */
export const referralPartnerPath = (partnerId: string) =>
    `/dashboard/referrals/partners/${encodeURIComponent(partnerId)}`;

export const referralRewardPath = (rewardId: string) =>
    `/dashboard/referrals/rewards/${encodeURIComponent(rewardId)}`;

/** A person first, then the code; a pending applicant has no code and may have no name. */
export function referralPartnerName(
    partner: Pick<ReferralPartnerRow, 'name' | 'code' | 'phone' | 'email'>,
): string {
    return partner.name ?? partner.code ?? partner.phone ?? partner.email ?? 'Unnamed partner';
}

// ─── The verbs ────────────────────────────────────────────────────────────────

export type ReferralPartnerVerb =
    | 'approve'
    | 'reject'
    | 'suspend'
    | 'reinstate'
    | 'terminate'
    | 'allow-reapply'
    | 'release-balance';

/** Each verb's permission: the three tiers hold `decide`, tiers 1–2 hold `balance`. */
export const REFERRAL_VERB_PERMISSION: Record<ReferralPartnerVerb, RoutedPermissionName> = {
    approve: 'referrals.partners.decide',
    reject: 'referrals.partners.decide',
    suspend: 'referrals.partners.decide',
    reinstate: 'referrals.partners.decide',
    terminate: 'referrals.partners.decide',
    'allow-reapply': 'referrals.partners.decide',
    'release-balance': 'referrals.partners.balance',
};

const VERBS_BY_STATUS: Record<string, readonly ReferralPartnerVerb[]> = {
    pending: ['approve', 'reject'],
    active: ['suspend', 'terminate'],
    suspended: ['reinstate', 'terminate', 'release-balance'],
    terminated: ['allow-reapply', 'release-balance'],
    rejected: ['allow-reapply'],
};

/**
 * The verbs valid for this partner, from the changelog's table and jovi-mall's
 * `referral-partner.service.ts`.
 *
 * ⚠ **Two of them are narrower than the status.** `allow-reapply` is refused once
 * `canReapply` is already true, and `release-balance` once a balance was released;
 * both answer `409`, so neither is offered. An unknown status offers nothing.
 */
export function referralPartnerVerbs(
    partner: Pick<ReferralPartner, 'status' | 'canReapply' | 'balanceReleased'>,
): readonly ReferralPartnerVerb[] {
    return (VERBS_BY_STATUS[partner.status] ?? []).filter((verb) => {
        if (verb === 'allow-reapply') return !partner.canReapply;
        if (verb === 'release-balance') return partner.balanceReleased === null;
        return true;
    });
}

/**
 * Is this balance frozen, in the sense an administrator would mean it?
 *
 * ⚠ The field alone says yes about a brand-new applicant, who has nothing to
 * freeze. So a `pending` or `rejected` partner counts only while money is really
 * there, which happens: someone terminated with a balance can reapply, and the
 * balance stays frozen with them.
 */
export function isReferralBalanceFrozen(
    partner: Pick<ReferralPartner, 'status' | 'balanceFrozen' | 'balances'>,
): boolean {
    if (!partner.balanceFrozen) return false;
    if (partner.status === 'suspended' || partner.status === 'terminated') return true;
    const { pending, available, requested } = partner.balances;
    return pending + available + requested > 0;
}

/** A referred account's standing: earning, finished, or a category that never earns. */
export function referredEarningLabel(row: Pick<ReferredAccount, 'earning' | 'category'>): string {
    if (row.earning) return 'Earning';
    return row.category === 'agent' ? 'Never earns' : 'Period ended';
}

/**
 * The owner's one computed figure (2026-11-03): what the program has cost so far,
 * per currency, as **held + released**. A reversed reward nets to zero by
 * construction, and an unknown status is left out rather than guessed into a cost.
 */
export function referralCostTotals(
    rows: readonly ReferralSummaryRewardRow[],
): { currency: string; amount: number }[] {
    const totals = new Map<string, number>();
    for (const row of rows) {
        if (row.status !== 'held' && row.status !== 'released') continue;
        totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
    }
    return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

/** The statuses to list on the summary: the five known, then anything else sent. */
export function referralSummaryPartnerRows(
    partners: Record<string, number>,
): { status: string; count: number }[] {
    const known: readonly string[] = REFERRAL_PARTNER_STATUSES;
    const extra = Object.keys(partners).filter((status) => !known.includes(status));
    return [...known, ...extra].map((status) => ({ status, count: partners[status] ?? 0 }));
}

// ─── The numbers on the two terms forms ───────────────────────────────────────

const DECIMAL = /^\d{1,3}(\.\d{1,2})?$/;
const WHOLE = /^\d{1,9}$/;

/** A rate is 0–25 with at most two decimals. `0` is legal. `null` when it is not one. */
export function parseReferralRate(text: string): number | null {
    const trimmed = text.trim();
    if (!DECIMAL.test(trimmed)) return null;
    const value = Number(trimmed);
    return value <= REFERRAL_RATE_MAX ? value : null;
}

/** A duration is 1–120 whole months. */
export function parseReferralDuration(text: string): number | null {
    const trimmed = text.trim();
    if (!WHOLE.test(trimmed)) return null;
    const value = Number(trimmed);
    return value >= REFERRAL_DURATION_MIN && value <= REFERRAL_DURATION_MAX ? value : null;
}

export const REFERRAL_RATE_ERROR = `From 0 to ${REFERRAL_RATE_MAX}, with at most two decimals`;
export const REFERRAL_DURATION_ERROR = `From ${REFERRAL_DURATION_MIN} to ${REFERRAL_DURATION_MAX} whole months`;
export const REFERRAL_MIN_PAYOUT_ERROR = 'A whole amount of at least 1';
export const REFERRAL_WAIT_ERROR = `From 0 to ${REFERRAL_WAIT_MAX} whole days`;

/** The settings form's text, one string per input. */
export interface ReferralSettingsDraft {
    /** Only the categories the server reported (`referralTermCategories`). */
    terms: Partial<Record<ReferralEarningCategory, { rate: string; duration: string }>>;
    minPayout: string;
    waitDays: string;
}

export function referralSettingsDraft(settings: ReferralSettings): ReferralSettingsDraft {
    const terms: ReferralSettingsDraft['terms'] = {};
    for (const category of referralTermCategories(settings.terms)) {
        const current = settings.terms[category];
        terms[category] = {
            rate: String(current.ratePercent),
            duration: String(current.durationMonths),
        };
    }
    return {
        terms,
        minPayout: String(settings.minPayoutAmount),
        waitDays: String(settings.rewardWaitDays),
    };
}

/** Field errors, keyed `vendor.rate`, `customer.duration`, `minPayout`, `waitDays`. */
export function referralSettingsDraftErrors(draft: ReferralSettingsDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const category of REFERRAL_EARNING_CATEGORIES) {
        const row = draft.terms[category];
        if (!row) continue;
        if (parseReferralRate(row.rate) === null) {
            errors[`${category}.rate`] = REFERRAL_RATE_ERROR;
        }
        if (parseReferralDuration(row.duration) === null) {
            errors[`${category}.duration`] = REFERRAL_DURATION_ERROR;
        }
    }
    const minPayout = draft.minPayout.trim();
    if (!WHOLE.test(minPayout) || Number(minPayout) < 1) errors.minPayout = REFERRAL_MIN_PAYOUT_ERROR;
    const waitDays = draft.waitDays.trim();
    if (!WHOLE.test(waitDays) || Number(waitDays) > REFERRAL_WAIT_MAX) errors.waitDays = REFERRAL_WAIT_ERROR;
    return errors;
}

/**
 * The fields the draft changed, and only those.
 *
 * ⚠ **Never the whole form.** The route takes any subset, and a rate and a
 * duration are separate decisions with separate consequences, so an administrator
 * who changed one rate must not also re-send a duration a colleague has changed
 * since this page loaded. Assumes a draft with no errors.
 */
export function referralSettingsPatch(
    settings: ReferralSettings,
    draft: ReferralSettingsDraft,
): UpdateReferralSettingsBody {
    const patch: UpdateReferralSettingsBody = {};
    const terms: NonNullable<UpdateReferralSettingsBody['terms']> = {};

    for (const category of REFERRAL_EARNING_CATEGORIES) {
        const row = draft.terms[category];
        if (!row) continue;
        const current = settings.terms[category];
        const rate = parseReferralRate(row.rate);
        const duration = parseReferralDuration(row.duration);
        const change: Partial<ReferralGlobalCategoryTerms> = {};
        if (rate !== null && rate !== current?.ratePercent) change.ratePercent = rate;
        if (duration !== null && duration !== current?.durationMonths) change.durationMonths = duration;
        if (Object.keys(change).length > 0) terms[category] = change;
    }
    if (Object.keys(terms).length > 0) patch.terms = terms;

    const minPayout = Number(draft.minPayout.trim());
    if (minPayout !== settings.minPayoutAmount) patch.minPayoutAmount = minPayout;
    const waitDays = Number(draft.waitDays.trim());
    if (waitDays !== settings.rewardWaitDays) patch.rewardWaitDays = waitDays;
    return patch;
}

// ─── The audit vocabulary on one partner ──────────────────────────────────────

/**
 * Every action filed against a `referral_partner` target: wi-admin's
 * `audit.catalog.ts`, 2026-11-02. `audit.md` does not list them yet.
 */
export const REFERRAL_PARTNER_AUDIT_ACTIONS = [
    'referrals.partner.approve',
    'referrals.partner.reject',
    'referrals.partner.suspend',
    'referrals.partner.reinstate',
    'referrals.partner.terminate',
    'referrals.partner.allow_reapply',
    'referrals.partner.release_balance',
    'referrals.partner.terms_update',
    'money.earnings.clawback.write_off_referral_partner',
] as const;

export const REFERRAL_PARTNER_AUDIT_ACTION_LABELS: Record<string, string> = {
    'referrals.partner.approve': 'Approved',
    'referrals.partner.reject': 'Rejected',
    'referrals.partner.suspend': 'Suspended',
    'referrals.partner.reinstate': 'Reinstated',
    'referrals.partner.terminate': 'Terminated',
    'referrals.partner.allow_reapply': 'Allowed a new application',
    'referrals.partner.release_balance': 'Released the balance',
    'referrals.partner.terms_update': 'Changed their terms',
    'money.earnings.clawback.write_off_referral_partner': 'Wrote off refund debt',
};

/** `GET /audit`'s own cap, which this feed reads through. */
export const REFERRAL_ACTIVITY_MAX_RANGE_DAYS = 92;
