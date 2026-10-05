import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { RefundRequestDetail } from '@/pages/refunds/RefundRequestDetail';
import { RefundRequestsList } from '@/pages/refunds/RefundRequestsList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    REFUND_ID,
    refundListMetaFixture,
    refundRequestFixture,
    typedRefundRequestFixture,
} from '@/test/refund-fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { RefundRequest } from '@/types/refunds.types';

const ME = adminFixture().id;

// ─── The queue ────────────────────────────────────────────────────────────────

function renderList({ tier = 2, route = '/dashboard/refunds', rows = [refundRequestFixture()] } = {}) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/refunds')) {
            return successResponse(rows, { meta: refundListMetaFixture(rows.length) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/refunds" element={<RefundRequestsList />} />
        </Routes>,
        {
            route,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(tier as 1 | 2 | 3) },
        },
    );
    return calls;
}

const lastQuery = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost').searchParams;

describe('the refund queue', () => {
    it('opens on the working queue — the five open statuses', async () => {
        const calls = renderList();
        await screen.findByText(/chez awa/i);
        expect(lastQuery(calls).get('open')).toBe('true');
        expect(lastQuery(calls).get('status')).toBeNull();
    });

    it('sends one status per tab', async () => {
        const calls = renderList();
        await screen.findByText(/chez awa/i);
        await userEvent.click(screen.getByRole('tab', { name: /transfer failed/i }));
        await waitFor(() => expect(lastQuery(calls).get('status')).toBe('failed'));
        expect(lastQuery(calls).get('open')).toBeNull();
    });

    /** `status` is a pinned enum: an unknown value would be a 400, so it is never sent. */
    it('reads a hand-edited tab it does not know as the open queue', async () => {
        const calls = renderList({ route: '/dashboard/refunds?tab=pending' });
        await screen.findByText(/chez awa/i);
        expect(lastQuery(calls).get('status')).toBeNull();
        expect(lastQuery(calls).get('open')).toBe('true');
    });

    it('shows gross, fee and net side by side', async () => {
        renderList();
        expect(await screen.findByText(/fee .*100.* customer gets .*4,900/i)).toBeInTheDocument();
    });

    it('says a COD refund waiting for cash is still with the agent or agency', async () => {
        renderList({
            rows: [refundRequestFixture({ status: 'waiting_for_cash', paymentChannel: 'cod' })],
        });
        expect(await screen.findByText(/cash still with the agent or agency/i)).toBeInTheDocument();
    });

    /** Support may hold, never send — but raising is theirs. */
    it('offers Raise a refund to Support', async () => {
        renderList({ tier: 3 });
        expect(await screen.findByRole('button', { name: /raise a refund/i })).toBeInTheDocument();
    });
});

// ─── The detail ───────────────────────────────────────────────────────────────

interface DetailOptions {
    refund?: RefundRequest;
    tier?: 1 | 2 | 3;
    held?: ReadonlySet<string>;
    write?: (call: FetchCall) => Response;
}

function renderDetail({ refund = refundRequestFixture(), tier = 2, held, write }: DetailOptions = {}) {
    const calls = stubFetch((call) => {
        if (call.method !== 'GET' && write) return write(call);
        if (call.url.includes('/refunds/proofs/')) {
            return new Response('JPEGBYTES', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        }
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: refundListMetaFixture(0) });
        }
        if (call.url.includes(`/refunds/${REFUND_ID}`)) return successResponse(refund);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/refunds/:refundId" element={<RefundRequestDetail />} />
        </Routes>,
        {
            route: `/dashboard/refunds/${REFUND_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: held ?? heldFixture(tier) },
        },
    );
    return calls;
}

const button = (name: RegExp) => screen.queryByRole('button', { name });

describe('the decisions on a request', () => {
    it('offers Approve, Reject and Settle on a request waiting for approval', async () => {
        renderDetail();
        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeEnabled();
        expect(button(/^reject$/i)).toBeInTheDocument();
        expect(button(/settle outside the platform/i)).toBeInTheDocument();
        expect(button(/^retry$/i)).not.toBeInTheDocument();
        expect(button(/resolve stuck transfer/i)).not.toBeInTheDocument();
    });

    /** Support may hold, never send — perturbation: drop a gate and this goes red. */
    it('offers Support no decision at all', async () => {
        renderDetail({ tier: 3 });
        await screen.findByText(/sandals arrived with a broken strap/i);
        expect(button(/^approve$/i)).not.toBeInTheDocument();
        expect(button(/^reject$/i)).not.toBeInTheDocument();
        expect(button(/settle outside the platform/i)).not.toBeInTheDocument();
        expect(button(/^retry$/i)).not.toBeInTheDocument();
    });

    /** ⛔ Nothing but Resolve acts on `sending` — the money may already be moving. */
    it('offers only Resolve while a transfer is with the gateway', async () => {
        renderDetail({ refund: refundRequestFixture({ status: 'sending' }) });
        expect(await screen.findByRole('button', { name: /resolve stuck transfer/i })).toBeInTheDocument();
        expect(button(/^reject$/i)).not.toBeInTheDocument();
        expect(button(/settle outside the platform/i)).not.toBeInTheDocument();
        expect(button(/^approve$/i)).not.toBeInTheDocument();
    });

    it('offers Retry, Reject and Settle on a failed transfer, with its reason', async () => {
        renderDetail({
            refund: refundRequestFixture({
                status: 'failed',
                transfer: { gateway: 'NOTCHPAY', gatewayRef: 'tr_1', failureReason: 'payout_unavailable', note: null, legs: [] },
            }),
        });
        expect(await screen.findByRole('button', { name: /^retry$/i })).toBeInTheDocument();
        expect(button(/^reject$/i)).toBeInTheDocument();
        expect(button(/settle outside the platform/i)).toBeInTheDocument();
        expect(screen.getByText(/payouts are switched off/i)).toBeInTheDocument();
    });

    it('offers Retry on an approved request whose send was refused before it started', async () => {
        renderDetail({
            refund: refundRequestFixture({
                status: 'approved',
                transfer: {
                    gateway: null,
                    gatewayRef: null,
                    failureReason: 'insufficient_gateway_balance',
                    note: null,
                    legs: [],
                },
            }),
        });
        expect(await screen.findByRole('button', { name: /^retry$/i })).toBeInTheDocument();
        expect(screen.getByText(/payout account short of funds/i)).toBeInTheDocument();
    });

    it('sends the administrator to Reject when the source no longer holds the amount', async () => {
        renderDetail({
            refund: refundRequestFixture({
                status: 'failed',
                transfer: { gateway: null, gatewayRef: null, failureReason: 'exceeds_refundable', note: null, legs: [] },
            }),
        });
        expect(await screen.findByText('The source no longer holds this much.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^reject$/i }).length).toBeGreaterThan(1);
    });
});

describe('the two four-eyes rules', () => {
    /** R-7: the typist cannot approve their own number. Disabled, never hidden. */
    it('disables Approve for the administrator who typed the number, and says why', async () => {
        renderDetail({
            refund: typedRefundRequestFixture({ requestedBy: { id: ME, role: 'admin', name: 'Ada Nkemelu' } }),
        });
        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeDisabled();
        expect(screen.getByText(/another administrator must approve a typed number/i)).toBeInTheDocument();
    });

    it('lets a different administrator approve a typed number, beside its picture', async () => {
        renderDetail({ refund: typedRefundRequestFixture() });
        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeEnabled();
        expect(screen.getByText(/compare it digit for digit/i)).toBeInTheDocument();
        // The number in full on the detail — the approver compares it with the proof.
        expect(screen.getByText('+237677001122')).toBeInTheDocument();
    });

    it('says before the click that a large refund goes to a second administrator', async () => {
        renderDetail({ refund: refundRequestFixture({ grossAmount: 2_400_000, feeAmount: 48_000, netAmount: 2_352_000 }) });
        expect(await screen.findByText(/approving needs a second administrator/i)).toBeInTheDocument();
    });

    /** A `202` is not an error: nothing was approved, and it says where it went. */
    it('renders a queued approval as waiting, with the approvals queue linked', async () => {
        const calls = renderDetail({
            refund: refundRequestFixture({ grossAmount: 2_400_000, feeAmount: 48_000, netAmount: 2_352_000 }),
            write: () =>
                successResponse(
                    {
                        id: '66a1b2c3d4e5f60718293a4b',
                        action: 'orders.refund',
                        description: 'Approve refund request 6701… — XAF 2,400,000',
                        status: 'pending',
                        expiresAt: '2026-10-06T10:00:00.000Z',
                    },
                    { status: 202 },
                ),
        });

        await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

        expect(await screen.findByText(/sent for a second administrator/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open it in the approvals queue/i })).toHaveAttribute(
            'href',
            `/dashboard/approvals?targetId=${REFUND_ID}`,
        );
        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toMatch(/\/refunds\/6701a0b2c3d4e5f6a7b8c901\/approve$/);
        expect(JSON.parse(post.body!)).toEqual({});
    });

    it('turns REFUND_SECOND_APPROVER_REQUIRED into the reason, not a generic error', async () => {
        renderDetail({
            refund: typedRefundRequestFixture(),
            write: () =>
                errorResponse(409, 'REFUND_SECOND_APPROVER_REQUIRED', { category: 'conflict' }),
        });
        await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
        expect(await within(dialog).findByText(/another administrator must approve this/i)).toBeInTheDocument();
    });
});

describe('settling outside the platform', () => {
    it('will not record a hand payment without its proof picture', async () => {
        const calls = renderDetail();
        await userEvent.click(await screen.findByRole('button', { name: /settle outside the platform/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('radio', { name: /^cash$/i }));
        await userEvent.click(within(dialog).getByRole('button', { name: /record as paid/i }));

        expect(await within(dialog).findByText(/needs its proof/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('uploads the picture to the private proof route, then settles with its id', async () => {
        const calls = renderDetail({
            write: (call) => {
                if (call.url.endsWith('/refunds/proofs')) {
                    return successResponse({ fileId: '6702a1b2c3d4e5f6a7b8c999' }, { status: 201 });
                }
                return successResponse(refundRequestFixture({ status: 'completed' }));
            },
        });
        await userEvent.click(await screen.findByRole('button', { name: /settle outside the platform/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('radio', { name: /mobile money/i }));
        const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(['png'], 'receipt.png', { type: 'image/png' }));
        expect(await within(dialog).findByText(/uploaded: receipt.png/i)).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole('button', { name: /record as paid/i }));
        await waitFor(() =>
            expect(calls.some((call) => call.url.endsWith('/settle-external'))).toBe(true),
        );

        const upload = calls.find((call) => call.url.endsWith('/refunds/proofs'))!;
        // ONE part under `file`, and never through the public `/files/upload`.
        expect(upload.formData?.get('file')).toBeInstanceOf(File);
        expect(calls.some((call) => call.url.includes('/files/upload'))).toBe(false);

        const settle = calls.find((call) => call.url.endsWith('/settle-external'))!;
        expect(JSON.parse(settle.body!)).toEqual({ method: 'mobile_money', proofFileId: '6702a1b2c3d4e5f6a7b8c999' });
    });

    it('shows what was paid by hand — the remainder, not the request’s total', async () => {
        renderDetail({
            refund: refundRequestFixture({
                status: 'completed',
                earningsSettledAt: '2026-10-05T12:00:00.000Z',
                externalSettlement: {
                    method: 'cash',
                    reference: null,
                    proofFileId: '6702a1b2c3d4e5f6a7b8c998',
                    settledBy: { id: 'x', name: 'Ops Admin' },
                    settledAt: '2026-10-05T11:00:00.000Z',
                    grossAmount: 2000,
                    netAmount: 1960,
                },
            }),
        });
        expect(await screen.findByText('Paid by hand')).toBeInTheDocument();
        expect(screen.getByText(/customer received .*1,960/i)).toBeInTheDocument();
    });
});

describe('the proof pictures', () => {
    /** Every open is audited, so nothing is fetched until the approver clicks. */
    it('fetches a proof only when it is clicked', async () => {
        const calls = renderDetail({ refund: typedRefundRequestFixture() });
        await screen.findByText(/the customer’s message giving this number/i);
        expect(calls.some((call) => call.url.includes('/refunds/proofs/'))).toBe(false);

        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));
        await waitFor(() =>
            expect(
                calls.some((call) => call.url.includes('/refunds/proofs/6702a1b2c3d4e5f6a7b8c999')),
            ).toBe(true),
        );
    });
});

describe('a completed request', () => {
    it('says it is still being finalised while the earnings recovery is due', async () => {
        renderDetail({
            refund: refundRequestFixture({ status: 'completed', completedAt: '2026-10-05T11:00:00.000Z' }),
        });
        expect(await screen.findByText(/refunded — still being finalised/i)).toBeInTheDocument();
    });

    it('offers nothing on a completed request', async () => {
        renderDetail({
            refund: refundRequestFixture({
                status: 'completed',
                completedAt: '2026-10-05T11:00:00.000Z',
                earningsSettledAt: '2026-10-05T12:00:00.000Z',
            }),
        });
        await screen.findByText(/sandals arrived/i);
        expect(button(/^approve$/i)).not.toBeInTheDocument();
        expect(button(/^reject$/i)).not.toBeInTheDocument();
        expect(button(/settle outside the platform/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/still being finalised/i)).not.toBeInTheDocument();
    });
});
