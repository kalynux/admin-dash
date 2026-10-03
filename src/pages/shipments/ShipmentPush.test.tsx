import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ShipmentDetail } from '@/pages/shipments/ShipmentDetail';
import { Toaster } from '@/components/ui/sonner';
import { auditEntryDetailFixture } from '@/test/audit-fixtures';
import { adminFixture, auditEntryFixture, heldFixture } from '@/test/fixtures';
import { offerFixture, shipmentDetailFixture } from '@/test/shipment-fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import { ApiError } from '@/types/api.types';
import {
    canMoveShipmentAgency,
    isForceablePush,
    type ShipmentDetail as ShipmentDetailRecord,
} from '@/types/shipments.types';

/**
 * The force-push round (2026-10-02): assign to agent, move to another agency,
 * `force` on reassign, the activity feed's "forced" mark and an offer's
 * `adminOverride`. Contract: `api-doc/admin/FRONTEND-CHANGELOG-delivery-region-and-force.md`
 * and `shipments.md` § Forcing.
 */

const SHIPMENT_ID = '6671aabbccddeeff00112233';
const DESTINATION_ID = '6671aabbccddeeff00119999';
const AGENT_ID = '6660112233445566778899aa';
const AGENCY_ID = '665c0011223344556677eeee';
const ORDER_ID = '6670aabbccddeeff00112233';

function agentless(overrides: Partial<ShipmentDetailRecord> = {}): ShipmentDetailRecord {
    return shipmentDetailFixture({ agent: null, assignmentState: 'unassigned', ...overrides });
}

function refusal(status: number, platformCode: string) {
    return errorResponse(status, 'PLATFORM_OPERATION_REJECTED', {
        category: status === 409 ? 'conflict' : 'business_rule',
        details: { platformCode },
    });
}

interface Options {
    detail?: ShipmentDetailRecord;
    destination?: ShipmentDetailRecord;
    held?: ReadonlySet<string>;
    /** Answers the writes in order; the last one repeats. */
    writes?: (() => Response)[];
    activity?: unknown[];
    auditDetail?: (id: string) => Response;
}

function render(options: Options = {}) {
    const {
        detail = agentless(),
        destination,
        held = heldFixture(3),
        writes = [],
        activity = [],
        auditDetail,
    } = options;
    let written = 0;

    const calls = stubFetch((call) => {
        if (call.method !== 'GET') {
            const answer = writes[Math.min(written, writes.length - 1)];
            written += 1;
            return answer();
        }
        if (call.url.includes('/activity')) {
            return successResponse(activity, {
                meta: { total: activity.length, page: 1, limit: 20, pages: activity.length ? 1 : 0 },
            });
        }
        if (call.url.includes('/audit/actions')) return successResponse([]);
        if (/\/audit\/[0-9a-f]{24}/.test(call.url) && auditDetail) {
            return auditDetail(call.url.split('/audit/')[1].split('?')[0]);
        }
        if (call.url.includes('/agents') || call.url.includes('/agencies')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 8, pages: 0 } });
        }
        if (call.url.includes('/offers')) return successResponse(detail.offers);
        if (destination && call.url.includes(`/shipments/${DESTINATION_ID}`)) {
            return successResponse(destination);
        }
        if (call.url.includes(`/shipments/${SHIPMENT_ID}`)) return successResponse(detail);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <>
            <Routes>
                <Route path="/dashboard/shipments/:shipmentId" element={<ShipmentDetail />} />
            </Routes>
            <Toaster />
        </>,
        {
            route: `/dashboard/shipments/${SHIPMENT_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );

    return calls;
}

function writeBodies(calls: readonly FetchCall[]): Record<string, unknown>[] {
    return calls
        .filter((call) => call.method !== 'GET')
        .map((call) => JSON.parse(call.body as string) as Record<string, unknown>);
}

// ─── The predicates ───────────────────────────────────────────────────────────

describe('isForceablePush', () => {
    const rejected = (status: number, platformCode?: string) =>
        new ApiError({
            status,
            code: 'PLATFORM_OPERATION_REJECTED',
            category: 'business_rule',
            message: 'refused',
            ...(platformCode ? { details: { platformCode } } : {}),
        });

    it('offers force on an eligibility refusal at 422 and 409', () => {
        expect(isForceablePush(rejected(422, 'AGENT_AT_CAPACITY'), false)).toBe(true);
        expect(isForceablePush(rejected(409, 'COD_AGENCY_LIMIT_EXCEEDED'), false)).toBe(true);
        // An unknown eligibility rule is forceable — the set is open-ended.
        expect(isForceablePush(rejected(422, 'AGENT_SOME_NEW_RULE'), false)).toBe(true);
    });

    it('never offers it on the refusals force cannot skip', () => {
        for (const code of [
            'AGENT_MEMBERSHIP_NOT_APPROVED',
            'SHIPMENT_ALREADY_HAS_AGENT',
            'SHIPMENT_REASSIGNMENT_NOT_ALLOWED',
            'SHIPMENT_NOT_OFFERABLE',
            'SHIPMENT_REASSIGNMENT_CONFLICT',
        ]) {
            expect(isForceablePush(rejected(422, code), false), code).toBe(false);
        }
    });

    it('never offers it twice, on another status, or without a platform code', () => {
        expect(isForceablePush(rejected(422, 'AGENT_AT_CAPACITY'), true)).toBe(false);
        expect(isForceablePush(rejected(403, 'AGENT_AT_CAPACITY'), false)).toBe(false);
        expect(isForceablePush(rejected(422), false)).toBe(false);
        expect(isForceablePush(new Error('network'), false)).toBe(false);
    });

    it('moves only pending, assigned and rejected shipments', () => {
        expect(['pending', 'assigned', 'rejected'].every((status) => canMoveShipmentAgency({ status }))).toBe(true);
        expect(canMoveShipmentAgency({ status: 'picked_up' })).toBe(false);
    });
});

// ─── The controls ─────────────────────────────────────────────────────────────

describe('who sees the pushes', () => {
    it('shows both to Support on a shipment with no agent — no tier check hides them', async () => {
        render({ held: heldFixture(3) });

        expect(await screen.findByRole('button', { name: /assign to agent/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /move to another agency/i })).toBeEnabled();
    });

    it('withholds both while an agent holds the shipment', async () => {
        render({ detail: shipmentDetailFixture() });

        expect(await screen.findByRole('button', { name: /reassign/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /assign to agent/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /move to another agency/i })).not.toBeInTheDocument();
    });

    it('withholds both without shipments.reassign', async () => {
        render({ held: new Set(['shipments.read']) });

        expect(await screen.findByText(/all shipments/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /assign to agent/i })).not.toBeInTheDocument();
    });

    it('disables the move, rather than hiding it, outside pending / assigned / rejected', async () => {
        render({ detail: agentless({ status: 'handing_over' }) });

        expect(await screen.findByRole('button', { name: /move to another agency/i })).toBeDisabled();
    });
});

// ─── Assign to agent ──────────────────────────────────────────────────────────

async function fillAssign() {
    await userEvent.click(await screen.findByRole('button', { name: /assign to agent/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText(/^agent id$/i), AGENT_ID);
    await userEvent.type(dialog.getByLabelText(/^reason$/i), 'Customer waiting three days');
    await userEvent.click(dialog.getByRole('button', { name: /send offer/i }));
    return dialog;
}

describe('assign to agent', () => {
    it('sends without force first, then resends with force: true on "Push anyway"', async () => {
        const calls = render({
            writes: [
                () => refusal(422, 'CONTRACT_COVERAGE_REGION_NOT_COVERED'),
                () => successResponse({ offer: {}, shipment: {}, autoAccepted: false }),
            ],
        });

        const dialog = await fillAssign();
        expect(
            await dialog.findByText(/does not cover the region this shipment is going to/i),
        ).toBeInTheDocument();
        expect(dialog.getByText('CONTRACT_COVERAGE_REGION_NOT_COVERED')).toBeInTheDocument();

        await userEvent.click(dialog.getByRole('button', { name: /push anyway/i }));

        expect(await screen.findByText(/offer sent to agent/i)).toBeInTheDocument();
        const bodies = writeBodies(calls);
        expect(calls.filter((call) => call.method === 'POST')[0].url).toContain(
            `/shipments/${SHIPMENT_ID}/assign-agent`,
        );
        expect(bodies[0]).toEqual({ agentId: AGENT_ID, reason: 'Customer waiting three days' });
        expect(bodies[1]).toEqual({
            agentId: AGENT_ID,
            reason: 'Customer waiting three days',
            force: true,
        });
    });

    it('never offers to push past a missing contract', async () => {
        render({ writes: [() => refusal(422, 'AGENT_MEMBERSHIP_NOT_APPROVED')] });

        const dialog = await fillAssign();
        expect(await dialog.findByText(/no active contract/i)).toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: /push anyway/i })).not.toBeInTheDocument();
    });

    it('requires a reason of at least three characters', async () => {
        const calls = render();

        await userEvent.click(await screen.findByRole('button', { name: /assign to agent/i }));
        const dialog = within(await screen.findByRole('dialog'));
        await userEvent.type(dialog.getByLabelText(/^agent id$/i), AGENT_ID);
        await userEvent.type(dialog.getByLabelText(/^reason$/i), 'no');
        await userEvent.click(dialog.getByRole('button', { name: /send offer/i }));

        expect(await dialog.findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });
});

// ─── Move to another agency ───────────────────────────────────────────────────

async function fillMove() {
    await userEvent.click(await screen.findByRole('button', { name: /move to another agency/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText(/^agency id$/i), AGENCY_ID);
    await userEvent.type(dialog.getByLabelText(/^reason$/i), 'Agency suspended in this city');
    await userEvent.click(dialog.getByRole('button', { name: /move shipment/i }));
    return dialog;
}

const moved = (overrides: Record<string, unknown> = {}) => ({
    shipmentId: SHIPMENT_ID,
    previousAgencyId: '665c0011223344556677889a',
    agencyId: AGENCY_ID,
    destinationShipmentId: DESTINATION_ID,
    itemsMoved: 2,
    dispatched: false,
    forced: false,
    ...overrides,
});

describe('move to another agency', () => {
    it('lands on the destination shipment and says a pending one still needs dispatching', async () => {
        const calls = render({
            held: heldFixture(1),
            detail: agentless({ status: 'pending' }),
            destination: agentless({ id: DESTINATION_ID, status: 'pending', trackingNumber: 'ACR-DEST' }),
            writes: [() => successResponse(moved())],
        });

        await fillMove();

        expect(await screen.findByText(/the shipment is still pending/i)).toBeInTheDocument();
        expect(screen.getByText(/emptied and removed/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /dispatch it from the order/i })).toHaveAttribute(
            'href',
            `/dashboard/orders/${ORDER_ID}`,
        );
        expect(calls.some((call) => call.url.includes(`/shipments/${DESTINATION_ID}`))).toBe(true);
        expect(writeBodies(calls)[0]).toEqual({
            agencyId: AGENCY_ID,
            reason: 'Agency suspended in this city',
        });
    });

    it('offers "Push anyway" on an inactive destination and sends force: true', async () => {
        const calls = render({
            destination: agentless({ id: DESTINATION_ID }),
            writes: [
                () => refusal(422, 'DELIVERY_AGENCY_NOT_ACTIVE'),
                () => successResponse(moved({ dispatched: true, forced: true })),
            ],
        });

        const dialog = await fillMove();
        expect(await dialog.findByText(/that agency is not active/i)).toBeInTheDocument();
        await userEvent.click(dialog.getByRole('button', { name: /push anyway/i }));

        expect(await screen.findByText(/forced past its checks/i)).toBeInTheDocument();
        expect(screen.queryByText(/still pending/i)).not.toBeInTheDocument();
        expect(writeBodies(calls)[1]).toMatchObject({ force: true });
    });

    it('never offers force on a wrong-status refusal', async () => {
        render({ writes: [() => refusal(422, 'SHIPMENT_REASSIGNMENT_NOT_ALLOWED')] });

        const dialog = await fillMove();
        expect(await dialog.findByText(/cannot be moved at its current status/i)).toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: /push anyway/i })).not.toBeInTheDocument();
    });
});

// ─── Reassign, the activity feed, the offer trail ─────────────────────────────

describe('force on reassign', () => {
    it('is never sent on an auto-reassign', async () => {
        const calls = render({
            detail: shipmentDetailFixture(),
            writes: [() => refusal(422, 'AGENT_AT_CAPACITY')],
        });

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        const dialog = within(await screen.findByRole('dialog'));
        await userEvent.type(dialog.getByLabelText(/^reason$/i), 'Vehicle broke down');
        await userEvent.click(dialog.getByRole('button', { name: /^reassign$/i }));

        await waitFor(() => expect(writeBodies(calls)).toHaveLength(1));
        expect(dialog.queryByRole('button', { name: /push anyway/i })).not.toBeInTheDocument();
        expect(writeBodies(calls)[0]).not.toHaveProperty('force');
    });
});

describe('the activity feed', () => {
    it('offers the two new actions and marks a forced push', async () => {
        const forcedId = '6677aabbccddeeff00110001';
        const plainId = '6677aabbccddeeff00110002';
        render({
            held: heldFixture(1),
            activity: [
                auditEntryFixture({ id: forcedId, action: 'shipments.agency.move', actionSummary: null }),
                auditEntryFixture({ id: plainId, action: 'shipments.cancel', actionSummary: null }),
            ],
            auditDetail: (id) =>
                successResponse(
                    auditEntryDetailFixture({
                        id,
                        action: 'shipments.agency.move',
                        payload: { agencyId: AGENCY_ID, reason: 'x', force: true },
                    }),
                ),
        });

        await userEvent.click(await screen.findByRole('tab', { name: /activity/i }));

        expect(await screen.findByText('Moved to another agency')).toBeInTheDocument();
        expect(await screen.findByText('forced')).toBeInTheDocument();
        // One forced mark: the cancellation's detail is never read.
        expect(screen.getAllByText('forced')).toHaveLength(1);
    });
});

describe('the offer trail', () => {
    it('shows who forced an offer, and why', async () => {
        render({
            held: heldFixture(1),
            detail: agentless({
                offers: [
                    offerFixture({
                        adminOverride: {
                            byName: 'Ada Admin',
                            reason: 'Only agent near Bonabéri',
                            at: '2026-10-02T09:00:00.000Z',
                        },
                    }),
                ],
            }),
        });

        await userEvent.click(await screen.findByRole('tab', { name: /offers/i }));

        expect(await screen.findByText(/forced by an administrator/i)).toBeInTheDocument();
        expect(screen.getByText(/ada admin/i)).toBeInTheDocument();
        expect(screen.getByText(/only agent near bonabéri/i)).toBeInTheDocument();
    });
});
