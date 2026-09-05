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
import {
    ORDER_TIMELINE_EVENT_TYPES,
    type OrderDetail as OrderDetailRecord,
    type OrderTimelineEntry,
} from '@/types/orders.types';

const ORDER_ID = '6670aabbccddeeff00112233';

interface StubOptions {
    detail?: OrderDetailRecord;
    eligibility?: () => Response;
    write?: () => Response;
    /** `GET /orders/:orderId/timeline` — one row unless a test says otherwise. */
    timeline?: OrderTimelineEntry[];
}

/**
 * Answers the reads this screen can make, and throws on anything else.
 *
 * Order matters: the sub-resource paths are prefixes of the detail path, so they
 * are matched first. The throw is itself an assertion — "no eligibility request is
 * made without `orders.refund`" is enforced by it, not by a separate check.
 */
function stubDetail({
    detail = orderDetailFixture(),
    eligibility,
    write,
    timeline = [timelineEntryFixture()],
}: StubOptions = {}) {
    return stubFetch((call) => {
        if (call.method !== 'GET' && write) return write();

        if (call.url.includes('/refund-eligibility')) {
            return eligibility?.() ?? successResponse(refundEligibilityFixture());
        }
        /*
          ⚠ **No branch for `/vendors/:id/products/:id`, deliberately.** The
          Items tab used to resolve one per distinct product for the pictures;
          BR-017 put `items[].image` on this payload and the lookup was deleted.
          Falling through to the throw below is the guard: re-introducing the
          N+1 fails the suite instead of quietly costing a request per line.
        */
        if (call.url.includes('/timeline')) {
            return successResponse(timeline, {
                meta: { total: timeline.length, page: 1, limit: 20, pages: 1 },
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

function detail(
    options: StubOptions & { held?: ReadonlySet<string>; id?: string; query?: string } = {},
) {
    const { held = heldFixture(1), id = ORDER_ID, query = '', ...stubOptions } = options;
    const calls = stubDetail(stubOptions);

    renderWithProviders(
        <Routes>
            <Route path="/dashboard/orders/:orderId" element={<OrderDetail />} />
        </Routes>,
        {
            route: `/dashboard/orders/${id}${query}`,
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

// ─── § C1 · the parties ───────────────────────────────────────────────────────

describe('the parties, named and copyable', () => {
    /**
     * The card used to render `name ?? id` as one string, which is why it
     * carried no copy affordance: a button beside it would have copied a *name*
     * whenever one existed. Splitting the two is what § C1 asked for.
     */
    it('shows each party’s name over its own id, with the id copyable', async () => {
        detail();

        expect(await screen.findByText('Douala Fresh Market')).toBeInTheDocument();
        expect(screen.getByText('Amina B.')).toBeInTheDocument();

        // The ids are values with no link of their own — the whole point of the
        // sub-line — so the affordance is what makes them reachable.
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy customer id/i })).toBeInTheDocument();
        expect(screen.getByText('665f1c2a9b3e4a91c7d2e5f0')).toBeInTheDocument();
    });

    /**
     * ⚠ The whole reason `PartyValue` branches on `kind` rather than comparing
     * strings: a party with no name falls through to the id, and printing the id
     * as a heading *and* as the value beneath it is the one render worse than
     * printing it once.
     */
    it('shows an unnamed party once, not twice', async () => {
        detail({ detail: orderDetailFixture({ vendorName: null }) });

        await screen.findByText('Amina B.');
        expect(screen.getAllByText('6650aa11bb22cc33dd44ee55')).toHaveLength(1);
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
    });

    /** A customer id resolves in no user route, so the name must not link. */
    it('links the vendor and never the customer', async () => {
        detail();

        expect(await screen.findByRole('link', { name: 'Douala Fresh Market' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/6650aa11bb22cc33dd44ee55',
        );
        expect(screen.queryByRole('link', { name: 'Amina B.' })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /their other orders/i })).toBeInTheDocument();
    });
});

// ─── § C2 · the items ─────────────────────────────────────────────────────────

describe('the item pictures', () => {
    /**
     * 🔴 **The regression guard for BR-017, and it is an assertion about a
     * request that must NOT happen.**
     *
     * Phase C resolved `GET /vendors/:vendorId/products/:productId` per distinct
     * product to get these pictures — bounded at 24, capped, gated on
     * `vendors.read`, six states. `items[].image` arrived on this payload and the
     * backend's answer said plainly to drop it. The stub throws on any
     * `/products/` request, so re-introducing the lookup fails the suite rather
     * than quietly costing a request per line.
     */
    it('draws the picture from the payload and reads no catalogue at all', async () => {
        const calls = detail();

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        const image = await screen.findByRole('img', { name: /plantain\.jpg/i });
        expect(image).toHaveAttribute(
            'src',
            'https://cdn.example.com/products/6660/plantain-1kg.jpg',
        );

        expect(calls.some((call) => call.url.includes('/products/'))).toBe(false);
        // A public tree, already resolved on the payload — nothing is disclosed
        // that the order read did not hand over, so no audit row is written.
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);
    });

    /**
     * ⚠ **This is what the lookup used to cost.** The picture was gated on
     * `vendors.read`, so Support — which holds `orders.read` and not the
     * catalogue — saw a padlock where every line's picture should be. It comes
     * with the order now.
     */
    it('shows the picture to a caller holding only orders.read', async () => {
        detail({ held: new Set(['orders.read']) });

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        expect(await screen.findByRole('img', { name: /plantain\.jpg/i })).toBeInTheDocument();
        expect(screen.queryByText(/vendor catalogue permission/i)).not.toBeInTheDocument();
    });

    /**
     * ⚠ `null` is ordinary, not a failure: a digital line, media swept by the
     * orphan cleanup, a product deleted since the order. Named rather than left
     * as an empty square, which reads as "still loading".
     */
    it('says a line has no picture rather than drawing an empty tile', async () => {
        const record = orderDetailFixture();
        detail({
            detail: {
                ...record,
                items: [{ ...record.items[0], image: null }],
            },
        });

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        expect(await screen.findByText(/no picture/i)).toBeInTheDocument();
        // The line's own data is what the tab is for, and it survives.
        expect(screen.getByText('PLT-1KG')).toBeInTheDocument();
    });
});

describe('the delivery fields the order used to send an operator away for', () => {
    /**
     * 🔴 **Both of these shipped an `InfoHint` saying the field was unavailable,
     * for two days after it arrived.** The agency row said the id "is what ships
     * until the field arrives"; the shipment row said the tracking number "is not
     * on this payload" and told the operator to open the shipment and read it.
     * Both were false from `RESPONSE-2026-08-26.md` onwards.
     */
    it('names the agency and keeps its id beneath', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        expect(await screen.findByText('Littoral Express Delivery')).toBeInTheDocument();
        expect(screen.queryByText(/until the field arrives/i)).not.toBeInTheDocument();
    });

    /**
     * ⚠ The tracking number goes **on top** of the shipment id, because
     * `GET /shipments`'s search takes a tracking-number prefix and cannot find a
     * shipment id at all — the id is unusable in the one box an operator would
     * paste it into.
     */
    it('leads with the tracking number, not the shipment id', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        expect(await screen.findByText('WM-2026-0088412')).toBeInTheDocument();
        expect(screen.queryByText(/not on this payload/i)).not.toBeInTheDocument();
    });

    /** `null` while the item is unfulfilled — ordinary, and a different fact
        from "not dispatched", which is a null `shipmentId`. */
    it('says why there is no tracking number rather than showing a gap', async () => {
        const record = orderDetailFixture();
        detail({
            detail: {
                ...record,
                items: [
                    {
                        ...record.items[0],
                        delivery: { ...record.items[0].delivery!, trackingNumber: null },
                    },
                ],
            },
        });

        await userEvent.click(await screen.findByRole('tab', { name: /^items$/i }));

        expect(await screen.findByText(/not fulfilled/i)).toBeInTheDocument();
    });
});

// ─── § C4's other half · the deep link this screen receives ───────────────────

describe('the hand-off from a shipment’s item card', () => {
    it('opens the Items tab and marks the line the link named', async () => {
        detail({ query: '?tab=items&item=6670aabbccddeeff00112240' });

        const items = await screen.findByRole('tab', { name: /^items$/i });
        expect(items).toHaveAttribute('aria-selected', 'true');

        // The anchor is what `scrollIntoView` targets and what the ring marks;
        // an order with nine similar lines is otherwise a hand-off into the
        // middle of a list with nothing saying which row was meant.
        const card = document.getElementById('order-item-6670aabbccddeeff00112240');
        expect(card).not.toBeNull();
        expect(card?.className).toContain('ring-2');
    });

    /** A query parameter is the one input an operator can mistype into this screen. */
    it('falls back to Overview on a tab name it does not recognise', async () => {
        detail({ query: '?tab=nonsense' });

        expect(await screen.findByRole('tab', { name: /overview/i })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});

// ─── § C3 · the timeline filter ───────────────────────────────────────────────

describe('the timeline’s event-type filter', () => {
    /**
     * ⚠ The exception to *filters stay free-text*, and it is only defensible
     * while the vocabulary is closed at jovi-mall's model —
     * `order-timeline-events.test.ts` is what keeps that true.
     */
    it('is a picker over the mirrored vocabulary, not a text box', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /timeline/i }));
        await screen.findByRole('combobox', { name: /event type/i });

        expect(screen.queryByRole('textbox', { name: /event type/i })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('combobox', { name: /event type/i }));
        for (const value of ORDER_TIMELINE_EVENT_TYPES) {
            expect(screen.getByRole('option', { name: value })).toBeInTheDocument();
        }
    });

    it('sends the chosen token and nothing when the choice is cleared', async () => {
        const calls = detail();

        await userEvent.click(await screen.findByRole('tab', { name: /timeline/i }));
        await userEvent.click(await screen.findByRole('combobox', { name: /event type/i }));
        await userEvent.click(screen.getByRole('option', { name: 'payment.updated' }));

        await waitFor(() =>
            expect(
                calls.some((call) => call.url.includes('eventType=payment.updated')),
            ).toBe(true),
        );

        // ⚠ The sentinel is a client-side "no filter", never a value: sending
        // `eventType=any` would be silently dropped by a non-strict `listQuery`
        // and come back looking filtered.
        await userEvent.click(screen.getByRole('combobox', { name: /event type/i }));
        await userEvent.click(screen.getByRole('option', { name: /any event/i }));

        await waitFor(() =>
            expect(calls.some((call) => call.url.includes('eventType=any'))).toBe(false),
        );
    });
});

describe('who acted, on the timeline', () => {
    /**
     * 🔴 **The timeline shipped an `InfoHint` reading "rows name who acted by id,
     * not by name … a request that has been made of the backend and is not
     * answered yet"** — for two days after BR-016 § 5 delivered `actorName`. The
     * screen was asserting something false about the service.
     *
     * ⚠ Resolving this needed **three id spaces across two databases**, and the
     * `admin` row is the one nothing else could answer: jovi-mall stamps a
     * wi-admin administrator id into a column declared `ref: MODELS.USER`, where
     * it dereferences to nothing.
     */
    it('names an administrator rather than showing their id alone', async () => {
        detail({
            timeline: [
                timelineEntryFixture({
                    actorType: 'admin',
                    actorId: '665a11223344556677889900',
                    actorName: 'Nadège M.',
                    description: 'Order cancelled by administrator',
                }),
            ],
        });

        await userEvent.click(await screen.findByRole('tab', { name: /timeline/i }));

        expect(await screen.findByText('Nadège M.')).toBeInTheDocument();
        expect(screen.queryByText(/is not answered yet/i)).not.toBeInTheDocument();
    });

    /**
     * ⚠ **`null`, never the id** — for `system` and wherever the record is gone.
     * An absent name here is an answer, so the row must not fall back to
     * rendering `actorId` as though it were one.
     */
    it('leaves a system row unnamed rather than inventing one', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /timeline/i }));

        await screen.findByText('payment.updated');
        expect(screen.getByText('system')).toBeInTheDocument();
    });

    /**
     * ⚠ **Not a link, and it must not become one.** `actorId` is a different id
     * space per `actorType`, so `/dashboard/users/:id` would be wrong for every
     * one of them — the same mistake `CUSTOMER` made on `TicketEntityLink`.
     */
    it('never links the actor id anywhere', async () => {
        detail({
            timeline: [
                timelineEntryFixture({
                    actorType: 'customer',
                    actorId: '665f1c2a9b3e4a91c7d2e5f0',
                    actorName: 'Amina Bekele',
                }),
            ],
        });

        await userEvent.click(await screen.findByRole('tab', { name: /timeline/i }));

        await screen.findByText('Amina Bekele');
        expect(
            screen.queryByRole('link', { name: /665f1c2a9b3e4a91c7d2e5f0/i }),
        ).not.toBeInTheDocument();
    });
});
