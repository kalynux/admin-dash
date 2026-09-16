import { describe, expect, it } from 'vitest';

import { earningsAccountRowFixture } from '@/test/money-fixtures';
import { ApiError } from '@/types/api.types';
import {
    canMarkPayoutPaid,
    canRejectPayout,
    endorsedByOf,
    gatewayShortfallOf,
    gatewayUnsupportedKind,
    isEarningsAccountRow,
    isGatewaySendableDestination,
    isPayoutSendable,
    isPayoutTransferInFlight,
    payoutHoldsFunds,
    PAYOUT_DUAL_CONTROL_THRESHOLD,
    PAYOUT_SORT_DEFAULT,
    PAYOUT_SORT_KEYS,
    PAYOUT_STATUSES,
    type PayoutDestination,
} from '@/types/money.types';

/*
 * `GET /money/earnings/accounts` is delegated and has no documented response
 * block, so the shape is inferred from jovi-mall's mapper and checked at runtime.
 * These assertions are what stop a silent shape change rendering as blank money.
 */
describe('isEarningsAccountRow', () => {
    it('accepts the row jovi-mall actually sends', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture())).toBe(true);
    });

    it('accepts a null ownerId, which the mapper can emit', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture({ ownerId: null }))).toBe(true);
    });

    it('rejects a row missing a balance', () => {
        const rest: Record<string, unknown> = earningsAccountRowFixture();
        delete rest.available;
        expect(isEarningsAccountRow(rest)).toBe(false);
    });

    it('rejects a balance sent as a string', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture({ available: '380000' }))).toBe(
            false,
        );
    });

    it('rejects null and non-objects', () => {
        expect(isEarningsAccountRow(null)).toBe(false);
        expect(isEarningsAccountRow('agency')).toBe(false);
    });

    it('tolerates a missing currency, which costs a symbol rather than a wrong number', () => {
        const rest: Record<string, unknown> = earningsAccountRowFixture();
        delete rest.currency;
        expect(isEarningsAccountRow(rest)).toBe(true);
    });
});

describe('payout vocabularies', () => {
    it('matches the endpoint sort allowlist', () => {
        // An undeclared field is a 400 naming the permitted set, so this list is
        // the contract rather than a convenience.
        expect(PAYOUT_SORT_KEYS).toEqual(['createdAt', 'amount', 'resolvedAt']);
        expect(PAYOUT_SORT_DEFAULT).toBe('-createdAt');
    });

    it('carries the four-eyes threshold as a warning value only', () => {
        // Duplicated from permission.catalog.ts to warn before submitting. The
        // server decides; nothing may gate on this.
        expect(PAYOUT_DUAL_CONTROL_THRESHOLD).toBe(2_000_000);
    });
});

/*
 * ── The five-state lifecycle, ADR-024 ────────────────────────────────────────
 *
 * `PayoutRequest.status` went from three values to five, and the whole hazard of
 * that change is that `processing` and `failed` **both still hold the owner's
 * money**. A status map that was exhaustive over `pending | paid | rejected`
 * sends both new values into whichever branch was last — in most implementations
 * `rejected` — which tells an owner their payout was declined while it is in
 * flight.
 *
 * These are not testing TypeScript. They pin the four *refusals* the predicates
 * encode, each of which is a rule a reasonable person would get backwards, and
 * each of which is invisible at runtime until money moves twice.
 */
describe('the payout lifecycle', () => {
    it('offers all five statuses as filters, in lifecycle order', () => {
        expect(PAYOUT_STATUSES).toEqual(['pending', 'processing', 'paid', 'rejected', 'failed']);
    });

    it('counts failed among the statuses that still hold the money', () => {
        /*
          ⛔ The single most important assertion in this file. A failed transfer
          has returned nothing — the gateway refused it and the hold stayed put.
        */
        expect(payoutHoldsFunds('failed')).toBe(true);
        expect(payoutHoldsFunds('processing')).toBe(true);
        expect(payoutHoldsFunds('pending')).toBe(true);

        // Only these two ended the hold — one by paying it out, one by releasing it.
        expect(payoutHoldsFunds('paid')).toBe(false);
        expect(payoutHoldsFunds('rejected')).toBe(false);
    });

    it('refuses a rejection only while a transfer is in flight', () => {
        /*
          ⛔ `processing → rejected` is a 409. Releasing a hold while a transfer
          may still be live is how a payout goes out twice — once by the transfer
          that was never actually dead, and once out of the balance that came
          back.
        */
        expect(canRejectPayout('processing')).toBe(false);

        // `failed` IS rejectable: it is the way out of a transfer that will not go.
        expect(canRejectPayout('failed')).toBe(true);
        expect(canRejectPayout('pending')).toBe(true);
    });

    it('sends from pending and from failed, because retry is the same call', () => {
        expect(isPayoutSendable('pending')).toBe(true);
        expect(isPayoutSendable('failed')).toBe(true);

        // Sending again while one is in flight risks a second transfer.
        expect(isPayoutSendable('processing')).toBe(false);
        expect(isPayoutSendable('paid')).toBe(false);
        expect(isPayoutSendable('rejected')).toBe(false);
    });

    it('marks paid from pending ALONE, which is narrower than jovi-mall', () => {
        /*
          ⚠ The asymmetry is wi-admin's own, and it is what this dashboard must
          obey. `assertPending(row, 'manual')` allows `['pending']`, so
          `/mark-paid` on a `failed` payout is refused by the pre-flight with
          `409 PAYOUT_NOT_PENDING` — before the delegated call is made — even
          though jovi-mall's own lifecycle documents `failed → paid` as
          "reconcile an out-of-band settlement", and the dashboard brief's diagram
          repeats it.

          If this ever goes green for 'failed', the backend closed the gap and the
          Mark-paid control should be offered there too.
        */
        expect(canMarkPayoutPaid('pending')).toBe(true);
        expect(canMarkPayoutPaid('failed')).toBe(false);
        expect(canMarkPayoutPaid('processing')).toBe(false);
    });

    it('reads a status it has never heard of as none of the five', () => {
        // Adding a member is additive and non-breaking on the platform, so an
        // unrecognised value must not borrow the affordances of a known one.
        expect(isPayoutSendable('escheated')).toBe(false);
        expect(canMarkPayoutPaid('escheated')).toBe(false);
        expect(payoutHoldsFunds('escheated')).toBe(false);
        expect(canRejectPayout('escheated')).toBe(false);
    });

    it('withholds the gateway only from the destinations it cannot reach', () => {
        expect(isGatewaySendableDestination({ method: 'mobile_money' } as PayoutDestination)).toBe(
            true,
        );
        expect(isGatewaySendableDestination({ method: 'bank' } as PayoutDestination)).toBe(false);
        expect(isGatewaySendableDestination({ method: 'card' } as PayoutDestination)).toBe(false);

        /*
          ⚠ Fails OPEN on anything else, deliberately. A legacy row carries no
          destination at all, and `method` is a bounded string — so an
          unrecognised value costs a handled 422 that offers the manual path,
          where hiding Send on a destination the gateway could pay costs an
          operator the only automatic route, with no explanation.
        */
        expect(isGatewaySendableDestination(null)).toBe(true);
        expect(isGatewaySendableDestination({ method: null } as PayoutDestination)).toBe(true);
        expect(isGatewaySendableDestination({ method: 'crypto' } as PayoutDestination)).toBe(true);
    });
});

/*
 * ── Reading a delegated refusal ──────────────────────────────────────────────
 *
 * ⚠ Every `EARNINGS_PAYOUT_*` code is jovi-mall's and arrives as
 * `details.platformCode` under `PLATFORM_OPERATION_REJECTED` — never as
 * `error.code`. The dashboard brief prints them in a `code` column, which is the
 * shape a branch on `error.code` would be written from, and such a branch never
 * fires. These pin that the readers look in the right place.
 */
describe('the gateway refusal readers', () => {
    const rejection = (platformCode: string, status: number, details: object = {}) =>
        new ApiError({
            status,
            code: 'PLATFORM_OPERATION_REJECTED',
            category: 'conflict',
            message: 'The platform rejected this operation',
            details: { platformCode, ...details },
        });

    it('never fires on a bare error.code carrying the platform name', () => {
        const wrong = new ApiError({
            status: 409,
            code: 'EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT',
            category: 'conflict',
            message: 'nope',
        });
        expect(isPayoutTransferInFlight(wrong)).toBe(false);
        expect(isPayoutTransferInFlight(rejection('EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT', 409))).toBe(
            true,
        );
    });

    it('separates the two GATEWAY_UNSUPPORTED situations on the status', () => {
        // 422 is this destination; 503 is this deployment. One code, two remedies.
        expect(gatewayUnsupportedKind(rejection('EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED', 422))).toBe(
            'destination',
        );
        expect(gatewayUnsupportedKind(rejection('EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED', 503))).toBe(
            'deployment',
        );
        expect(gatewayUnsupportedKind(rejection('EARNINGS_PAYOUT_TRANSFER_FAILED', 409))).toBeNull();
    });

    it('reads a float shortfall, and tolerates the details not surviving the hop', () => {
        /*
          ⚠ wi-admin forwards jovi-mall's `details` only when the platform's
          envelope declares a client-safe category, so the figures may simply not
          arrive. A partial object must degrade to the sentence without the
          numbers rather than render "undefined of undefined".
        */
        const full = rejection('EARNINGS_PAYOUT_TRANSFER_FAILED', 409, {
            reason: 'insufficient_gateway_balance',
            available: 150000,
            required: 340000,
        });
        expect(gatewayShortfallOf(full)).toEqual({ available: 150000, required: 340000 });

        const bare = rejection('EARNINGS_PAYOUT_TRANSFER_FAILED', 409, {
            reason: 'insufficient_gateway_balance',
        });
        expect(gatewayShortfallOf(bare)).toEqual({ available: null, required: null });

        // A different failure reason is not a shortfall — there is nothing to top up.
        const other = rejection('EARNINGS_PAYOUT_TRANSFER_FAILED', 409, { reason: 'declined' });
        expect(gatewayShortfallOf(other)).toBeNull();
    });

    it('names who endorsed first, in either shape, and drops the clause otherwise', () => {
        const code = 'EARNINGS_PAYOUT_ALREADY_TRIAGED';
        expect(endorsedByOf(rejection(code, 409, { endorsedBy: 'Ama Nkeng' }))).toBe('Ama Nkeng');
        expect(endorsedByOf(rejection(code, 409, { endorsedBy: { name: 'Ama Nkeng' } }))).toBe(
            'Ama Nkeng',
        );
        expect(endorsedByOf(rejection(code, 409))).toBeNull();
    });
});
