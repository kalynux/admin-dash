import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FileDetail } from '@/types/files.types';

const PROOF: FileDetail = {
    id: '6612a4f0c1a2b3d4e5f60719',
    key: 'shipments/2026/08/9c8b7a_proof.jpg',
    url: null,
    access: 'authorized',
    mimeType: 'image/jpeg',
    size: 214880,
    originalName: 'proof-6670.jpg',
};

/** Support holds `files.content.read` — that was the whole argument at BR-011. */
const asSupport = { permissions: { held: heldFixture(3) } };

/** Answers the resolve with `file` and the content route with bytes. */
function stub(file: FileDetail = PROOF) {
    return stubFetch((call) =>
        call.url.includes('/content')
            ? new Response('JPEGBYTES', {
                  status: 200,
                  headers: { 'Content-Type': file.mimeType },
              })
            : successResponse(file),
    );
}

describe('resolving a bare file id', () => {
    it('resolves on mount and stops there', async () => {
        /**
         * ⚠ **The load-bearing assertion in this file**, and it is about the
         * *order* of two requests rather than about either one.
         *
         * `GET /files/:fileId` is unaudited and held by every tier — resolving
         * an id you were already given discloses nothing new — which is exactly
         * why it may run on mount. `GET /files/:fileId/content` is neither: it
         * is a second permission and the only audited read in the family, so it
         * waits for a click. If this ever fired both, every screen carrying a
         * `*FileId` would file a disclosure for an operator who scrolled past.
         */
        const calls = stub();

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);
        await screen.findByRole('button', { name: /click to view/i });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(`/files/${PROOF.id}`);
        expect(calls[0].url).not.toContain('/content');
    });

    it('reads the bytes only once the box is clicked', async () => {
        const calls = stub();

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /click to view/i }));

        expect(await screen.findByRole('img')).toHaveAttribute(
            'src',
            expect.stringMatching(/^blob:/),
        );
        expect(calls).toHaveLength(2);
        expect(calls[1].url).toContain(`/files/${PROOF.id}/content`);
    });

    it('names the image from the resolve when the caller gives no alt', async () => {
        stub();

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /click to view/i }));

        expect(await screen.findByRole('img', { name: 'proof-6670.jpg' })).toBeInTheDocument();
    });

    it("prefers the caller's alt over the filename", async () => {
        stub();

        renderWithProviders(
            <ResolvedImageBox fileId={PROOF.id} alt="Delivery proof" />,
            asSupport,
        );
        await userEvent.click(await screen.findByRole('button', { name: /click to view/i }));

        expect(await screen.findByRole('img', { name: 'Delivery proof' })).toBeInTheDocument();
    });
});

describe('when the resolve does not answer a file', () => {
    it('reads a 404 as a sweep rather than as a client bug', async () => {
        // Files are soft-deleted and swept, so a record legitimately outlives the
        // picture it points at. Render the absence; do not raise an error banner
        // over an ordinary state.
        stubFetch(() => errorResponse(404, 'FILE_NOT_FOUND', { category: 'not_found' }));

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);

        expect(await screen.findByText(/has been cleaned up/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry for an ordinary failure', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});

describe('a file that is not an image', () => {
    it('hands it to the metadata card instead of drawing a box for it', async () => {
        /**
         * The content route serves any tree and a `digital/` file is as likely
         * to be a zip as a picture. The resolve already said which this is, so
         * the right card can be offered **without** spending an audited read to
         * find out.
         */
        stub({ ...PROOF, mimeType: 'application/zip', originalName: 'product.zip' });

        renderWithProviders(<ResolvedImageBox fileId={PROOF.id} />, asSupport);

        expect(await screen.findByRole('button', { name: /open the file/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
    });
});
