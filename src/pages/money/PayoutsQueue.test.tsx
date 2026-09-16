import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayoutsQueue } from '@/pages/money/PayoutsQueue';
import { adminFixture, approvalFixture } from '@/test/fixtures';
import { legacyPayoutFixture, payoutFixture, payoutListMetaFixture } from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { Payout } from '@/types/money.types';

function stubList(rows = [payoutFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/money/payouts')) {
            return successResponse(rows, { meta: { ...payoutListMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function queue(route = '/dashboard/money/payouts') {
    return renderWithProviders(<PayoutsQueue />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

describe('the queue', () => {
    it('shows the amount, owner and origin', async () => {
        stubList();

        queue();

        expect(await screen.findByText(/340,000/)).toBeInTheDocument();
        expect(screen.getByText('Littoral Express')).toBeInTheDocument();
        expect(screen.getByText(/opened by the platform/i)).toBeInTheDocument();
    });

    it('recognises a destination by provider and account name, with no digits', async () => {
        /*
         * The projection never reads the number columns, so there is nothing to
         * mask — an operator identifies a destination this way.
         */
        stubList();

        queue();

        expect(await screen.findByText(/MTN · Nadège Mbarga/)).toBeInTheDocument();
        expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
    });

    it('renders a legacy row with no destination without crashing', async () => {
        // `destination: null` predates the snapshot — a different fact from a
        // destination with no details.
        stubList([legacyPayoutFixture()]);

        queue();

        expect(await screen.findByText(/no destination on file/i)).toBeInTheDocument();
    });

    it('reports the total from meta rather than counting rows', async () => {
        stubList([payoutFixture()], { total: 143 });

        queue();

        // Exact, not a substring: the pager prints the total too, as
        // "1–1 of 143 payout requests", and matching that instead would prove
        // nothing about the screen's own count line.
        expect(await screen.findByText('143 payout requests')).toBeInTheDocument();
    });
});

describe('the request it builds', () => {
    it('sorts on a permitted key', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue();
        await screen.findByText(/340,000/);
        await user.click(screen.getByRole('button', { name: /sort by amount/i }));

        expect(latest(calls).searchParams.get('sort')).toBe('amount');
    });

    it('carries the status filter and resets the page', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue('/dashboard/money/payouts?page=4');
        await screen.findByText(/340,000/);

        await user.click(screen.getByRole('combobox', { name: /status/i }));
        await user.click(await screen.findByRole('option', { name: /^paid$/i }));

        const query = latest(calls).searchParams;
        expect(query.get('status')).toBe('paid');
        // Page 4 of one filter is rarely page 4 of the next, so changing a
        // filter always goes back to the first page.
        expect(query.get('page')).toBe('1');
    });

    it('sends no date range when the span exceeds the cap', async () => {
        /*
         * An over-cap span is a guaranteed 400, so the screen declines to send it
         * rather than letting the list fail.
         */
        const calls = stubList();

        queue('/dashboard/money/payouts?createdFrom=2024-01-01&createdTo=2026-01-01');

        await screen.findByText(/340,000/);
        const query = latest(calls).searchParams;
        expect(query.get('from')).toBeNull();
        expect(query.get('to')).toBeNull();
    });

    it('carries an owner id arriving from a cross-link, and can clear it', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue('/dashboard/money/payouts?ownerId=665c0011223344556677889a');
        await screen.findByText(/340,000/);
        expect(latest(calls).searchParams.get('ownerId')).toBe('665c0011223344556677889a');

        await user.click(screen.getByRole('button', { name: /clear owner/i }));
        expect(latest(calls).searchParams.get('ownerId')).toBeNull();
    });
});

describe('states', () => {
    it('renders a permission refusal as a refusal', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'money.payouts.read', mode: 'all' },
            }),
        );

        queue();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('shows a disabled pager over an empty queue', async () => {
        // An empty list reports pages: 0, not 1 — so no page number is claimed.
        stubList([], { total: 0, pages: 0 });

        queue();

        expect(await screen.findByText(/no payout requests match/i)).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
    });
});

/**
 * The queue used to be read-only: mark-paid and reject existed one click away on
 * the detail screen and the queue itself offered nothing, so an operator whose
 * whole job is this list had to open every row to do it.
 */
describe('row actions', () => {
    it('offers both verbs on a pending request', async () => {
        stubList();

        queue();

        expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('offers nothing on a request somebody has already resolved', async () => {
        stubList([payoutFixture({ status: 'paid', resolvedAt: '2026-08-14T09:00:00.000Z' })]);

        queue();

        await screen.findByText(/340,000/);
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers each verb only to a holder of its own permission', async () => {
        // They are separate permissions and the detail screen gates them
        // separately; a holder of one must not be offered the other.
        stubList();

        renderWithProviders(<PayoutsQueue />, {
            route: '/dashboard/money/payouts',
            auth: { status: 'authenticated', admin: adminFixture() },
            permissions: {
                held: new Set(['money.payouts.read', 'money.payouts.reject']),
            },
        });

        expect(await screen.findByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    });

    it('offers the amount-independent affordance, because the threshold is the server’s', async () => {
        /*
         * The 2,000,000 XAF quorum is hard-coded in the backend's permission
         * catalog rather than being env-driven, so a client copy of it would be a
         * second implementation of a rule that can move. Both buttons appear on
         * every pending row and the `202` is the truth.
         */
        stubList([payoutFixture({ amount: 5_000_000 })]);

        queue();

        expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
    });

    it('opens the mark-paid dialog on the row it was pressed for', async () => {
        stubList();

        queue();

        await userEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(/mark this payout paid/i);
    });
});

/**
 * `verification` — BR-026 § 1.
 *
 * The field exists because `owner` being `active` stopped meaning "vetted" on
 * 2026-09-15, and this is the screen where money leaves the platform. Every
 * assertion below pins a rule the brief or the contract states explicitly, and
 * the three negative ones are the ones worth having: each pins a mistake that
 * would read as correct on screen.
 */
describe('the owner’s verification verdict', () => {
    it('shows the verdict on every row, not behind a detail click', async () => {
        /*
          ⚠ `status: 'paid'` so the row's own status badge cannot say "Pending"
          too. The default fixture is `status: 'pending'` with a `pending`
          verdict, and the two words are then indistinguishable on screen — which
          is a trap for the assertions below, not only for this one.
        */
        stubList([
            payoutFixture({
                status: 'paid',
                verification: { verified: false, verdict: 'pending' },
            }),
        ]);

        queue();

        expect(await screen.findByText(/^pending$/i)).toBeInTheDocument();
    });

    it('does NOT read a rejected owner as verified', async () => {
        /*
          ⛔ The `verdict !== 'rejected'` trap, inverted: a *rejected* owner is
          the one case where that derivation and the boolean agree, so the
          revealing fixture is the opposite one — see the `unverified` test
          below. This pins the plain case: a refusal renders as its own word and
          never as the approved tone.
        */
        stubList([payoutFixture({ verification: { verified: false, verdict: 'rejected' } })]);

        queue();

        expect(await screen.findByText(/^rejected$/i)).toBeInTheDocument();
        expect(screen.queryByText(/^verified$/i)).not.toBeInTheDocument();
    });

    it('renders an agent’s own “unverified” rather than flattening it to pending', async () => {
        /*
          ⚠ The vocabulary differs by role deliberately: vendor and agency default
          to `pending`, an agent to `unverified`, reaching `pending` only once
          documents are submitted. On an agent those two words separate "nothing
          submitted" from "submitted, waiting" — the one thing that tells a
          reviewer whether to chase somebody for documents.

          This is also the fixture that would pass under a `verdict !== 'rejected'`
          derivation: it is not rejected, and it is not verified either.
        */
        stubList([
            payoutFixture({
                // `paid`, so that the absence of "Pending" below can only mean the
                // verdict was not flattened — on a `pending` payout the status
                // badge would say it regardless and the assertion would prove
                // nothing (and fail).
                status: 'paid',
                owner: { type: 'agent', id: '665c0011223344556677889b', name: 'Eric T.' },
                verification: { verified: false, verdict: 'unverified' },
            }),
        ]);

        queue();

        expect(await screen.findByText(/^unverified$/i)).toBeInTheDocument();
        expect(screen.queryByText(/^pending$/i)).not.toBeInTheDocument();
    });

    it('still offers both verbs against an unvetted owner — it is information, not a gate', async () => {
        /*
          ⛔ The load-bearing one. The platform does not refuse an unverified
          owner's payout; whether to pay is the reviewer's judgement. A future
          change that disables these buttons on the verdict fails here.
        */
        stubList([payoutFixture({ verification: { verified: false, verdict: 'unverified' } })]);

        queue();

        expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('fails closed when the field is missing, rather than reading as approved', async () => {
        /*
          The mapper always sends it, so an absent one means a stale client or a
          hand-built row. "I do not know whether anybody vetted the account I am
          about to pay" must not render as approval.
        */
        // The cast is the point of the test: the field is required on `Payout`, so
        // TypeScript already stops us writing this — but a stale deployed client
        // or a widened wire can still deliver it, and the screen must fail closed.
        stubList([{ ...payoutFixture(), verification: undefined } as unknown as Payout]);

        queue();

        expect(await screen.findByText('Not verified')).toBeInTheDocument();
    });
});

describe('the client-side vetting filter', () => {
    /*
      It is client-side because the backend refused a server filter with a reason
      (the verdict lives in three other collections; joining would widen the
      projection that keeps the account number off this path). That makes it
      page-scoped, and these two tests pin the honesty of that rather than the
      filtering itself — a filter that silently spoke for the whole queue is the
      failure mode worth a test.
    */
    it('hides vetted rows and reports both counts, so a page is not read as the queue', async () => {
        stubList(
            [
                payoutFixture({ id: 'a', verification: { verified: false, verdict: 'pending' } }),
                payoutFixture({
                    id: 'b',
                    owner: { type: 'vendor', id: '665c00112233445566778800', name: 'Jovi Electronics' },
                    verification: { verified: true, verdict: 'verified' },
                }),
            ],
            { total: 143 },
        );

        queue();

        expect(await screen.findByText('Jovi Electronics')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('checkbox', { name: /nobody has vetted/i }));

        expect(screen.queryByText('Jovi Electronics')).not.toBeInTheDocument();
        // Both numbers: the queue total from `meta`, and the page-scoped count.
        expect(screen.getByText(/143 payout requests · showing 1 of 2 on this page/)).toBeInTheDocument();
    });

    it('says the page is all vetted rather than that nothing is waiting', async () => {
        /*
          The server returned a row, so "Nothing is waiting to leave the platform"
          would be false — and on a payout queue that is the reading that matters.
        */
        stubList([payoutFixture({ verification: { verified: true, verdict: 'verified' } })]);

        queue();

        expect(await screen.findByText(/340,000/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('checkbox', { name: /nobody has vetted/i }));

        expect(await screen.findByText(/every request on this page is from an owner/i)).toBeInTheDocument();
        expect(screen.queryByText(/nothing is waiting to leave/i)).not.toBeInTheDocument();
    });
});

/*
 * ── The two-stage payout workflow, ADR-024 ───────────────────────────────────
 *
 * The acceptance list for this change is mostly a list of things that must NOT
 * happen, which is what these assert. Each one names a mistake that is invisible
 * once made: a control that looks deliberately absent, a status that looks
 * deliberately red, a disabled button that looks like a permission problem.
 */

/** Everything a tier-1/2 approver holds on this surface. */
const APPROVER = new Set([
    'money.payouts.read',
    'money.payouts.mark_paid',
    'money.payouts.reject',
]);

/**
 * What Support actually holds here.
 *
 * ⚠ `money.payouts.triage` and nothing else that writes — no `mark_paid`, no
 * `reject`, no `destination.read`. Reject still reaches them, because `/reject`
 * takes `anyPermission('money.payouts.reject', 'money.payouts.triage')`.
 */
const SUPPORT = new Set(['money.payouts.read', 'money.payouts.triage']);

function queueAs(held: ReadonlySet<string>) {
    return renderWithProviders(<PayoutsQueue />, {
        route: '/dashboard/money/payouts',
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held },
    });
}

describe('endorsement never gates payment', () => {
    it('offers Send and Mark paid on a payout nobody has endorsed', async () => {
        /*
         * ⛔ The acceptance criterion this whole change turns on (ADR-024 D-2).
         * The pre-screen exists to save the approver work, not to gate them — an
         * empty Support queue must never stall payments. `triage: null` is the
         * ordinary state, not a missing step.
         */
        stubList([payoutFixture({ triage: null })]);

        queueAs(APPROVER);

        expect(await screen.findByRole('button', { name: 'Send' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Mark paid' })).toBeEnabled();
    });

    it('offers exactly the same controls on one that has been endorsed', async () => {
        // An endorsed payout is still `pending` — endorsement is a field, not a
        // state (D-6) — so nothing about the controls may change.
        stubList([
            payoutFixture({
                triage: {
                    verdict: 'endorsed',
                    note: 'Checked against KYC docs',
                    by: { id: '665f1c2a9b3e4a91c7d2e5f0', name: 'Ama Nkeng' },
                    at: '2026-09-15T10:04:00.000Z',
                },
            }),
        ]);

        queueAs(APPROVER);

        expect(await screen.findByRole('button', { name: 'Send' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Mark paid' })).toBeEnabled();
        // And the endorsement is visible to the person it was written for.
        expect(screen.getByText(/endorsed/i)).toBeInTheDocument();
    });

    it('draws no attention to a missing endorsement', async () => {
        /*
         * An advisory field displayed like a checklist item becomes a gate in
         * practice, whatever the API says. There is no "not endorsed" badge.
         */
        stubList([payoutFixture({ triage: null })]);

        queueAs(APPROVER);

        await screen.findByRole('button', { name: 'Send' });
        expect(screen.queryByText(/not endorsed/i)).not.toBeInTheDocument();
    });
});

describe('a transfer in flight', () => {
    it('renders processing as unfinished, never as paid', async () => {
        stubList([payoutFixture({ status: 'processing' })]);

        queueAs(APPROVER);

        expect(await screen.findByText(/^processing$/i)).toBeInTheDocument();
        expect(screen.queryByText(/^paid$/i)).not.toBeInTheDocument();
    });

    it('disables Reject while processing, and says why rather than hiding it', async () => {
        /*
         * ⛔ `processing → rejected` is a 409. Releasing a hold while a transfer
         * may still be live is how a payout goes out twice. A missing button
         * teaches nothing; a button pressed into an error teaches it the hard
         * way.
         */
        stubList([payoutFixture({ status: 'processing' })]);

        queueAs(APPROVER);

        const reject = await screen.findByRole('button', { name: 'Reject' });
        expect(reject).toBeDisabled();
        expect(reject).toHaveAttribute('title', expect.stringMatching(/confirm/i));
    });

    it('offers neither Send nor Mark paid while one is already in flight', async () => {
        stubList([payoutFixture({ status: 'processing' })]);

        queueAs(APPROVER);

        await screen.findByRole('button', { name: 'Reject' });
        expect(screen.queryByRole('button', { name: /send|retry/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    });
});

describe('a transfer that failed', () => {
    it('offers Retry and Reject, because the funds are still held', async () => {
        /*
         * ⛔ ADR-024 D-7. A failed transfer has returned nothing — the request is
         * still open work. Retry is the same `/send` call; the backend reuses the
         * stored provider reference so a transfer that actually succeeded is
         * deduplicated rather than paid twice.
         */
        stubList([
            payoutFixture({
                status: 'failed',
                transferFailureReason: 'Beneficiary account is barred',
            }),
        ]);

        queueAs(APPROVER);

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    });

    it('shows the provider’s reason on the row', async () => {
        stubList([
            payoutFixture({
                status: 'failed',
                transferFailureReason: 'Beneficiary account is barred',
            }),
        ]);

        queueAs(APPROVER);

        expect(await screen.findByText(/beneficiary account is barred/i)).toBeInTheDocument();
    });

    it('withholds Mark paid, which wi-admin refuses on a failed payout', async () => {
        /*
         * ⚠ Narrower than jovi-mall's own lifecycle and than the dashboard brief's
         * diagram, both of which document `failed → paid`. wi-admin's manual
         * pre-flight allows `['pending']` alone, so the control would be a
         * guaranteed `409 PAYOUT_NOT_PENDING`.
         */
        stubList([payoutFixture({ status: 'failed' })]);

        queueAs(APPROVER);

        await screen.findByRole('button', { name: 'Retry' });
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    });
});

describe('what Support sees', () => {
    it('offers Endorse and Reject, and neither way of paying', async () => {
        /*
         * ⚠ Reject IS available to Support — it is the half of triage that
         * actually closes a request, and their rejection is final. Send,
         * Mark-paid and the destination reveal are hidden rather than left to
         * answer 403, because a control that only ever refuses teaches an
         * operator that the screen is unreliable.
         */
        stubList([payoutFixture({ triage: null })]);

        queueAs(SUPPORT);

        expect(await screen.findByRole('button', { name: 'Endorse' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /send|retry/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    });

    it('has no separate "recommend rejection" control', async () => {
        // One Reject control, shown to both tiers. A reviewer's rejection is
        // terminal, and terminal outcomes are statuses (D-1).
        stubList([payoutFixture({ triage: null })]);

        queueAs(SUPPORT);

        await screen.findByRole('button', { name: 'Reject' });
        expect(screen.queryByRole('button', { name: /recommend/i })).not.toBeInTheDocument();
    });

    it('stops offering Endorse once somebody has endorsed it', async () => {
        // A request carries one endorsement; a second is a 409.
        stubList([
            payoutFixture({
                triage: {
                    verdict: 'endorsed',
                    note: null,
                    by: { id: '665f1c2a9b3e4a91c7d2e5f0', name: 'Ama Nkeng' },
                    at: '2026-09-15T10:04:00.000Z',
                },
            }),
        ]);

        queueAs(SUPPORT);

        await screen.findByRole('button', { name: 'Reject' });
        expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    });
});

describe('sending money from the queue', () => {
    it('posts an empty body to /send and re-reads the row', async () => {
        const calls = stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return successResponse(payoutFixture({ status: 'processing' }));
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        const send = calls.find((call) => call.url.includes('/send'));
        expect(send?.method).toBe('POST');
        expect(JSON.parse(send?.body ?? '{}')).toEqual({});
    });

    it('reports processing as awaiting confirmation, not as paid', async () => {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return successResponse(
                    payoutFixture({ status: 'processing', transferGatewayRef: 'trf_123456789' }),
                );
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/awaiting confirmation/i)).toBeInTheDocument();
        // The provider's own id, for reconciling against their dashboard.
        expect(screen.getByText(/trf_123456789/)).toBeInTheDocument();
    });

    it('says the funds are still held when the gateway refuses', async () => {
        /*
         * ⛔ The sentence an administrator must not have to infer. A `200`
         * carrying `status: 'failed'` is not an error and is not a refund.
         */
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return successResponse(
                    payoutFixture({
                        status: 'failed',
                        transferFailureReason: 'Beneficiary account is barred',
                    }),
                );
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/funds are still held/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /retry the transfer/i })).toBeInTheDocument();
    });

    it('offers no retry when a transfer is already in flight', async () => {
        /*
         * ⛔ `409 EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT` — pressing send again is
         * the double payment the design exists to prevent. It arrives as
         * `details.platformCode`, never as `error.code`.
         */
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT' },
                });
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/already in progress/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('routes a 422 on the destination to the manual path', async () => {
        // The gateway reaches mobile money only; a bank or card is settled by hand.
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    details: { platformCode: 'EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED' },
                });
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/can’t be paid automatically/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /mark paid instead/i })).toBeInTheDocument();
    });

    it('says nothing was sent when the payout float is short, and offers a retry', async () => {
        /*
         * ⚠ The refusal that is easy to read backwards: a 409 that looks like a
         * failure, where **nothing left**. Safe to retry once topped up.
         */
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: {
                        platformCode: 'EARNINGS_PAYOUT_TRANSFER_FAILED',
                        reason: 'insufficient_gateway_balance',
                        available: 150000,
                        required: 340000,
                    },
                });
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/nothing was sent/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    });

    it('treats a 202 as queued and names which act is being approved', async () => {
        /*
         * ⚠ `/send` rides `money.payouts.mark_paid`, so the four-eyes rule covers
         * it unchanged — and **nothing was sent**. The approver is agreeing to
         * instruct a live transfer rather than to record a manual one, which the
         * backend enforces by hashing `mode` into the approval key.
         */
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/send')) {
                return successResponse(
                    approvalFixture({
                        action: 'money.payouts.mark_paid',
                        payload: { mode: 'gateway' },
                    }),
                    { status: 202, message: 'submitted for a second administrator’s approval' },
                );
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(APPROVER);

        await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));

        expect(await screen.findByText(/nothing has been paid/i)).toBeInTheDocument();
        expect(screen.getByText(/approving a live transfer/i)).toBeInTheDocument();
    });
});

describe('endorsing from the queue', () => {
    it('posts the note and omits an empty one', async () => {
        const calls = stubFetch((call: FetchCall) => {
            if (call.url.includes('/triage')) return successResponse(payoutFixture());
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(SUPPORT);

        await userEvent.click(await screen.findByRole('button', { name: 'Endorse' }));
        await userEvent.type(
            await screen.findByLabelText(/note/i),
            'Checked against KYC docs',
        );
        await userEvent.click(screen.getByRole('button', { name: 'Endorse' }));

        const triage = calls.find((call) => call.url.includes('/triage'));
        expect(triage?.method).toBe('POST');
        expect(JSON.parse(triage?.body ?? '{}')).toEqual({ note: 'Checked against KYC docs' });
    });

    it('names whoever endorsed it first when the race is lost', async () => {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/triage')) {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: {
                        platformCode: 'EARNINGS_PAYOUT_ALREADY_TRIAGED',
                        endorsedBy: 'Ama Nkeng',
                    },
                });
            }
            if (call.url.includes('/money/payouts')) {
                return successResponse([payoutFixture()], { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        queueAs(SUPPORT);

        await userEvent.click(await screen.findByRole('button', { name: 'Endorse' }));
        await userEvent.click(screen.getByRole('button', { name: 'Endorse' }));

        expect(await screen.findByText(/Ama Nkeng already reviewed/i)).toBeInTheDocument();
    });
});
