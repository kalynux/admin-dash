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

describe('a file blocked on its owner’s storage quota', () => {
    /**
     * 🔴 **This block asserted the opposite of the truth until 2026-09-09, and it
     * passed the whole time — which is the lesson worth keeping.**
     *
     * It was written from [`files.md`](../../../api-doc/admin/api/files.md),
     * which said of a quota-blocked file: *"`url` is `null`, and the content route
     * will not help you either."* Every assertion here followed from that sentence,
     * and every one passed, **because the tests were run against a stub built from
     * the same sentence.** A stub cannot contradict the belief that produced it.
     *
     * Measured against a running service, `GET /files/:fileId/content` answers
     * `200` with the real bytes for a quota-blocked file — on a public `images/`
     * key and on private `shipments/` and `digital/` keys alike. `quota_blocked`
     * withholds the **address**, never the bytes. Filed as BR-023; see
     * [VERIFICATION-2026-09-09-LIVE](../../../api-doc/VERIFICATION-2026-09-09-LIVE.md) § 7.3.
     *
     * So the open is offered and it works. What survives from the old block — and
     * it was always the sound half — is that a blocked file must never read as
     * *missing*, *broken* or *private*. Those assertions are unchanged below.
     */
    const BLOCKED: FileDetail = {
        ...PROOF,
        key: 'images/2026/08/1f2e3d_logo.png',
        access: 'quota_blocked',
    };

    /** A stub that FAILS the test if anything is requested before a click. */
    function noRequests() {
        return stubFetch((call) => {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers the audited open, because it succeeds on a blocked file', () => {
        const calls = noRequests();

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);

        expect(screen.getByRole('button', { name: /click to view/i })).toBeInTheDocument();
        // ⚠ Still nothing on mount: the click is the consent, exactly as for any
        // other file. Offering the button is not the same as spending the row.
        expect(calls).toHaveLength(0);
    });

    it('opens the bytes when clicked, and files the row that pays for them', async () => {
        // 🔴 The assertion the old block could not have written. This is the one
        // that would have caught BR-023 had it existed, because it describes what
        // the service does rather than what the page said it does.
        const calls = stubFetch(() => bytes());

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);
        await userEvent.click(screen.getByRole('button', { name: /click to view/i }));

        expect(await screen.findByRole('img', { name: 'Shop logo' })).toBeInTheDocument();
        expect(calls[0].url).toContain(`/files/${BLOCKED.id}/content`);
    });

    it('says the owner is over a storage cap, beside the affordance rather than instead of it', () => {
        // ⚠ Both, in one render. The billing fact is why there was no thumbnail;
        // the button is what still works. Dropping either one is a wrong answer:
        // without the note the operator cannot act, and without the button the
        // dashboard is hiding bytes it can fetch.
        noRequests();

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);

        expect(screen.getByText(/over their plan's storage cap/i)).toBeInTheDocument();
        expect(screen.getByText(/opening it still works/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /click to view/i })).toBeInTheDocument();
    });

    it('never claims the file cannot be shown, which is what the old copy said', () => {
        // The regression guard for BR-023. `QUOTA_BLOCKED_COPY.body` used to end
        // "so this file cannot be shown", drawn at six sites from one constant.
        noRequests();

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);

        expect(screen.queryByText(/cannot be shown|will not display/i)).not.toBeInTheDocument();
    });

    it('never calls it missing, broken, or private', () => {
        /**
         * ⚠ **The three renderings `files.md` rules out by name**, and the half of
         * the original block that was always right. "Missing" reads as data loss, a
         * broken image reads as a platform incident, and "private" reads as
         * permanent — each sends an operator somewhere that cannot resolve it, and
         * the file is neither deleted nor faulty nor in a private tree.
         */
        noRequests();

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);

        expect(screen.queryByText(/missing|cleaned up|no picture/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/private/i)).not.toBeInTheDocument();
    });

    it('offers no retry, because there is nothing that failed to retry', () => {
        noRequests();

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, asSupport);

        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
        // Still a box — a state that collapses to a line of text undoes the
        // layout this component exists to hold still.
        expect(frames()).toHaveLength(1);
    });

    it('explains the missing permission rather than the storage cap, when that is the blocker', () => {
        // ⚠ Reversed on 2026-09-09. This used to assert that the permission was
        // "irrelevant here", on the reasoning that *nobody* can open a blocked
        // file — true only under the false premise. Somebody can, so a caller who
        // holds no `files.content.read` is refused for the ORDINARY reason, and the
        // ordinary sentence is the honest one.
        stubFetch((call) => {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<ImageBox file={BLOCKED} alt="Shop logo" />, {
            permissions: { held: new Set(['files.resolve']) },
        });

        expect(
            screen.getByText(/needs a permission this account does not hold/i),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
    });

    it('takes precedence over the private tree it may also be in', () => {
        /**
         * ⚠ **The wire ranks `quota_blocked` above `authorized`**, because it is
         * stamped per file rather than derived from the tree. A blocked delivery
         * proof therefore arrives as `quota_blocked` — and the box must read the
         * value it was given rather than inferring a tree from the key.
         *
         * The *rendering* no longer differs between the two — both offer the open —
         * so what this now pins is the wording: a blocked private file must be
         * described by its billing state, not by its tree.
         */
        stubFetch((call) => {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(
            <ImageBox
                file={{ ...PROOF, access: 'quota_blocked' }}
                alt="Delivery proof"
            />,
            asSupport,
        );

        expect(screen.getByText(/over their plan's storage cap/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /click to view/i })).toBeInTheDocument();
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
