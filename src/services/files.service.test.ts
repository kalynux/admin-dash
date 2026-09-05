import { describe, expect, it } from 'vitest';

import {
    deleteFilePermanently,
    getFile,
    getFileContent,
    listFileLibrary,
    listOrphanFiles,
    resolveFiles,
    uploadFiles,
} from '@/services/files.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import {
    FILE_UPLOAD_MAX_BYTES,
    PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
    isDisplayableImage,
    isViewableImage,
    type FileDetail,
    type FileLibraryMeta,
    type FileUploadMeta,
    type LibraryFile,
} from '@/types/files.types';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

/** The four pagination keys plus the two the library adds. */
function libraryMeta(overrides: Partial<FileLibraryMeta> = {}): Record<string, unknown> {
    return {
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
        referenceSampleCap: 5,
        publicUrlsConfigured: true,
        ...overrides,
    };
}

/** The constraints the upload declares rather than leaving to be discovered. */
function uploadMeta(overrides: Partial<FileUploadMeta> = {}): Record<string, unknown> {
    return {
        count: 1,
        maxBytes: FILE_UPLOAD_MAX_BYTES,
        maxFiles: 10,
        fieldName: 'files',
        acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        ...overrides,
    };
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

describe('the media library', () => {
    function libraryRow(overrides: Partial<LibraryFile> = {}): LibraryFile {
        return {
            ...fileFixture(),
            createdAt: '2026-08-11T09:14:00.000Z',
            owner: { type: 'admin', id: '6511aabbccddeeff00112233', name: 'Ada Mensah' },
            usage: { referenceCount: 0, references: [] },
            ...overrides,
        };
    }

    it('sends one sort token, not sortBy and sortOrder', async () => {
        /**
         * ⚠ **The wrong form is dropped SILENTLY.** jovi-mall's own file listing
         * takes `sortBy` + `sortOrder`; this route does not, and the list-query
         * schema on this service is not `.strict()` — so `sortBy=size` answers
         * `200` in the default order with nothing saying the sort was ignored.
         * That is why this is asserted rather than assumed.
         */
        const calls = stubFetch(() => successResponse([libraryRow()], { meta: libraryMeta() }));

        await listFileLibrary({ sort: '-size' });

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe('/api/v1/files/library');
        expect(url.searchParams.get('sort')).toBe('-size');
        expect(url.searchParams.get('sortBy')).toBeNull();
        expect(url.searchParams.get('sortOrder')).toBeNull();
    });

    it('drops an empty search rather than sending one', async () => {
        // An empty `?search=` is a 400 on this service, not "no filter".
        const calls = stubFetch(() => successResponse([], { meta: libraryMeta({ total: 0 }) }));

        await listFileLibrary({ search: '', ownerType: 'admin' });

        const url = urlOf(calls[0]);
        expect(url.searchParams.has('search')).toBe(false);
        expect(url.searchParams.get('ownerType')).toBe('admin');
    });

    it('reads the reference cap and the URL-configuration flag off meta', async () => {
        stubFetch(() =>
            successResponse([libraryRow()], {
                meta: libraryMeta({ referenceSampleCap: 5, publicUrlsConfigured: false }),
            }),
        );

        const result = await listFileLibrary();

        expect(result.meta.referenceSampleCap).toBe(5);
        expect(result.meta.publicUrlsConfigured).toBe(false);
    });

    it('falls back to a reference cap of zero, never to a guess', async () => {
        /**
         * ⚠ The cap bounds `usage.references`. A screen that assumed a *larger*
         * cap than the service applied would render "and N more" as though it had
         * shown everything — visibly wrong is the safer direction, so a row with
         * references reports them all as unshown.
         */
        stubFetch(() =>
            successResponse([libraryRow()], { meta: { total: 1, page: 1, limit: 20, pages: 1 } }),
        );

        const result = await listFileLibrary();

        expect(result.meta.referenceSampleCap).toBe(0);
    });

    it('does not claim previews are unconfigured when the service did not say', async () => {
        // `publicUrlsConfigured: false` makes the screen assert something about
        // the SERVER. A missing field is not evidence for that claim.
        stubFetch(() =>
            successResponse([libraryRow()], { meta: { total: 1, page: 1, limit: 20, pages: 1 } }),
        );

        const result = await listFileLibrary();

        expect(result.meta.publicUrlsConfigured).toBe(true);
    });

    it('reports pages: 0 on an empty list rather than 1', async () => {
        stubFetch(() => successResponse([]));

        const result = await listFileLibrary();

        expect(result.meta.pages).toBe(0);
    });
});

describe('the upload', () => {
    function upload(name = 'cover.png', type = 'image/png', bytes = 8) {
        return new File([new Uint8Array(bytes)], name, { type });
    }

    it('sends multipart under the field name the platform reads, and sets no Content-Type', async () => {
        /**
         * ⚠ **The header is the browser's job and must not be written here.** A
         * multipart body is unreadable without the `boundary` token that
         * separates its parts, and only the `FormData` serialiser knows it —
         * writing `Content-Type: multipart/form-data` by hand omits it and the
         * service answers `415 FILE_UPLOAD_NOT_MULTIPART` on a request that
         * genuinely was multipart.
         */
        const calls = stubFetch(() =>
            successResponse({ files: [fileFixture()] }, { status: 201, meta: uploadMeta() }),
        );

        await uploadFiles([upload()]);

        const call = calls[0];
        expect(call.method).toBe('POST');
        expect(urlOf(call).pathname).toBe('/api/v1/files/upload');
        expect(call.headers.get('Content-Type')).toBeNull();
        // ⚠ One repeated field name, never `files[0]` / `files[1]`.
        expect(call.formData?.getAll('files')).toHaveLength(1);
    });

    it('repeats the one field name across every part', async () => {
        const calls = stubFetch(() =>
            successResponse({ files: [fileFixture()] }, { status: 201, meta: uploadMeta() }),
        );

        await uploadFiles([upload('a.png'), upload('b.png')]);

        expect(calls[0].formData?.getAll('files')).toHaveLength(2);
        expect(calls[0].formData?.getAll('files[0]')).toHaveLength(0);
    });

    it('refuses an empty upload without spending an audited write', async () => {
        const calls = stubFetch(() => successResponse({ files: [] }, { status: 201 }));

        await expect(uploadFiles([])).rejects.toBeInstanceOf(RangeError);
        expect(calls).toHaveLength(0);
    });

    it('returns what was STORED, which is not always what was sent', async () => {
        /**
         * ⚠ jovi-mall sniffs the real type and **converts PNG to WebP** by its own
         * policy, so a client that records `image/png` because that is what it
         * picked has the wrong type on file. This pins that the response is read
         * rather than the request echoed.
         */
        stubFetch(() =>
            successResponse(
                {
                    files: [
                        fileFixture({
                            mimeType: 'image/webp',
                            key: 'images/2026/08/1f2e3d_cover.webp',
                            originalName: 'cover.png',
                        }),
                    ],
                },
                { status: 201, meta: uploadMeta() },
            ),
        );

        const result = await uploadFiles([upload('cover.png', 'image/png')]);

        expect(result.files[0].mimeType).toBe('image/webp');
        expect(result.files[0].originalName).toBe('cover.png');
    });

    it('prefers the constraints the service declares over the ones compiled in', async () => {
        // The constants describe the deployment this dashboard was written
        // against; the meta describes the one it is talking to.
        stubFetch(() =>
            successResponse(
                { files: [fileFixture()] },
                { status: 201, meta: uploadMeta({ maxBytes: 1024, maxFiles: 2 }) },
            ),
        );

        const result = await uploadFiles([upload()]);

        expect(result.meta.maxBytes).toBe(1024);
        expect(result.meta.maxFiles).toBe(2);
    });

    it('falls back to the compiled constraints when the service sends no meta', async () => {
        stubFetch(() => successResponse({ files: [fileFixture()] }, { status: 201 }));

        const result = await uploadFiles([upload()]);

        expect(result.meta.maxBytes).toBe(FILE_UPLOAD_MAX_BYTES);
        expect(result.meta.fieldName).toBe('files');
    });

    it('surfaces the platform policy refusal under its platformCode', async () => {
        /**
         * ⚠ Max files, field name and MIME type are **published, not policed** by
         * wi-admin — it never parses the body. A file that slips past the client
         * comes back as a delegated refusal, and `error.code` is the same for
         * every one of those, so the branch has to be `details.platformCode`.
         */
        stubFetch(() =>
            errorResponse(400, 'PLATFORM_OPERATION_REJECTED', {
                message: 'The platform refused this',
                category: 'business_rule',
                details: {
                    platformCode: PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
                    violations: [{ file: 'notes.txt', reason: 'type not accepted' }],
                },
            }),
        );

        await expect(uploadFiles([upload('notes.txt', 'text/plain')])).rejects.toMatchObject({
            code: 'PLATFORM_OPERATION_REJECTED',
            platformCode: PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
        });
    });
});
