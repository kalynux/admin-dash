import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { FAILED_WARNING } from '@/components/money/ResolveUnknownPayoutDialog';
import { formatInstantInZone } from '@/lib/format';
import { PayoutDetail } from '@/pages/money/PayoutDetail';
import { adminFixture, approvalFixture, heldFixture } from '@/test/fixtures';
import { largePayoutFixture, payoutFixture } from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { Payout } from '@/types/money.types';

/*
 * `POST /money/payouts/:payoutId/resolve-unknown` — money.md § resolve-unknown.
 * The manual exit for a payout stuck in `processing` whose transfer outcome
 * nobody knows.
 */

const PAYOUT_ID = '66a2aabbccddeeff00112233';
const UNKNOWN_REASON =
    'Outcome unknown: the transfer request timed out — look up jm_po_8f2 on the provider dashboard';

function stuck(overrides: Partial<Payout> = {}): Payout {
    return payoutFixture({
        status: 'processing',
        transferFailureReason: UNKNOWN_REASON,
        ...overrides,
    });
}

function stubDetail(payout: Payout, write?: (call: FetchCall) => Response | undefined) {
    return stubFetch((call: FetchCall) => {
        const answered = write?.(call);
        if (answered) return answered;
        if (call.url.includes(`/money/payouts/${PAYOUT_ID}`) && call.method === 'GET') {
            return successResponse(payout);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(held: ReadonlySet<string> = heldFixture(1)) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/money/payouts/:payoutId" element={<PayoutDetail />} />
        </Routes>,
        {
            route: `/dashboard/money/payouts/${PAYOUT_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
}

const resolveWrites = (calls: FetchCall[]) =>
    calls.filter((call) => call.url.includes('/resolve-unknown'));

async function openAndFill(
    user: ReturnType<typeof userEvent.setup>,
    outcome: RegExp,
    reason = 'MyCoolPay dashboard shows jm_po_8f2 SUCCESS at 14:02',
) {
    await user.click(await screen.findByRole('button', { name: /resolve stuck payout/i }));
    await user.click(await screen.findByRole('radio', { name: outcome }));
    await user.type(screen.getByLabelText(/what you checked/i), reason);
}

describe('when Resolve stuck payout is offered', () => {
    it('is offered on a processing payout whose outcome is unknown', async () => {
        stubDetail(stuck());

        detail();

        expect(
            await screen.findByRole('button', { name: /resolve stuck payout/i }),
        ).toBeInTheDocument();
        // The banner must not promise a callback that is not coming.
        expect(screen.getByText(/never said whether this transfer arrived/i)).toBeInTheDocument();
        expect(screen.queryByText(/awaiting confirmation/i)).not.toBeInTheDocument();
    });

    it('is not offered on an ordinary processing payout — a callback is coming', async () => {
        stubDetail(payoutFixture({ status: 'processing', transferFailureReason: null }));

        detail();

        await screen.findByText(/awaiting confirmation/i);
        expect(
            screen.queryByRole('button', { name: /resolve stuck payout/i }),
        ).not.toBeInTheDocument();
    });

    it('is not offered on a failed payout, even with the same note', async () => {
        stubDetail(stuck({ status: 'failed' }));

        detail();

        await screen.findByText(/funds are still held/i);
        expect(
            screen.queryByRole('button', { name: /resolve stuck payout/i }),
        ).not.toBeInTheDocument();
    });

    it('is not offered to an administrator holding neither permission', async () => {
        stubDetail(stuck());

        detail(new Set(['money.payouts.read']));

        await screen.findByRole('heading', { level: 1 });
        expect(
            screen.queryByRole('button', { name: /resolve stuck payout/i }),
        ).not.toBeInTheDocument();
    });
});

describe('which outcomes are offered', () => {
    it('offers both, with the failed warning, to a holder of both permissions', async () => {
        stubDetail(stuck());
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /resolve stuck payout/i }));

        expect(await screen.findByRole('radio', { name: /it arrived/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /did not arrive/i })).toBeInTheDocument();
        expect(screen.getByText(FAILED_WARNING)).toBeInTheDocument();
        // No outcome is pre-selected — a default would be a claim nobody made.
        expect(screen.getByRole('radio', { name: /it arrived/i })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: /did not arrive/i })).not.toBeChecked();
    });

    it('offers Support only "failed" — they hold triage and not mark_paid', async () => {
        stubDetail(stuck());
        const user = userEvent.setup();

        detail(new Set(['money.payouts.read', 'money.payouts.triage']));
        await user.click(await screen.findByRole('button', { name: /resolve stuck payout/i }));

        expect(await screen.findByRole('radio', { name: /did not arrive/i })).toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: /it arrived/i })).not.toBeInTheDocument();
    });

    it('offers a mark_paid holder without triage only "paid"', async () => {
        stubDetail(stuck());
        const user = userEvent.setup();

        detail(new Set(['money.payouts.read', 'money.payouts.mark_paid']));
        await user.click(await screen.findByRole('button', { name: /resolve stuck payout/i }));

        expect(await screen.findByRole('radio', { name: /it arrived/i })).toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: /did not arrive/i })).not.toBeInTheDocument();
        expect(screen.queryByText(FAILED_WARNING)).not.toBeInTheDocument();
    });
});

describe('recording the outcome', () => {
    it('sends paid as a strict literal and re-reads the payout', async () => {
        const calls = stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? successResponse(payoutFixture({ status: 'paid' }))
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        await user.type(screen.getByLabelText(/evidence/i), 'MCP txn 77812');
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        await waitFor(() => expect(resolveWrites(calls)).toHaveLength(1));
        expect(JSON.parse(resolveWrites(calls)[0].body ?? '{}')).toEqual({
            outcome: 'paid',
            reason: 'MyCoolPay dashboard shows jm_po_8f2 SUCCESS at 14:02',
            evidence: 'MCP txn 77812',
        });
        // Reconciled: the record is read again rather than merged.
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(1),
        );
    });

    it('sends failed and omits a blank evidence rather than sending ""', async () => {
        const calls = stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? successResponse(stuck({ status: 'failed' }))
                : undefined,
        );
        const user = userEvent.setup();

        detail(new Set(['money.payouts.read', 'money.payouts.triage']));
        await openAndFill(user, /did not arrive/i, 'Provider shows no transfer for jm_po_8f2');
        await user.click(screen.getByRole('button', { name: /record as failed/i }));

        await waitFor(() => expect(resolveWrites(calls)).toHaveLength(1));
        expect(JSON.parse(resolveWrites(calls)[0].body ?? '{}')).toEqual({
            outcome: 'failed',
            reason: 'Provider shows no transfer for jm_po_8f2',
        });
    });

    it('refuses a reason under ten characters without a request', async () => {
        const calls = stubDetail(stuck());
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i, 'too short');
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
        expect(resolveWrites(calls)).toHaveLength(0);
    });

    it('queues a large paid for approval, and says it is an unknown-transfer confirmation', async () => {
        stubDetail(largePayoutFixture({ status: 'processing', transferFailureReason: UNKNOWN_REASON }), (call) =>
            call.url.includes('/resolve-unknown')
                ? successResponse(
                      approvalFixture({
                          action: 'money.payouts.mark_paid',
                          description:
                              'Mark payout request 66a2… PAID — XAF 3,400,000 (transfer outcome was unknown; confirming it arrived: seen on dashboard)',
                          payload: { mode: 'resolve_paid' },
                      }),
                      { status: 202, message: 'submitted for a second administrator’s approval' },
                  )
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        expect(screen.getByText(/four-eyes threshold/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /request approval/i }));

        expect(await screen.findByText(/waiting for a second administrator/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing has been paid/i)).toBeInTheDocument();
        expect(
            screen.getByText(/confirming a transfer whose outcome was unknown/i),
        ).toBeInTheDocument();
    });
});

describe('refusals', () => {
    it('names when to try again on the quiet-period refusal', async () => {
        stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'conflict',
                      details: {
                          platformCode: 'EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT',
                          settleAfter: '2026-09-30T13:15:00.000Z',
                          minAgeMinutes: 15,
                      },
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        // In the operator's zone, not UTC — computed with the screen's own
        // formatter because its output is locale-dependent.
        const when = formatInstantInZone('2026-09-30T13:15:00.000Z', 'Africa/Douala');
        expect(await screen.findByText(new RegExp(`try again after ${when}`, 'i'))).toBeInTheDocument();
    });

    it.each([
        ['wi-admin’s pre-flight', 'PAYOUT_NOT_PROCESSING', { status: 'paid' }],
        ['jovi-mall’s check', 'PLATFORM_OPERATION_REJECTED', { platformCode: 'EARNINGS_PAYOUT_NOT_PROCESSING' }],
    ])('asks for a reload when %s says it is no longer processing', async (_, code, details) => {
        stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? errorResponse(409, code, { category: 'conflict', details })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        expect(await screen.findByText(/settled while you were looking/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    });

    it('disables the outcome the server refused on a 403', async () => {
        stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                      category: 'authorization',
                      details: { required: ['money.payouts.mark_paid'] },
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        await waitFor(() => expect(screen.getByRole('radio', { name: /it arrived/i })).toBeDisabled());
        expect(screen.getByRole('radio', { name: /did not arrive/i })).toBeEnabled();
    });

    it('places a server field error on its field', async () => {
        stubDetail(stuck(), (call) =>
            call.url.includes('/resolve-unknown')
                ? errorResponse(400, 'VALIDATION_ERROR', {
                      category: 'validation',
                      details: { fields: [{ path: 'evidence', message: 'Evidence is too long' }] },
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await openAndFill(user, /it arrived/i);
        await user.type(screen.getByLabelText(/evidence/i), 'x');
        await user.click(screen.getByRole('button', { name: /confirm as paid/i }));

        expect(await screen.findByText('Evidence is too long')).toBeInTheDocument();
    });
});
