/**
 * The 2026-10-22 refund round: two fees, who pays them, and parcels delivered
 * at fault. Contract: `FRONTEND-CHANGELOG-refund-fees-and-claims.md` and
 * `refunds.md` § Money.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RaiseRefundDialog } from '@/components/refunds/RaiseRefundDialog';
import { RefundMoney } from '@/components/refunds/RefundBits';
import { formatMoney } from '@/lib/format';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { REFUND_ORDER_ID, refundEligibilityFixture, refundRequestFixture } from '@/test/refund-fixtures';
import { shipmentFixture, shipmentListMetaFixture } from '@/test/shipment-fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { RefundDeliveryFault, RefundEligibility, RefundFees } from '@/types/refunds.types';

const PARCEL_A = '6671aabbccddeeff00112233';
/** As Testing Library normalises DOM text: `Intl` puts a no-break space after the symbol. */
const flat = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ');
const xaf = (n: number) => flat(formatMoney(n, 'XAF'));
/** Text containing `needle`, across nested nodes — for sentences that embed an amount. */
const containing = (needle: string) => (_: string, node: Element | null) =>
    !!node &&
    flat(node.textContent).includes(needle) &&
    ![...node.children].some((child) => flat(child.textContent).includes(needle));
const PARCEL_B = '6671aabbccddeeff00112244';

const customerFees: RefundFees = {
    paidBy: 'customer',
    paymentFeePercent: 2,
    paymentFee: 100,
    transferFeePercent: 2,
    transferFee: 98,
    vendorCharge: 0,
};

describe('the two fees on a refund', () => {
    it('prints the payment fee and the transfer fee apart, as sent', () => {
        render(<RefundMoney gross={5000} fee={198} net={4802} currency="XAF" fees={customerFees} feeRate={2} />);
        expect(screen.getByText('Payment fee 2%')).toBeInTheDocument();
        expect(screen.getByText('Transfer fee 2%')).toBeInTheDocument();
        expect(screen.getByText(xaf(100))).toBeInTheDocument();
        expect(screen.getByText(xaf(98))).toBeInTheDocument();
        expect(screen.getByText(xaf(4802))).toBeInTheDocument();
    });

    it('prints only the fee that happened — a card refund has no transfer fee', () => {
        render(
            <RefundMoney
                gross={10000}
                fee={200}
                net={9800}
                currency="XAF"
                fees={{ ...customerFees, paymentFee: 200, transferFeePercent: 0, transferFee: 0 }}
            />,
        );
        expect(screen.getByText('Payment fee 2%')).toBeInTheDocument();
        expect(screen.queryByText(/transfer fee/i)).not.toBeInTheDocument();
    });

    it('says the seller pays when the seller cancelled a paid order', () => {
        render(
            <RefundMoney
                gross={12000}
                fee={0}
                net={12000}
                currency="XAF"
                fees={{ ...customerFees, paidBy: 'vendor', paymentFee: 240, transferFee: 240, vendorCharge: 480 }}
            />,
        );
        expect(screen.getByText('Fees charged to the seller')).toBeInTheDocument();
        expect(screen.getByText(xaf(480))).toBeInTheDocument();
        expect(screen.getByText(/the seller pays the fees/i)).toBeInTheDocument();
        // The customer-side lines are not shown as deductions.
        expect(screen.queryByText('Payment fee 2%')).not.toBeInTheDocument();
    });

    it('falls back to one transfer-fee line when an older wi-admin sends no fees', () => {
        render(<RefundMoney gross={5000} fee={100} net={4900} currency="XAF" fees={null} feeRate={2} />);
        expect(screen.getByText('Transfer fee 2%')).toBeInTheDocument();
        expect(screen.queryByText(/payment fee/i)).not.toBeInTheDocument();
    });

    it('puts both fees in the compact queue cell', () => {
        render(<RefundMoney gross={5000} fee={198} net={4802} currency="XAF" fees={customerFees} compact />);
        expect(
            screen.getByText(containing(`payment fee 2% ${xaf(100)} · transfer fee 2% ${xaf(98)}`)),
        ).toBeInTheDocument();
    });

    it('says "fees charged to the seller" in the compact cell', () => {
        render(
            <RefundMoney
                gross={12000}
                fee={0}
                net={12000}
                currency="XAF"
                fees={{ ...customerFees, paidBy: 'vendor', vendorCharge: 480 }}
                compact
            />,
        );
        expect(screen.getByText(containing(`fees charged to the seller ${xaf(480)}`))).toBeInTheDocument();
    });
});

function verdict(overrides: Partial<RefundDeliveryFault> = {}): RefundDeliveryFault {
    return {
        shipmentId: PARCEL_A,
        agencyId: '665c0011223344556677889a',
        trackingNumber: 'ACR-260812-103000-4K7QP',
        deliveredAt: '2026-10-20T09:00:00.000Z',
        raisedAt: '2026-10-21T08:00:00.000Z',
        windowDays: 2,
        insideWindow: true,
        customerDeliveryAmount: 1000,
        claimDeadlineDays: 2,
        returnsPayer: null,
        ...overrides,
    };
}

function openForm({
    eligibility = (call: FetchCall): RefundEligibility => {
        const ids = new URL(call.url, 'http://localhost').searchParams.get('deliveryFaultShipmentIds');
        return refundEligibilityFixture(
            ids
                ? {
                      deliveryFault: ids.split(',').map((id) =>
                          id === PARCEL_A
                              ? verdict()
                              : verdict({
                                    shipmentId: id,
                                    trackingNumber: 'ACR-260812-103000-9ZZZZ',
                                    insideWindow: false,
                                    customerDeliveryAmount: 0,
                                    windowDays: 3,
                                }),
                      ),
                  }
                : {},
        );
    },
    tier = 2 as 1 | 2 | 3,
} = {}) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/refunds/eligibility')) return successResponse(eligibility(call));
        if (call.url.includes('/shipments?')) {
            return successResponse(
                [
                    shipmentFixture({ id: PARCEL_A }),
                    shipmentFixture({ id: PARCEL_B, trackingNumber: 'ACR-260812-103000-9ZZZZ' }),
                ],
                { meta: shipmentListMetaFixture({ total: 2 }) },
            );
        }
        if (call.method === 'POST' && call.url.endsWith('/refunds')) {
            return successResponse(refundRequestFixture(), {
                status: 201,
                meta: { approveNow: { status: 'not_requested' } },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <RaiseRefundDialog
            open
            onOpenChange={() => {}}
            source={{ kind: 'order', id: REFUND_ORDER_ID, label: 'ORD-1' }}
            onRaised={vi.fn()}
        />,
        { auth: { status: 'authenticated', admin: adminFixture() }, permissions: { held: heldFixture(tier) } },
    );
    return calls;
}

const eligibilityCalls = (calls: FetchCall[]) =>
    calls.filter((call) => call.url.includes('/refunds/eligibility'));

describe('delivery at fault on the create form', () => {
    it('lists the order’s parcels and explains when to use it', async () => {
        const calls = openForm();
        expect(await screen.findByText('Delivery at fault (optional)')).toBeInTheDocument();
        expect(await screen.findByText(/only when the parcel was damaged or lost in delivery/i)).toBeInTheDocument();
        expect(await screen.findByRole('checkbox', { name: /ACR-260812-103000-4K7QP/ })).toBeInTheDocument();
        const list = calls.find((call) => call.url.includes('/shipments?'));
        expect(new URL(list!.url, 'http://localhost').searchParams.get('orderId')).toBe(REFUND_ORDER_ID);
    });

    it('re-reads the eligibility with the ticked parcels, comma-separated, and shows each verdict', async () => {
        const calls = openForm();
        await userEvent.click(await screen.findByRole('checkbox', { name: /ACR-260812-103000-4K7QP/ }));
        await userEvent.click(screen.getByRole('checkbox', { name: /ACR-260812-103000-9ZZZZ/ }));

        await waitFor(() => {
            const last = eligibilityCalls(calls).at(-1)!;
            expect(new URL(last.url, 'http://localhost').searchParams.get('deliveryFaultShipmentIds')).toBe(
                `${PARCEL_A},${PARCEL_B}`,
            );
        });
        expect(
            await screen.findByText(`The agency and rider will refund this delivery (${xaf(1000)}).`),
        ).toBeInTheDocument();
        expect(screen.getByText(/outside the agency’s 3-day window — the agency keeps its fee/i)).toBeInTheDocument();
        // The first read carried none: the key is omitted, never sent empty.
        expect(new URL(eligibilityCalls(calls)[0].url, 'http://localhost').searchParams.has('deliveryFaultShipmentIds')).toBe(false);
    });

    it('sends the ticked parcels on create, and nothing when none is ticked', async () => {
        const calls = openForm();
        await userEvent.click(await screen.findByRole('checkbox', { name: /ACR-260812-103000-4K7QP/ }));
        await userEvent.type(screen.getByLabelText(/why it is owed/i), 'Parcel crushed in delivery');
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        const body = JSON.parse(calls.find((call) => call.method === 'POST')!.body!);
        expect(body.deliveryFaultShipmentIds).toEqual([PARCEL_A]);
    });

    it('omits the key on create when no parcel is named', async () => {
        const calls = openForm();
        await userEvent.type(await screen.findByLabelText(/why it is owed/i), 'Changed their mind');
        await userEvent.click(screen.getByRole('button', { name: /^raise refund$/i }));
        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        expect(JSON.parse(calls.find((call) => call.method === 'POST')!.body!)).not.toHaveProperty(
            'deliveryFaultShipmentIds',
        );
    });

    it('prints the preview’s two fees when the platform splits them', async () => {
        openForm({
            eligibility: () =>
                refundEligibilityFixture({
                    paymentFeePercent: 2,
                    attributionPreview: {
                        ...refundEligibilityFixture().attributionPreview,
                        byReasonKind: {
                            cancellation: {
                                maxRefundable: 6000,
                                goods: 5000,
                                delivery: 1000,
                                feeAmount: 238,
                                netAmount: 5762,
                                paymentFee: 120,
                                transferFee: 118,
                            },
                        },
                    },
                }),
        });
        const money = within((await screen.findByText('Payment fee 2%')).closest('dl') as HTMLElement);
        expect(money.getByText('Transfer fee 2%')).toBeInTheDocument();
        expect(money.getByText(xaf(118))).toBeInTheDocument();
        expect(screen.getByText(/a 2% payment fee .* and a 2% transfer fee are deducted/i)).toBeInTheDocument();
    });
});
