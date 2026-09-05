import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FileUploadPanel } from '@/components/files/FileUploadPanel';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import {
    FILE_UPLOAD_MAX_BYTES,
    PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
    type FileDetail,
} from '@/types/files.types';

function uploaded(overrides: Partial<FileDetail> = {}): FileDetail {
    return {
        id: '6612a4f0c1a2b3d4e5f60718',
        key: 'images/2026/08/1f2e3d_cover.webp',
        url: 'http://localhost:8022/api/files/images/2026/08/1f2e3d_cover.webp',
        access: 'public',
        mimeType: 'image/webp',
        size: 48213,
        originalName: 'cover.png',
        ...overrides,
    };
}

/** A `File` of a stated size, without allocating one. */
function fileOf(name: string, bytes: number, type = 'image/png'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: bytes });
    return file;
}

function panel(onUploaded = vi.fn()) {
    renderWithProviders(<FileUploadPanel onUploaded={onUploaded} />);
    return onUploaded;
}

describe('what is checked before an audited write is spent', () => {
    it('refuses an over-size request without asking the server', async () => {
        /**
         * ⚠ **The ceiling is the WHOLE request body**, not the largest file —
         * multipart framing and every part count against it, so four 9 MiB images
         * are over it while none of them is. Checked here because a `413` is an
         * audited round trip to be told a number this client already knew.
         */
        const calls = stubFetch(() => successResponse({ files: [uploaded()] }, { status: 201 }));
        panel();

        await userEvent.upload(
            screen.getByLabelText(/choose a file/i),
            fileOf('huge.png', FILE_UPLOAD_MAX_BYTES + 1),
        );

        expect(screen.getByText(/over the .* limit on the whole request/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled();
        expect(calls).toHaveLength(0);
    });

    it('adds the parts together rather than checking them one at a time', async () => {
        const calls = stubFetch(() => successResponse({ files: [uploaded()] }, { status: 201 }));
        panel();

        const half = Math.ceil(FILE_UPLOAD_MAX_BYTES / 2) + 1;
        await userEvent.upload(screen.getByLabelText(/choose a file/i), [
            fileOf('a.png', half),
            fileOf('b.png', half),
        ]);

        expect(screen.getByText(/limit is the total, not the largest file/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

describe('what the operator is told', () => {
    it('warns that the upload is public BEFORE the file is chosen', async () => {
        /**
         * ⚠ An operator who uploads a customer's document here has **published**
         * it: jovi-mall files every part under a tree classified `public`, so the
         * address is unauthenticated and never expires. Said before the choice,
         * because afterwards there is nothing to undo.
         */
        stubFetch(() => successResponse({ files: [uploaded()] }, { status: 201 }));
        panel();

        expect(screen.getByText(/stored in a public tree/i)).toBeInTheDocument();
        expect(screen.getByText(/does not expire/i)).toBeInTheDocument();
    });

    it('names the file the platform refused, from details.violations', async () => {
        /**
         * ⚠ **Max files, field name and MIME type are published, not policed** by
         * wi-admin — it never parses the body — so a file that slips past this
         * client comes back as a delegated refusal. `error.code` is
         * `PLATFORM_OPERATION_REJECTED` for every one of those, which is why the
         * branch is on `details.platformCode`, and why the violations array is the
         * only thing that says *which* file.
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
        panel();

        // ⚠ A file the **browser** thinks is a PNG — which is the realistic
        // case, since `accept` is a hint to the file dialog and a renamed file
        // passes it. jovi-mall sniffs the actual bytes; this client cannot.
        await userEvent.upload(
            screen.getByLabelText(/choose a file/i),
            fileOf('notes.txt', 12, 'image/png'),
        );
        await userEvent.click(screen.getByRole('button', { name: /upload/i }));

        expect(await screen.findByText(/notes\.txt — type not accepted/i)).toBeInTheDocument();
    });

    it('renders an unrecognised violation entry rather than dropping it', async () => {
        // `details` is scrubbed and forwarded from another service and its element
        // shape is not pinned by anything this repository can diff. A refusal the
        // operator cannot read is worse than an ugly one.
        stubFetch(() =>
            errorResponse(400, 'PLATFORM_OPERATION_REJECTED', {
                category: 'business_rule',
                details: {
                    platformCode: PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
                    violations: ['too many files'],
                },
            }),
        );
        panel();

        await userEvent.upload(screen.getByLabelText(/choose a file/i), fileOf('a.png', 12));
        await userEvent.click(screen.getByRole('button', { name: /upload/i }));

        expect(await screen.findByText('too many files')).toBeInTheDocument();
    });
});

describe('the successful write', () => {
    it('hands back what was STORED, not what was sent', async () => {
        /**
         * ⚠ jovi-mall sniffs the real type and **converts PNG to WebP** by its own
         * policy, so a caller that recorded `image/png` because that is what it
         * picked would have the wrong type on file — and a URL whose extension
         * disagreed with it.
         */
        stubFetch(() => successResponse({ files: [uploaded()] }, { status: 201 }));
        const onUploaded = panel();

        await userEvent.upload(screen.getByLabelText(/choose a file/i), fileOf('cover.png', 12));
        await userEvent.click(screen.getByRole('button', { name: /upload/i }));

        await vi.waitFor(() =>
            expect(onUploaded).toHaveBeenCalledWith([
                expect.objectContaining({ mimeType: 'image/webp' }),
            ]),
        );
    });
});
