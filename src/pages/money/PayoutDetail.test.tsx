import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { PayoutDetail } from '@/pages/money/PayoutDetail';
import { adminFixture, approvalFixture, heldFixture } from '@/test/fixtures';
import { largePayoutFixture, payoutFixture, resolvedPayoutFixture } from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { Payout } from '@/types/money.types';

const PAYOUT_ID = '66a2aabbccddeeff00112233';

/** Answers the payout read; a handler may add cases for the write under test. */
function stubDetail(
    payout: Payout = payoutFixture(),
    write?: (call: FetchCall) => Response | undefined,
) {
    return stubFetch((call: FetchCall) => {
        const answered = write?.(call);
        if (answered) return answered;
        if (call.url.includes(`/money/payouts/${PAYOUT_ID}`) && call.method === 'GET') {
            return successResponse(payout);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(held = heldFixture(1)) {
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

describe('the record', () => {
    it('shows the amount, beneficiary and status', async () => {
        stubDetail();

        detail();

        expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/340,000/);
        expect(screen.getByText('Littoral Express')).toBeInTheDocument();
        expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    });

    it('renders a 404 as a refusal rather than a fault', async () => {
        stubFetch(() =>
            errorResponse(404, 'NOT_FOUND', {
                message: 'No such payout',
                category: 'not_found',
            }),
        );

        detail();

        // Title and message both say it; the point is that it is a refusal
        // rather than a fault, so neither offers a retry.
        expect((await screen.findAllByText(/no such payout/i)).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
});

describe('which actions are offered', () => {
    it('offers both writes on a pending payout', async () => {
        stubDetail();

        detail();

        expect(await screen.findByRole('button', { name: /mark paid/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    });

    it('offers neither once the payout is resolved', async () => {
        /*
         * The status is on the row this page renders and wi-admin pre-flights it,
         * so offering "Mark paid" on a paid payout is nonsense.
         */
        stubDetail(resolvedPayoutFixture());

        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('button', { name: /mark paid/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });

    it('hides each write behind its own permission', async () => {
        stubDetail();

        detail(new Set(['money.payouts.read', 'money.payouts.reject']));

        expect(await screen.findByRole('button', { name: /^reject$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /mark paid/i })).not.toBeInTheDocument();
    });

    it('omits the activity tab without audit.read', async () => {
        // A composite `all`-mode guard: the payout permission alone is not enough.
        stubDetail();

        detail(new Set(['money.payouts.read']));

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('tab', { name: /activity/i })).not.toBeInTheDocument();
    });
});

describe('marking a payout paid', () => {
    it('sends the reference and reports success', async () => {
        const calls = stubDetail(payoutFixture(), (call) =>
            call.url.includes('/mark-paid')
                ? successResponse(resolvedPayoutFixture())
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));
        await user.type(await screen.findByLabelText(/transfer reference/i), 'TRF/001');
        await user.click(screen.getByRole('button', { name: /^mark paid$/i, hidden: false }));

        await waitFor(() => {
            const write = calls.find((call) => call.url.includes('/mark-paid'));
            expect(write).toBeTruthy();
            expect(JSON.parse(write?.body ?? '{}')).toEqual({ reference: 'TRF/001' });
        });
    });

    it('warns above the four-eyes threshold without disabling the button', async () => {
        /*
         * The threshold is the server's. Relabelling or disabling on a client
         * copy would be a second implementation of a rule that can move.
         */
        stubDetail(largePayoutFixture());
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));

        expect(await screen.findByText(/four-eyes threshold/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^mark paid$/i })).toBeEnabled();
    });

    it('renders a 202 as queued, not as a failure', async () => {
        stubDetail(largePayoutFixture(), (call) =>
            call.url.includes('/mark-paid')
                ? successResponse(
                      approvalFixture({
                          action: 'money.payouts.mark_paid',
                          description: 'Mark payout request 66a2… PAID — XAF 3,400,000',
                      }),
                      {
                          status: 202,
                          message:
                              'This payout is above the four-eyes threshold — submitted for a second administrator’s approval',
                      },
                  )
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));
        await user.click(await screen.findByRole('button', { name: /^mark paid$/i }));

        expect(await screen.findByText(/waiting for a second administrator/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing has been paid/i)).toBeInTheDocument();
        expect(screen.getByText(/Mark payout request 66a2… PAID/)).toBeInTheDocument();
    });

    it('tells the operator the queued request will not show on the activity tab', async () => {
        /*
         * The audit row targets the approval, not the payout, so the feed shows
         * nothing new. Unsaid, an operator concludes the submission was lost.
         */
        stubDetail(largePayoutFixture(), (call) =>
            call.url.includes('/mark-paid')
                ? successResponse(approvalFixture(), { status: 202, message: 'queued' })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));
        await user.click(await screen.findByRole('button', { name: /^mark paid$/i }));

        expect(await screen.findByText(/appear on the Activity tab below/i)).toBeInTheDocument();
    });

    it('renders the identical-request message verbatim', async () => {
        // `created` is not on the wire and the outcome is the same approval
        // either way, so the client does not try to tell them apart.
        stubDetail(largePayoutFixture(), (call) =>
            call.url.includes('/mark-paid')
                ? successResponse(approvalFixture(), {
                      status: 202,
                      message: 'An identical request is already awaiting approval',
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));
        await user.click(await screen.findByRole('button', { name: /^mark paid$/i }));

        expect(
            await screen.findByText(/an identical request is already awaiting approval/i),
        ).toBeInTheDocument();
    });

    it('keeps the dialog open on a 409 and names the new status', async () => {
        stubDetail(payoutFixture(), (call) =>
            call.url.includes('/mark-paid')
                ? errorResponse(409, 'PAYOUT_NOT_PENDING', {
                      message: 'This payout is no longer pending',
                      category: 'conflict',
                      details: { status: 'paid' },
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /mark paid/i }));
        await user.click(await screen.findByRole('button', { name: /^mark paid$/i }));

        expect(await screen.findByText(/already been resolved/i)).toBeInTheDocument();
        expect(screen.getByText(/it is now paid/i)).toBeInTheDocument();
    });
});

describe('rejecting a payout', () => {
    it('requires a reason and sends it', async () => {
        const calls = stubDetail(payoutFixture(), (call) =>
            call.url.includes('/reject')
                ? successResponse(payoutFixture({ status: 'rejected' }), {
                      message: 'Payout request rejected',
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /^reject$/i }));
        await user.type(await screen.findByLabelText(/reason/i), 'Bank details unverified');
        await user.click(screen.getByRole('button', { name: /reject request/i }));

        await waitFor(() => {
            const write = calls.find((call) => call.url.includes('/reject'));
            expect(JSON.parse(write?.body ?? '{}')).toEqual({
                reason: 'Bank details unverified',
            });
        });
    });

    it('recognises the platform code, which differs from mark-paid for the same situation', async () => {
        /*
         * Reject has no pre-flight, so jovi-mall raises the refusal and it
         * arrives wrapped. A branch on PAYOUT_NOT_PENDING alone never fires here.
         */
        stubDetail(payoutFixture(), (call) =>
            call.url.includes('/reject')
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'The platform refused this operation',
                      category: 'conflict',
                      details: { platformCode: 'EARNINGS_PAYOUT_REQUEST_NOT_PENDING' },
                  })
                : undefined,
        );
        const user = userEvent.setup();

        detail();
        await user.click(await screen.findByRole('button', { name: /^reject$/i }));
        await user.type(await screen.findByLabelText(/reason/i), 'no longer valid');
        await user.click(screen.getByRole('button', { name: /reject request/i }));

        expect(await screen.findByText(/already been resolved/i)).toBeInTheDocument();
    });
});
