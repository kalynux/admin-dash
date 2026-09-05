import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImageBox } from '@/components/files/ImageBox';
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

/** The reserved box, whatever is drawn inside it. */
function frames() {
    return document.querySelectorAll('[data-slot="aspect-ratio"]');
}

describe('the reveal-on-click box', () => {
    it('fetches nothing until the operator clicks it', async () => {
        /**
         * ⚠ **The load-bearing assertion in this file.** Every open writes an
         * audit row, and that row is the entire reason Support may hold
         * `files.content.read`. Fetching on mount would file a disclosure
         * against an operator who merely scrolled past a shipment — and this
         * box is meant for lists and galleries, so the trail would read as forty
         * deliberate reads in an afternoon when nobody looked at anything, which
         * destroys the only signal the row exists to carry.
         *
         * The box's whole shape is designed around this: it reserves the layout
         * *without* the image, so nothing about the geometry is an argument for
         * fetching early.
         */
        const calls = stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);

        expect(await screen.findByRole('button', { name: /click to view/i })).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('says the open is recorded before it happens, not after', async () => {
        stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);

        expect(await screen.findByText(/recorded against your account/i)).toBeInTheDocument();
    });

    it('reserves the layout before anything is loaded', async () => {
        // The complaint this primitive answers: an image that arrives and *then*
        // takes its space pushes the paragraph under it down mid-sentence.
        stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);

        expect(frames()).toHaveLength(1);
    });

    it('reveals the image on the first click', async () => {
        const calls = stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        const image = await screen.findByRole('img', { name: 'Delivery proof' });
        expect(image).toHaveAttribute('src', expect.stringMatching(/^blob:/));
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(`/files/${PROOF.id}/content`);
    });

    it('opens the lightbox on a second click, without fetching again', async () => {
        const calls = stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));
        await userEvent.click(await screen.findByRole('button', { name: /full screen/i }));

        expect(await screen.findByRole('dialog')).toHaveAccessibleName('Delivery proof');
        // The bytes are already in hand — a second audit row here would record a
        // disclosure that never happened.
        expect(calls).toHaveLength(1);
    });

    it('revokes the object url when it unmounts', async () => {
        stubFetch(() => bytes());

        const view = renderWithProviders(
            <ImageBox file={PROOF} alt="Delivery proof" />,
            asSupport,
        );
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));
        await screen.findByRole('img', { name: 'Delivery proof' });

        expect(__liveObjectUrls()).toHaveLength(1);
        view.unmount();
        await waitFor(() => expect(__liveObjectUrls()).toHaveLength(0));
    });
});

describe('the direct-render variant', () => {
    it('renders an already-resolved url immediately and requests nothing', async () => {
        /**
         * ⚠ **No audit row, because nothing is disclosed that the resolve did
         * not already give.** This is the variant the media picker, the
         * orphan-file screen and the Media menu's own uploads use, and it is the
         * *only* one that may render without a click. If this ever started
         * fetching, those screens would file a row per thumbnail.
         */
        const calls = stubFetch(() => bytes());

        renderWithProviders(
            <ImageBox src="https://cdn.example.test/logo.png" alt="Vendor logo" />,
            asSupport,
        );

        expect(await screen.findByRole('img', { name: 'Vendor logo' })).toHaveAttribute(
            'src',
            'https://cdn.example.test/logo.png',
        );
        expect(calls).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
    });

    it('still opens the lightbox when it is clicked', async () => {
        stubFetch(() => bytes());

        renderWithProviders(
            <ImageBox src="https://cdn.example.test/logo.png" alt="Vendor logo" />,
            asSupport,
        );
        await userEvent.click(screen.getByRole('button', { name: /full screen/i }));

        expect(await screen.findByRole('dialog')).toHaveAccessibleName('Vendor logo');
    });
});

describe('the answers that are states rather than failures', () => {
    it('reads FILE_CONTENT_NOT_SUPPORTED as a configuration state and offers no retry', async () => {
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

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByText(/cannot display stored files/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
        // Still a box — a state that collapses to a line of text undoes the
        // layout this component exists to hold still.
        expect(frames()).toHaveLength(1);
    });

    it('reads FILE_NOT_FOUND as a sweep, not as an error', async () => {
        // Files are soft-deleted and swept, so a record legitimately outlives the
        // picture it points at. A shipment whose proof was swept still carries
        // the id, and that is a state to render rather than a bug to report.
        stubFetch(() => errorResponse(404, 'FILE_NOT_FOUND', { category: 'not_found' }));

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByText(/has been cleaned up/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('does offer a retry for an ordinary failure, which a retry can fix', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('says a truncated transfer is incomplete rather than passing it off as the evidence', async () => {
        /**
         * ⚠ The route is a proxied stream, so once the first byte is sent the
         * status line is committed and a later failure closes the connection
         * instead of answering a 5xx. `Content-Length` is forwarded precisely so
         * this is detectable — a short body means the transfer broke, not that
         * the file is small.
         */
        stubFetch(() => bytes('half', { 'Content-Length': '214880' }));

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByText(/did not arrive complete/i)).toBeInTheDocument();
        // Still shown — the operator decides whether a partial image is useful.
        expect(screen.getByRole('img', { name: 'Delivery proof' })).toBeInTheDocument();
    });

    it('believes Content-Type over the resolve when the bytes are not an image', async () => {
        // Two services' records of the same file can disagree, and what actually
        // arrived is the authority. A broken `<img>` is the wrong answer.
        stubFetch(() => bytes('PK', { 'Content-Type': 'application/zip' }));

        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByText(/is not an image/i)).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});

describe('without files.content.read', () => {
    it('explains, renders no control that would 403, and keeps the box', () => {
        // Holding it is necessary and never sufficient, but not holding it is
        // conclusive — there is nothing to offer. The shape stays so a row of
        // boxes does not reflow for an operator who can open none of them.
        renderWithProviders(<ImageBox file={PROOF} alt="Delivery proof" />, {
            permissions: { held: new Set(['files.resolve']) },
        });

        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
        expect(
            screen.getByText(/needs a permission this account does not hold/i),
        ).toBeInTheDocument();
        expect(frames()).toHaveLength(1);
    });
});
