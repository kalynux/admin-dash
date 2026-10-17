import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { OrderDeliveryFeePanel } from '@/components/orders/OrderDeliveryFeePanel';
import { renderWithProviders } from '@/test/utils';
import type { DeliveryFeeProposal, OrderDetail } from '@/types/orders.types';

/**
 * The proposals table on the order's Delivery fee tab.
 *
 * jovi-mall ADR-A12 (2026-10-14) lets whoever pays the delivery — the vendor
 * or the customer — propose a fee, and the agency answers. wi-admin passes the
 * new values through as strings (`orders.md` § `proposals[]`), so the only
 * work here is the words, and an unknown value must still print.
 */

function proposal(overrides: Partial<DeliveryFeeProposal>): DeliveryFeeProposal {
    return {
        id: '665f1c0000000000000000a1',
        shipmentId: '665f1c0000000000000000b1',
        agencyId: '665f1c0000000000000000c1',
        proposedByRole: 'agency',
        origin: 'agency',
        approver: 'vendor',
        direction: 'increase',
        feeBefore: 1500,
        proposedFee: 2000,
        currency: 'XAF',
        reason: 'Heavier than declared',
        status: 'pending',
        respondedByRole: null,
        respondedAt: null,
        rejectionNote: null,
        withdrawalReason: null,
        topUp: null,
        customerEffect: null,
        createdAt: '2026-10-14T09:00:00.000Z',
        ...overrides,
    };
}

function order(proposals: DeliveryFeeProposal[]): OrderDetail {
    return {
        currency: 'XAF',
        paymentMethod: 'cash_on_delivery',
        deliveryFee: {
            payments: { checkout: null, deliveryTopUps: [], deliveryTopUpsPaid: 0 },
            proposals,
            refunds: [],
            owedManually: 0,
            returned: 0,
        },
    } as unknown as OrderDetail;
}

function renderPanel(proposals: DeliveryFeeProposal[]) {
    renderWithProviders(
        <OrderDeliveryFeePanel
            order={order(proposals)}
            timeZone="Africa/Douala"
            can={() => false}
            onChanged={() => {}}
        />,
    );
}

function rowFor(reason: string): HTMLElement {
    const row = screen.getByText(reason).closest('tr');
    if (!row) throw new Error(`no row for ${reason}`);
    return row;
}

describe('OrderDeliveryFeePanel — fee proposals', () => {
    it('reads a proposal raised by the vendor', () => {
        renderPanel([
            proposal({
                proposedByRole: 'vendor',
                origin: 'payer',
                approver: 'agency',
                reason: 'Vendor offers less',
            }),
        ]);
        const row = within(rowFor('Vendor offers less'));
        expect(row.getByText('Asked by Vendor · Proposed by the payer')).toBeInTheDocument();
        expect(row.getByText('Delivery company answers')).toBeInTheDocument();
    });

    it('reads a proposal raised by the customer', () => {
        renderPanel([
            proposal({
                proposedByRole: 'customer',
                origin: 'payer',
                approver: 'agency',
                reason: 'Customer offers more',
            }),
        ]);
        const row = within(rowFor('Customer offers more'));
        expect(row.getByText('Asked by Customer · Proposed by the payer')).toBeInTheDocument();
        expect(row.getByText('Delivery company answers')).toBeInTheDocument();
    });

    it('leaves the ordinary agency origin unsaid', () => {
        renderPanel([proposal({ reason: 'Agency asks more' })]);
        const row = within(rowFor('Agency asks more'));
        expect(row.getByText('Asked by Agency')).toBeInTheDocument();
        expect(row.getByText('The shop')).toBeInTheDocument();
    });

    it('prints values it has never heard of raw, rather than failing', () => {
        renderPanel([
            proposal({
                proposedByRole: 'courier_partner',
                origin: 'invented_next_quarter',
                approver: 'regulator',
                reason: 'From the future',
            }),
        ]);
        const row = within(rowFor('From the future'));
        expect(
            row.getByText('Asked by courier_partner · invented_next_quarter'),
        ).toBeInTheDocument();
        expect(row.getByText('regulator')).toBeInTheDocument();
    });
});
