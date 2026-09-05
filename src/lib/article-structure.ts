/**
 * Structural inheritance between the languages of one article — § E3 of the
 * 2026-08-25 remediation round.
 *
 * The operator ask, in full:
 *
 * > The first blog is the component driver. Once set, all other language blogs
 * > added for the same article should inherit the same components.
 *
 * ── ⚠ There is no backend concept of a shared structure ──────────────────────
 * `body` is per translation and free-form: five languages may hold five
 * completely different block lists and the service will store all of them
 * without a word. **Everything in this file is a client-side convention**, and
 * the edges are stated precisely below because a convention nobody can see is
 * one the next person will break.
 *
 * ── 🔴 The driver is `sourceLocale`, and it is NOT `translations[0]` ─────────
 * This repository planned § E3 on `translations[0]` and the premise was false.
 * `translations` comes back in the order the **last write** sent it, and a
 * `PATCH` is a full-array replace that stores what it is handed — so a client
 * that sorts the array for display and sends it back **repoints a positional
 * driver**, with a request that cannot fail and nothing on either side that
 * reports it. The backend measured that rather than reasoning about it and
 * shipped `sourceLocale` (BR-019 § 1): stamped once at create, never mutated,
 * and guaranteed to name a locale that is present in `translations`.
 *
 * ── ⚠ Why deletions are confirmed rather than propagated ─────────────────────
 * `translations` is a full-array replace and the editor sends **every** language
 * on every save. A literal reading of *"deleting a component should equally
 * affect all other languages"* therefore means: one save destroys translated
 * prose in up to four languages, with no undo and a `200`. So:
 *
 * - **adding is safe and is automatic** — a block the driver grew is appended
 *   to a language when that language is next opened, carrying the driver's text
 *   and flagged as untranslated;
 * - **removing and reordering are neither** — they are shown as drift, named
 *   per language, and applied only when an operator ticks that language.
 *
 * ── ⚠ Propagation is by ORIGIN, never by position ────────────────────────────
 * `applyStructure` maps each block of the edited driver back to the index it
 * held **when the dialog opened** (`StructurePlan.origins`), so a deletion in
 * the middle carries the right prose in every other language. The obvious
 * alternative — align position by position, keeping a block whose type matches —
 * is silently wrong for the commonest edit there is: delete the second of three
 * paragraphs and every translation keeps its *second* paragraph in the slot
 * where its third belongs. That failure renders perfectly and is invisible in
 * review, which is why the origin map exists at all.
 *
 * ── ⚠ What drift detection cannot see ────────────────────────────────────────
 * `structureDrift` compares by **position and block type**. Swapping two
 * paragraphs in the driver leaves every type in place, so a language that was
 * translated before the swap now reads in the old order and nothing here can
 * tell. The origin map above is what makes the *good* path exact; this function
 * is the fallback for a driver that was already saved without propagating, and
 * it is honest about being a heuristic rather than a diff.
 */

import type { ArticleBlock, ArticleBody, ContentLocale } from '@/types/content.types';

// ─── The driver ───────────────────────────────────────────────────────────────

/**
 * The translation whose structure every other language follows.
 *
 * ⚠ **`sourceLocale` is authoritative and the fallback below is not a second
 * opinion.** The field always names a locale present in `translations`, so the
 * `find` succeeds for every article the service can produce. `translations[0]`
 * is reached only for an article carrying no `sourceLocale` at all — which the
 * write schema does not permit, since a create requires at least one
 * translation — and it is there so a malformed read renders instead of
 * throwing, never as a routine path.
 */
export function driverTranslation<T extends { locale: ContentLocale }>(article: {
    sourceLocale: ContentLocale | null;
    translations: T[];
}): T | undefined {
    if (article.sourceLocale !== null) {
        const named = article.translations.find((row) => row.locale === article.sourceLocale);
        if (named) return named;
    }
    return article.translations[0];
}

// ─── Cloning ──────────────────────────────────────────────────────────────────

/**
 * A deep copy of one block.
 *
 * ⚠ **Structural sharing would be a live defect, not an inefficiency.** The
 * editor mutates by replacing objects, but `RichTextField` and the list editor
 * both rebuild *arrays* in place from the value they were handed — so a seeded
 * language holding the same array instance as the driver would edit the
 * driver's prose too, and the driver's row is sent on the same save.
 *
 * `structuredClone` rather than a JSON round-trip: the block union is plain
 * data, and JSON would silently turn an `undefined` optional into a dropped key
 * (which is right) *and* a `NaN` width into `null` (which is a `400` shaped like
 * a typo).
 */
export function cloneBlock(block: ArticleBlock): ArticleBlock {
    return structuredClone(block);
}

/** A deep copy of a whole body. */
export function cloneBody(body: ArticleBody): ArticleBody {
    return body.map(cloneBlock);
}

// ─── "Not yet translated" ─────────────────────────────────────────────────────

/**
 * Every string in a block that a **reader** reads, in a stable order.
 *
 * ⚠ **Deliberately not `blockText` from `article-body.ts`.** That one feeds the
 * word count and omits an image's `alt` because the backend's own counter does —
 * `alt` is an accessibility label rather than prose a reader spends time on. It
 * is still a sentence somebody has to translate, so it is in here, and the two
 * functions must not be merged into one that is wrong for both jobs.
 *
 * Marks and hrefs are **not** included: bolding a run or fixing a link is not a
 * translation, and counting it as one would clear the flag on a block whose
 * prose is still in the driver's language.
 */
function translatableText(block: ArticleBlock): string[] {
    switch (block.type) {
        case 'heading':
            return [block.text];
        case 'paragraph':
            return block.text.map((span) => span.text);
        case 'list':
            return block.items.flatMap((item) => item.map((span) => span.text));
        case 'quote':
            return [block.text, block.attribution ?? ''];
        case 'callout':
            return [block.title ?? '', ...block.text.map((span) => span.text)];
        case 'image':
            // The picture is shared across languages by construction — one file,
            // one url, one set of dimensions. What needs translating is the
            // description and the caption.
            return [block.alt, block.caption ?? ''];
        case 'cta':
            return [block.title, block.body, block.label];
        case 'faq':
            return block.items.flatMap((item) => [item.question, item.answer]);
        case 'divider':
            // Nothing to translate, ever — so a divider is never flagged. A
            // badge on every rule in the document would train an editor to
            // ignore the badge.
            return [];
    }
}

/**
 * Whether this block still carries the driver's words.
 *
 * ⚠ **Derived, never stored.** The block schemas are `.strict()` throughout, so
 * there is no marker field to add — an `untranslated: true` key is a `400` on
 * the whole save. What is available is a comparison, and it has exactly the
 * property the flag needs: **the first edit clears it by construction**, and an
 * untouched block keeps it for as long as it is untouched.
 *
 * The one thing it cannot tell is a translation that is legitimately identical —
 * a product name, a code sample, a URL as prose. That is a false positive on a
 * badge, which costs an editor one glance; the opposite error would be a badge
 * that quietly stops appearing.
 */
export function isUntranslated(block: ArticleBlock, driverBlock: ArticleBlock | undefined): boolean {
    if (!driverBlock || block.type !== driverBlock.type) return false;

    const mine = translatableText(block);
    // Nothing to translate (a divider), or nothing written yet in either — a
    // badge on an empty block says nothing an empty block does not already say.
    if (mine.every((text) => text.trim().length === 0)) return false;

    const theirs = translatableText(driverBlock);
    return mine.length === theirs.length && mine.every((text, at) => text === theirs[at]);
}

/** The indices of a body that still read as the driver's. */
export function untranslatedIndices(body: ArticleBody, driverBody: ArticleBody): number[] {
    return body.flatMap((block, index) => (isUntranslated(block, driverBody[index]) ? [index] : []));
}

// ─── Seeding a language ───────────────────────────────────────────────────────

/**
 * The body a non-driver language starts its editing session with.
 *
 * Two cases, and neither destroys anything:
 *
 * - **a new language** clones the driver's whole structure, text carried over
 *   verbatim, so every block arrives flagged as untranslated and the editor
 *   translates in place rather than rebuilding a document that already exists;
 * - **an existing language** gets the blocks the driver has grown since it was
 *   last written, appended — *the additive half of the sync*.
 *
 * ⚠ **It never removes, never reorders and never overwrites.** Everything it
 * cannot do additively is drift, which `structureDrift` reports and only an
 * operator resolves. A seed that silently truncated would be the full-array
 * replace's worst case wearing the word "inherit".
 */
export function seedFromDriver(driverBody: ArticleBody, body?: ArticleBody): ArticleBody {
    if (!body) return cloneBody(driverBody);
    if (body.length >= driverBody.length) return body;
    return [...body, ...cloneBody(driverBody.slice(body.length))];
}

// ─── Drift ────────────────────────────────────────────────────────────────────

/**
 * How a language's structure disagrees with the driver's, after seeding.
 *
 * ⚠ **`extra` and `mismatched` are both consequences of an edit to the DRIVER
 * that was not propagated** — a block removed from the middle, or two blocks
 * reordered across types. A language cannot produce them on its own, because a
 * non-driver editor offers no add, no remove and no move.
 */
export interface StructureDrift {
    /** Blocks this language holds past the end of the driver's list. */
    extra: number[];
    /** Indices where the two disagree on the block *type*. */
    mismatched: number[];
}

export function structureDrift(body: ArticleBody, driverBody: ArticleBody): StructureDrift {
    const extra: number[] = [];
    const mismatched: number[] = [];

    body.forEach((block, index) => {
        const driverBlock = driverBody[index];
        if (!driverBlock) extra.push(index);
        else if (driverBlock.type !== block.type) mismatched.push(index);
    });

    return { extra, mismatched };
}

export function hasDrift(drift: StructureDrift): boolean {
    return drift.extra.length > 0 || drift.mismatched.length > 0;
}

/**
 * Force one language onto the driver's shape, by position.
 *
 * ⚠ **This is the destructive remedy and it is never automatic.** It is offered
 * only where `structureDrift` already reports a disagreement — i.e. where a
 * driver edit was saved without propagating — and only behind an explicit
 * confirmation that names how many blocks it drops.
 *
 * ⚠ **It aligns by position and cannot do better.** A block whose type matches
 * the driver's at that index is kept on the assumption it is the same block; a
 * block whose type does not is replaced by the driver's, and this language's
 * prose for it is gone. Where the driver reordered rather than deleted, the
 * assumption is wrong and the result reads in the wrong order — which is why
 * `applyStructure`, which knows the origins, is the path that should be taken
 * instead whenever it is available.
 */
export function alignToDriver(body: ArticleBody, driverBody: ArticleBody): ArticleBody {
    return driverBody.map((driverBlock, index) => {
        const block = body[index];
        return block && block.type === driverBlock.type ? block : cloneBlock(driverBlock);
    });
}

// ─── Propagating a driver edit ────────────────────────────────────────────────

/**
 * What the driver's editing session did to its own block list, as a map from
 * each block's current position back to the index it held when the dialog
 * opened.
 *
 * `null` means "this block did not exist then" — it was added during the
 * session, so no other language has a translation of it and the driver's own
 * text is what every language inherits.
 */
export interface StructurePlan {
    /** One entry per block of the edited body. */
    origins: (number | null)[];
    /** How many blocks the stored driver had when the session opened. */
    storedLength: number;
}

export function initialPlan(storedBody: ArticleBody): StructurePlan {
    return { origins: storedBody.map((_, index) => index), storedLength: storedBody.length };
}

/**
 * The structural edits the body editor reports.
 *
 * ⚠ **`replace` is not `remove` + `add`.** Editing a block's prose must keep its
 * origin, or propagating the save would throw away every other language's
 * translation of it — the exact loss this whole module exists to prevent.
 */
export type BodyEdit =
    | { kind: 'replace'; index: number }
    | { kind: 'add' }
    | { kind: 'remove'; index: number }
    | { kind: 'move'; from: number; to: number };

/** The plan after one structural edit. */
export function applyEditToPlan(plan: StructurePlan, edit: BodyEdit): StructurePlan {
    const origins = [...plan.origins];

    switch (edit.kind) {
        case 'replace':
            // Deliberately nothing: the block is the same block with new words.
            return plan;
        case 'add':
            // The editor appends; a block that did not exist has no origin.
            return { ...plan, origins: [...origins, null] };
        case 'remove':
            origins.splice(edit.index, 1);
            return { ...plan, origins };
        case 'move': {
            const [moved] = origins.splice(edit.from, 1);
            origins.splice(edit.to, 0, moved);
            return { ...plan, origins };
        }
    }
}

/** Whether the driver's block list changed shape — added blocks do not count. */
export function planRemovesOrReorders(plan: StructurePlan): boolean {
    const kept = plan.origins.filter((origin): origin is number => origin !== null);
    if (kept.length !== plan.storedLength) return true;
    return kept.some((origin, at) => origin !== at);
}

/**
 * Rebuild one other language's body so it follows the driver's new structure.
 *
 * Each block of the result is that language's own block for the driver block
 * that now sits there — found by **origin**, so a middle deletion or a reorder
 * carries the right prose — or, where the driver block is new, the driver's own
 * block, which arrives flagged as untranslated.
 */
export function applyStructure(
    body: ArticleBody,
    driverBody: ArticleBody,
    plan: StructurePlan,
): ArticleBody {
    return driverBody.map((driverBlock, index) => {
        const origin = plan.origins[index];
        if (origin === null || origin === undefined) return cloneBlock(driverBlock);
        const existing = body[origin];
        // A language shorter than the stored driver had not been synced yet, so
        // there is nothing of its own to keep at that slot.
        return existing ? existing : cloneBlock(driverBlock);
    });
}

/**
 * How many of a language's blocks `applyStructure` would drop, and how many of
 * those carry prose somebody wrote.
 *
 * ⚠ **The second number is the one the confirmation must lead with.** "Three
 * blocks removed" reads as tidying; "two of them carry French prose" is the
 * fact an operator is being asked to accept, and it is not recoverable.
 */
export function structureLoss(
    body: ArticleBody,
    /**
     * ⚠ **The driver body as it was STORED**, not as the session has edited it.
     * The question here is whether a block about to be dropped ever received
     * this language's own words, and that is only answerable against the blocks
     * it was aligned to — the edited body's index `i` is a different block.
     */
    storedDriverBody: ArticleBody,
    plan: StructurePlan,
): { removed: number; removedWithProse: number } {
    const kept = new Set(plan.origins.filter((origin): origin is number => origin !== null));

    let removed = 0;
    let removedWithProse = 0;

    body.forEach((block, index) => {
        if (kept.has(index)) return;
        removed += 1;
        const isDriverText = isUntranslated(block, storedDriverBody[index]);
        const hasProse = translatableText(block).some((text) => text.trim().length > 0);
        // A block still carrying the driver's own words is not this language's
        // prose — losing it loses nothing that was written here.
        if (hasProse && !isDriverText) removedWithProse += 1;
    });

    return { removed, removedWithProse };
}
