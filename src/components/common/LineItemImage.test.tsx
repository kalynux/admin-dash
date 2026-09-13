import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { LineItemImage } from '@/components/common/LineItemImage';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FileDetail } from '@/types/files.types';

const PUBLIC_IMAGE: FileDetail = {
    id: '6612aabbccddeeff00112233',
    key: 'products/6660/plantain-1kg.jpg',
    url: 'https://cdn.example.com/products/6660/plantain-1kg.jpg',
    access: 'public',
    mimeType: 'image/jpeg',
    size: 84213,
    originalName: 'plantain.jpg',
};

function show(image: FileDetail | null) {
    // Nothing here should reach the network. The throwing stub is the assertion:
    // this component replaced a lookup, and it must not have grown a new one.
    const calls = stubFetch((call) => {
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<LineItemImage image={image} alt="this item" />, {
        permissions: { held: heldFixture(3) },
    });

    return calls;
}

/**
 * 🔴 **This component exists because a lookup was deleted.**
 *
 * Order and shipment items used to name a product by id and carry no media, so
 * both screens resolved `GET /vendors/:vendorId/products/:productId` per
 * distinct listing — bounded, capped, permission-gated, six states. BR-017 put
 * `items[].image` on both payloads and the backend said to drop it. What is left
 * is three branches and no request at all.
 */
describe('a picture that came with the payload', () => {
    it('renders it immediately, asking for nothing', () => {
        const calls = show(PUBLIC_IMAGE);

        expect(screen.getByRole('img', { name: /plantain\.jpg/i })).toHaveAttribute(
            'src',
            PUBLIC_IMAGE.url,
        );
        expect(calls).toHaveLength(0);
    });

    /**
     * ⚠ The `src` rule: **the resolve itself was the disclosure.** Product media
     * is a public tree and the payload already handed the URL over, so nothing
     * is disclosed by drawing it and no audit row is written. That is the
     * opposite call from a ticket attachment, where the picture is a customer's
     * upload and the open is worth a row in the trail.
     */
    it('writes no audit row, because there is nothing left to consent to', () => {
        show(PUBLIC_IMAGE);

        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
    });

    it('falls back to the caller’s alt when the file has no original name', () => {
        show({ ...PUBLIC_IMAGE, originalName: null });
        expect(screen.getByRole('img', { name: 'this item' })).toBeInTheDocument();
    });
});

describe('a listing whose owner is over their storage cap', () => {
    /**
     * 🔴 **The branch these tests guarded has been DELETED, because its premise was
     * false — and this block asserted the premise.**
     *
     * It said a `quota_blocked` file must not reach `ResolvedImageBox`, because the
     * audited route *"offered an open that cannot succeed"* and would spend a
     * disclosure *"for an image nobody could see"*. That came from
     * [`files.md`](../../../api-doc/admin/api/files.md) — *"the content route
     * will not help you either"* — and it was wrong: the route answers `200` with
     * the bytes for a blocked file in every tree (BR-023, measured 2026-09-09;
     * the clause was deleted upstream on 2026-09-12).
     *
     * ⚠ **These tests passed while asserting it**, because the stub they ran against
     * was built from the same sentence. That is the `/content` lesson again: a
     * transcription and a test written from the transcription agree with each other.
     *
     * So a blocked file now takes the ordinary addressless path — resolve, then the
     * audited open on click — and the billing fact is drawn by `ImageBox` beside the
     * affordance. What survives is the assertion that it must never read as "no
     * picture", because the listing has one.
     */
    const BLOCKED: FileDetail = { ...PUBLIC_IMAGE, url: null, access: 'quota_blocked' };

    /**
     * The quota case is the one place this component DOES reach the network, so it
     * needs its own stub — `show()`'s throwing one is the guard for every other
     * branch and must stay that way.
     */
    function showBlocked() {
        const calls = stubFetch((call) => {
            if (call.url.includes(`/files/${BLOCKED.id}`)) return successResponse(BLOCKED);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<LineItemImage image={BLOCKED} alt="this item" />, {
            permissions: { held: heldFixture(3) },
        });

        return calls;
    }

    it('resolves and offers the audited open, because the open succeeds', async () => {
        showBlocked();

        expect(
            await screen.findByRole('button', { name: /click to view/i }),
        ).toBeInTheDocument();
    });

    it('says a storage limit is the reason, beside the affordance', async () => {
        showBlocked();

        expect(await screen.findByText(/over their plan's storage cap/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /click to view/i })).toBeInTheDocument();
    });

    it('does not claim the line has no picture, because it has one', async () => {
        // "No picture" is the branch above this and means something different:
        // there is no image on the listing. Here there is, and it is openable.
        showBlocked();

        await screen.findByRole('button', { name: /click to view/i });
        expect(screen.queryByText(/no picture/i)).not.toBeInTheDocument();
    });
});

describe('the two branches that are not a picture', () => {
    /**
     * ⚠ Not a failure. A digital line, media swept by the orphan cleanup, a
     * product deleted since the order, a draft that never had one — all ordinary.
     * Named rather than left as an empty square, which reads as "still loading".
     */
    it('says a line has no picture rather than drawing an empty tile', () => {
        show(null);
        expect(screen.getByText(/no picture/i)).toBeInTheDocument();
    });

    /**
     * ⚠ **All three conditions, not any one of them.** A public tree legitimately
     * holds PDFs and video, and `url !== null` says nothing about the bytes. A
     * private-tree file has no URL to render at all, so it goes through the
     * audited content route — which asks first, and should be unreachable here.
     * It exists because "should be" is not a guarantee, and a blank tile is the
     * worst of the three.
     */
    it('sends a file with no public URL through the audited route, which asks', () => {
        const calls = stubFetch(() => successResponse({ ...PUBLIC_IMAGE, url: null }));

        renderWithProviders(
            <LineItemImage
                image={{ ...PUBLIC_IMAGE, url: null, access: 'authorized' }}
                alt="this item"
            />,
            { permissions: { held: heldFixture(3) } },
        );

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        // The resolve may run — it is unaudited and held by every tier — but the
        // bytes must not, and nothing is on screen until a click.
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);
    });
});
