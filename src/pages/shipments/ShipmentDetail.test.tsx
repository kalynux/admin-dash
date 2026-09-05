import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    /** `GET /files/:fileId` — the delivery proof's resolve, never its content. */
    file?: () => Response;
}

/** A private-tree image: `url: null`, so only the content route can show it. */
const PROOF_FILE = {
    id: '6612aabbccddeeff00112299',
    key: 'shipments/2026/08/9c8b7a_proof.jpg',
    url: null,
    access: 'authorized',
    mimeType: 'image/jpeg',
    size: 214880,
    originalName: 'proof-6671.jpg',
};

function stubDetail({
    detail = shipmentDetailFixture(),
    write,
    file = () => successResponse(PROOF_FILE),
}: StubOptions = {}) {
    return stubFetch((call) => {
        if (call.method !== 'GET' && write) return write();

        if (call.url.includes('/files/')) {
            return file();
        }
        if (call.url.includes('/offers')) {
            return successResponse(detail.offers);
        }
        if (call.url.includes('/activity')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.url.includes('/agents')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 8, pages: 0 } });
        }
        /*
          ⚠ **No `/vendors/` branch at all, deliberately.** Phase C made two
          reads here — one `GET /vendors/:vendorId` for the business name and one
          `GET /vendors/:id/products/:id` per distinct listing for the title,
          price and picture. BR-016 § 6 and BR-017 put all five fields on the
          shipment payload, so both were deleted. Falling through to the throw
          below is the guard: either lookup coming back fails the suite.
        */
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

        /*
          Scoped to the dialog, and it has to be: the overview behind it now
          renders the offered agent's id through `AgentRef`, whose copy button is
          named "Copy agent ID" — which `/agent id/i` matches just as happily as
          the field this test is about. The assertion is unchanged; only the
          haystack is. `within(dialog)` is what `CodScreens.test.tsx` already does
          for the same pair of labels.
        */
        const dialog = within(await screen.findByRole('dialog'));
        expect(await dialog.findByLabelText(/agent id/i)).toBeInTheDocument();
        expect(dialog.queryByLabelText(/find an agent/i)).not.toBeInTheDocument();
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
            // ⚠ The two `/vendors/` branches that used to sit here went with the
            // reads they answered — see the note in `stubDetail`.
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

// ─── § C4 · the two joins the Overview tab makes for itself ───────────────────

describe('the vendor behind the order', () => {
    /**
     * 🔴 **This used to assert the request. Now it asserts its absence.**
     *
     * Phase C paid one `GET /vendors/:vendorId` for this name and shipped an
     * `InfoHint` saying the payload "carries the vendor's id and no name" —
     * false from BR-016 § 6 onwards. The stub throws on any `/vendors/` request,
     * so re-introducing the read fails the suite.
     */
    it('names the vendor from the payload, with no second read', async () => {
        const calls = detail();

        expect(await screen.findByText('Douala Fresh Market')).toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/vendors/'))).toBe(false);
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ The name no longer costs a permission either. `vendors.read` still gates
     * the **link** — what is visible must be reachable — but a caller who cannot
     * open the vendor directory can still read which shop the parcel came from.
     */
    it('names the vendor without vendors.read, and offers no link', async () => {
        // Explicitly narrow rather than a tier: **every** catalogued tier holds
        // `vendors.read`, so `heldFixture(3)` would have made this pass for the
        // wrong reason — and then stopped, silently, the day it did not.
        detail({ held: new Set(['shipments.read']) });

        expect(await screen.findByText('Douala Fresh Market')).toBeInTheDocument();
        expect(
            screen.queryByRole('link', { name: /douala fresh market/i }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ `null` where the vendor has no Store row — mid-onboarding, an ordinary
     * state — and **never `display_name` substituted in**. The id is the honest
     * answer, exactly as it was when the read could fail.
     */
    it('falls back to the id when the vendor has no business name', async () => {
        const record = shipmentDetailFixture();
        detail({
            detail: shipmentDetailFixture({
                order: { ...record.order!, vendorName: null },
            }),
        });

        expect(
            await screen.findByRole('button', { name: /copy vendor id/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText('Douala Fresh Market')).not.toBeInTheDocument();
    });
});

describe('what is in the parcel', () => {
    /**
     * 🔴 **The regression guard for BR-017 on this screen.**
     *
     * The card used to say *"ids only — open the order"*, then Phase C filled it
     * in by resolving the catalogue per distinct listing. `title`, `price`,
     * `currency` and `image` are on this payload now, so the lookup is gone and
     * the stub throws on `/products/`.
     */
    it('names the listing and shows its picture with no catalogue read', async () => {
        const calls = detail();

        expect(await screen.findByText('Plantain — 1 kg')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /plantain\.jpg/i })).toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/products/'))).toBe(false);
    });

    /**
     * 🔴 **The price is now the one that was CHARGED, and the caveat is gone
     * with the lookup.** The catalogue could only quote today's listed price, so
     * the old card had to label it "listed" and point at the order for the
     * figure that settles money questions. These fields are joined from the
     * order line's own snapshot, so this card *is* that figure.
     */
    it('quotes the sale’s price, not the listing’s', async () => {
        detail();

        await screen.findByText('Plantain — 1 kg');
        expect(screen.queryByText(/listed/)).not.toBeInTheDocument();
    });

    /**
     * ⚠ Both links are built from ids this screen already holds, so neither ever
     * depended on an enrichment. A screen that loses its navigation because a
     * read failed is worse than one that never had it — and now there is no read
     * to fail.
     */
    it('links to the listing and back to the order line', async () => {
        detail();

        const line = await screen.findByRole('link', { name: /this line on the order/i });
        expect(line).toHaveAttribute(
            'href',
            '/dashboard/orders/6670aabbccddeeff00112233?tab=items&item=6670aabbccddeeff00112240',
        );
        expect(screen.getByRole('button', { name: /copy product id/i })).toBeInTheDocument();
    });
});

describe('the delivery proof', () => {
    /**
     * ⚠ **The click is still the consent.** `deliveryProofFileId` lives in a
     * private tree, so the content route is the only way to see it and every
     * open writes an audit row — the box says so *before* the click and fetches
     * nothing until then. What changed in § C4 is the shape: a box at the
     * picture's size rather than a button labelled "Open the file".
     */
    it('offers a reveal box and fetches nothing on mount', async () => {
        const calls = detail({
            detail: shipmentDetailFixture({ deliveryProofFileId: PROOF_FILE.id }),
        });

        await screen.findByRole('tab', { name: /overview/i });
        await waitFor(() =>
            expect(
                calls.some((call) => call.url.includes('/files/6612aabbccddeeff00112299')),
            ).toBe(true),
        );

        // The resolve runs on mount — it is unaudited and discloses nothing new.
        // The *content* read must not.
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);
        expect(await screen.findByRole('button', { name: /click to view/i })).toBeInTheDocument();
        expect(screen.getByText(/recorded against your account/i)).toBeInTheDocument();
    });
});
