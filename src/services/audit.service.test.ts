import { beforeEach, describe, expect, it } from 'vitest';

import {
    __resetAuditActionCache,
    createAuditExport,
    downloadAuditExport,
    getAuditActionCatalog,
    getAuditEntry,
    listAuditExports,
} from '@/services/audit.service';
import {
    auditActionCatalogFixture,
    auditEntryDetailFixture,
    auditExportFixture,
} from '@/test/audit-fixtures';
import { stubFetch, successResponse, type FetchCall } from '@/test/utils';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

beforeEach(() => {
    __resetAuditActionCache();
});

describe('GET /audit/:auditId', () => {
    it('reads the entry detail', async () => {
        const calls = stubFetch(() => successResponse(auditEntryDetailFixture()));

        const entry = await getAuditEntry('66bc4f0a1d2e3f4a5b6c7d8e');

        expect(calls[0].url).toContain('/audit/66bc4f0a1d2e3f4a5b6c7d8e');
        expect(entry.before).toEqual({ tier: 3 });
        expect(entry.stateTruncated).toBe(false);
    });
});

describe('GET /audit/actions', () => {
    /**
     * ⚠ **`data` is an object here, not an array** — the only list-shaped read on
     * the service that is not paginated. `api.list` would coerce it to `[]` and
     * hand back an empty catalog with no error anywhere, which would silently
     * remove the action filter from ten screens.
     */
    it('reads an object-shaped data, not a paginated array', async () => {
        stubFetch(() => successResponse(auditActionCatalogFixture()));

        const catalog = await getAuditActionCatalog();

        expect(catalog.actions).toHaveLength(auditActionCatalogFixture().actions.length);
        expect(catalog.total).toBe(catalog.actions.length);
    });

    it('sends no pagination or sort parameters', async () => {
        const calls = stubFetch(() => successResponse(auditActionCatalogFixture()));

        await getAuditActionCatalog();

        expect(calls[0].url).toContain('/audit/actions');
        expect(calls[0].url).not.toContain('?');
    });
});

describe('POST /audit/exports', () => {
    /**
     * `api.mutate`, not `api.post`: the server composes the sentence that says an
     * action flagged `destructive` destroyed nothing, and re-deriving it here
     * would be a second copy of a claim only the server can make.
     */
    it('keeps the server’s own message', async () => {
        const calls = stubFetch(() =>
            successResponse(auditExportFixture(), {
                status: 201,
                message:
                    'Exported 12043 row(s). Nothing was deleted — use the CLI with --purge for that.',
            }),
        );

        const result = await createAuditExport({
            from: '2026-07-01T00:00:00.000Z',
            to: '2026-08-01T00:00:00.000Z',
        });

        expect(calls[0].method).toBe('POST');
        expect(result.message).toMatch(/nothing was deleted/i);
        expect(result.data.id).toBe('66bd1122334455667788990a');
    });
});

describe('GET /audit/exports', () => {
    it('passes the sort through and honours pages: 0 on an empty list', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        const page = await listAuditExports({ page: 1, limit: 20, sort: '-startedAt' });

        expect(queryOf(calls[0]).get('sort')).toBe('-startedAt');
        expect(page.meta.pages).toBe(0);
    });
});

describe('GET /audit/exports/:id/download', () => {
    it('surfaces the filename and the checksum from the headers', async () => {
        stubFetch(
            () =>
                new Response('{"id":"1"}\n', {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/x-ndjson',
                        'Content-Disposition': 'attachment; filename="audit-july.ndjson"',
                        'X-Content-SHA256': '9f2b8c1a',
                    },
                }),
        );

        const file = await downloadAuditExport('66bd1122334455667788990a');

        expect(file.fileName).toBe('audit-july.ndjson');
        // Verify a download against this before trusting it.
        expect(file.sha256).toBe('9f2b8c1a');
    });
});
