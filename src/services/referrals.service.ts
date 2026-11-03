/**
 * `/referrals` — the seventeen routes of the referral program (2026-11-02).
 *
 * Source: `api-doc/admin/api/referrals.md` and
 * `backend/admin/src/modules/referrals/`.
 *
 * ── Reads direct, writes delegated ────────────────────────────────────────────
 * Every read comes straight from the shared database. **Every write is executed
 * by jovi-mall and audited fail-closed**, so a refusal arrives as
 * `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in `details.platformCode`,
 * and a plain `404 NOT_FOUND` is wi-admin's own: gone before the call was made.
 *
 * Each partner write answers `{ partner, result }` with the fresh detail and a
 * sentence in `message` saying what happened.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { ApiError, type Paginated } from '@/types/api.types';
import type {
    ReferralPartner,
    ReferralPartnerAck,
    ReferralPartnerListQuery,
    ReferralPartnerRow,
    ReferralPartnerVerb,
    ReferralPartnerWriteResult,
    ReferralReward,
    ReferralRewardDetail,
    ReferralRewardListQuery,
    ReferralSettings,
    ReferralSummary,
    ReferralSummaryQuery,
    ReferredAccount,
    ReferredListQuery,
    UpdatePartnerTermsBody,
    UpdateReferralSettingsBody,
} from '@/types/referrals.types';

const partnerPath = (partnerId: string, suffix = '') =>
    `/referrals/partners/${encodeURIComponent(partnerId)}${suffix}`;

/** `GET /referrals/settings` · `referrals.read` (every tier). */
export function getReferralSettings(options?: RequestOptions): Promise<ReferralSettings> {
    return api.get<ReferralSettings>('/referrals/settings', options);
}

/**
 * `PATCH /referrals/settings` · `referrals.settings.write` (`financial`, tier 1) ·
 * audited `referrals.settings.update`. Any subset, and strict.
 */
export function updateReferralSettings(
    body: UpdateReferralSettingsBody,
    options?: RequestOptions,
): Promise<ReferralSettings> {
    return api.patch<ReferralSettings>('/referrals/settings', body, options);
}

/** `GET /referrals/summary` · `referrals.read`. `from`/`to` are on when rewards were earned. */
export function getReferralSummary(
    query: ReferralSummaryQuery = {},
    options?: RequestOptions,
): Promise<ReferralSummary> {
    return api.get<ReferralSummary>(withQuery('/referrals/summary', { ...query }), options);
}

/** `GET /referrals/rewards` · `referrals.read`. */
export function listReferralRewards(
    query: ReferralRewardListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ReferralReward>> {
    return api.list<ReferralReward>(withQuery('/referrals/rewards', { ...query }), options);
}

/** `GET /referrals/rewards/:rewardId` · `referrals.read`. */
export function getReferralReward(
    rewardId: string,
    options?: RequestOptions,
): Promise<ReferralRewardDetail> {
    return api.get<ReferralRewardDetail>(`/referrals/rewards/${encodeURIComponent(rewardId)}`, options);
}

/**
 * `GET /referrals/partners` · `referrals.read`. `?status=pending` is the
 * applications queue. ⚠ `search` matches the START of a code, phone or email,
 * and never a name.
 */
export function listReferralPartners(
    query: ReferralPartnerListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ReferralPartnerRow>> {
    return api.list<ReferralPartnerRow>(withQuery('/referrals/partners', { ...query }), options);
}

/** `GET /referrals/partners/:partnerId` · `referrals.read`. */
export function getReferralPartner(
    partnerId: string,
    options?: RequestOptions,
): Promise<ReferralPartner> {
    return api.get<ReferralPartner>(partnerPath(partnerId), options);
}

/** `GET /referrals/partners/:partnerId/referred` · `referrals.read`. */
export function listPartnerReferred(
    partnerId: string,
    query: ReferredListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ReferredAccount>> {
    return api.list<ReferredAccount>(withQuery(partnerPath(partnerId, '/referred'), { ...query }), options);
}

/** `GET /referrals/partners/:partnerId/rewards` · `referrals.read`. */
export function listPartnerRewards(
    partnerId: string,
    query: ReferralRewardListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ReferralReward>> {
    return api.list<ReferralReward>(withQuery(partnerPath(partnerId, '/rewards'), { ...query }), options);
}

async function write(
    method: 'POST' | 'PATCH',
    partnerId: string,
    suffix: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
): Promise<ReferralPartnerWriteResult> {
    const { data, message } = await api.mutate<{
        partner: ReferralPartner | null;
        result: ReferralPartnerAck;
    }>(method, partnerPath(partnerId, suffix), body, options);
    return { partner: data?.partner ?? null, result: data?.result, message };
}

/**
 * The seven decisions on a partner, one per verb.
 *
 * ⚠ **`approve` and `reinstate` take an optional note, sent as no key when
 * blank** — the strict body trims and then refuses anything under three
 * characters, so `""` is a `400`. `allow-reapply` is an empty object and takes no
 * reason at all. The other four require one.
 */
export function decideReferralPartner(
    partnerId: string,
    verb: ReferralPartnerVerb,
    reason?: string,
    options?: RequestOptions,
): Promise<ReferralPartnerWriteResult> {
    const trimmed = reason?.trim();
    const body = verb !== 'allow-reapply' && trimmed ? { reason: trimmed } : {};
    return write('POST', partnerId, `/${verb}`, body, options);
}

/**
 * `PATCH /referrals/partners/:partnerId/terms` · `referrals.settings.write` ·
 * audited `referrals.partner.terms_update`. Each field stands alone, and `null`
 * returns it to the global value.
 */
export function updateReferralPartnerTerms(
    partnerId: string,
    body: UpdatePartnerTermsBody,
    options?: RequestOptions,
): Promise<ReferralPartnerWriteResult> {
    return write('PATCH', partnerId, '/terms', { ...body }, options);
}

// ─── jovi-mall's refusals, as `details.platformCode` ─────────────────────────

const CODE_NOT_FOUND = 'NOT_FOUND';

/** 409 — that verb cannot run from the partner's current status. `details.status`. */
export const PLATFORM_CODE_REFERRAL_PARTNER_STATUS_CONFLICT = 'REFERRAL_PARTNER_STATUS_CONFLICT';
/** 409 — no frozen balance to release, or it was already released. */
export const PLATFORM_CODE_REFERRAL_BALANCE_NOT_FROZEN = 'REFERRAL_BALANCE_NOT_FROZEN';
/** 404 — gone between wi-admin's read and jovi-mall's write. */
export const PLATFORM_CODE_REFERRAL_PARTNER_NOT_FOUND = 'REFERRAL_PARTNER_NOT_FOUND';

/** Either half of "no such partner": wi-admin's own `404`, or jovi-mall's. */
export function isReferralPartnerGone(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error.platformCode === PLATFORM_CODE_REFERRAL_PARTNER_NOT_FOUND) return true;
    return error.code === CODE_NOT_FOUND && error.platformCode === undefined;
}

/** Someone else got there first. A re-read, not a retry. */
export function isReferralPartnerMoved(error: unknown): boolean {
    return (
        error instanceof ApiError &&
        (error.platformCode === PLATFORM_CODE_REFERRAL_PARTNER_STATUS_CONFLICT ||
            error.platformCode === PLATFORM_CODE_REFERRAL_BALANCE_NOT_FROZEN)
    );
}
