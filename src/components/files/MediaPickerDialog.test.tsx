import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
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

/** Answers `/files/library` and throws on anything else. */
function stubLibrary(rows: LibraryFile[], meta: Partial<FileLibraryMeta> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/files/library')) {
            return successResponse(rows, {
                meta: {
                    total: rows.length,
                    page: 1,
                    limit: 12,
                    pages: rows.length > 0 ? 1 : 0,
                    referenceSampleCap: 5,
                    publicUrlsConfigured: true,
                    ...meta,
                },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function open(
    props: Partial<React.ComponentProps<typeof MediaPickerDialog>> = {},
    held?: string[],
) {
    const onSelect = props.onSelect ?? vi.fn();
    renderWithProviders(
        <MediaPickerDialog open onOpenChange={() => {}} {...props} onSelect={onSelect} />,
        held ? { permissions: { held: new Set(held) } } : {},
    );
    return onSelect;
}

describe('what the picker is allowed to show', () => {
    it('asks only for the administration’s own uploads', async () => {
        /**
         * ⚠ **`ownerType=admin` is the specification, not a default.** It is the
         * one parameter that makes *"only files uploaded by the administration"*
         * true, and it is deliberately not offered as a filter — widening it would
         * turn a picker into a second door onto every customer's uploaded
         * photographs, reachable from a blog editor.
         */
        const calls = stubLibrary([libraryFile()]);
        open();

        await screen.findByText('shop-logo.png');

        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toBe('/api/v1/files/library');
        expect(url.searchParams.get('ownerType')).toBe('admin');
        expect(url.searchParams.get('category')).toBe('image');
    });

    it('drops the image filter when the caller does not want one', async () => {
        // The ticket attachment takes any file, not only pictures.
        const calls = stubLibrary([libraryFile()]);
        open({ imagesOnly: false });

        await screen.findByText('shop-logo.png');

        expect(new URL(calls[0].url, 'http://localhost').searchParams.has('category')).toBe(false);
    });

    it('hands the whole file back, so both a url and an id are available', async () => {
        const onSelect = vi.fn();
        stubLibrary([libraryFile()]);
        open({ onSelect });

        await screen.findByText('shop-logo.png');
        await userEvent.click(screen.getByRole('button', { name: /shop-logo\.png/i }));

        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: FILE_ID }));
    });
});

describe('the blog’s constraint, which is real', () => {
    it('disables a file with no public address rather than hiding it', async () => {
        /**
         * ⚠ An article's `cover.url` and an `image` block's `url` are **stored
         * strings served to anonymous readers**, so a file with `url: null` is
         * unusable there and always will be. Filtering it out of the grid would
         * leave the operator on a short page unable to tell whether their file is
         * missing or merely unusable here — and only the second is something they
         * can act on.
         */
        const onSelect = vi.fn();
        stubLibrary([libraryFile({ url: null, access: 'authorized' })]);
        open({ requirePublicUrl: true, onSelect });

        const tile = await screen.findByRole('button', { name: /shop-logo\.png/i });
        expect(tile).toBeDisabled();
        expect(screen.getByText(/no public address/i)).toBeInTheDocument();

        await userEvent.click(tile);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('leaves the same file selectable where an id is what gets stored', async () => {
        // `POST …/attachments` takes a `fileId`, so a private file is perfectly
        // attachable — the blog is the one that cannot use it.
        stubLibrary([libraryFile({ url: null, access: 'authorized' })]);
        open({ requirePublicUrl: false });

        expect(await screen.findByRole('button', { name: /shop-logo\.png/i })).toBeEnabled();
    });

    it('says the deployment cannot build URLs, rather than blaming the files', async () => {
        stubLibrary([libraryFile({ url: null })], { publicUrlsConfigured: false });
        open();

        expect(
            await screen.findByText(/previews are not configured on this deployment/i),
        ).toBeInTheDocument();
    });
});

describe('two permissions, and neither implies the other', () => {
    it('makes no request at all without files.library.read', async () => {
        /**
         * ⚠ **Mounted behind the permission, not merely hidden by it.**
         * `useAsyncData` fires on mount, so rendering the browse subtree for a
         * caller who cannot browse would spend a request to be told `403` and then
         * draw the refusal — discovering capability by collecting 403s is exactly
         * what the contract tells clients not to do.
         *
         * ⚠ An explicit narrow set, never `heldFixture(2)`: every catalogued tier
         * that reaches this dialog holds `files.library.read`, so a tier fixture
         * cannot express its absence.
         */
        const calls = stubLibrary([libraryFile()]);
        open({}, ['files.upload']);

        // It opens on Upload — the only half this caller has — so the Library
        // tab is present, disabled, and its content is never mounted.
        await screen.findByLabelText(/choose a file/i);
        expect(screen.getByRole('tab', { name: /library/i })).toBeDisabled();
        expect(calls).toHaveLength(0);
    });

    it('explains the missing upload rather than offering a control that would 403', async () => {
        stubLibrary([libraryFile()]);
        open({}, ['files.library.read']);

        await screen.findByText('shop-logo.png');
        expect(screen.getByRole('tab', { name: /upload/i })).toBeDisabled();
    });

    it('says so plainly when the account holds neither', async () => {
        const calls = stubLibrary([libraryFile()]);
        open({}, ['files.resolve']);

        expect(
            await screen.findByText(/browsing and uploading files each need a permission/i),
        ).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('opens on the upload tab when that is the only half available', async () => {
        stubLibrary([libraryFile()]);
        open({}, ['files.upload']);

        expect(await screen.findByLabelText(/choose a file/i)).toBeInTheDocument();
    });
});

describe('the empty state', () => {
    it('does not read as "the feature is broken"', async () => {
        /**
         * The picker was blocked for a round on the reasoning that *a picker with
         * nothing to offer is worse than no picker*. Now that it can be empty
         * legitimately — nothing uploaded yet — the empty state has to say which
         * of the two it is.
         */
        stubLibrary([]);
        open();

        expect(await screen.findByText(/nothing has been uploaded yet/i)).toBeInTheDocument();
        expect(screen.getByText(/the upload tab puts the first file here/i)).toBeInTheDocument();
    });
});
