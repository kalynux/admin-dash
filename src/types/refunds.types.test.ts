import { describe, expect, it } from 'vitest';

import { refundRequestFixture, typedRefundRequestFixture } from '@/test/refund-fixtures';
import { ApiError } from '@/types/api.types';
import {
    canApproveRefund,
    canRejectRefund,
    canResolveRefund,
    canRetryRefund,
    canSettleRefundExternally,
    isOwnTypedNumber,
    isRefundOpen,
    isTypedPhoneValid,
    REFUND_REQUEST_STATUSES,
    refundFinalisingNote,
    refundRefusalCode,
} from '@/types/refunds.types';

/*
 * The server's own `ACTIONABLE_FROM` table (refunds/domain/refund-vocabulary.ts),
 * pinned row by row. Every rule here is one a reasonable person gets backwards,
 * and none shows at runtime until money moves twice.
 */
const TABLE: Record<string, string[]> = {
    approve: ['awaiting_approval'],
    reject: ['awaiting_approval', 'failed'],
    retry: ['approved', 'failed'],
    settle: ['awaiting_approval', 'approved', 'waiting_for_cash', 'failed'],
    resolve: ['sending'],
};

const PREDICATES: Record<string, (status: string) => boolean> = {
    approve: canApproveRefund,
    reject: canRejectRefund,
    retry: canRetryRefund,
    settle: canSettleRefundExternally,
    resolve: canResolveRefund,
};

describe('what may be done, by status', () => {
    for (const [verb, allowed] of Object.entries(TABLE)) {
        it(`${verb} is allowed from exactly ${allowed.join(', ')}`, () => {
            const permitted = REFUND_REQUEST_STATUSES.filter((status) => PREDICATES[verb](status));
            expect(permitted.sort()).toEqual([...allowed].sort());
        });
    }

    /** ⛔ The money may already be on its way. */
    it('allows nothing but resolve on a sending request', () => {
        expect(Object.entries(PREDICATES).filter(([, can]) => can('sending')).map(([verb]) => verb)).toEqual([
            'resolve',
        ]);
    });

    it('counts five statuses as open', () => {
        expect(REFUND_REQUEST_STATUSES.filter(isRefundOpen)).toEqual([
            'awaiting_approval',
            'approved',
            'waiting_for_cash',
            'sending',
            'failed',
        ]);
    });
});

describe('R-7 — a typed number', () => {
    it('is the typist’s own only when the request names them', () => {
        const refund = typedRefundRequestFixture();
        expect(isOwnTypedNumber(refund, refund.requestedBy.id!)).toBe(true);
        expect(isOwnTypedNumber(refund, 'someone-else')).toBe(false);
    });

    it('never applies to the payer’s own number', () => {
        const refund = refundRequestFixture();
        expect(isOwnTypedNumber(refund, refund.requestedBy.id!)).toBe(false);
    });

    it('reads a typed number as wi-admin does — international form, spacing allowed', () => {
        expect(isTypedPhoneValid('+237 677 00 11 22')).toBe(true);
        expect(isTypedPhoneValid('+237 (677) 00-11-22')).toBe(true);
        expect(isTypedPhoneValid('677001122')).toBe(false);
        expect(isTypedPhoneValid('+0123')).toBe(false);
    });
});

describe('still being finalised', () => {
    it('says so on a completed clawback refund whose recovery is due', () => {
        expect(refundFinalisingNote(refundRequestFixture({ status: 'completed' }))).toMatch(/finalised/i);
        expect(
            refundFinalisingNote(
                refundRequestFixture({ status: 'completed', earningsSettledAt: '2026-10-05T12:00:00.000Z' }),
            ),
        ).toBeNull();
    });

    it('reads billingReversedAt for a plan purchase, not earnings', () => {
        const billing = refundRequestFixture({
            status: 'completed',
            source: { kind: 'plan_purchase', id: 'x', number: null },
            earningsSettledAt: null,
        });
        expect(refundFinalisingNote(billing)).toMatch(/plan or credits/i);
        expect(refundFinalisingNote({ ...billing, billingReversedAt: '2026-10-05T12:00:00.000Z' })).toBeNull();
    });

    it('says nothing on a delivery refund nobody was paid', () => {
        expect(refundFinalisingNote(refundRequestFixture({ status: 'completed', earningsImpact: 'none' }))).toBeNull();
    });
});

describe('refusals arrive both ways', () => {
    it('reads wi-admin’s own code', () => {
        const error = new ApiError({
            status: 409,
            code: 'REFUND_REQUEST_STATUS_CONFLICT',
            category: 'conflict',
            message: 'moved',
        });
        expect(refundRefusalCode(error)).toBe('REFUND_REQUEST_STATUS_CONFLICT');
    });

    it('reads the same name as jovi-mall’s platform code', () => {
        const error = new ApiError({
            status: 409,
            code: 'PLATFORM_OPERATION_REJECTED',
            category: 'conflict',
            message: 'moved',
            details: { platformCode: 'REFUND_REQUEST_STATUS_CONFLICT', reason: 'exceeds_refundable' },
        });
        expect(refundRefusalCode(error)).toBe('REFUND_REQUEST_STATUS_CONFLICT');
    });
});
