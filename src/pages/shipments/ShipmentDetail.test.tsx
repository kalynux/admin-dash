import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ShipmentDetail } from '@/pages/shipments/ShipmentDetail';
import { Toaster } from '@/components/ui/sonner';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    codBlockFixture,
    offerFixture,
    outboxHealthFixture,
    rejectedShipmentDetailFixture,
    shipmentDetailFixture,
} from '@/test/shipment-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { ShipmentDetail as ShipmentDetailRecord } from '@/types/shipments.types';

const SHIPMENT_ID = '6671aabbccddeeff00112233';

interface StubOptions {
    detail?: ShipmentDetailRecord;
    write?: () => Response;
}

function stubDetail({ detail = shipmentDetailFixture(), write }: StubOptions = {}) {
    return stubFetch((call) => {
        if (call.method !== 'GET' && write) return write();

        if (call.url.includes('/offers')) {
            return successResponse(detail.offers);
        }
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.url.includes('/agents')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 8, pages: 0 } });
        }
        if (call.url.includes(`/shipments/${SHIPMENT_ID}`)) {
            return successResponse(detail);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(options: StubOptions & { held?: ReadonlySet<string>; id?: string } = {}) {
    const { held = heldFixture(1), id = SHIPMENT_ID, ...stubOptions } = options;
    const calls = stubDetail(stubOptions);

    renderWithProviders(
        <>
            <Routes>
                <Route path="/dashboard/shipments/:shipmentId" element={<ShipmentDetail />} />
            </Routes>
            {/*
              Mounted here because two outcomes on this surface are *only* a toast:
              a reassignment whose replacement search came up empty, and a
              compare-and-set conflict. Both close the dialog, so the toast is the
              whole message — asserting on it needs somewhere for it to render.
            */}
            <Toaster />
        </>,
        {
            route: `/dashboard/shipments/${id}`,
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

        expect(await screen.findByText(/not a valid shipment id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('says nothing has gone wrong on an ordinary delivery', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: 'Delivery' }));
        expect(await screen.findByText(/nothing has gone wrong/i)).toBeInTheDocument();
    });

    /**
     * `rejection.by.source` is `'platform' | 'admin'`. An `admin` id resolves in
     * neither the platform database nor as a platform user, so the name is the
     * only readable record and it is never linked.
     */
    it('marks an administrator rejection and does not link the actor', async () => {
        detail({ detail: rejectedShipmentDetailFixture() });

        await userEvent.click(await screen.findByRole('tab', { name: 'Delivery' }));
        expect(await screen.findByText('Ada Nkemelu')).toBeInTheDocument();
        expect(screen.getAllByText('administrator').length).toBeGreaterThan(0);
    });
});

describe('the offer trail', () => {
    /** Both reads are capped at 50, and no `meta` says so — the UI has to. */
    it('says the trail is capped when it holds fifty rows', async () => {
        const offers = Array.from({ length: 50 }, (_, index) =>
            offerFixture({ id: `offer-${index}`, agentId: `agent-${index}` }),
        );
        detail({ detail: shipmentDetailFixture({ offers }) });

        await userEvent.click(await screen.findByRole('tab', { name: /offers/i }));
        expect(await screen.findByText(/50 most recent offers/i)).toBeInTheDocument();
    });

    it('says nothing about a cap on a short trail', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /offers/i }));
        await screen.findByText('Eric T.');
        expect(screen.queryByText(/most recent offers/i)).not.toBeInTheDocument();
    });

    it('labels an offer with no session as created by hand', async () => {
        detail({
            detail: shipmentDetailFixture({
                offers: [offerFixture({ sessionId: null, origin: 'manual' })],
            }),
        });

        await userEvent.click(await screen.findByRole('tab', { name: /offers/i }));
        expect(await screen.findByText(/created by hand/i)).toBeInTheDocument();
    });
});

describe('the outbox panel', () => {
    /**
     * Health, and deliberately **not** a trackability verdict — recomputing that
     * would be a second definition of who may be watched.
     */
    it('never claims anything about trackability', async () => {
        detail();

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.getByText(/delivery-event dispatch/i)).toBeInTheDocument();
        expect(screen.queryByText(/trackab/i)).not.toBeInTheDocument();
    });

    it('warns when events have failed, and names the consequence', async () => {
        detail({
            detail: shipmentDetailFixture({
                tracking: { outbox: outboxHealthFixture({ failed: 2, lastError: 'ECONNREFUSED' }) },
            }),
        });

        expect(
            await screen.findByText(/could still be open on the previous agent/i),
        ).toBeInTheDocument();
    });
});

describe('the cash block', () => {
    /** Served under `shipments.read` alone — no `cod.*` permission is needed. */
    it('renders for a caller holding no cod permission at all', async () => {
        detail({ held: new Set(['shipments.read']) });

        await userEvent.click(await screen.findByRole('tab', { name: /cash on delivery/i }));
        expect(await screen.findByText('6674aabbccddeeff00112233')).toBeInTheDocument();
    });

    it('says the delivery code is never returned', async () => {
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /cash on delivery/i }));
        expect(await screen.findByText(/never the delivery code/i)).toBeInTheDocument();
    });

    it('flags a locked code', async () => {
        detail({
            detail: shipmentDetailFixture({
                cod: codBlockFixture({ codeAttempts: 5, codeLocked: true }),
            }),
        });

        await userEvent.click(await screen.findByRole('tab', { name: /cash on delivery/i }));
        expect(await screen.findByText('Locked')).toBeInTheDocument();
    });

    it('says so when the order was paid online', async () => {
        detail({ detail: shipmentDetailFixture({ cod: null }) });

        await userEvent.click(await screen.findByRole('tab', { name: /cash on delivery/i }));
        expect(await screen.findByText(/carries no cash collection/i)).toBeInTheDocument();
    });
});

describe('permissions', () => {
    it('omits Offers without agents.read and Activity without audit.read', async () => {
        detail({ held: new Set(['shipments.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('tab', { name: /offers/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /activity/i })).not.toBeInTheDocument();
    });

    it('offers no write affordance to a caller holding only shipments.read', async () => {
        detail({ held: new Set(['shipments.read']) });

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('button', { name: /reassign/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    });
});

describe('cancelling', () => {
    /**
     * ADR-010 D-4 says the dashboard must disable the button outside `assigned`.
     * **Disabled, not hidden** — hiding it would read as "you lack the permission".
     */
    it('is disabled past pickup, and says why', async () => {
        detail({ detail: shipmentDetailFixture({ status: 'picked_up' }) });

        const button = await screen.findByRole('button', { name: /^cancel$/i });
        expect(button).toBeDisabled();

        await userEvent.click(
            screen.getByRole('button', { name: /why cancelling is unavailable/i }),
        );
        expect(
            await screen.findByText(/only be pulled back while it is/i),
        ).toBeInTheDocument();
    });

    it('is enabled while the shipment is assigned', async () => {
        detail();

        expect(await screen.findByRole('button', { name: /^cancel$/i })).toBeEnabled();
    });

    it('states the cascade before asking for the note', async () => {
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
        expect(await screen.findByText(/the vendor is notified/i)).toBeInTheDocument();
        expect(screen.getByText(/stored on the shipment, not only in the audit trail/i)).toBeInTheDocument();
    });
});

describe('reassigning', () => {
    /**
     * `shipments.reassign` does not imply `agents.read`, and the endpoint needs
     * only the one — so the picker degrades to an id field and the directory is
     * never requested. The throwing stub is what enforces the second half.
     */
    it('offers an id field rather than the directory without agents.read', async () => {
        const calls = detail({ held: new Set(['shipments.read', 'shipments.reassign']) });

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        await userEvent.click(await screen.findByRole('radio', { name: /choose an agent/i }));

        expect(await screen.findByLabelText(/agent id/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/find an agent/i)).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/agents?'))).toBe(false);
    });

    /** Omitting `agentId` *is* the instruction to auto-assign. */
    it('sends no agentId in auto-assign mode', async () => {
        let body: string | undefined;
        stubFetch((call) => {
            if (call.method === 'POST' && call.url.includes('/reassign')) {
                body = call.body;
                return successResponse({ status: 'assigned' });
            }
            if (call.url.includes('/offers')) return successResponse([]);
            if (call.url.includes('/activity')) {
                return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
            }
            return successResponse(shipmentDetailFixture());
        });

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/shipments/:shipmentId" element={<ShipmentDetail />} />
            </Routes>,
            {
                route: `/dashboard/shipments/${SHIPMENT_ID}`,
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: heldFixture(1) },
            },
        );

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        await userEvent.type(await screen.findByLabelText(/^reason$/i), 'Vehicle broke down');
        await userEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

        await waitFor(() => expect(body).toBeDefined());
        expect(JSON.parse(body as string)).not.toHaveProperty('agentId');
    });

    /**
     * A **partial success**: by the time this throws the previous agent has already
     * been detached and the shipment is unassigned. Saying "nothing happened" would
     * leave an operator believing a delivery still has an agent.
     */
    it('says the agent was released when no replacement is available', async () => {
        detail({
            write: () =>
                errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    details: { platformCode: 'SHIPMENT_NO_ELIGIBLE_AGENTS' },
                }),
        });

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        await userEvent.type(await screen.findByLabelText(/^reason$/i), 'Vehicle broke down');
        await userEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

        expect(await screen.findByText(/no replacement is available/i)).toBeInTheDocument();
        expect(screen.getByText(/taken off this shipment/i)).toBeInTheDocument();
    });

    /** Compare-and-set miss: reload, never force. */
    it('reloads on a 409 conflict rather than offering to force it', async () => {
        detail({
            write: () =>
                errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'SHIPMENT_REASSIGNMENT_CONFLICT' },
                }),
        });

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        await userEvent.type(await screen.findByLabelText(/^reason$/i), 'Vehicle broke down');
        await userEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

        expect(await screen.findByText(/moved while this was open/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /force/i })).not.toBeInTheDocument();
    });

    /**
     * The post-pickup rule is jovi-mall's and is deliberately not copied. The
     * dialog hints, and switches itself when the platform says otherwise.
     */
    it('hints that a picked-up shipment will need a named agent', async () => {
        detail({ detail: shipmentDetailFixture({ status: 'picked_up' }) });

        await userEvent.click(await screen.findByRole('button', { name: /reassign/i }));
        // Pre-selected to manual, so the auto-mode warning is not shown yet.
        expect(await screen.findByRole('radio', { name: /choose an agent/i })).toBeChecked();
    });
});
