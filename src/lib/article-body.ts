/**
 * The article-body rules, client side.
 *
 * Source: [`api-doc/admin/article-blocks.ts`](../../api-doc/admin/article-blocks.ts),
 * a byte-identical mirror of wi-admin's own Zod validator.
 *
 * ── Why validate here at all, when the server already does ────────────────────
 * Because the server's refusal is `400 VALIDATION_ERROR` on a **whole body**,
 * and a body is up to four hundred blocks. An editor who mistypes one heading
 * id gets one message about one array, and has to find the block themselves.
 * These functions say *which block*, so the mistake is caught next to where it
 * was made.
 *
 * ⚠ **This is a convenience, never the gate.** The schema is `.strict()` and the
 * server is the only thing standing between an editor and a public marketing
 * page — jovi-mall stores `body` as Mongoose `Mixed` and validates nothing on
 * the read side. So a save still goes through the API and a `400` is still
 * rendered; nothing here is permitted to *pass* a body the server would refuse.
 * When the two disagree, the server is right and this file is the bug.
 */

import {
    ARTICLE_BODY_MAX_BLOCKS,
    CONTENT_LOCALES,
    HEADING_ID_PATTERN,
    type ArticleBlock,
    type ArticleBody,
    type RichText,
} from '@/types/content.types';

/** One problem, and the block it is on. `blockIndex` is `null` for a whole-body rule. */
export interface BodyProblem {
    blockIndex: number | null;
    message: string;
}

// ─── Links ────────────────────────────────────────────────────────────────────

/** `/fr/pricing`, `/en/faq`… — the mistake rule 1 exists to catch. */
const LOCALE_PREFIXED = new RegExp(`^/(${CONTENT_LOCALES.join('|')})(/|$)`);

/**
 * **Rule 1 · Internal links carry no locale prefix.**
 *
 * Write `/pricing`, not `/fr/pricing` — the renderer localizes it, so a prefixed
 * path renders as `/fr/fr/pricing`. That is a broken link on a published page
 * and it is **invisible in the editor**, which is exactly why it is refused
 * rather than left to review.
 *
 * Accepted: `https:`, `http:`, `mailto:`, a `#fragment`, and an internal
 * `/path`. Refused: `javascript:`, `data:`, protocol-relative `//host`, and a
 * bare `pricing` with no leading slash.
 */
export function hrefProblem(href: string): string | null {
    const value = href.trim();

    if (value.length === 0) return 'A link needs an href';

    const shaped =
        /^https?:\/\//i.test(value) ||
        /^mailto:/i.test(value) ||
        value.startsWith('#') ||
        // `//host` is protocol-relative, not an internal path. The order matters:
        // it starts with "/" and would otherwise pass.
        (value.startsWith('/') && !value.startsWith('//'));

    if (!shaped) {
        return 'A link must be an internal path starting with “/”, a “#fragment”, a mailto: address, or an http(s):// URL';
    }

    if (LOCALE_PREFIXED.test(value)) {
        return 'Internal links must not carry a locale prefix — write “/pricing”, not “/fr/pricing”. The renderer adds the language itself.';
    }

    return null;
}

/** An image `url` — the same shape minus `mailto:` and fragments. */
export function imageUrlProblem(url: string): string | null {
    const value = url.trim();
    if (value.length === 0) return 'An image needs a url';
    if (/^https?:\/\//i.test(value)) return null;
    if (value.startsWith('/') && !value.startsWith('//')) return null;
    return 'An image url must be an http(s):// URL or an internal path starting with “/”';
}

/**
 * **Rule 2 · Heading ids are authored, never derived from the text.**
 *
 * A convenience for the *first* draft of an id only — the editor offers it as a
 * suggestion and never re-runs it. Deriving on every edit is the failure this
 * rule exists to prevent: it breaks every shared anchor the moment a title is
 * retouched, silently, because the page still renders.
 */
export function suggestHeadingId(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        // Strip combining marks so "Payé" becomes "paye" rather than losing the
        // vowel entirely — the pattern allows neither the accent nor an empty id.
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        // A trailing hyphen can reappear after the slice.
        .replace(/-+$/, '');
}

// ─── Whole-body validation ────────────────────────────────────────────────────

function richTextProblem(spans: RichText, label: string): string | null {
    if (spans.length === 0) return `${label} needs at least one span of text`;

    for (const span of spans) {
        if (span.text.length === 0) return `${label} has an empty run of text`;
        if (span.type === 'link') {
            const problem = hrefProblem(span.href);
            if (problem) return `${label}: ${problem}`;
        }
    }

    return null;
}

/** The per-block rules. Whole-body rules are in `validateArticleBody`. */
function blockProblem(block: ArticleBlock): string | null {
    switch (block.type) {
        case 'heading': {
            if (block.text.trim().length === 0) return 'A heading needs text';
            const id = block.id.trim();
            if (id.length === 0) return 'A heading needs an anchor id';
            if (!HEADING_ID_PATTERN.test(id)) {
                return 'An anchor id is lowercase letters, digits and single hyphens — e.g. “how-momo-payouts-work”';
            }
            return null;
        }
        case 'paragraph':
            return richTextProblem(block.text, 'This paragraph');
        case 'list': {
            if (block.items.length === 0) return 'A list needs at least one item';
            for (const [index, item] of block.items.entries()) {
                const problem = richTextProblem(item, `List item ${index + 1}`);
                if (problem) return problem;
            }
            return null;
        }
        case 'quote':
            return block.text.trim().length === 0 ? 'A quote needs text' : null;
        case 'callout': {
            if (block.title !== undefined && block.title.trim().length === 0) {
                // Absent and empty are different to a `.strict()` schema: omit
                // the key rather than sending "".
                return 'Remove the callout title rather than leaving it blank';
            }
            return richTextProblem(block.text, 'This callout');
        }
        case 'image': {
            const problem = imageUrlProblem(block.url);
            if (problem) return problem;
            // ⚠ Rule 4. Not pedantry: these reserve the box so a loading image
            // does not shift the paragraph under it, and layout shift is a Core
            // Web Vitals penalty on exactly the pages that exist to rank.
            if (!Number.isInteger(block.width) || block.width <= 0) {
                return 'An image needs its real pixel width — it reserves the space so the page does not jump while loading';
            }
            if (!Number.isInteger(block.height) || block.height <= 0) {
                return 'An image needs its real pixel height — it reserves the space so the page does not jump while loading';
            }
            if (block.alt.trim().length === 0) return 'Every image needs alt text';
            return null;
        }
        case 'cta': {
            if (block.title.trim().length === 0) return 'A call to action needs a title';
            if (block.body.trim().length === 0) return 'A call to action needs body copy';
            if (block.label.trim().length === 0) return 'A call to action needs a button label';
            return hrefProblem(block.href);
        }
        case 'faq': {
            if (block.items.length === 0) return 'An FAQ block needs at least one question';
            for (const [index, item] of block.items.entries()) {
                if (item.question.trim().length === 0) return `FAQ ${index + 1} needs a question`;
                if (item.answer.trim().length === 0) return `FAQ ${index + 1} needs an answer`;
            }
            return null;
        }
        case 'divider':
            return null;
    }
}

/**
 * Every problem in a body, in reading order.
 *
 * Returns **all** of them rather than the first, for the same reason
 * `BLOG_ARTICLE_NOT_PUBLISHABLE` carries a full checklist: telling an editor
 * about one missing piece at a time, over three round-trips, is how a save
 * button earns a reputation for being broken.
 */
export function validateArticleBody(body: ArticleBody): BodyProblem[] {
    const problems: BodyProblem[] = [];

    if (body.length === 0) {
        problems.push({ blockIndex: null, message: 'An article body needs at least one block' });
    }
    if (body.length > ARTICLE_BODY_MAX_BLOCKS) {
        problems.push({
            blockIndex: null,
            message: `An article body holds at most ${ARTICLE_BODY_MAX_BLOCKS} blocks`,
        });
    }

    body.forEach((block, index) => {
        const message = blockProblem(block);
        if (message) problems.push({ blockIndex: index, message });
    });

    // ⚠ Rule 3, the union's one cross-block rule: heading ids are unique within
    // one body. Two `#pricing` anchors mean one of them is unreachable, and
    // which one wins is a browser detail rather than a decision.
    const seen = new Map<string, number>();
    body.forEach((block, index) => {
        if (block.type !== 'heading') return;
        const id = block.id.trim();
        if (id.length === 0) return; // Already reported as a missing id.
        const first = seen.get(id);
        if (first !== undefined) {
            problems.push({
                blockIndex: index,
                message: `Duplicate anchor id “${id}” — block ${first + 1} already uses it. One of the two would be unreachable.`,
            });
            return;
        }
        seen.set(id, index);
    });

    return problems;
}

// ─── Derivations ──────────────────────────────────────────────────────────────

/** Spans concatenate with **no separator** — they are one sentence split at its formatting boundaries. */
function runText(spans: RichText): string {
    return spans.map((span) => span.text).join('');
}

function blockText(block: ArticleBlock): string[] {
    switch (block.type) {
        case 'heading':
            return [block.text];
        case 'paragraph':
            return [runText(block.text)];
        case 'list':
            return block.items.map(runText);
        case 'quote':
            return block.attribution ? [block.text, block.attribution] : [block.text];
        case 'callout':
            return [...(block.title ? [block.title] : []), runText(block.text)];
        case 'image':
            // `alt` is an accessibility label, not prose the reader spends time
            // on — the one omission, and the backend makes it too.
            return block.caption ? [block.caption] : [];
        case 'cta':
            return [block.title, block.body, block.label];
        case 'faq':
            return block.items.flatMap((item) => [item.question, item.answer]);
        case 'divider':
            return [];
    }
}

/**
 * Words in a body — **for display only.**
 *
 * ⚠ **Rule 5: `wordCount` is never sent.** The backend derives it on write so it
 * cannot drift from the prose, and the schema is `.strict()`, so including the
 * key is a `400`. This exists so the editor can show a running count while
 * writing, mirroring the backend's own algorithm (spans joined with no
 * separator, `alt` omitted) so the number does not jump on save.
 */
export function countWords(body: ArticleBody): number {
    const words = body.flatMap(blockText).join(' ').trim().match(/\S+/g);
    return words ? words.length : 0;
}

/** Every heading id in a body, in order — the table of contents. */
export function headingIds(body: ArticleBody): string[] {
    return body.filter((block) => block.type === 'heading').map((block) => block.id);
}

// ─── Starters ─────────────────────────────────────────────────────────────────

/** A newly added block of each type, valid-shaped but deliberately empty of prose. */
export function emptyBlock(type: ArticleBlock['type']): ArticleBlock {
    switch (type) {
        case 'heading':
            return { type: 'heading', level: 2, id: '', text: '' };
        case 'paragraph':
            return { type: 'paragraph', text: [{ type: 'text', text: '' }] };
        case 'list':
            return { type: 'list', items: [[{ type: 'text', text: '' }]] };
        case 'quote':
            return { type: 'quote', text: '' };
        case 'callout':
            return { type: 'callout', tone: 'note', text: [{ type: 'text', text: '' }] };
        case 'image':
            // Width and height start at 0 rather than a guess: a wrong number
            // reserves the wrong box, which is the defect the field exists to
            // prevent. `validateArticleBody` refuses 0, so it cannot be saved.
            return { type: 'image', url: '', alt: '', width: 0, height: 0 };
        case 'cta':
            return { type: 'cta', title: '', body: '', href: '', label: '' };
        case 'faq':
            return { type: 'faq', items: [{ question: '', answer: '' }] };
        case 'divider':
            return { type: 'divider' };
    }
}
