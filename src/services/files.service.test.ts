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
    FILE_ACCESS_QUOTA_BLOCKED,
    FILE_UPLOAD_MAX_BYTES,
    PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
    QUOTA_BLOCKED_COPY,
    isDisplayableImage,
    isQuotaBlocked,
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
    // was closed at two *then*. These pin the behaviour that was already right.
    //
    // ⚠ It is closed at **three** since 2026-09-08, and the case immediately
    // below — an unrecognised value failing safe — is the reason that arrived
    // without breaking a render. See the `quota_blocked` block after this one.

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
        // The backend asked us to stay defensive across the service boundary
        // even while the union was closed. Anything unrecognised is NOT
        // displayable — the safe direction, and the one that made a third value
        // a labelling job rather than an outage.
        expect(isDisplayableImage(fileFixture({ access: 'something-new' }))).toBe(false);
    });

    it('separates "can I use the url" from "can this be viewed at all"', () => {
        const proof = fileFixture({ url: null, access: 'authorized' });

        expect(isDisplayableImage(proof)).toBe(false);
        expect(isViewableImage(proof)).toBe(true);
        expect(isViewableImage({ mimeType: 'application/zip' })).toBe(false);
    });
});

describe('quota_blocked — the third access value, and a billing state', () => {
    /**
     * 🔴 **The value that arrived after the union was called closed.** A
     * `quota_blocked` file sits in a **public** tree and is withheld because its
     * owner is over their plan's storage cap. `files.md` § `quota_blocked` is
     * the contract; three properties of it drive every assertion here:
     *
     *   · it is **not** a missing file and **not** a platform fault;
     *   · it is **temporary** — unlike `authorized`, it comes back when the plan
     *     is upgraded;
     *   · it **outranks** `authorized`, so it must be branched on first.
     */
    const blocked = fileFixture({ url: null, access: FILE_ACCESS_QUOTA_BLOCKED });

    it('is recognised, and is not confused with a private tree', () => {
        expect(isQuotaBlocked(blocked)).toBe(true);
        expect(isQuotaBlocked(fileFixture({ url: null, access: 'authorized' }))).toBe(false);
        expect(isQuotaBlocked(fileFixture())).toBe(false);
    });

    it('is not displayable from its url, which the open union already ensured', () => {
        // ⚠ The point of this case is that it needed **no** code change to pass:
        // `isDisplayableImage` requires `access === 'public'`, so the new value
        // failed safe on the day it appeared. What was broken was every screen
        // that then said "private".
        expect(isDisplayableImage(blocked)).toBe(false);
    });

    it('is still an image, so "cannot be shown" must not be read as "not a picture"', () => {
        // `isViewableImage` is access-blind and stays that way. A blocked JPEG is
        // a JPEG — the reason it cannot be drawn is nothing to do with its bytes.
        expect(isViewableImage(blocked)).toBe(true);
    });

    it('outranks authorized, so a blocked file in a private tree is still a billing state', () => {
        /**
         * ⚠ **The precedence rule, asserted as a client obligation.** The wire
         * stamps `quota_blocked` per file (`files.quotaBlockedAt`) rather than
         * deriving it from the tree, so a blocked file in `shipments/` reports
         * `quota_blocked` and never `authorized`. A screen that tests
         * `access === 'authorized'` first would therefore never reach the branch
         * that says what is actually wrong — which is exactly what three screens
         * did until 2026-09-09.
         */
        const blockedProof = fileFixture({
            key: 'shipments/2026/08/9c8b7a_proof.jpg',
            url: null,
            access: FILE_ACCESS_QUOTA_BLOCKED,
        });

        expect(isQuotaBlocked(blockedProof)).toBe(true);
        expect(blockedProof.access).not.toBe('authorized');
    });

    it('says money, and says the file is coming back', () => {
        /**
         * ⚠ **The copy is the fix**, so the copy is what is pinned. `files.md`
         * forbids two renderings by name — *"Never render this as a broken image,
         * and never as 'file missing'"* — because one reads as a platform bug and
         * the other as data loss, when the real answer is that somebody needs to
         * pay for more storage. This is the one wording six surfaces share.
         */
        expect(QUOTA_BLOCKED_COPY.title).toMatch(/storage limit/i);
        expect(QUOTA_BLOCKED_COPY.body).toMatch(/storage cap/i);
        expect(QUOTA_BLOCKED_COPY.body).toMatch(/upgrad|freed/i);
        expect(QUOTA_BLOCKED_COPY.body).toMatch(/nothing has been deleted/i);
        expect(QUOTA_BLOCKED_COPY.label).toMatch(/blocked/i);

        // The two words the contract rules out, in every field an operator reads.
        for (const line of Object.values(QUOTA_BLOCKED_COPY)) {
            expect(line).not.toMatch(/missing|broken|private/i);
        }
    });

    it('never says the file cannot be shown, because it can — the BR-023 guard', () => {
        /**
         * 🔴 **The regression guard for the most expensive sentence in this
         * repository.** `body` used to end *"so this file cannot be shown"*, taken
         * from [`files.md`](../../api-doc/admin/api/files.md) — *"the content
         * route will not help you either"*. It is false: the audited route answers
         * `200` with the bytes for a blocked file in every tree (measured
         * 2026-09-09, BR-023).
         *
         * ⚠ **One constant fed six surfaces, so the wrong claim was rendered seven
         * times and corrected once.** That is the argument for the constant, and it
         * is why the guard belongs here rather than at each screen. The screens
         * assert their own *affordance*; this asserts the *words*.
         */
        for (const [field, line] of Object.entries(QUOTA_BLOCKED_COPY)) {
            expect(line, `${field} must not claim the file is unviewable`).not.toMatch(
                /cannot be (shown|displayed|viewed|opened)|will not (display|open)|unviewable/i,
            );
        }

        // And the note that replaced it has to say the open still works, or the
        // affordance beside it is unexplained.
        expect(QUOTA_BLOCKED_COPY.note).toMatch(/still works/i);
        expect(QUOTA_BLOCKED_COPY.note).toMatch(/no public address|storage cap/i);
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
