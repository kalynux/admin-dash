import { imageUrlProblem } from '@/lib/article-body';
import type { ArticleCover } from '@/types/content.types';

/** The cover as it is being typed — three strings, because two of them are number inputs. */
export interface CoverDraft {
    url: string;
    width: string;
    height: string;
}

export const EMPTY_COVER_DRAFT: CoverDraft = { url: '', width: '', height: '' };

/**
 * Read a draft the way `CoverSchema` will: a url that is http(s) or an internal
 * path, and positive integer dimensions.
 *
 * `empty` is a legitimate answer — an article may have no cover — and is kept
 * apart from `cover: null` on an incomplete one, so a caller can tell "nothing
 * asked for" from "asked for and not finished".
 */
export function readCoverDraft(draft: CoverDraft): {
    empty: boolean;
    urlProblem: string | null;
    cover: ArticleCover | null;
} {
    const url = draft.url.trim();
    if (url.length === 0) return { empty: true, urlProblem: null, cover: null };

    const urlProblem = imageUrlProblem(url);
    const width = Number(draft.width);
    const height = Number(draft.height);
    const dimensionsValid =
        Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;

    return {
        empty: false,
        urlProblem,
        cover: urlProblem === null && dimensionsValid ? { url, width, height } : null,
    };
}
