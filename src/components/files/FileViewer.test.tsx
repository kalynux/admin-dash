import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FileViewer } from '@/components/files/FileViewer';
import { heldFixture } from '@/test/fixtures';
import { __liveObjectUrls } from '@/test/setup';
import { errorResponse, renderWithProviders, stubFetch } from '@/test/utils';
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

function bytes(body = 'JPEGBYTES', headers: Record<string, string> = {}) {
    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', ...headers },
    });
}

/** Support holds `files.content.read` — that was the whole argument at BR-011. */
const asSupport = { permissions: { held: heldFixture(3) } };

describe('opening a private file', () => {
    it('fetches nothing until the operator asks', async () => {
        /**
         * ⚠ **The load-bearing assertion in this file.** Every open writes an
         * audit row, and that row is the entire reason Support may hold this
         * permission. Fetching on mount would file a disclosure against an
         * operator who merely scrolled past a shipment — the trail would read as
         * forty deliberate reads in an afternoon when nobody looked at anything,
         * which destroys the only signal the row exists to carry.
         */
        const calls = stubFetch(() => bytes());

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);

        expect(await screen.findByRole('button', { name: /open the file/i })).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('says the open is recorded before it happens, not after', async () => {
        stubFetch(() => bytes());

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);

        expect(await screen.findByText(/recorded against your account/i)).toBeInTheDocument();
    });

    it('renders the bytes as an image once asked', async () => {
        const calls = stubFetch(() => bytes());

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        const image = await screen.findByRole('img', { name: /proof-6670\.jpg/i });
        expect(image).toHaveAttribute('src', expect.stringMatching(/^blob:/));
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(`/files/${PROOF.id}/content`);
    });

    it('revokes the object url when it unmounts', async () => {
        // Otherwise the blob is pinned for the lifetime of the document, and on a
        // busy queue that is an operator's whole session holding every proof
        // photo they opened.
        stubFetch(() => bytes());

        const view = renderWithProviders(<FileViewer file={PROOF} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));
        await screen.findByRole('img');

        expect(__liveObjectUrls()).toHaveLength(1);
        view.unmount();
        await waitFor(() => expect(__liveObjectUrls()).toHaveLength(0));
    });
});

describe('the capability refusal', () => {
    it('reads as a state and offers no retry', async () => {
        /**
         * ⚠ `409 FILE_CONTENT_NOT_SUPPORTED` is a **configuration state, not an
         * outage**: on a storage provider that cannot read bytes it is the
         * permanent answer for every file, so a retry can never succeed. A retry
         * button here sends an operator round a loop, and an error banner sends
         * them hunting an incident that is not happening.
         */
        stubFetch(() =>
            errorResponse(409, 'FILE_CONTENT_NOT_SUPPORTED', {
                category: 'business_rule',
                details: { platformCode: 'STORAGE_DOWNLOAD_NOT_SUPPORTED' },
            }),
        );

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        expect(await screen.findByText(/cannot display stored files/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('does offer a retry for an ordinary failure, which a retry can fix', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});

describe('a truncated transfer', () => {
    it('says so rather than passing half a photograph off as the evidence', async () => {
        /**
         * ⚠ The route is a proxied stream, so once the first byte is sent the
         * status line is committed and a later failure closes the connection
         * instead of answering a 5xx. `Content-Length` is forwarded precisely so
         * this is detectable — a short body means the transfer broke, not that
         * the file is small.
         */
        stubFetch(() => bytes('half', { 'Content-Length': '214880' }));

        renderWithProviders(<FileViewer file={PROOF} />, asSupport);
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        expect(await screen.findByText(/did not arrive complete/i)).toBeInTheDocument();
        // Still shown — the operator decides whether a partial image is useful.
        expect(screen.getByRole('img')).toBeInTheDocument();
    });
});

describe('a file that is not an image', () => {
    it('describes it instead of rendering a broken image', async () => {
        // The route serves any tree, and `digital/` holds product files as
        // likely to be a zip as a picture. `Content-Type` is the authority.
        stubFetch(() => bytes('PK', { 'Content-Type': 'application/zip' }));

        renderWithProviders(
            <FileViewer file={{ ...PROOF, mimeType: 'application/zip' }} />,
            asSupport,
        );
        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        expect(await screen.findByText(/not something this screen can display/i)).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});

describe('without the permission', () => {
    it('offers no button at all', () => {
        // Holding it is necessary and never sufficient, but not holding it is
        // conclusive — there is nothing to offer.
        renderWithProviders(<FileViewer file={PROOF} />, {
            permissions: { held: new Set(['files.resolve']) },
        });

        expect(screen.queryByRole('button', { name: /open the file/i })).not.toBeInTheDocument();
        expect(screen.getByText(/needs a permission this account does not hold/i)).toBeInTheDocument();
    });
});
