import { describe, expect, it } from 'vitest';

import {
    decideReferralPartner,
    isReferralPartnerGone,
    isReferralPartnerMoved,
    listReferralPartners,
    updateReferralPartnerTerms,
} from '@/services/referrals.service';
import { stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';

const ID = '6900a1b2c3d4e5f6a7b8c901';

const written = () =>
    stubFetch(() =>
        successResponse({ partner: null, result: { id: ID, status: 'active' } }, { message: 'Done' }),
    );

describe('the partner writes', () => {
    it.each([
        ['approve', 'Known owner', { reason: 'Known owner' }],
        ['approve', '   ', {}],
        ['reinstate', undefined, {}],
        ['reject', ' Not eligible ', { reason: 'Not eligible' }],
        ['suspend', 'Under review', { reason: 'Under review' }],
        ['terminate', 'Self-referral', { reason: 'Self-referral' }],
        ['release-balance', 'Reviewed', { reason: 'Reviewed' }],
        ['allow-reapply', 'ignored', {}],
    ] as const)('%s with %j sends %j', async (verb, reason, body) => {
        const calls = written();
        await decideReferralPartner(ID, verb, reason);

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(`/referrals/partners/${ID}/${verb}`);
        expect(JSON.parse(calls[0].body as string)).toEqual(body);
    });

    it('keeps the server’s message, and a null partner rather than inventing one', async () => {
        written();
        const answer = await decideReferralPartner(ID, 'suspend', 'Under review');

        expect(answer.message).toBe('Done');
        expect(answer.partner).toBeNull();
    });

    it('patches terms, sending null to reset', async () => {
        const calls = written();
        await updateReferralPartnerTerms(ID, { terms: { vendor: { durationMonths: null } } });

        expect(calls[0].method).toBe('PATCH');
        expect(calls[0].url).toContain(`/referrals/partners/${ID}/terms`);
        expect(JSON.parse(calls[0].body as string)).toEqual({ terms: { vendor: { durationMonths: null } } });
    });
});

describe('the list', () => {
    it('sends a status and a search as query parameters', async () => {
        const calls = stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));
        await listReferralPartners({ status: 'pending', search: 'ULR' });

        const url = new URL(calls[0].url, 'http://x');
        expect(url.pathname).toContain('/referrals/partners');
        expect(url.searchParams.get('status')).toBe('pending');
        expect(url.searchParams.get('search')).toBe('ULR');
    });
});

describe('the refusals', () => {
    const refused = (code: string, status: number, platformCode?: string) =>
        new ApiError({
            code,
            message: 'refused',
            status,
            category: 'conflict',
            details: platformCode ? { platformCode } : undefined,
        } as ConstructorParameters<typeof ApiError>[0]);

    it('reads both 404s as gone', () => {
        expect(isReferralPartnerGone(refused('NOT_FOUND', 404))).toBe(true);
        expect(isReferralPartnerGone(refused('PLATFORM_OPERATION_REJECTED', 404, 'REFERRAL_PARTNER_NOT_FOUND'))).toBe(true);
        expect(isReferralPartnerGone(refused('PLATFORM_OPERATION_REJECTED', 404, 'SOMETHING_ELSE'))).toBe(false);
    });

    it('reads both 409s as moved, and only on platformCode', () => {
        expect(isReferralPartnerMoved(refused('PLATFORM_OPERATION_REJECTED', 409, 'REFERRAL_PARTNER_STATUS_CONFLICT'))).toBe(true);
        expect(isReferralPartnerMoved(refused('PLATFORM_OPERATION_REJECTED', 409, 'REFERRAL_BALANCE_NOT_FROZEN'))).toBe(true);
        expect(isReferralPartnerMoved(refused('REFERRAL_PARTNER_STATUS_CONFLICT', 409))).toBe(false);
    });
});
