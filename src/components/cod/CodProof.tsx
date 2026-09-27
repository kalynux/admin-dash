import { Camera } from 'lucide-react';

import { NotSet } from '@/components/common/DefinitionList';
import { FileViewer } from '@/components/files/FileViewer';
import { ImageBox } from '@/components/files/ImageBox';
import { isViewableImage, type FileDetail } from '@/types/files.types';

/**
 * The photo attached to a COD declaration — a receipt, a transfer screenshot, or
 * the hand-over itself.
 *
 * Contract: [FRONTEND-CHANGELOG-cod-cash-proof.md](../../../api-doc/admin/FRONTEND-CHANGELOG-cod-cash-proof.md)
 * and [cod.md](../../../api-doc/admin/api/cod.md). Since 2026-09-27 this, not the
 * `reference`, is **what an operator checks before pressing Confirm**.
 *
 * ── ⚠ A click, never a mount ─────────────────────────────────────────────────
 * `cod-proofs/` is a private tree, so `url` is always `null` and the bytes come
 * only from `GET /files/:fileId/content` — which writes an audit row on every
 * open. `ImageBox` and `FileViewer` both wait for the click; that is inherited,
 * and nothing here may add an eager fetch or a preloaded thumbnail.
 *
 * ── `key={proof.id}` is load-bearing ─────────────────────────────────────────
 * Both children change files by remounting (see `FileViewer`'s header). A
 * re-read that brought a different proof must not render one frame of the old
 * photograph under the new record — on a cash dispute that is the one wrong
 * thing this could show.
 *
 * ── `null` is not a failure and not a reason to reject ───────────────────────
 * One-step deposits carry no declaration to prove, and anything declared before
 * 2026-09-27 predates the rule. So it reads as a plain absence, never a warning.
 */
export function CodProof({
    proof,
    alt,
    className = 'max-w-sm',
}: {
    proof: FileDetail | null;
    alt: string;
    className?: string;
}) {
    if (!proof) return <NotSet>No photo attached</NotSet>;

    // The resolve's own type decides, without spending an audited read to find
    // out — the same split `ResolvedImageBox` makes. The declaring apps upload
    // images, but the content route serves any file and a PDF receipt is not a
    // broken image.
    if (!isViewableImage(proof)) {
        return <FileViewer key={proof.id} file={proof} />;
    }

    return <ImageBox key={proof.id} file={proof} alt={alt} className={className} />;
}

/**
 * The list's "has photo" mark. **Fetches nothing** — a list row opening its
 * proof would file an audit row per row an operator scrolled past.
 */
export function CodProofIndicator({ proof }: { proof: FileDetail | null }) {
    if (!proof) return <span className="text-muted-foreground">—</span>;

    return (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
            <Camera className="size-4" aria-hidden />
            Photo
        </span>
    );
}
