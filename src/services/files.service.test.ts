import { describe, expect, it } from 'vitest';

import {
    deleteFilePermanently,
    getFile,
    getFileContent,
    listOrphanFiles,
    resolveFiles,
} from '@/services/files.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { isDisplayableImage, isViewableImage, type FileDetail } from '@/types/files.types';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

const A = '6612a4f0c1a2b3d4e5f60718';
const B = '6612a4f0c1a2b3d4e5f60719';

function fileFixture(overrides: Partial<FileDetail> = {}): FileDetail {
    return {
        id: A,
        key: 'vendors/665a/logo-1f2e3d.png',
        url: 'https://cdn.example.com/vendors/665a/logo-1f2e3d.png',
        access: 'public',
        mimeType: 'image/png',
        size: 48213,
        originalName: 'shop-logo.png',
        ...overrides,
    };
}

describe('batch resolution', () => {
    it('sends one comma-separated ids parameter', async () => {
        // One documented separator rather than repeated `?ids=`, because Express
        // parses `?ids=a&ids=b` as an array and `?ids=a` as a string — every
        // consumer would otherwise have to normalise.
        const calls = stubFetch(() => successResponse({ files: [fileFixture()] }));

        await resolveFiles([A, B]);

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe('/api/v1/files');
        expect(url.searchParams.get('ids')).toBe(`${A},${B}`);
    });

    it('keys the result by id, because the response is not in request order', async () => {
        /**
         * ⚠ An id that resolves to nothing is **absent**, not present-and-null:
         * files are soft-deleted and swept, so a record legitimately outlives
         * the picture it points at. Zipping against the request array is the
         * mistake the `Map` exists to prevent.
         */
        stubFetch(() => successResponse({ files: [fileFixture({ id: B })] }));

        const result = await resolveFiles([A, B]);

        expect(result.size).toBe(1);
        expect(result.get(B)?.id).toBe(B);
        expect(result.get(A)).toBeUndefined();
    });

    it('answers the empty case without a round trip', async () => {
        // A request with no ids is a 400, so there is nothing to be told off for.
        const calls = stubFetch(() => successResponse({ files: [] }));

        await expect(resolveFiles([])).resolves.toEqual(new Map());
        expect(calls).toHaveLength(0);
    });

    it('refuses more than the batch ceiling locally', async () => {
        const tooMany = Array.from({ length: 101 }, (_, index) =>
            index.toString(16).padStart(24, '0'),
        );

        await expect(resolveFiles(tooMany)).rejects.toBeInstanceOf(RangeError);
    });
});

describe('the single form raises where the batch does not', () => {
    it('propagates FILE_NOT_FOUND', async () => {
        // A list renders the rows it got and shows a placeholder for the rest; a
        // caller that asked for exactly one file and got an empty object cannot
        // tell "gone" from "the field was empty".
        stubFetch(() => errorResponse(404, 'FILE_NOT_FOUND'));

        await expect(getFile(A)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    });
});

describe('the two fields the contract used to get wrong', () => {
    // ✅ Confirmed at BR-010 and both documents corrected — `url` really is
    // `string | null`, `access` really is present on every route, and the union
    // really is closed at two. These pin the behaviour that was already right.

    it('refuses to render a private-tree file FROM ITS URL', () => {
        /**
         * A delivery-proof photo and a digital product both resolve with
         * `url: null, access: "authorized"`.
         *
         * ⚠ **This is no longer the same as "cannot be shown".** Since BR-011
         * the bytes are reachable through `getFileContent`; what stays false is
         * that `url` can ever be used for them.
         */
        const proof = fileFixture({ url: null, access: 'authorized' });

        expect(isDisplayableImage(proof)).toBe(false);
        expect(isDisplayableImage(fileFixture())).toBe(true);
    });

    it('refuses to display a public non-image', () => {
        // A product's media may be a video or a spec sheet, so the mime type is
        // checked independently of `access`.
        expect(isDisplayableImage(fileFixture({ mimeType: 'application/pdf' }))).toBe(false);
    });

    it('would still refuse an unrecognised access value', () => {
        // The union is closed at two upstream and the backend still asked us to
        // stay defensive across the service boundary. Anything unrecognised is
        // NOT displayable — the safe direction.
        expect(isDisplayableImage(fileFixture({ access: 'something-new' }))).toBe(false);
    });

    it('separates "can I use the url" from "can this be viewed at all"', () => {
        const proof = fileFixture({ url: null, access: 'authorized' });

        expect(isDisplayableImage(proof)).toBe(false);
        expect(isViewableImage(proof)).toBe(true);
        expect(isViewableImage({ mimeType: 'application/zip' })).toBe(false);
    });
});

describe('the content route', () => {
    function bytesResponse(
        body: string,
        headers: Record<string, string> = {},
    ): Response {
        return new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg', ...headers },
        });
    }

    it('asks the content path and hands back an object url', async () => {
        const calls = stubFetch(() => bytesResponse('JPEGBYTES'));

        const content = await getFileContent(A);

        expect(urlOf(calls[0]).pathname).toBe(`/api/v1/files/${A}/content`);
        expect(calls[0].method).toBe('GET');
        expect(content.objectUrl).toMatch(/^blob:/);
        expect(content.mimeType).toBe('image/jpeg');
        expect(content.size).toBe('JPEGBYTES'.length);
    });

    it('trusts the Content-Type header over anything in the filename', async () => {
        // jovi-mall's header is the authority on what the bytes are. A proof
        // photo uploaded as `scan.pdf` is still whatever the header says.
        stubFetch(() =>
            bytesResponse('X', {
                'Content-Type': 'image/png',
                'Content-Disposition': 'inline; filename="scan.pdf"',
            }),
        );

        const content = await getFileContent(A);

        expect(content.mimeType).toBe('image/png');
        expect(content.fileName).toBe('scan.pdf');
    });

    it('reports a short body as truncated, because nothing else will', async () => {
        /**
         * ⚠ The route is a **proxied stream**: once the first byte is sent the
         * status line is committed, so a failure after that point closes the
         * connection rather than answering a 5xx. A truncated body is the only
         * signal there is, which is why `Content-Length` is forwarded.
         */
        stubFetch(() => bytesResponse('half', { 'Content-Length': '9999' }));

        await expect(getFileContent(A)).resolves.toMatchObject({ truncated: true });
    });

    it('does not cry truncation when the length matches', async () => {
        stubFetch(() => bytesResponse('exactly!!', { 'Content-Length': '9' }));

        await expect(getFileContent(A)).resolves.toMatchObject({ truncated: false });
    });

    it('does not cry truncation on a chunked response with no length at all', async () => {
        // `Number(null)` is 0, which would read as "the body is empty" and make
        // every chunked response a false truncation report.
        stubFetch(() => bytesResponse('chunked'));

        await expect(getFileContent(A)).resolves.toMatchObject({ truncated: false });
    });

    it('surfaces the capability refusal under its own code', async () => {
        /**
         * ⚠ `409 FILE_CONTENT_NOT_SUPPORTED` is a **configuration state, not an
         * outage**: on a provider that cannot read bytes it is the permanent
         * answer for every file. It must stay distinguishable from a
         * `SERVICE_DEPENDENCY_UNAVAILABLE`, because one of them deserves a retry
         * button and the other can never succeed.
         */
        stubFetch(() =>
            errorResponse(409, 'FILE_CONTENT_NOT_SUPPORTED', {
                category: 'business_rule',
                details: { platformCode: 'STORAGE_DOWNLOAD_NOT_SUPPORTED' },
            }),
        );

        await expect(getFileContent(A)).rejects.toMatchObject({
            code: 'FILE_CONTENT_NOT_SUPPORTED',
            category: 'business_rule',
            details: { platformCode: 'STORAGE_DOWNLOAD_NOT_SUPPORTED' },
        });
    });

    it('still raises FILE_NOT_FOUND for a swept file', async () => {
        stubFetch(() => errorResponse(404, 'FILE_NOT_FOUND', { category: 'not_found' }));

        await expect(getFileContent(A)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    });
});

describe('the orphan listing', () => {
    it('reads meta.olderThan — the cutoff the platform actually applied', async () => {
        // Not the value sent, and not a default recomputed here.
        stubFetch(() =>
            successResponse(
                { files: [] },
                { meta: { count: 0, olderThan: '2026-08-13T00:00:00.000Z' } },
            ),
        );

        const result = await listOrphanFiles();

        expect(result.meta.olderThan).toBe('2026-08-13T00:00:00.000Z');
        expect(result.files).toEqual([]);
    });
});

describe('the permanent delete', () => {
    it('refuses a mismatched confirmation before it leaves the browser', async () => {
        // The `outbox/prune` pattern: restate the value that decides the blast
        // radius. wi-admin refuses it again with FILE_DELETE_NOT_CONFIRMED.
        await expect(deleteFilePermanently(A, { confirmFileId: B })).rejects.toThrow(
            /must equal/i,
        );
    });

    it('sends the confirmation in the body', async () => {
        const calls = stubFetch(() => successResponse({ id: A, deleted: true }));

        await deleteFilePermanently(A, { confirmFileId: A });

        const call = calls[calls.length - 1];
        expect(call.method).toBe('DELETE');
        expect(urlOf(call).pathname).toBe(`/api/v1/files/${A}/permanent`);
        expect(JSON.parse(call.body as string)).toEqual({ confirmFileId: A });
    });
});
