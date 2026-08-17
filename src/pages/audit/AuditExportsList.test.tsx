import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { notify } from '@/lib/notify';
import { AuditExportsList } from '@/pages/audit/AuditExportsList';
import { auditExportFixture, cliAuditExportFixture } from '@/test/audit-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

const LIST_META = { total: 1, page: 1, limit: 20, pages: 1 };

function renderList(rows = [auditExportFixture()]) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/audit/exports')) {
            return successResponse(rows, { meta: LIST_META });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<AuditExportsList />, {
        route: '/dashboard/audit/exports',
        auth: { admin: adminFixture({ tier: 1 }) },
        permissions: { held: heldFixture(1), tier: 1 },
    });

    return calls;
}

function bodyOf(call: FetchCall): Record<string, unknown> {
    return JSON.parse(String(call.body ?? '{}')) as Record<string, unknown>;
}

describe('the list', () => {
    it('renders an export, its size and who asked for it', async () => {
        renderList();

        // The list carries the range, the counts and the requester; the file name
        // itself is on the detail screen.
        expect(await screen.findByText('12,043')).toBeInTheDocument();
        expect(screen.getByText('8.0 MB')).toBeInTheDocument();
        expect(screen.getByText('Ada Nkemelu')).toBeInTheDocument();
    });

    /**
     * The endpoint offers no filters and one sort key. A list with no filter bar
     * reads as unfinished unless something says that is the contract.
     */
    it('offers no filters, and exactly one sortable column', async () => {
        renderList();
        await screen.findByText('12,043');

        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

        const sortable = screen
            .getAllByRole('columnheader')
            .filter((header) => within(header).queryByRole('button') !== null);
        expect(sortable).toHaveLength(1);
        expect(sortable[0]).toHaveTextContent(/started/i);
    });

    /** Both name fields are null on a CLI export — a fact, not missing data. */
    it('says an export came from the command line rather than leaving a blank', async () => {
        renderList([cliAuditExportFixture()]);

        expect(await screen.findByText(/command line/i)).toBeInTheDocument();
    });

    it('offers no download for an export whose file is not durable', async () => {
        renderList([auditExportFixture({ status: 'running', downloadable: false })]);

        expect(await screen.findByText(/not ready/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    });
});

describe('creating an export', () => {
    it('refuses to submit without both bounds, and says what the server would', async () => {
        const user = userEvent.setup();
        const calls = renderList();
        await screen.findByText('12,043');
        const before = calls.length;

        await user.click(screen.getByRole('button', { name: /new export/i }));
        const dialog = await screen.findByRole('dialog');

        // Only one end filled: an export with no range means the whole
        // collection, which this endpoint cannot answer.
        await user.type(within(dialog).getByLabelText('From'), '2026-07-01');

        expect(within(dialog).getByRole('button', { name: /^export$/i })).toBeDisabled();
        expect(await screen.findByText(/needs both a start and an end date/i)).toBeInTheDocument();
        expect(calls).toHaveLength(before);
    });

    /** The contract refuses date-only values — `2026-07-01` is not an instant. */
    it('sends instants, not the days the operator picked', async () => {
        const user = userEvent.setup();
        const calls = renderList();
        await screen.findByText('12,043');

        await user.click(screen.getByRole('button', { name: /new export/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('From'), '2026-07-01');
        await user.type(within(dialog).getByLabelText('To'), '2026-07-31');
        await user.click(within(dialog).getByRole('button', { name: /^export$/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });

        const body = bodyOf(calls.find((call) => call.method === 'POST')!);
        expect(String(body.from)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(String(body.to)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    /**
     * A routine answer, not an edge case: the API path is bounded by row count,
     * and a quarter of a busy trail exceeds 50 000 easily. It has to name both
     * numbers and point at the CLI, and the dialog has to stay open.
     */
    it('explains a too-large range inline and keeps the dialog open', async () => {
        const user = userEvent.setup();
        stubFetch((call) => {
            if (call.method === 'POST') {
                return errorResponse(422, 'AUDIT_EXPORT_TOO_LARGE', {
                    message: 'That range covers too many rows to export in a request',
                    category: 'business_rule',
                    details: { rowCount: 91_204, maxRows: 50_000 },
                });
            }
            return successResponse([auditExportFixture()], { meta: LIST_META });
        });

        renderWithProviders(<AuditExportsList />, {
            route: '/dashboard/audit/exports',
            auth: { admin: adminFixture({ tier: 1 }) },
            permissions: { held: heldFixture(1), tier: 1 },
        });
        await screen.findByText('12,043');

        await user.click(screen.getByRole('button', { name: /new export/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('From'), '2026-01-01');
        await user.type(within(dialog).getByLabelText('To'), '2026-12-31');
        await user.click(within(dialog).getByRole('button', { name: /^export$/i }));

        expect(await screen.findByText(/91,204 rows/)).toBeInTheDocument();
        expect(screen.getByText(/at most 50,000/)).toBeInTheDocument();
        expect(screen.getByText(/npm run audit:export/)).toBeInTheDocument();
        // Fixed in the form the operator is looking at.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    /**
     * A quarterly export is legal and would be refused if the feed's 92-day cap
     * were applied here. `POST /audit/exports` passes no `maxDays` — it is bounded
     * by row count instead.
     */
    it('does not apply the feed’s 92-day cap to an export range', async () => {
        const user = userEvent.setup();
        const calls = renderList();
        await screen.findByText('12,043');

        await user.click(screen.getByRole('button', { name: /new export/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText('From'), '2026-01-01');
        await user.type(within(dialog).getByLabelText('To'), '2026-06-30');

        expect(within(dialog).getByRole('button', { name: /^export$/i })).toBeEnabled();
        await user.click(within(dialog).getByRole('button', { name: /^export$/i }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });
    });
});

describe('downloading', () => {
    it('hands the file to the browser and releases the object URL', async () => {
        const user = userEvent.setup();
        // jsdom implements neither, so they are installed before being spied on
        // rather than replaced.
        const create = vi.fn(() => 'blob:audit');
        const revoke = vi.fn();
        URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
        URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;

        stubFetch((call) => {
            if (call.url.includes('/download')) {
                // The one endpoint that does not answer with the JSON envelope.
                return new Response('{"id":"1"}\n', {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/x-ndjson',
                        'Content-Disposition': 'attachment; filename="audit-july.ndjson"',
                    },
                });
            }
            return successResponse([auditExportFixture()], { meta: LIST_META });
        });

        renderWithProviders(<AuditExportsList />, {
            route: '/dashboard/audit/exports',
            auth: { admin: adminFixture({ tier: 1 }) },
            permissions: { held: heldFixture(1), tier: 1 },
        });
        await screen.findByText('12,043');

        await user.click(screen.getByRole('button', { name: /download/i }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        // In a `finally`, so a throw cannot leak it for the life of the document.
        expect(revoke).toHaveBeenCalledWith('blob:audit');
    });

    /**
     * The most important copy on this screen: behind more than one instance this
     * is the *normal* answer, so it must not read as data loss.
     */
    it('names the deployment cause when the file is gone', async () => {
        const user = userEvent.setup();
        // The refusal surfaces as a toast, and no `<Toaster />` is mounted in a
        // screen test — so the assertion is on what was reported, not on a
        // portal that this tree does not render.
        const reported = vi.spyOn(notify, 'apiError');

        stubFetch((call) => {
            if (call.url.includes('/download')) {
                return errorResponse(410, 'AUDIT_EXPORT_FILE_MISSING', {
                    message: 'The export file is no longer on disk',
                    category: 'not_found',
                });
            }
            return successResponse([auditExportFixture()], { meta: LIST_META });
        });

        renderWithProviders(<AuditExportsList />, {
            route: '/dashboard/audit/exports',
            auth: { admin: adminFixture({ tier: 1 }) },
            permissions: { held: heldFixture(1), tier: 1 },
        });
        await screen.findByText('12,043');

        await user.click(screen.getByRole('button', { name: /download/i }));

        await waitFor(() => expect(reported).toHaveBeenCalled());
        // Branched on the code, not the message: a 410 here is a deployment fact
        // rather than data loss, and says so instead of reading as a fault.
        expect(reported.mock.calls[0][1]).toMatch(/its file is gone/i);
        reported.mockRestore();
    });
});
