/**
 * Damage claims (2026-10-22) and the delivery pause, on the shipment page.
 * Contract: `agency-claims.md`, `money.md` § Earnings pauses, and the two
 * 2026-10-22 changelogs.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AgencyClaimsPanel } from '@/components/agencies/AgencyClaimsPanel';
import { ChargeDamageClaimDialog } from '@/components/agencies/ChargeDamageClaimDialog';
import { formatMoney } from '@/lib/format';
import { ShipmentDetail } from '@/pages/shipments/ShipmentDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { shipmentDetailFixture } from '@/test/shipment-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { AgencyClaim, AgencyClaimEligibility } from '@/types/agency-claims.types';

const SHIPMENT_ID = '6671aabbccddeeff00112233';
const AGENCY_ID = '665c0011223344556677889a';
const flat = (text: string) => text.replace(/\s+/g, ' ');
const xaf = (n: number) => flat(formatMoney(n, 'XAF'));

function eligibilityFixture(overrides: Partial<AgencyClaimEligibility> = {}): AgencyClaimEligibility {
    return {
        shipmentId: SHIPMENT_ID,
        orderId: '6670aabbccddeeff00112233',
        orderNumber: 'ORD-2026-000123',
        trackingNumber: 'ACR-260812-103000-4K7QP',
        agencyId: AGENCY_ID,
        vendorId: '6650aabbccddeeff00112233',
        currency: 'XAF',
        deliveredAt: '2026-10-20T09:00:00.000Z',
        firstProblemAt: '2026-10-21T08:00:00.000Z',
        raisedAt: '2026-10-21T08:00:00.000Z',
        windowDays: 2,
        windowEndsAt: '2026-10-22T09:00:00.000Z',
        insideWindow: true,
        maxPerItem: 5000,
        investigationFee: 1000,
        existingClaimId: null,
        eligible: true,
        reason: null,
        ...overrides,
    };
}

const EXPLANATION =
    'Damage claim on order ORD-2026-000123, parcel ACR-260812-103000-4K7QP: 2 item(s) damaged in delivery, within your 2-day damage-claim window.';

function claimFixture(overrides: Partial<AgencyClaim> = {}): AgencyClaim {
    return {
        id: '6720aabbccddeeff00112233',
        kind: 'damage',
        shipmentId: SHIPMENT_ID,
        orderId: '6670aabbccddeeff00112233',
        orderNumber: 'ORD-2026-000123',
        trackingNumber: 'ACR-260812-103000-4K7QP',
        agencyId: AGENCY_ID,
        vendorId: '6650aabbccddeeff00112233',
        refundRequestId: null,
        itemCount: 2,
        claimedAmount: 8000,
        maxPerItem: 5000,
        cap: 10000,
        amount: 8000,
        investigationFee: 1000,
        currency: 'XAF',
        deliveredAt: '2026-10-20T09:00:00.000Z',
        raisedAt: '2026-10-21T08:00:00.000Z',
        windowDays: 2,
        note: 'Screen cracked',
        createdBy: { id: 'a1', name: 'Alice' },
        reasonCode: 'damage_claim',
        reasonParams: {},
        explanation: EXPLANATION,
        takenFrom: { pending: 1500, reserve: 0, available: 0, debt: 7500 },
        createdAt: '2026-10-21T10:00:00.000Z',
        ...overrides,
    };
}

function openDialog({
    eligibility = eligibilityFixture(),
    charge = () => successResponse(claimFixture(), { status: 201 }),
}: {
    eligibility?: AgencyClaimEligibility | (() => Response);
    charge?: (call: FetchCall) => Response;
} = {}) {
    const onCharged = vi.fn();
    const calls = stubFetch((call) => {
        if (call.url.includes('/agency-claims/eligibility')) {
            return typeof eligibility === 'function' ? eligibility() : successResponse(eligibility);
        }
        if (call.method === 'POST' && call.url.endsWith('/agency-claims')) return charge(call);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <ChargeDamageClaimDialog
            shipmentId={SHIPMENT_ID}
            reference="ACR-260812-103000-4K7QP"
            timeZone="Africa/Douala"
            open
            onOpenChange={() => {}}
            onCharged={onCharged}
        />,
        { auth: { status: 'authenticated', admin: adminFixture() }, permissions: { held: heldFixture(2) } },
    );
    return { calls, onCharged };
}

describe('charging a damage claim', () => {
    it('reads the eligibility for the parcel, then shows the ceiling and the investigation fee', async () => {
        const { calls } = openDialog();
        const amount = await screen.findByLabelText(/amount claimed/i);
        expect(new URL(calls[0].url, 'http://localhost').searchParams.get('shipmentId')).toBe(SHIPMENT_ID);

        // One item: the ceiling is maxPerItem × 1.
        expect(screen.getByText((_, node) => node?.id === 'claim-amount-hint' || false)).toHaveTextContent(
            `at most ${xaf(5000)}`,
        );
        await userEvent.clear(screen.getByLabelText(/items damaged/i));
        await userEvent.type(screen.getByLabelText(/items damaged/i), '3');
        expect(amount).toHaveAttribute('placeholder', '15000');
        expect(screen.getByText(/\+ investigation fee/i)).toHaveTextContent(xaf(1000));
    });

    it('sends the strict body and then shows the claim’s own explanation', async () => {
        const { calls, onCharged } = openDialog();
        await userEvent.clear(await screen.findByLabelText(/items damaged/i));
        await userEvent.type(screen.getByLabelText(/items damaged/i), '2');
        await userEvent.type(screen.getByLabelText(/amount claimed/i), '8000');
        await userEvent.type(screen.getByLabelText(/what was damaged/i), 'Screen cracked');
        await userEvent.click(screen.getByRole('button', { name: /charge the agency/i }));

        expect(await screen.findByText(EXPLANATION)).toBeInTheDocument();
        const post = calls.find((call) => call.method === 'POST')!;
        expect(JSON.parse(post.body!)).toEqual({
            shipmentId: SHIPMENT_ID,
            itemCount: 2,
            amount: 8000,
            note: 'Screen cracked',
        });
        expect(onCharged).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/owed as a debt/i)).toBeInTheDocument();
    });

    it('refuses an amount above the ceiling before sending', async () => {
        const { calls } = openDialog();
        await userEvent.type(await screen.findByLabelText(/amount claimed/i), '6000');
        await userEvent.type(screen.getByLabelText(/what was damaged/i), 'Screen cracked');
        await userEvent.click(screen.getByRole('button', { name: /charge the agency/i }));
        expect(await screen.findByText(new RegExp(`At most ${xaf(5000)} for 1 item`))).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('places the platform’s cap on the amount when it refuses', async () => {
        openDialog({
            charge: () =>
                errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    details: { platformCode: 'AGENCY_CLAIM_EXCEEDS_CAP', cap: 4000 },
                }),
        });
        await userEvent.type(await screen.findByLabelText(/amount claimed/i), '5000');
        await userEvent.type(screen.getByLabelText(/what was damaged/i), 'Screen cracked');
        await userEvent.click(screen.getByRole('button', { name: /charge the agency/i }));
        expect(await screen.findByText(new RegExp(`At most ${xaf(4000)}`))).toBeInTheDocument();
    });

    it('says why when the parcel is outside the agency’s window, with the date it closed', async () => {
        openDialog({
            eligibility: eligibilityFixture({ eligible: false, insideWindow: false, reason: 'outside_window' }),
        });
        expect(await screen.findByText(/cannot be claimed/i)).toBeInTheDocument();
        expect(screen.getByText(/2-day damage-claim window closed on/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/amount claimed/i)).not.toBeInTheDocument();
    });

    it('says why for an agency with no per-item limit', async () => {
        openDialog({ eligibility: eligibilityFixture({ eligible: false, reason: 'no_per_item_limit' }) });
        expect(await screen.findByText(/set no maximum refund per item/i)).toBeInTheDocument();
    });
});

describe('the claims list', () => {
    it('reads one agency’s claims with only the strict keys and prints the explanation', async () => {
        const calls = stubFetch((call) => {
            if (call.url.includes('/agency-claims')) {
                return successResponse([claimFixture()], { meta: { total: 1, page: 1, limit: 10, pages: 1 } });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        renderWithProviders(
            <AgencyClaimsPanel scope={{ agencyId: AGENCY_ID }} timeZone="Africa/Douala" noun="this agency" hide={['agency']} />,
            { auth: { status: 'authenticated', admin: adminFixture() }, permissions: { held: heldFixture(3) } },
        );
        expect(await screen.findByText(EXPLANATION)).toBeInTheDocument();
        const params = new URL(calls[0].url, 'http://localhost').searchParams;
        expect([...params.keys()].sort()).toEqual(['agencyId', 'limit', 'page']);
        expect(screen.queryByRole('columnheader', { name: /^agency$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/\+ investigation fee/i)).toHaveTextContent(xaf(1000));
    });
});

function shipmentPage(tier: 1 | 2 | 3) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/money/earnings/pauses/shipment/')) {
            if (call.method === 'POST') {
                return successResponse({
                    kind: 'shipment',
                    id: SHIPMENT_ID,
                    pause: {
                        active: true,
                        reason: 'admin',
                        note: 'Agency under review',
                        paused_at: '2026-10-22T10:00:00.000Z',
                        paused_by_user_id: 'a1',
                        paused_by_source: 'admin',
                        paused_by_name: 'Alice',
                        resumed_at: null,
                        resumed_by_user_id: null,
                        resumed_by_source: null,
                        resumed_by_name: null,
                        resume_note: null,
                    },
                });
            }
            return successResponse({ kind: 'shipment', id: SHIPMENT_ID, pause: null });
        }
        if (call.url.includes('/agency-claims')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 10, pages: 0 } });
        }
        if (call.url.includes('/offers')) return successResponse([]);
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.url.includes(`/shipments/${SHIPMENT_ID}`)) return successResponse(shipmentDetailFixture());
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/shipments/:shipmentId" element={<ShipmentDetail />} />
        </Routes>,
        {
            route: `/dashboard/shipments/${SHIPMENT_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(tier) },
        },
    );
    return calls;
}

describe('the shipment page', () => {
    it('offers Admin both the delivery pause and the damage claim', async () => {
        shipmentPage(2);
        expect(await screen.findByRole('button', { name: /pause this delivery's payment/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /charge a damage claim/i })).toBeInTheDocument();
    });

    /** Perturbation-tested: dropping either gate turns this red. */
    it('shows Support neither — no payout read, no charge — but lists the parcel’s claim', async () => {
        const calls = shipmentPage(3);
        expect(await screen.findByRole('heading', { name: /damage claim/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /charge a damage claim/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /pause this delivery/i })).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/money/earnings/pauses'))).toBe(false);
        expect(calls.some((call) => call.url.includes('/agency-claims?shipmentId='))).toBe(true);
    });

    it('pauses one delivery with a required note, and says the seller is still paid', async () => {
        const calls = shipmentPage(2);
        await userEvent.click(await screen.findByRole('button', { name: /pause this delivery's payment/i }));
        const dialog = within(await screen.findByRole('dialog'));
        expect(dialog.getByText(/agency and rider are not paid until it is resumed\. the seller is still paid/i)).toBeInTheDocument();
        // The order-pause warning belongs to orders, not to a delivery.
        expect(dialog.queryByText(/does not stop agencies whose terms/i)).not.toBeInTheDocument();

        await userEvent.type(dialog.getByLabelText(/why are you pausing/i), 'Agency under review');
        await userEvent.click(dialog.getByRole('button', { name: /pause payout/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toContain(`/money/earnings/pauses/shipment/${SHIPMENT_ID}/pause`);
        expect(JSON.parse(post.body!)).toEqual({ note: 'Agency under review' });
    });
});
