import { ImageOff } from 'lucide-react';

import {
    IMAGE_BOX_RATIO,
    ImageBox,
    ImageBoxNotice,
} from '@/components/files/ImageBox';
import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { formatBytes } from '@/lib/format';
import { isDisplayableImage, type FileDetail } from '@/types/files.types';

/**
 * One line item's picture, from the picture the payload already carried.
 *
 * ── ⚠ This replaced a lookup, and that is the point ──────────────────────────
 * Order items and shipment items used to name a product by id and carry no media
 * at all, so both screens resolved `GET /vendors/:vendorId/products/:productId`
 * **per distinct product** through `useVendorProducts` — a bounded, capped,
 * permission-gated fan-out with six states, five of which were not failures.
 * BR-017 put `items[].image` on both payloads and the backend's answer said
 * plainly: *drop the N+1*. The hook, its cap, its `forbidden`/`omitted`/
 * `unresolved` states and the component that drew them are all gone, because the
 * question they answered is no longer asked.
 *
 * ⚠ **Resolution is batched server-side** — three reads for a whole `items`
 * array however long it is. There is nothing left for a client to bound.
 *
 * ── ⚠ Rendered from `url`, so no audit row ───────────────────────────────────
 * Product media lives in a **public** tree and arrives already resolved on the
 * payload, so `<ImageBox src>` displays it at once: nothing is disclosed here
 * that the read did not already hand over. That is the `src` rule — *the resolve
 * itself was the disclosure* — and it is the opposite call from ticket
 * attachments, where the picture is a customer's upload and the open is worth a
 * row in the trail.
 *
 * The `url: null` fallback goes through `ResolvedImageBox` — the audited content
 * route, waiting for a click — and should be unreachable on a public tree. It
 * exists because "should be" is not a guarantee and a blank tile is the worst of
 * the four.
 *
 * ⚠ **One `url: null` case must NOT reach that fallback**, and it is a public
 * tree: `access: "quota_blocked"`, the owner over their plan's storage cap. The
 * content route cannot serve those either, so the audited path would resolve the
 * file twice and then offer an open that spends an audit row to fail. It is a
 * *billing* state, it is temporary, and it gets its own branch above the
 * displayability test.
 *
 * ── ⚠ The primary image, never the gallery ───────────────────────────────────
 * The payload carries one picture per line and says so. The old component opened
 * a lightbox that walked the whole listing's gallery with arrow keys; that came
 * from having fetched the listing, and it went with the lookup. A line item is a
 * record of what was sold, and one picture of the object is what it needs — the
 * product screen is where a gallery belongs.
 *
 * ⚠ **Variant-preferred, and resolved LIVE rather than snapshotted.** A line
 * naming a `variantId` shows that variant's own media, so a red shirt cannot
 * show the blue one. The picture is the listing's *current* one while `title`,
 * `sku` and `price` are snapshots — deliberate: those are terms of the sale and
 * must not drift, a picture is an aid to recognising the object.
 */
export function LineItemImage({
    image,
    alt,
    className,
    ratio = IMAGE_BOX_RATIO,
}: {
    /** `items[].image`. `null` is ordinary — see below. */
    image: FileDetail | null;
    /** What the picture is *of*, for the screen reader and the lightbox. */
    alt: string;
    className?: string;
    ratio?: number;
}) {
    /*
      ⚠ Not a failure, and the reasons are ordinary: a digital line, a listing
      whose media was swept by the orphan cleanup, a product deleted since the
      order, a draft that never had one. Named rather than left as an empty
      square, because a blank tile reads as "still loading".
    */
    if (!image) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                className={className}
                icon={ImageOff}
                title="No picture"
                body="This line has no image on the listing behind it."
            />
        );
    }

    const label = image.originalName?.trim() || alt;

    /*
      🔴 **A `quota_blocked` branch stood here until 2026-09-09 and has been
      removed, because its premise was false.** It returned a billing placeholder
      rather than letting the file reach `ResolvedImageBox`, on the grounds that
      the audited route *"offers an open that cannot succeed"* and would spend a
      disclosure *"on a request that was never going to return an image"*.

      The request returns the image. `GET /files/:fileId/content` answers `200`
      with the bytes for a quota-blocked file in every tree — BR-023, measured
      against a running service, contradicting what `files.md` said at the time.
      So a blocked file
      now takes the ordinary path below: `url` is `null`, so `isDisplayableImage`
      is false, so it resolves through the audited box — which offers the open and
      says *why* there was no thumbnail, via `QUOTA_BLOCKED_COPY.note`.

      ⚠ The labelling argument that justified the branch was always sound and is
      not lost: a blocked file must never read as "no picture", because the listing
      has one. It is now `ImageBox`'s job, stated once, for all six surfaces.
    */

    /*
      ⚠ All three conditions, not any one of them: a public tree legitimately
      holds PDFs and video, and `url !== null` alone says nothing about the
      bytes. `isDisplayableImage` is the both-conditions rule from `files.md`,
      and the field is a full `FileDetail` rather than a URL string exactly so a
      client is not left guessing at the first two.
    */
    if (!isDisplayableImage(image)) {
        return (
            <ResolvedImageBox
                fileId={image.id}
                alt={label}
                ratio={ratio}
                className={className}
            />
        );
    }

    return (
        <ImageBox
            src={image.url as string}
            alt={label}
            ratio={ratio}
            className={className}
            caption={[image.originalName, image.mimeType, formatBytes(image.size)]
                .filter(Boolean)
                .join(' · ')}
        />
    );
}
