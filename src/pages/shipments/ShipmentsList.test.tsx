import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { ShipmentsList } from '@/pages/shipments/ShipmentsList';
import { adminFixture } from '@/test/fixtures';
import {
    heldShipmentFixture,
    shipmentFixture,
    shipmentListMetaFixture,
    unassignedShipmentFixture,
} from '@/test/shipment-fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Shipment } from '@/types/shipments.types';

function stubList(rows: Shipment[], meta: Record<string, unknown> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/shipments')) {
            return successResponse(rows, { meta: shipmentListMetaFixture(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(route = '/dashboard/shipments') {
    return renderWithProviders(<ShipmentsList />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the directory', () => {
    it('asks for the documented defaults', async () => {
        const calls = stubList([shipmentFixture()]);
        list();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/shipments');
        expect(url.searchParams.get('sort')).toBe('-createdAt');
        expect(url.searchParams.get('limit')).toBe('20');
    });

    /** `updatedAt` costs an index on a hot write collection. Not offered. */
    it('offers a sort control only for the creation date', async () => {
        stubList([shipmentFixture()]);
        list();

        await screen.findByRole('link', { name: 'ACR-260812-103000-4K7QP' });
        const table = within(screen.getByRole('table'));
        expect(table.getByRole('button', { name: /created/i })).toBeInTheDocument();
        expect(table.queryByRole('button', { name: /^updated$/i })).not.toBeInTheDocument();
    });

    /**
     * The docs show `WM-SH-2026-114402`. The real format is
     * `ACR-YYMMDD-HHMMSS-XXXXX`, and the search is an uppercase-anchored prefix —
     * so the placeholder has to teach the real one.
     */
    it('shows the real tracking-number shape in the search placeholder', async () => {
        stubList([shipmentFixture()]);
        list();

        const box = await screen.findByLabelText(/search shipments/i);
        expect(box).toHaveAttribute('placeholder', expect.stringContaining('ACR-'));
        expect(box.getAttribute('placeholder')).not.toContain('WM-SH');
    });

    /** No currency accompanies `deliveryFeeSnapshot` — format it, print no symbol. */
    it('prints the delivery fee without a currency symbol', async () => {
        stubList([shipmentFixture()]);
        list();

        const row = (
            await screen.findByRole('link', { name: 'ACR-260812-103000-4K7QP' })
        ).closest('tr');
        const cells = within(row as HTMLElement).getAllByRole('cell');
        const feeCell = cells.find((cell) => /1,500|1 500/.test(cell.textContent ?? ''));
        expect(feeCell).toBeDefined();
        expect(feeCell?.textContent).not.toMatch(/XAF|FCFA|\$/);
    });

    it('says so when no agent is bound rather than leaving the cell empty', async () => {
        stubList([unassignedShipmentFixture()]);
        list();

        expect(await screen.findByText(/no agent bound/i)).toBeInTheDocument();
    });
});

describe('filters', () => {
    it('reads every filter out of the URL and sends it', async () => {
        const calls = stubList([shipmentFixture()]);
        list(
            '/dashboard/shipments?search=ACR-2608&status=picked_up&assignmentState=accepted' +
                '&agencyId=665c0011223344556677889a&agentId=6660112233445566778899aa' +
                '&orderId=6670aabbccddeeff00112233&unassigned=false&held=true',
        );

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.get('search')).toBe('ACR-2608');
        expect(url.searchParams.get('status')).toBe('picked_up');
        expect(url.searchParams.get('assignmentState')).toBe('accepted');
        expect(url.searchParams.get('agencyId')).toBe('665c0011223344556677889a');
        expect(url.searchParams.get('agentId')).toBe('6660112233445566778899aa');
        expect(url.searchParams.get('orderId')).toBe('6670aabbccddeeff00112233');
        expect(url.searchParams.get('held')).toBe('true');
    });

    /**
     * Two independent axes: a held shipment may well have an agent, so setting
     * both is a legitimate and different question from setting either.
     */
    it('sends unassigned and held together as separate axes', async () => {
        const calls = stubList([heldShipmentFixture()]);
        list('/dashboard/shipments?unassigned=true&held=true');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.get('unassigned')).toBe('true');
        expect(url.searchParams.get('held')).toBe('true');
    });

    it('sends held=false rather than dropping it', async () => {
        const calls = stubList([shipmentFixture()]);
        list('/dashboard/shipments?held=false');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('held')).toBe('false');
    });

    it('sends no search parameter when the box is empty', async () => {
        const calls = stubList([shipmentFixture()]);
        list();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    it('makes no dated request when the picked range exceeds the cap', async () => {
        const calls = stubList([shipmentFixture()]);
        list('/dashboard/shipments?createdFrom=2024-01-01&createdTo=2026-08-15');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.has('from')).toBe(false);
        expect(url.searchParams.has('to')).toBe(false);
    });

    /** The status enum is a cross-service contract the platform extends. */
    it('sends and shows a status that is not in the known set', async () => {
        const calls = stubList([shipmentFixture()]);
        list('/dashboard/shipments?status=awaiting_customs');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('status')).toBe('awaiting_customs');
        expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent(
            /awaiting customs/i,
        );
    });

    it('renders a clearable chip for a cross-linked order filter', async () => {
        stubList([shipmentFixture()]);
        list('/dashboard/shipments?orderId=6670aabbccddeeff00112233');

        expect(await screen.findByText(/order 6670aabbccddeeff00112233/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /clear order filter/i })).toBeInTheDocument();
    });
});

describe('states', () => {
    it('warns when an order-number search matched more than could be looked up', async () => {
        stubList([shipmentFixture()], { searchMatchesTruncated: true });
        list('/dashboard/shipments?search=ORD');

        expect(await screen.findByText(/results may be incomplete/i)).toBeInTheDocument();
    });

    it('says nothing about completeness when the server did not set the flag', async () => {
        stubList([shipmentFixture()]);
        list('/dashboard/shipments?search=ORD');

        await screen.findByRole('link', { name: 'ACR-260812-103000-4K7QP' });
        expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
    });

    it('renders no pager over an empty result', async () => {
        stubList([], { total: 0, pages: 0 });
        list();

        await screen.findByText(/no shipments yet/i);
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });
});
