/**
 * Partial payment (2026-11-01): a returned parcel's refund waits for an
 * administrator to say whose fault it was, and saying so REPLACES the request.
 * Contract: `FRONTEND-CHANGELOG-partial-payment.md` and `refunds.md`.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import { OrderOverviewPanel } from '@/components/orders/OrderProfilePanels';
import { RefundMoney } from '@/components/refunds/RefundBits';
import { formatMoney } from '@/lib/format';
import { RefundRequestDetail } from '@/pages/refunds/RefundRequestDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { orderDetailFixture } from '@/test/order-fixtures';
import { REFUND_ID, refundListMetaFixture, refundRequestFixture } from '@/test/refund-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { dispatchCaveats } from '@/types/orders.types';
import {
    laterRequestForParcel,
    refundStatusNote,
    type RefundPartialReturn,
    type RefundRequest,
} from '@/types/refunds.types';
import { transactionReasonLabel } from '@/types/transactions.types';

const NEW_ID = '6701a0b2c3d4e5f6a7b8c9ff';
const PARCEL = '664a0b1c2d3e4f5a6b7c8d9e';
const flat = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ');
const xaf = (n: number) => flat(formatMoney(n, 'XAF'));

function partialReturn(overrides: Partial<RefundPartialReturn> = {}): RefundPartialReturn {
    return {
        shipmentId: PARCEL,
        fault: null,
        returnFee: 1500,
        prepaidAmount: 6000,
        agentReason: 'address_not_found',
        agentNote: 'Nobody at the pin',
        ...overrides,
    };
}

function returnedParcelRequest(overrides: Partial<RefundRequest> = {}): RefundRequest {
    return refundRequestFixture({
        reasonKind: 'return',
        reason: 'Parcel ACR-1 came back (address_not_found)',
        earningsImpact: 'none',
        grossAmount: 6000,
        feeAmount: 240,
        netAmount: 5760,
        requestedBy: { id: null, role: 'system', name: 'parcel returned' },
        partialReturn: partialReturn(),
        ...overrides,
    });
}

/** Shows where the router is, so a move to the replacement can be asserted. */
function Where() {
    const location = useLocation();
    return <p data-testid="where">{location.pathname}</p>;
}

interface Options {
    refund?: RefundRequest;
    tier?: 1 | 2 | 3;
    /** Every request by id the stub can serve. */
    byId?: Record<string, RefundRequest>;
    list?: RefundRequest[];
    write?: (call: FetchCall) => Response;
}

function renderDetail({ refund = returnedParcelRequest(), tier = 2, byId = {}, list = [], write }: Options = {}) {
    const rows: Record<string, RefundRequest> = { [refund.id]: refund, ...byId };
    const calls = stubFetch((call) => {
        if (call.method !== 'GET' && write) return write(call);
        if (call.url.includes('/activity')) return successResponse([], { meta: refundListMetaFixture(0) });
        const one = /\/refunds\/([0-9a-f]{24})(?:\?|$)/.exec(call.url);
        if (one && rows[one[1]]) return successResponse(rows[one[1]]);
        if (/\/refunds\?/.test(call.url)) return successResponse(list, { meta: refundListMetaFixture(list.length) });
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <>
            <Routes>
                <Route path="/dashboard/refunds/:refundId" element={<RefundRequestDetail />} />
            </Routes>
            <Where />
        </>,
        {
            route: `/dashboard/refunds/${refund.id}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(tier) },
        },
    );
    return calls;
}

const button = (name: RegExp) => screen.queryByRole('button', { name });

describe('a returned parcel nobody is named for', () => {
    it('shows what the agent reported and what was prepaid', async () => {
        renderDetail();
        expect(await screen.findByText('The address could not be found')).toBeInTheDocument();
        expect(screen.getByText(/nobody at the pin/i)).toBeInTheDocument();
        expect(screen.getByText(xaf(1500))).toBeInTheDocument();
        expect(screen.getAllByText('Nobody named yet').length).toBeGreaterThan(0);
    });

    /** Perturbation: drop `faultMissing` from the gate and this goes red. */
    it('disables Approve and Settle, with the reason', async () => {
        renderDetail();
        const approve = await screen.findByRole('button', { name: /^approve$/i });
        expect(approve).toBeDisabled();
        expect(approve).toHaveAttribute('title', expect.stringMatching(/whose fault/i));
        expect(button(/settle outside the platform/i)).toBeDisabled();
        // Rejecting stays possible — the server allows it.
        expect(button(/^reject$/i)).toBeEnabled();
        expect(screen.getByText(/say whose fault this returned parcel is first/i)).toBeInTheDocument();
        expect(screen.getByText(/^provisional:/i)).toBeInTheDocument();
    });

    it('offers three choices, none pre-selected, each saying what it means', async () => {
        renderDetail();
        const radios = await screen.findAllByRole('radio');
        expect(radios).toHaveLength(3);
        radios.forEach((radio) => expect(radio).not.toBeChecked());
        expect(screen.getByText(/minus the return fee and the normal refund fees/i)).toBeInTheDocument();
        expect(screen.getByText(/it earns nothing for the trip/i)).toBeInTheDocument();
        expect(button(/record whose fault it is/i)).toBeDisabled();
    });

    it('moves the screen to the NEW request, and approves that one', async () => {
        const replacement = returnedParcelRequest({
            id: NEW_ID,
            requestedBy: { id: adminFixture().id, role: 'admin', name: 'Ops Admin' },
            netAmount: 6000,
            feeAmount: 0,
            fees: {
                paidBy: 'agency',
                paymentFeePercent: 2,
                paymentFee: 120,
                transferFeePercent: 2,
                transferFee: 120,
                vendorCharge: 0,
                agencyCharge: 240,
            },
            partialReturn: partialReturn({ fault: 'agency' }),
        });
        const calls = renderDetail({
            byId: { [NEW_ID]: replacement },
            write: (call) => {
                if (call.url.endsWith('/partial-return-fault')) {
                    return successResponse(replacement, { message: 'Fault recorded — approve this refund to send it' });
                }
                if (call.url.endsWith(`/${NEW_ID}/approve`)) {
                    return successResponse({ ...replacement, status: 'sending' });
                }
                throw new Error(`unexpected write ${call.url}`);
            },
        });

        await userEvent.click(await screen.findByRole('radio', { name: /^the delivery agency/i }));
        await userEvent.click(screen.getByRole('button', { name: /record whose fault it is/i }));

        const post = calls.find((c) => c.url.endsWith('/partial-return-fault'))!;
        expect(post.url).toContain(`/refunds/${REFUND_ID}/partial-return-fault`);
        expect(JSON.parse(post.body ?? '{}')).toEqual({ fault: 'agency' });

        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/dashboard/refunds/${NEW_ID}`));
        expect(await screen.findByText(/this request replaces the earlier one/i)).toBeInTheDocument();
        expect(screen.getByText('Fees charged to the delivery agency')).toBeInTheDocument();

        const approve = await screen.findByRole('button', { name: /^approve$/i });
        expect(approve).toBeEnabled();
        await userEvent.click(approve);
        await userEvent.click(within_dialog_button(/^approve$/i));
        await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/${NEW_ID}/approve`))).toBe(true));
        expect(calls.some((c) => c.url.endsWith(`/${REFUND_ID}/approve`))).toBe(false);
    });

    it('stays put when the answer is the SAME request, rejected — nothing left to refund', async () => {
        const fee = returnedParcelRequest({ partialReturn: partialReturn({ returnFee: 6000 }) });
        const closed = { ...fee, status: 'rejected', rejectionReason: 'Replaced: the fault was set to customer' };
        let posted = false;
        renderDetail({
            refund: fee,
            write: () => {
                posted = true;
                return successResponse(closed);
            },
            list: [],
        });
        // The GET after the write must see the closed row.
        await userEvent.click(await screen.findByRole('radio', { name: /^the customer/i }));
        expect(screen.getByText(/nothing would be left to refund/i)).toBeInTheDocument();
        const record = screen.getByRole('button', { name: /record and close the case/i });
        stubAfterWrite(closed);
        await userEvent.click(record);
        expect(posted).toBe(true);
        expect(await screen.findByText(/no later request exists for this parcel/i)).toBeInTheDocument();
        expect(screen.getByTestId('where')).toHaveTextContent(`/dashboard/refunds/${REFUND_ID}`);
    });

    it('reloads when someone else decided it first', async () => {
        renderDetail({
            write: () =>
                errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    details: { platformCode: 'REFUND_PARTIAL_RETURN_NOT_APPLICABLE' },
                }),
        });
        await userEvent.click(await screen.findByRole('radio', { name: /^the seller/i }));
        await userEvent.click(screen.getByRole('button', { name: /record whose fault it is/i }));
        expect(await screen.findByText(/this request has moved on/i)).toBeInTheDocument();
    });

    /** Support reads refunds and decides none. Perturbation: drop the `orders.refund` gate. */
    it('offers Support the facts and no choice', async () => {
        renderDetail({ tier: 3 });
        expect(await screen.findByText('The address could not be found')).toBeInTheDocument();
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        expect(button(/record whose fault/i)).not.toBeInTheDocument();
    });
});

describe('a returned parcel with a fault on it', () => {
    it('can be approved as it stands, and the current fault cannot be chosen again', async () => {
        renderDetail({ refund: returnedParcelRequest({ partialReturn: partialReturn({ fault: 'customer', agentReason: 'customer_refused' }) }) });
        expect(await screen.findByRole('button', { name: /^approve$/i })).toBeEnabled();
        expect(screen.getByRole('radio', { name: /^the customer/i })).toBeDisabled();
        expect(screen.getByText(/proposed from the agent’s report/i)).toBeInTheDocument();
    });
});

describe('a replaced request', () => {
    it('links to the request that replaced it', async () => {
        const old = returnedParcelRequest({ status: 'rejected', rejectionReason: 'Replaced: the fault was set to vendor' });
        const later = returnedParcelRequest({
            id: NEW_ID,
            createdAt: '2026-10-05T11:00:00.000Z',
            partialReturn: partialReturn({ fault: 'vendor' }),
        });
        renderDetail({ refund: old, list: [later, old] });
        const link = await screen.findByRole('link', { name: /open the current request/i });
        expect(link).toHaveAttribute('href', `/dashboard/refunds/${NEW_ID}`);
    });
});

describe('the pieces', () => {
    it('renders an agency charge like the seller’s', () => {
        render(
            <RefundMoney
                gross={6000}
                fee={0}
                net={6000}
                currency="XAF"
                fees={{
                    paidBy: 'agency',
                    paymentFeePercent: 2,
                    paymentFee: 120,
                    transferFeePercent: 2,
                    transferFee: 120,
                    vendorCharge: 0,
                    agencyCharge: 240,
                }}
                returnedParcel
            />,
        );
        expect(screen.getByText('Fees charged to the delivery agency')).toBeInTheDocument();
        expect(screen.getByText(xaf(240))).toBeInTheDocument();
        expect(screen.getByText(/fault of the delivery agency/i)).toBeInTheDocument();
        expect(screen.queryByText(/cancelled after payment/i)).not.toBeInTheDocument();
    });

    it('says in the queue that a fault is needed', () => {
        expect(refundStatusNote(returnedParcelRequest())?.tone).toBe('warning');
        expect(refundStatusNote(returnedParcelRequest({ partialReturn: partialReturn({ fault: 'vendor' }) }))?.text).toMatch(
            /the seller/,
        );
    });

    it('takes the newest later request on the same parcel only', () => {
        const old = returnedParcelRequest();
        const other = returnedParcelRequest({ id: 'a'.repeat(24), createdAt: '2026-10-06T00:00:00.000Z', partialReturn: partialReturn({ shipmentId: 'b'.repeat(24) }) });
        const a = returnedParcelRequest({ id: 'c'.repeat(24), createdAt: '2026-10-05T11:00:00.000Z' });
        const b = returnedParcelRequest({ id: 'd'.repeat(24), createdAt: '2026-10-05T12:00:00.000Z' });
        expect(laterRequestForParcel(old, [other, a, b, old])?.id).toBe('d'.repeat(24));
        expect(laterRequestForParcel(old, [other, old])).toBeNull();
    });

    it('labels the fault charge in the transactions feed', () => {
        expect(transactionReasonLabel('partial_return_fault')).toBe('Charged for a returned parcel');
    });
});

describe('a partly paid order', () => {
    const partial = {
        minPercent: 30,
        minimumAmount: 6000,
        maximumAmount: 18000,
        amountPaidOnline: 6000,
        balanceDue: 14000,
        paidAt: '2026-11-01T10:00:00.000Z',
    };

    it('says what was paid online and what is due in cash, not just "cash on delivery"', () => {
        renderWithProviders(
            <OrderOverviewPanel
                order={orderDetailFixture({ paymentMethod: 'cash_on_delivery', paymentStatus: 'partially_paid', currency: 'XAF', partialPayment: partial })}
                timeZone="Africa/Douala"
                can={() => true}
            />,
        );
        expect(screen.getByText('Part online, part cash at delivery')).toBeInTheDocument();
        expect(screen.getByText((_, node) => flat(node?.textContent) === `${xaf(6000)} paid online, ${xaf(14000)} due in cash at delivery.`)).toBeInTheDocument();
        expect(screen.getByText(/\(30%\)/)).toBeInTheDocument();
    });

    it('cannot dispatch before the online part is paid', () => {
        const order = orderDetailFixture({ paymentStatus: 'AWAITING_PAYMENT', partialPayment: { ...partial, amountPaidOnline: 0, balanceDue: 20000, paidAt: null } });
        expect(dispatchCaveats(order)).toEqual([expect.stringMatching(/not paid the online part/i)]);
    });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function within_dialog_button(name: RegExp) {
    const dialog = screen.getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll('button')).filter((b) => name.test(b.textContent ?? ''));
    return buttons[buttons.length - 1];
}

/** After the write, every read of the request sees `row`. */
function stubAfterWrite(row: RefundRequest) {
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if ((init?.method ?? 'GET') === 'GET' && url.includes(`/refunds/${row.id}`) && !url.includes('/activity')) {
            return successResponse(row);
        }
        return previous(input, init);
    }) as typeof fetch;
}
