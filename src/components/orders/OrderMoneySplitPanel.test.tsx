import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OrderMoneySplitPanel } from '@/components/orders/OrderMoneySplitPanel';
import { heldFixture } from '@/test/fixtures';
import {
    deliveryBasisFixture,
    goodsBasisFixture,
    moneyLineFixture,
    orderMoneySplitFixture,
    splitShipmentFixture,
} from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

/*
 * `GET /money/orders/:orderId/split` — the order's Money tab (money-split
 * changelog, 2026-10-04). What is pinned:
 * - every figure is printed as sent, never re-added;
 * - a projected section looks projected (an Estimate badge);
 * - the two warnings the changelog names (`vendor_net_negative`, a non-zero
 *   difference);
 * - unknown vocabulary renders as text;
 * - the platform's own amounts are FCFA for Developers and RATES for Admin and
 *   Support (owner's decision, 2026-10-04).
 */

const ORDER_ID = '6670aabbccddeeff00112233';
const TIER_LABEL: Record<AdminTier, string> = { 1: 'Developer', 2: 'Admin', 3: 'Support' };

function render(split: unknown, tier: AdminTier = 1) {
    const calls = stubFetch((call) => {
        if (call.url.includes(`/money/orders/${ORDER_ID}/split`)) return successResponse(split);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <OrderMoneySplitPanel orderId={ORDER_ID} timeZone="Africa/Douala" reloadToken={0} />,
        { permissions: { held: heldFixture(tier), tier, tierLabel: TIER_LABEL[tier] } },
    );
    return calls;
}

/** The lines table of one section, found by its moment's label. */
async function section(name: RegExp) {
    return within(await screen.findByRole('region', { name }));
}

describe('a projected prepaid order (money.md’s worked example)', () => {
    it('reads the split from the documented path', async () => {
        const calls = render(orderMoneySplitFixture());
        await screen.findByText('Who gets what');
        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain(`/money/orders/${ORDER_ID}/split`);
    });

    it('marks the estimate, on the order and on every projected section', async () => {
        render(orderMoneySplitFixture());
        await screen.findByText('Who gets what');
        // One on the header, one per projected section.
        expect(screen.getAllByText('Estimate')).toHaveLength(3);
    });

    it('prints every line as sent, with its beneficiary and status', async () => {
        render(orderMoneySplitFixture());
        const payment = await section(/payment/i);

        expect(payment.getByText('Chez Ama')).toBeInTheDocument();
        expect(payment.getByText('Vendor net')).toBeInTheDocument();
        // The vendor net appears in the line and in the totals, and is the
        // server's number — 52 450, not anything re-derived.
        expect(screen.getAllByText(/52,450/).length).toBeGreaterThan(0);
        expect(payment.getAllByText('Projected')).toHaveLength(3);
        expect(screen.getByText(/the vendor's plan rate is read again/i)).toBeInTheDocument();
    });

    it('says the agent is not known yet rather than showing zero', async () => {
        render(orderMoneySplitFixture());
        const delivery = await section(/^delivery fee$/i);
        expect(delivery.getByText(/agent: none yet/i)).toBeInTheDocument();
        expect(delivery.getByText(/no agent has accepted yet/i)).toBeInTheDocument();
    });

    it('opens the basis on demand — the bargain fee item by item', async () => {
        const user = userEvent.setup();
        render(orderMoneySplitFixture());
        const payment = await section(/payment/i);

        await user.click(payment.getByRole('button', { name: /how this was calculated/i }));

        expect(payment.getByText('Phone — Black')).toBeInTheDocument();
        expect(payment.getByText(/30% of what each bargainable item sold/)).toBeInTheDocument();
        expect(payment.getByText(/10% of the items after the bargain fee/)).toBeInTheDocument();
        // A Developer sees the commission base and amount beside the rate.
        expect(payment.getByText(/60,500/)).toBeInTheDocument();
    });
});

describe('the platform’s own amounts', () => {
    it('are FCFA for a Developer', async () => {
        render(orderMoneySplitFixture(), 1);
        const payment = await section(/payment/i);

        expect(payment.getByText(/6,050/)).toBeInTheDocument();
        expect(payment.getByText(/4,500/)).toBeInTheDocument();
        expect(screen.getByText('Platform — total')).toBeInTheDocument();
        expect(screen.getByText(/10,550/)).toBeInTheDocument();
    });

    it.each([2, 3] as const)('are rates, never FCFA, for tier %i', async (tier) => {
        const user = userEvent.setup();
        render(orderMoneySplitFixture(), tier);
        const payment = await section(/payment/i);

        // The two platform lines carry the rate in the amount cell.
        const commission = payment.getByText('Platform — commission').closest('tr');
        const bargain = payment.getByText('Platform — bargain fee').closest('tr');
        expect(within(commission as HTMLElement).getByText('10%')).toBeInTheDocument();
        expect(within(bargain as HTMLElement).getByText('30%')).toBeInTheDocument();

        // The basis keeps the rates and drops the platform's figures.
        await user.click(payment.getByRole('button', { name: /how this was calculated/i }));
        expect(payment.getByText(/30% of what each bargainable item sold/)).toBeInTheDocument();
        expect(payment.queryByRole('columnheader', { name: 'Fee' })).not.toBeInTheDocument();

        // Nowhere on the panel: the commission, the bargain fee, their total or
        // the commission base. The vendor's figures stay.
        for (const amount of [/6,050/, /4,500/, /10,550/, /60,500/]) {
            expect(screen.queryByText(amount)).not.toBeInTheDocument();
        }
        expect(screen.queryByText('Platform — total')).not.toBeInTheDocument();
        expect(screen.getByText(/Commission 10% · Bargain fee 30% of the uplift/)).toBeInTheDocument();
        expect(screen.getAllByText(/52,450/).length).toBeGreaterThan(0);
    });
});

describe('an allocated order', () => {
    it('says why each held line is waiting, with the release date', async () => {
        const split = orderMoneySplitFixture({
            estimated: false,
            sections: [
                {
                    ...orderMoneySplitFixture().sections[0],
                    state: 'allocated',
                    notes: [],
                    lines: [
                        moneyLineFixture({
                            status: 'held',
                            allocationId: '66a1aabbccddeeff00112233',
                            holdReleaseAt: '2026-10-11T09:00:00.000Z',
                            waitingOn: ['hold_window'],
                        }),
                        moneyLineFixture({
                            role: 'commission',
                            beneficiary: { type: 'platform', id: null, name: null },
                            amount: 6050,
                            status: 'released',
                            releasedAt: '2026-10-11T09:00:00.000Z',
                        }),
                    ],
                },
            ],
        });
        render(split);
        const payment = await section(/payment/i);

        expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
        expect(payment.getByText('Allocated')).toBeInTheDocument();
        expect(payment.getByText('In the hold window')).toBeInTheDocument();
        expect(payment.getByText(/releases/)).toBeInTheDocument();
        expect(payment.getByText('Held')).toBeInTheDocument();
        expect(payment.getByText('Released')).toBeInTheDocument();
    });
});

describe('a cash-on-delivery order', () => {
    it('renders one cash collection, with the cash wait and an unknown agent share', async () => {
        const split = orderMoneySplitFixture({
            sections: [
                {
                    key: 'shipment:6680aabbccddeeff00112233',
                    moment: 'cash_collection',
                    source: { type: 'cod_collection', id: null },
                    state: 'allocated',
                    noneReason: null,
                    shipment: splitShipmentFixture({ status: 'delivered' }),
                    goods: goodsBasisFixture({ codHandlingFee: 500, vendorNet: 51950 }),
                    delivery: deliveryBasisFixture({ outcome: 'delivered', codHandlingFee: 500 }),
                    lines: [
                        moneyLineFixture({
                            amount: 51950,
                            status: 'held',
                            requiresCashSettlement: true,
                            waitingOn: ['order_not_completed', 'cash_not_settled', 'paused'],
                        }),
                        moneyLineFixture({
                            role: 'delivery_agent',
                            beneficiary: { type: 'agent', id: null, name: null },
                            amount: null,
                            status: 'projected',
                        }),
                    ],
                    notes: [],
                },
            ],
        });
        render(split);
        const cod = await section(/cash collection/i);

        // The value kept its name when the hold moved to delivery (2026-10-05);
        // the label follows the meaning.
        expect(cod.getByText('Not delivered yet')).toBeInTheDocument();
        expect(cod.queryByText('Waiting for the order to complete')).not.toBeInTheDocument();
        expect(cod.getByText('Paused')).toBeInTheDocument();
        expect(cod.getByText('Waiting for the cash to reach the platform')).toBeInTheDocument();
        // `amount: null` in source — never a zero.
        expect(cod.getByText('Not known until an agent accepts')).toBeInTheDocument();
    });
});

describe('a returned parcel', () => {
    it('shows the section as nothing to split, and why', async () => {
        const split = orderMoneySplitFixture({
            sections: [
                {
                    ...orderMoneySplitFixture().sections[1],
                    moment: 'cash_collection',
                    state: 'none',
                    noneReason: 'returned_without_cash',
                    lines: [],
                    notes: [],
                    delivery: null,
                },
            ],
            reconciliation: { charged: 0, distributed: 0, difference: 0, complete: false },
        });
        render(split);
        const cod = await section(/cash collection/i);

        expect(cod.getByText('Nothing to split')).toBeInTheDocument();
        expect(cod.getByText(/came back and no cash was collected/i)).toBeInTheDocument();
    });
});

describe('the warnings', () => {
    it('warns on vendor_net_negative', async () => {
        const base = orderMoneySplitFixture();
        render({
            ...base,
            sections: [{ ...base.sections[0], notes: ['vendor_net_negative'] }],
        });
        expect(await screen.findByRole('alert')).toHaveTextContent(/split will refuse this order/i);
    });

    it('warns when the reconciliation does not add up', async () => {
        render(
            orderMoneySplitFixture({
                reconciliation: { charged: 65000, distributed: 63000, difference: 2000, complete: true },
            }),
        );
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/does not add up/i);
        expect(alert).toHaveTextContent(/escalate/i);
    });

    it('raises neither on a normal order', async () => {
        render(orderMoneySplitFixture());
        await screen.findByText('Who gets what');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('unknown vocabulary', () => {
    it('renders as plain text and never crashes', async () => {
        const base = orderMoneySplitFixture();
        render({
            ...base,
            sections: [
                {
                    ...base.sections[0],
                    moment: 'moon_landing',
                    state: 'quantum',
                    notes: ['brand_new_note'],
                    lines: [
                        moneyLineFixture({
                            role: 'tip_jar',
                            beneficiary: { type: 'charity', id: null, name: null },
                            status: 'escrowed',
                            waitingOn: ['planets_aligning'],
                        }),
                    ],
                },
            ],
        });

        expect(await screen.findByText('moon_landing')).toBeInTheDocument();
        expect(screen.getByText('quantum')).toBeInTheDocument();
        expect(screen.getByText('brand_new_note')).toBeInTheDocument();
        expect(screen.getByText('tip_jar')).toBeInTheDocument();
        expect(screen.getByText('charity')).toBeInTheDocument();
        expect(screen.getByText('escrowed')).toBeInTheDocument();
        expect(screen.getByText('planets_aligning')).toBeInTheDocument();
    });

    it('shows no figures for a shape it does not recognise', async () => {
        render({ totalMoney: 5 });
        expect(await screen.findByText(/does not recognise/i)).toBeInTheDocument();
    });
});

describe('a failure', () => {
    it('renders the error rather than an empty split', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );
        renderWithProviders(
            <OrderMoneySplitPanel orderId={ORDER_ID} timeZone="Africa/Douala" reloadToken={0} />,
        );
        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(screen.queryByText('Who gets what')).not.toBeInTheDocument();
    });
});
