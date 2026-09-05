import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MediaLibrary } from '@/pages/media/MediaLibrary';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FileLibraryMeta, LibraryFile } from '@/types/files.types';

const FILE_ID = '6612a4f0c1a2b3d4e5f60718';

function libraryFile(overrides: Partial<LibraryFile> = {}): LibraryFile {
    return {
        id: FILE_ID,
        key: 'images/2026/08/1f2e3d_logo.png',
        url: 'http://localhost:8022/api/files/images/2026/08/1f2e3d_logo.png',
        access: 'public',
        mimeType: 'image/png',
        size: 48213,
        originalName: 'shop-logo.png',
        createdAt: '2026-08-11T09:14:00.000Z',
        owner: { type: 'admin', id: '6511aabbccddeeff00112233', name: 'Ada Mensah' },
        usage: { referenceCount: 0, references: [] },
        ...overrides,
    };
}

function libraryMeta(overrides: Partial<FileLibraryMeta> = {}): Record<string, unknown> {
    return {
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
        referenceSampleCap: 2,
        publicUrlsConfigured: true,
        ...overrides,
    };
}

/**
 * Answers `/files/library` and **throws on anything else**.
 *
 * A catch-all that quietly answered every URL would let a screen fetching the
 * wrong path pass — and this repository has already been bitten once by a stub
 * that handed a shipment back to a product lookup.
 */
function stubLibrary(rows: LibraryFile[], meta: Partial<FileLibraryMeta> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/files/library')) {
            return successResponse(rows, { meta: libraryMeta(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * ⚠ **`held` takes an explicit narrow set, never `heldFixture(2)`.** A tier
 * fixture answers *"what does an Admin see"* and never *"what happens without
 * permission X"* — three tests in Phases C and D passed for the wrong reason
 * before that distinction was drawn. The default is the whole Developer set,
 * which is what `renderWithProviders` gives when `permissions` is omitted.
 *
 * The timezone is pinned rather than inherited from the runner: day filters are
 * resolved in the operator's zone, so a test that took the machine's would pass
 * or fail depending on where it ran.
 */
function render({ route = '/dashboard/media/library', held }: { route?: string; held?: string[] } = {}) {
    return renderWithProviders(<MediaLibrary />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        ...(held ? { permissions: { held: new Set(held) } } : {}),
    });
}

function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the request', () => {
    it('asks for the documented defaults, with one sort token', async () => {
        /**
         * ⚠ **`sort`, never `sortBy` + `sortOrder`.** jovi-mall's own file listing
         * takes the second form and this route does not — and because the
         * list-query schema is not `.strict()`, the wrong form answers `200` in
         * the default order with nothing saying the sort was ignored. That
         * silence is why the request is asserted rather than the rendering.
         */
        const calls = stubLibrary([libraryFile()]);
        render();

        await screen.findByText('shop-logo.png');

        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/files/library');
        expect(url.searchParams.get('sort')).toBe('-createdAt');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.has('sortBy')).toBe(false);
    });

    it('sends a chosen filter, and sends no empty one', async () => {
        const calls = stubLibrary([libraryFile()]);
        render({ route: '/dashboard/media/library?category=image' });

        await screen.findByText('shop-logo.png');

        const url = latest(calls);
        expect(url.searchParams.get('category')).toBe('image');
        // An empty `?search=` is a 400 on this service, not "no filter".
        expect(url.searchParams.has('search')).toBe(false);
    });
});

describe('the owner column — the "name and role" the ask names', () => {
    it('renders the name over the role, with the id copyable', async () => {
        stubLibrary([libraryFile()]);
        render();

        expect(await screen.findByText('Ada Mensah')).toBeInTheDocument();
        // `humaniseEnum` un-underscores and does not capitalise, which is the
        // convention the orphan listing already renders owner types with.
        expect(screen.getByText('admin')).toBeInTheDocument();
    });

    it('says a name is unavailable rather than substituting the id', async () => {
        /**
         * ⚠ `owner.name` is **`null`, never `""` and never the id**. Four things
         * produce it — `system` has no name by construction, the record was
         * deleted, the owner is mid-onboarding, the administrator was removed —
         * and the wire deliberately cannot tell them apart, because they render
         * the same way.
         */
        stubLibrary([libraryFile({ owner: { type: 'system', id: null, name: null } })]);
        render();

        expect(await screen.findByText('No name available')).toBeInTheDocument();
        expect(screen.getByText('system')).toBeInTheDocument();
    });

    it('distinguishes "no owner recorded" from "the name did not resolve"', async () => {
        // A legacy row with no owner at all is a different fact from an owner
        // whose name is missing, and collapsing them loses the only signal.
        stubLibrary([libraryFile({ owner: null })]);
        render();

        expect(await screen.findByText('Not recorded')).toBeInTheDocument();
        expect(screen.queryByText('No name available')).not.toBeInTheDocument();
    });
});

describe('the usage column — "is it used, and by what"', () => {
    it('leads with the true count and states what the sample left out', async () => {
        /**
         * ⚠ **`referenceCount` is the truth; `references` is capped.** A stock
         * photograph on four hundred products must not put four hundred rows in
         * one cell — and a page that quietly showed two of four would read as the
         * whole answer, which is the failure `meta.referenceSampleCap` exists to
         * prevent.
         */
        stubLibrary([
            libraryFile({
                usage: {
                    referenceCount: 4,
                    references: [
                        { entityType: 'ticket', entityId: 'a'.repeat(24), field: 'attachments', label: null },
                        { entityType: 'product', entityId: 'b'.repeat(24), field: 'media', label: null },
                    ],
                },
            }),
        ]);
        render();

        expect(await screen.findByText('4 records')).toBeInTheDocument();
        expect(screen.getByText(/and 2 more/)).toBeInTheDocument();
        expect(screen.getByText(/at most 2/)).toBeInTheDocument();
    });

    it('does not claim a file is orphaned just because nothing points at it', async () => {
        /**
         * ⚠ Zero references and *being on the orphan screen* are different facts.
         * That listing has a 24-hour floor and a sweep behind it; this is the live
         * count as of this request, and a file uploaded a minute ago reads zero
         * here while being perfectly healthy.
         */
        stubLibrary([libraryFile()]);
        render();

        expect(await screen.findByText('Nothing points at this')).toBeInTheDocument();
        expect(screen.getByText(/until something attaches it/)).toBeInTheDocument();
    });
});

describe('what the deployment can and cannot show', () => {
    it('blames the deployment, not the files, when no public URL can be built', async () => {
        /**
         * ⚠ `url: null` has **three** causes and only one is about the file: a
         * private tree, no reproducible `STORAGE_PROVIDER` on the wi-admin side,
         * or one whose URL form wi-admin cannot reproduce. `publicUrlsConfigured`
         * is the last two — so a page of missing thumbnails must not read as a
         * broken library.
         */
        stubLibrary([libraryFile({ url: null })], { publicUrlsConfigured: false });
        render();

        expect(await screen.findByText(/previews are not configured on this deployment/i)).toBeInTheDocument();
    });

    it('says nothing about configuration when the service said nothing', async () => {
        stubLibrary([libraryFile()]);
        render();

        await screen.findByText('shop-logo.png');
        expect(
            screen.queryByText(/previews are not configured on this deployment/i),
        ).not.toBeInTheDocument();
    });
});

describe('the two affordances, each on its own permission', () => {
    it('offers no delete without files.delete', async () => {
        /**
         * ⚠ **An explicit narrow set, not `heldFixture(2)`.** A tier fixture
         * answers *"what does an Admin see"* and never *"what happens without
         * permission X"* — three tests in Phases C and D passed for the wrong
         * reason before that distinction was drawn.
         */
        stubLibrary([libraryFile()]);
        render({ held: ['files.library.read'] });

        await screen.findByText('shop-logo.png');
        expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('offers the delete to a caller holding files.delete', async () => {
        stubLibrary([libraryFile()]);
        render({ held: ['files.library.read', 'files.delete'] });

        await screen.findByText('shop-logo.png');
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    it('warns before deleting a file that is still in use, and says how many', async () => {
        /**
         * ⚠ **The difference between this screen and the orphan listing.** There,
         * "nothing refers to this" is a property of the screen; here a row may be
         * live, so the count travels into the dialog. An operator confirming a
         * delete they were not told about is the failure this pins.
         */
        stubLibrary([
            libraryFile({
                usage: {
                    referenceCount: 3,
                    references: [
                        { entityType: 'product', entityId: 'b'.repeat(24), field: 'media', label: null },
                    ],
                },
            }),
        ]);
        render({ held: ['files.library.read', 'files.delete'] });

        await screen.findByText('shop-logo.png');
        await userEvent.click(screen.getByRole('button', { name: /delete/i }));

        expect(await screen.findByText(/3 live records still point at this file/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete anyway/i })).toBeInTheDocument();
    });

    it('does not raise the in-use warning on a file nothing points at', async () => {
        stubLibrary([libraryFile()]);
        render({ held: ['files.library.read', 'files.delete'] });

        await screen.findByText('shop-logo.png');
        await userEvent.click(screen.getByRole('button', { name: /delete/i }));

        await screen.findByText(/Type the file id to confirm/i);
        // ⚠ Narrow on purpose: the page's own description contains the words
        // "still points at it", so a looser matcher passes for the wrong reason.
        expect(screen.queryByText(/live records? still points? at this file/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
    });

    it('offers no upload without files.upload', async () => {
        stubLibrary([libraryFile()]);
        render({ held: ['files.library.read'] });

        await screen.findByText('shop-logo.png');
        expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument();
    });
});

describe('the picture, and what it costs', () => {
    it('renders a public image from the url the listing already handed over', async () => {
        // No audit row: nothing is disclosed that browsing did not already give.
        stubLibrary([libraryFile()]);
        render();

        const image = await screen.findByRole('img', { name: 'shop-logo.png' });
        expect(image).toHaveAttribute('src', libraryFile().url);
    });

    it('spends no audited read on a private image until it is asked for twice', async () => {
        /**
         * ⚠ **The rule the whole `ImageBox` primitive rests on, applied to a
         * browse table.** `GET /files/:fileId/content` writes an audit row on
         * every open, and a one-click reveal on a list is how twenty disclosures
         * get filed by an operator who was only scanning. The tile opens a
         * dialog; the dialog holds the reveal box. Neither gesture fetches.
         */
        const calls = stubLibrary([libraryFile({ url: null, access: 'authorized' })]);
        render();

        await screen.findByText('shop-logo.png');
        const before = calls.length;

        await userEvent.click(screen.getByRole('button', { name: /stored privately/i }));

        // Matched on the dialog's own sentence: `ImageBox` puts near-identical
        // wording in both its visible copy and its accessible name, so a looser
        // matcher finds two nodes and says nothing about which opened.
        expect(
            await screen.findByText(/reads the bytes through the platform/i),
        ).toBeInTheDocument();
        expect(calls).toHaveLength(before);
    });
});
