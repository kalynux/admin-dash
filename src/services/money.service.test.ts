import { describe, expect, it } from 'vitest';

import {
    getAllocation,
    getPayment,
    getPayout,
    getPlatformLedger,
    listAllocations,
    listEarningsAccounts,
    listPayments,
    listPayoutActivity,
    listPayouts,
    listRefunds,
    markPayoutPaid,
    sendPayout,
    triagePayout,
    rejectPayout,
    revealPayoutDestination,
} from '@/services/money.service';
import { approvalFixture, auditEntryFixture, auditMetaFixture } from '@/test/fixtures';
import {
    allocationDetailFixture,
    allocationFixture,
    ledgerEntryFixture,
    paymentDetailFixture,
    paymentFixture,
    payoutFixture,
    payoutListMetaFixture,
    refundFixture,
} from '@/test/money-fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

function stubList(rows: unknown[] = [payoutFixture()], meta = {}) {
    return stubFetch(() =>
        successResponse(rows, { meta: { ...payoutListMetaFixture(), ...meta } }),
    );
}

describe('listPayouts', () => {
    it('hits the documented path and carries every filter', async () => {
        const calls = stubList();

        await listPayouts({
            status: 'pending',
            ownerType: 'agency',
            ownerId: '665c0011223344556677889a',
            origin: 'auto_threshold',
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-14T00:00:00.000Z',
            sort: '-amount',
            page: 2,
            limit: 25,
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/payouts');
        expect(query.get('status')).toBe('pending');
        expect(query.get('ownerType')).toBe('agency');
        expect(query.get('ownerId')).toBe('665c0011223344556677889a');
        expect(query.get('origin')).toBe('auto_threshold');
        expect(query.get('from')).toBe('2026-08-01T00:00:00.000Z');
        expect(query.get('to')).toBe('2026-08-14T00:00:00.000Z');
        expect(query.get('sort')).toBe('-amount');
        expect(query.get('page')).toBe('2');
    });

    it('reports pages: 0 on an empty queue rather than inventing a page one', async () => {
        stubList([], { total: 0, pages: 0 });

        const page = await listPayouts();

        expect(page.data).toEqual([]);
        expect(page.meta.pages).toBe(0);
    });
});

describe('getPayout', () => {
    it('reads one payout by id', async () => {
        const calls = stubFetch(() => successResponse(payoutFixture()));

        const payout = await getPayout('66a2aabbccddeeff00112233');

        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233');
        expect(calls[0].method).toBe('GET');
        expect(payout.id).toBe('66a2aabbccddeeff00112233');
    });
});

describe('revealPayoutDestination', () => {
    /*
     * The only audited read on the service. These assertions exist because the
     * cost of getting them wrong is a false entry against an operator's name,
     * not a rendering bug.
     */
    it('issues exactly one GET to the disclosure path', async () => {
        const calls = stubFetch(() =>
            successResponse({
                method: 'mobile_money',
                isPreferred: true,
                masked: {
                    mobileMoney: {
                        provider: 'MTN',
                        phoneNumberMasked: '••••3456',
                        accountName: 'Nadège Mbarga',
                    },
                    bank: null,
                    card: null,
                },
                full: { mobileMoney: { phoneNumber: '+237677003456' }, bank: null, card: null },
                revealed: true,
            }),
        );

        const destination = await revealPayoutDestination('66a2aabbccddeeff00112233');

        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/destination');
        expect(destination.revealed).toBe(true);
        expect(destination.full?.mobileMoney?.phoneNumber).toBe('+237677003456');
    });

    it('surfaces PAYOUT_DESTINATION_ABSENT as a 422, distinct from a 404', async () => {
        // A legacy row an operator must resolve by asking the beneficiary is a
        // different problem from a broken link, which is why the service
        // separates them.
        stubFetch(() =>
            errorResponse(422, 'PAYOUT_DESTINATION_ABSENT', {
                message: 'This payout carries no destination',
                category: 'business_rule',
            }),
        );

        await expect(revealPayoutDestination('66a2aabbccddeeff00112233')).rejects.toMatchObject({
            code: 'PAYOUT_DESTINATION_ABSENT',
            status: 422,
        });
    });

    it('reports a card disclosure as revealed with nothing to give', async () => {
        // `revealed` is the discriminator: a card answers true with every `full`
        // member null, because its only number is the last4 already on the
        // masked side. Inferring from `full` would call this a failure.
        stubFetch(() =>
            successResponse({
                method: 'card',
                isPreferred: true,
                masked: { mobileMoney: null, bank: null, card: { brand: 'VISA', last4: '4242' } },
                full: { mobileMoney: null, bank: null, card: null },
                revealed: true,
            }),
        );

        const destination = await revealPayoutDestination('66a2aabbccddeeff00112233');

        expect(destination.revealed).toBe(true);
        expect(destination.full?.mobileMoney).toBeNull();
        expect(destination.full?.bank).toBeNull();
    });
});

describe('markPayoutPaid', () => {
    it('sends the reference and nothing else', async () => {
        const calls = stubFetch(() => successResponse(payoutFixture({ status: 'paid' })));

        await markPayoutPaid('66a2aabbccddeeff00112233', { reference: 'AFRILAND/TRF/00412' });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/mark-paid');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ reference: 'AFRILAND/TRF/00412' });
    });

    it('never sends an amount key', async () => {
        /*
         * The load-bearing assertion of this phase's write path. The threshold is
         * evaluated against the payout row, so a client that could name the
         * amount could name 1,999,999 and skip the second administrator — which
         * is why the schema is strict and an `amount` key is a 400.
         */
        const calls = stubFetch(() => successResponse(payoutFixture({ status: 'paid' })));

        await markPayoutPaid('66a2aabbccddeeff00112233', { reference: 'REF' });

        expect(JSON.parse(calls[0].body ?? '{}')).not.toHaveProperty('amount');
    });

    it('sends an empty body when no reference was given', async () => {
        const calls = stubFetch(() => successResponse(payoutFixture({ status: 'paid' })));

        await markPayoutPaid('66a2aabbccddeeff00112233');

        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({});
    });

    it('reports a 200 as performed', async () => {
        stubFetch(() => successResponse(payoutFixture({ status: 'paid' })));

        const result = await markPayoutPaid('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(false);
        if (result.queued === false) expect(result.data.status).toBe('paid');
    });

    it('reports a 202 as queued, carrying the approval and the server message', async () => {
        // 202 is not a failure: the action was accepted and is waiting.
        stubFetch(() =>
            successResponse(approvalFixture({ action: 'money.payouts.mark_paid' }), {
                status: 202,
                message:
                    'This payout is above the four-eyes threshold — submitted for a second administrator’s approval',
            }),
        );

        const result = await markPayoutPaid('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(true);
        if (result.queued === true) {
            expect(result.approval.action).toBe('money.payouts.mark_paid');
            expect(result.message).toContain('four-eyes threshold');
        }
    });

    it('passes through the identical-request message unchanged', async () => {
        /*
         * `created` is not on the wire and the outcome is the same approval
         * either way, so the client renders whichever sentence the server sent
         * rather than trying to tell the two apart.
         */
        stubFetch(() =>
            successResponse(approvalFixture(), {
                status: 202,
                message: 'An identical request is already awaiting approval',
            }),
        );

        const result = await markPayoutPaid('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(true);
        if (result.queued === true) {
            expect(result.message).toBe('An identical request is already awaiting approval');
        }
    });

    it('surfaces PAYOUT_NOT_PENDING with the status the pre-flight reported', async () => {
        stubFetch(() =>
            errorResponse(409, 'PAYOUT_NOT_PENDING', {
                message: 'This payout is no longer pending',
                category: 'conflict',
                details: { status: 'paid' },
            }),
        );

        const error = await markPayoutPaid('66a2aabbccddeeff00112233').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('PAYOUT_NOT_PENDING');
        expect((error as ApiError).details?.status).toBe('paid');
    });
});

describe('rejectPayout', () => {
    it('sends the reason and keeps the server sentence', async () => {
        const calls = stubFetch(() =>
            successResponse(payoutFixture({ status: 'rejected' }), {
                message:
                    'Payout request rejected — the funds returned to the owner’s available balance',
            }),
        );

        const result = await rejectPayout('66a2aabbccddeeff00112233', 'Bank details unverified');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/reject');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ reason: 'Bank details unverified' });
        expect(result.message).toContain('available balance');
    });

    it('surfaces a not-pending refusal under the platform code, not PAYOUT_NOT_PENDING', async () => {
        /*
         * Reject has no pre-flight, so the identical situation arrives under a
         * different code from mark-paid's. A branch on `PAYOUT_NOT_PENDING`
         * alone would never fire here.
         */
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'The platform refused this operation',
                category: 'conflict',
                details: { platformCode: 'EARNINGS_PAYOUT_REQUEST_NOT_PENDING' },
            }),
        );

        const error = await rejectPayout('66a2aabbccddeeff00112233', 'why').catch(
            (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).platformCode).toBe('EARNINGS_PAYOUT_REQUEST_NOT_PENDING');
    });
});

describe('listPayoutActivity', () => {
    it('reads the payout-scoped audit feed', async () => {
        const calls = stubFetch(() =>
            successResponse([auditEntryFixture()], { meta: { ...auditMetaFixture() } }),
        );

        const page = await listPayoutActivity('66a2aabbccddeeff00112233', {
            action: 'money.payouts.destination.read',
        });

        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/activity');
        expect(queryOf(calls[0]).get('action')).toBe('money.payouts.destination.read');
        expect(page.data).toHaveLength(1);
    });
});

describe('listEarningsAccounts', () => {
    it('carries ownerType and paging, and offers no sort', async () => {
        // The platform ranks these itself, so a `sort` parameter would be a
        // promise this service cannot keep.
        const calls = stubFetch(() => successResponse([], { meta: payoutListMetaFixture() }));

        await listEarningsAccounts({ ownerType: 'agency', page: 3, limit: 50 });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/earnings/accounts');
        expect(query.get('ownerType')).toBe('agency');
        expect(query.get('page')).toBe('3');
        expect(query.get('limit')).toBe('50');
        expect(query.get('sort')).toBeNull();
    });
});

describe('getPlatformLedger', () => {
    it('carries every filter and the sort', async () => {
        const calls = stubFetch(() =>
            successResponse([ledgerEntryFixture()], { meta: payoutListMetaFixture() }),
        );

        await getPlatformLedger({
            entryType: 'release',
            reasonCode: 'hold_release',
            sourceType: 'order',
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-14T00:00:00.000Z',
            sort: '-amount',
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/earnings/platform/ledger');
        expect(query.get('entryType')).toBe('release');
        expect(query.get('reasonCode')).toBe('hold_release');
        expect(query.get('sourceType')).toBe('order');
        expect(query.get('sort')).toBe('-amount');
    });

    it('sends no owner parameter — the scope is pinned server-side', async () => {
        // The repository hard-pins owner_type/owner_id before any filter, so
        // there is nothing to send and no way to widen it.
        const calls = stubFetch(() => successResponse([], { meta: payoutListMetaFixture() }));

        await getPlatformLedger();

        const query = queryOf(calls[0]);
        expect(query.get('ownerId')).toBeNull();
        expect(query.get('ownerType')).toBeNull();
    });
});

describe('listAllocations', () => {
    it('serialises the two boolean flags as real values', async () => {
        // `boolFlag` accepts only true|false|1|0 — `false` must survive rather
        // than being dropped as falsy.
        const calls = stubFetch(() =>
            successResponse([allocationFixture()], { meta: payoutListMetaFixture() }),
        );

        await listAllocations({ unsettledOnly: true, requiresCashSettlement: false });

        const query = queryOf(calls[0]);
        expect(query.get('unsettledOnly')).toBe('true');
        expect(query.get('requiresCashSettlement')).toBe('false');
    });

    it('carries the beneficiary and source filters', async () => {
        const calls = stubFetch(() =>
            successResponse([allocationFixture()], { meta: payoutListMetaFixture() }),
        );

        await listAllocations({
            beneficiaryType: 'vendor',
            beneficiaryId: '6650aa11bb22cc33dd44ee55',
            sourceType: 'order',
            status: 'held',
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/earnings/allocations');
        expect(query.get('beneficiaryType')).toBe('vendor');
        expect(query.get('status')).toBe('held');
    });
});

describe('getAllocation', () => {
    it('returns the movements and siblings the split is read from', async () => {
        stubFetch(() => successResponse(allocationDetailFixture()));

        const allocation = await getAllocation('66a1aabbccddeeff00112233');

        expect(allocation.movements).toHaveLength(1);
        expect(allocation.siblings).toHaveLength(1);
        // The stuck state: cash required and not yet settled.
        expect(allocation.release.requiresCashSettlement).toBe(true);
        expect(allocation.release.cashSettledAt).toBeNull();
    });
});

describe('listPayments', () => {
    it('sends the UPPERCASE vocabularies the schema actually pins', async () => {
        /*
         * The load-bearing assertion of Part A. These are bounded strings
         * server-side, so a lower-cased value answers an empty page rather than a
         * 400 — the doc's `"succeeded"` would match nothing, silently.
         */
        const calls = stubFetch(() =>
            successResponse([paymentFixture()], { meta: payoutListMetaFixture() }),
        );

        await listPayments({ status: 'SUCCEEDED', gateway: 'NOTCHPAY', method: 'MOBILE' });

        const query = queryOf(calls[0]);
        expect(query.get('status')).toBe('SUCCEEDED');
        expect(query.get('gateway')).toBe('NOTCHPAY');
        expect(query.get('method')).toBe('MOBILE');
    });

    it('carries the order and user filters', async () => {
        const calls = stubFetch(() =>
            successResponse([paymentFixture()], { meta: payoutListMetaFixture() }),
        );

        await listPayments({ orderId: '6670aabbccddeeff00112233', userId: '665b112233445566778899bb' });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/payments');
        expect(query.get('orderId')).toBe('6670aabbccddeeff00112233');
        expect(query.get('userId')).toBe('665b112233445566778899bb');
    });
});

describe('getPayment', () => {
    it('returns the refunds against the payment', async () => {
        stubFetch(() =>
            successResponse(paymentDetailFixture({ refundTransactions: [refundFixture()] })),
        );

        const payment = await getPayment('66c0aabbccddeeff00112233');

        expect(payment.refundTransactions).toHaveLength(1);
        expect(payment.refunds.netAmount).toBe(27500);
    });
});

describe('listRefunds', () => {
    it('sends lowercase status beside UPPERCASE gateway', async () => {
        // The mixed casing lives on this one collection, and the doc gets one of
        // the two wrong on adjacent lines.
        const calls = stubFetch(() =>
            successResponse([refundFixture()], { meta: payoutListMetaFixture() }),
        );

        await listRefunds({ status: 'completed', gateway: 'NOTCHPAY' });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/money/refunds');
        expect(query.get('status')).toBe('completed');
        expect(query.get('gateway')).toBe('NOTCHPAY');
    });
});

describe('sendPayout', () => {
    it('sends no body at all', async () => {
        /*
         * ⚠ `SendPayoutSchema` is `z.object({}).strict()`, so ANY key is a 400 —
         * the same guard `MarkPaidSchema` carries and for the same reason: a
         * client that could name an `amount` could name 1,999,999 and slip under
         * the four-eyes threshold. The amount is read off the row, always.
         */
        const calls = stubFetch(() => successResponse(payoutFixture({ status: 'processing' })));

        await sendPayout('66a2aabbccddeeff00112233');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/send');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({});
    });

    it('carries no idempotency key of its own', async () => {
        /*
         * ⛔ Retry is the same call, and the backend reuses the STORED provider
         * reference so a transfer that succeeded and merely failed to report is
         * deduplicated by the provider (ADR-024 D-8). A client-side key minted
         * per attempt would defeat exactly that.
         */
        const calls = stubFetch(() => successResponse(payoutFixture({ status: 'processing' })));

        await sendPayout('66a2aabbccddeeff00112233');

        expect(calls[0].headers.has('Idempotency-Key')).toBe(false);
        expect(calls[0].headers.has('X-Idempotency-Key')).toBe(false);
        expect(JSON.parse(calls[0].body ?? '{}')).not.toHaveProperty('idempotencyKey');
    });

    it('reports a 200 as performed, with the status the gateway actually reached', async () => {
        // ⛔ A 200 does not mean the money arrived. The usual answer is processing.
        stubFetch(() => successResponse(payoutFixture({ status: 'processing' })));

        const result = await sendPayout('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(false);
        if (result.queued === false) expect(result.data.status).toBe('processing');
    });

    it('reports a failed transfer as a SUCCESSFUL call, not a thrown error', async () => {
        /*
         * The gateway refusing a transfer is a `200` carrying `status: 'failed'`,
         * not an HTTP error — and the funds are still held. A caller that only
         * handled the throw would report this as paid.
         */
        stubFetch(() =>
            successResponse(
                payoutFixture({
                    status: 'failed',
                    transferFailureReason: 'Beneficiary account is barred',
                    transferGatewayRef: 'trf_123456789',
                }),
            ),
        );

        const result = await sendPayout('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(false);
        if (result.queued === false) {
            expect(result.data.status).toBe('failed');
            expect(result.data.transferFailureReason).toBe('Beneficiary account is barred');
        }
    });

    it('reports a 202 as queued, exactly like mark-paid', async () => {
        /*
         * ⚠ `/send` rides `money.payouts.mark_paid`, so the ≥ 2,000,000 XAF rule
         * covers it unchanged. A client that treated 202 as success would show a
         * payout as sent while it sits in a queue — **nothing was sent**.
         */
        stubFetch(() =>
            successResponse(
                approvalFixture({
                    action: 'money.payouts.mark_paid',
                    payload: { mode: 'gateway' },
                }),
                {
                    status: 202,
                    message:
                        'This payout is above the four-eyes threshold — submitted for a second administrator’s approval',
                },
            ),
        );

        const result = await sendPayout('66a2aabbccddeeff00112233');

        expect(result.queued).toBe(true);
        if (result.queued) {
            // The mode is what the approver is actually signing for, and the
            // backend will not let an approval for one be spent on the other.
            expect(result.approval.payload.mode).toBe('gateway');
        }
    });
});

describe('triagePayout', () => {
    it('sends the note when there is one', async () => {
        const calls = stubFetch(() => successResponse(payoutFixture()));

        await triagePayout('66a2aabbccddeeff00112233', 'Checked against KYC docs');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/money/payouts/66a2aabbccddeeff00112233/triage');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ note: 'Checked against KYC docs' });
    });

    it('omits an empty note rather than sending an empty string', async () => {
        // `note` is `.min(1)` when present, so an empty string is a 400 where an
        // absent key is the documented "no note".
        const calls = stubFetch(() => successResponse(payoutFixture()));

        await triagePayout('66a2aabbccddeeff00112233', '   ');

        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({});
    });

    it('never names a verdict', async () => {
        /*
         * ⛔ `TriagePayoutSchema` accepts `note` and nothing else, `.strict()`,
         * and the validator says why: a body that could name a verdict could name
         * "approve", and this route must never be a second way to release money.
         */
        const calls = stubFetch(() => successResponse(payoutFixture()));

        await triagePayout('66a2aabbccddeeff00112233', 'fine');

        expect(JSON.parse(calls[0].body ?? '{}')).not.toHaveProperty('verdict');
    });
});
