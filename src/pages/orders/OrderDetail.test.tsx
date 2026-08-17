import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { OrderDetail } from '@/pages/orders/OrderDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    cleanRefundEligibilityFixture,
    openDisputeOrderFixture,
    orderDetailFixture,
    refundEligibilityFixture,
    refundResultFixture,
    resolvedDisputeOrderFixture,
    timelineEntryFixture,
} from '@/test/order-fixtures';
import { shipmentFixture, shipmentListMetaFixture } from '@/test/shipment-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { OrderDetail as OrderDetailRecord } from '@/types/orders.types';

const ORDER_ID = '6670aabbccddeeff00112233';

interface StubOptions {
    detail?: OrderDetailRecord;
    eligibility?: () => Response;
    write?: () => Response;
}

/**
 * Answers the reads this screen can make, and throws on anything else.
 *
 * Order matters: the sub-resource paths are prefixes of the detail path, so they
 * are matched first. The throw is itself an assertion — "no eligibility request is
 * made without `orders.refund`" is enforced by it, not by a separate check.
 */
function stubDetail({ detail = orderDetailFixture(), eligibility, write }: StubOptions = {}) {
    return stubFetch((call) => {
        if (call.method !== 'GET' && write) return write();

        if (call.url.includes('/refund-eligibility')) {
            return eligibility?.() ?? successResponse(refundEligibilityFixture());
        }
        if (call.url.includes('/timeline')) {
            return successResponse([timelineEntryFixture()], {
                meta: { total: 1, page: 1, limit: 20, pages: 1 },
            });
        }
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.url.includes('/shipments')) {
            return successResponse([shipmentFixture()], { meta: shipmentListMetaFixture() });
        }
        if (call.url.includes(`/orders/${ORDER_ID}`)) {
            return successResponse(detail);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(options: StubOptions & { held?: ReadonlySet<string>; id?: string } = {}) {
    const { held = heldFixture(1), id = ORDER_ID, ...stubOptions } = options;
    const calls = stubDetail(stubOptions);

    renderWithProviders(
        <Routes>
            <Route path="/dashboard/orders/:orderId" element={<OrderDetail />} />
        </Routes>,
        {
            route: `/dashboard/orders/${id}`,
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held },
        },
    );

    return calls;
}

describe('the record', () => {
    it('refuses a non-hex id without issuing a request', async () => {
        const calls = detail({ id: 'not-an-id' });

        expect(await screen.findByText(/not a valid order id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    /** Absent entirely, not a block of nulls that reads as "unknown". */
    it('says an order has never been disputed, distinctly from a resolved one', async () => {
        detail();
        expect(await screen.findByText(/has never been disputed/i)).toBeInTheDocument();
    });

    it('shows a resolved dispute rather than hiding it', async () => {
        detail({ detail: resolvedDisputeOrderFixture() });

        // "Resolved" also labels the resolution timestamp, so the badge is found
        // by there being at least one and the reason confirms it is the block.
        expect((await screen.findAllByText('Resolved')).length).toBeGreaterThan(0);
        expect(screen.getByText('item_not_received')).toBeInTheDocument();
        expect(screen.queryByText(/has never been disputed/i)).not.toBeInTheDocument();
    });

    /** Nullable object with nullable members — "—", never `NaN`. */
    it('renders a null price breakdown as blanks', async () => {
        detail({ detail: orderDetailFixture({ priceBreakdown: null }) });

        await screen.findAllByText('ORD-2026-008841');
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    /** The coordinates and the raw typed input never leave the service. */
    it('says the delivery address is textual only', async () => {
        detail();

        expect(
            await screen.findByText(/coordinates and whatever the customer originally typed/i),
        ).toBeInTheDocument();
    });
});

describe('tabs and permissions', () => {
    it('omits Shipments without shipments.read and Activity without audit.read', async () => {
        detail({ held: new Set(['orders.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('tab', { name: /shipments/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /activity/i })).not.toBeInTheDocument();
    });

    /**
     * An order's payload carries no shipments — the repository's `findForOrder` is
     * dead code — so the tab is a separate read against the shipment directory.
     */
    it('reads the shipment directory by orderId rather than the order payload', async () => {
        const calls = detail();

        await userEvent.click(await screen.findByRole('tab', { name: /shipments/i }));
        await waitFor(() => {
            const asked = calls.some((call) =>
                call.url.includes(`/shipments?orderId=${ORDER_ID}`),
            );
            expect(asked).toBe(true);
        });
    });

    /**
     * `/refund-eligibility` is gated on `orders.refund`, not `orders.read`. A
     * Support administrator must never fire it — and the throwing stub would fail
     * the test if the screen did.
     */
    it('makes no eligibility request for a caller without orders.refund', async () => {
        const calls = detail({ held: new Set(['orders.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('refund-eligibility'))).toBe(false);
    });

    it('offers no write affordance to a caller holding only orders.read', async () => {
        detail({ held: new Set(['orders.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /dispatch/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /resolve dispute/i })).not.toBeInTheDocument();
    });

    /** Offered only when there is an open dispute to resolve. */
    it('offers Resolve only on an order with an active dispute', async () => {
        detail();
        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('button', { name: /resolve dispute/i })).not.toBeInTheDocument();
    });

    it('offers Resolve when the dispute is open', async () => {
        detail({ detail: openDisputeOrderFixture() });
        expect(
            await screen.findByRole('button', { name: /resolve dispute/i }),
        ).toBeInTheDocument();
    });
});

describe('the writes', () => {
    /**
     * `cancel` answers jovi-mall's **raw Mongoose document** — snake_case, the whole
     * document, carrying the coordinates the read deliberately withholds. The
     * service discards it and the screen refetches; nothing from that body may
     * reach the DOM.
     */
    it('reads nothing from a cancel response, including the PII it carries', async () => {
        let cancelled = false;
        stubFetch((call) => {
            if (call.method === 'POST' && call.url.includes('/cancel')) {
                cancelled = true;
                return successResponse({
                    _id: ORDER_ID,
                    order_number: 'ORD-2026-008841',
                    fulfillment_status: 'cancelled',
                    delivery_address: {
                        formatted_address: 'Rue Njo-Njo 14',
                        coordinates: [9.7043, 4.0611],
                        raw_input: 'njonjo 14 bonapriso',
                    },
                });
            }
            if (call.url.includes('/timeline') || call.url.includes('/activity')) {
                return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
            }
            if (call.url.includes('/shipments')) {
                return successResponse([], { meta: shipmentListMetaFixture({ total: 0, pages: 0 }) });
            }
            // The refetch answers the unchanged record, so a merged body would show.
            return successResponse(orderDetailFixture());
        });

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/orders/:orderId" element={<OrderDetail />} />
            </Routes>,
            {
                route: `/dashboard/orders/${ORDER_ID}`,
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: heldFixture(1) },
            },
        );

        await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
        await userEvent.type(
            await screen.findByLabelText(/reason/i),
            'Customer asked before dispatch',
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel order/i }));

        await waitFor(() => expect(cancelled).toBe(true));
        // Neither the raw coordinates nor the raw input reaches the screen.
        expect(screen.queryByText(/9\.7043/)).not.toBeInTheDocument();
        expect(screen.queryByText(/njonjo 14 bonapriso/i)).not.toBeInTheDocument();
    });

    /** `shipmentsAssigned: 0` is a `200`. Rendering it as a failure is the bug. */
    it('renders a zero dispatch as an outcome, not an error', async () => {
        detail({
            write: () =>
                successResponse(
                    { order: { _id: ORDER_ID }, shipmentsAssigned: 0 },
                    { message: 'Nothing to dispatch — no shipment on this order was pending' },
                ),
        });

        await userEvent.click(await screen.findByRole('button', { name: /dispatch/i }));
        await userEvent.click(await screen.findByRole('button', { name: /^dispatch$/i, hidden: false }));

        expect(await screen.findByText(/nothing to dispatch/i)).toBeInTheDocument();
        expect(screen.getByText(/this is an outcome, not a failure/i)).toBeInTheDocument();
    });
});

describe('the refund dialog', () => {
    async function openRefund(options: StubOptions = {}) {
        detail(options);
        await userEvent.click(await screen.findByRole('button', { name: /refund/i }));
    }

    /** Two ceilings, two statements. Merging them is how the wrong one is used. */
    it('renders the platform ceiling and the vendor ceiling separately', async () => {
        await openRefund();

        expect(await screen.findByText(/what the platform will permit/i)).toBeInTheDocument();
        expect(screen.getByText(/what the vendor's terms allow/i)).toBeInTheDocument();
    });

    it('lists the gates by name before offering the override', async () => {
        await openRefund();

        expect(await screen.findByText(/return window expired/i)).toBeInTheDocument();
        expect(
            screen.getByRole('checkbox', { name: /override the vendor's terms/i }),
        ).toBeInTheDocument();
    });

    it('offers no override checkbox when nothing would be crossed', async () => {
        await openRefund({ eligibility: () => successResponse(cleanRefundEligibilityFixture()) });

        await screen.findByText(/what the platform will permit/i);
        expect(
            screen.queryByRole('checkbox', { name: /override the vendor's terms/i }),
        ).not.toBeInTheDocument();
    });

    /** An expected outcome, not a fault — and explained before the button. */
    it('refuses to submit when the gateway has no refund API, and says why', async () => {
        await openRefund({
            eligibility: () =>
                successResponse(
                    refundEligibilityFixture({
                        gateway: 'NOTCHPAY',
                        gatewayRefundSupported: false,
                    }),
                ),
        });

        expect(await screen.findByText(/has no refund api/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^refund$/i })).toBeDisabled();
    });

    it('refuses to submit on a cash order, and says why', async () => {
        await openRefund({
            eligibility: () => successResponse(refundEligibilityFixture({ isCod: true })),
        });

        expect(await screen.findByText(/cash-on-delivery order/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^refund$/i })).toBeDisabled();
    });

    /** Without the ceilings this is a blind money button. */
    it('will not offer a refund when the eligibility read failed', async () => {
        await openRefund({
            eligibility: () =>
                errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                    category: 'external_service',
                }),
        });

        expect(await screen.findByText(/could not read what may be refunded/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^refund$/i })).not.toBeInTheDocument();
    });

    it('says the blank amount means the full remaining balance, not the vendor cap', async () => {
        await openRefund();

        expect(
            await screen.findByText(/blank refunds the full remaining refundable balance/i),
        ).toBeInTheDocument();
    });

    /**
     * The gateway call happens outside any transaction, so a lost answer is
     * genuinely ambiguous. "Try again" is the wrong affordance.
     */
    it('renders a 502 as an unknown outcome with no retry', async () => {
        await openRefund({
            write: () =>
                errorResponse(502, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                    category: 'external_service',
                }),
        });

        await screen.findByText(/what the platform will permit/i);
        await userEvent.click(
            screen.getByRole('checkbox', { name: /override the vendor's terms/i }),
        );
        await userEvent.type(screen.getByLabelText(/^reason$/i), 'Parcel never arrived');
        await userEvent.click(screen.getByRole('button', { name: /^refund$/i }));

        expect(await screen.findByText(/the outcome is unknown/i)).toBeInTheDocument();
        expect(screen.getByText(/may or may not have completed/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    /**
     * These figures exist on this response and nowhere else — no later read
     * reports which of the vendor's gates were crossed.
     */
    it('keeps the result on screen, including which gates were overridden', async () => {
        await openRefund({
            write: () =>
                successResponse(refundResultFixture(), {
                    message: 'Refund completed — the vendor’s return policy was overridden',
                }),
        });

        await screen.findByText(/what the platform will permit/i);
        await userEvent.click(
            screen.getByRole('checkbox', { name: /override the vendor's terms/i }),
        );
        await userEvent.type(screen.getByLabelText(/^reason$/i), 'Parcel never arrived');
        await userEvent.click(screen.getByRole('button', { name: /^refund$/i }));

        expect(await screen.findByText(/return policy was overridden/i)).toBeInTheDocument();
        expect(screen.getByText('rf_66739911')).toBeInTheDocument();
        expect(screen.getByText(/no — overridden/i)).toBeInTheDocument();
    });
});
