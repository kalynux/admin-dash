import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RaiseRefundDialog, type RaiseRefundSource } from '@/components/refunds/RaiseRefundDialog';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    codRefundEligibilityFixture,
    REFUND_ID,
    REFUND_ORDER_ID,
    refundEligibilityFixture,
    refundRequestFixture,
} from '@/test/refund-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { RefundEligibility } from '@/types/refunds.types';

const PROOF_ID = '6702a1b2c3d4e5f6a7b8c999';

function open({
    source = { kind: 'order', id: REFUND_ORDER_ID, label: 'ORD-1' } as RaiseRefundSource | null,
    eligibility = refundEligibilityFixture(),
    tier = 2 as 1 | 2 | 3,
    create = () =>
        successResponse(refundRequestFixture(), { status: 201, meta: { approveNow: { status: 'not_requested' } } }),
}: {
    /** `null` = raised from the queue, with no record in hand. */
    source?: RaiseRefundSource | null;
    eligibility?: RefundEligibility;
    tier?: 1 | 2 | 3;
    create?: (call: FetchCall) => Response;
} = {}) {
    const onRaised = vi.fn();
    const calls = stubFetch((call) => {
        if (call.url.includes('/refunds/eligibility')) return successResponse(eligibility);
        if (call.method === 'POST' && call.url.endsWith('/refunds/proofs')) {
            return successResponse({ fileId: PROOF_ID }, { status: 201 });
        }
        if (call.method === 'POST' && call.url.endsWith('/refunds')) return create(call);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(<RaiseRefundDialog open onOpenChange={() => {}} source={source ?? undefined} onRaised={onRaised} />, {
        auth: { status: 'authenticated', admin: adminFixture() },
        permissions: { held: heldFixture(tier) },
    });
    return { calls, onRaised };
}

const posted = (calls: FetchCall[]) => {
    const call = calls.find((entry) => entry.method === 'POST' && entry.url.endsWith('/refunds'));
    return call ? JSON.parse(call.body!) : null;
};

describe('raising a refund', () => {
    /** Billing refunds are full only: `amount` is a 400 there, so the field is not offered. */
    it('offers no amount for a plan purchase, and sends none', async () => {
        const { calls } = open({
            source: { kind: 'plan_purchase', id: REFUND_ORDER_ID },
            eligibility: refundEligibilityFixture({ sourceKind: 'plan_purchase', paymentChannel: 'card', feePercent: 0 }),
        });

        expect(await screen.findByText(/refunded in full only/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();

        await userEvent.type(screen.getByLabelText(/why it is owed/i), 'Charged twice');
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));
        await waitFor(() => expect(posted(calls)).not.toBeNull());
        expect(posted(calls)).not.toHaveProperty('amount');
        expect(posted(calls).sourceKind).toBe('plan_purchase');
    });

    /** A typed number needs its picture, uploaded first to the private proof route. */
    it('uploads the customer’s message and sends the typed number with its proof id', async () => {
        const { calls } = open({ eligibility: codRefundEligibilityFixture() });

        await userEvent.type(await screen.findByLabelText(/why it is owed/i), 'Cancelled before dispatch');
        await userEvent.type(screen.getByLabelText(/phone number/i), '+237 677 00 11 22');
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(['png'], 'message.png', { type: 'image/png' }));
        expect(await screen.findByText(/uploaded: message.png/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));
        await waitFor(() => expect(posted(calls)).not.toBeNull());
        expect(posted(calls)).toMatchObject({
            destination: { phone: '+237 677 00 11 22' },
            destinationProofFileId: PROOF_ID,
        });
        // Approve-now is not ticked, so it is not sent.
        expect(posted(calls)).not.toHaveProperty('approveNow');
    });

    it('refuses a number that is not in international form before sending', async () => {
        const { calls } = open({ eligibility: codRefundEligibilityFixture() });
        await userEvent.type(await screen.findByLabelText(/why it is owed/i), 'Cancelled before dispatch');
        await userEvent.type(screen.getByLabelText(/phone number/i), '677001122');
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));
        expect(await screen.findByText(/international form/i, { selector: 'p.text-destructive, [id$="-error"]' })).toBeInTheDocument();
        expect(posted(calls)).toBeNull();
    });

    it('links to the request that is already open instead of raising a second', async () => {
        open({
            create: () =>
                errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'REFUND_ALREADY_OPEN', refundRequestId: REFUND_ID },
                }),
        });
        await userEvent.type(await screen.findByLabelText(/why it is owed/i), 'Parcel never arrived');
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));

        expect(await screen.findByText(/already open for this/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open it/i })).toHaveAttribute(
            'href',
            `/dashboard/refunds/${REFUND_ID}`,
        );
    });

    it('sends Approve now only when an approver ticks it', async () => {
        const { calls } = open();
        await userEvent.type(await screen.findByLabelText(/why it is owed/i), 'Parcel never arrived');
        await userEvent.click(screen.getByRole('checkbox', { name: /approve now/i }));
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));
        await waitFor(() => expect(posted(calls)).not.toBeNull());
        expect(posted(calls).approveNow).toBe(true);
    });

    it('asks for the source when raised from the queue', async () => {
        open({ source: null });
        expect(await screen.findByRole('button', { name: /check what can be refunded/i })).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/order id/i), 'not-an-id');
        await userEvent.click(screen.getByRole('button', { name: /check what can be refunded/i }));
        expect(await screen.findByText(/24-character id/i)).toBeInTheDocument();
    });
});
