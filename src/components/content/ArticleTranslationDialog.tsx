import { useState } from 'react';
import { Eye, EyeOff, Languages } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ArticleBodyEditor } from '@/components/content/ArticleBodyEditor';
import { ArticleReaderView } from '@/components/content/ArticlePreview';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { emptyBlock, validateArticleBody } from '@/lib/article-body';
import {
    alignToDriver,
    applyEditToPlan,
    applyStructure,
    driverTranslation,
    hasDrift,
    initialPlan,
    planRemovesOrReorders,
    seedFromDriver,
    structureDrift,
    structureLoss,
    untranslatedIndices,
    type BodyEdit,
    type StructurePlan,
} from '@/lib/article-structure';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { updateArticle } from '@/services/content.service';
import { ApiError } from '@/types/api.types';
import {
    ARTICLE_EXCERPT_MAX,
    ARTICLE_META_TITLE_MAX,
    ARTICLE_SLUG_MAX,
    ARTICLE_SLUG_PATTERN,
    ARTICLE_TITLE_MAX,
    CODE_SLUG_RESERVED,
    CODE_SLUG_TAKEN,
    CONTENT_LOCALES,
    COVER_ALT_MAX,
    RESERVED_SLUGS,
    toTranslationInput,
    type Article,
    type ArticleBody,
    type ArticleTranslation,
    type ArticleTranslationInput,
    type ContentLocale,
} from '@/types/content.types';

/**
 * Write one language of an article — metadata and prose.
 *
 * ── ⚠ `translations` is a FULL-ARRAY REPLACE, so this sends every language ────
 * Not just the one being edited. A partial merge has no way to express "remove
 * the Spanish translation", and a per-locale endpoint would leave the array's
 * one cross-element rule — unique locales — unenforceable. So the dialog takes
 * the whole article, swaps one element, and sends the array back.
 *
 * **Sending only the edited language would delete the rest**, silently and with
 * a `200`. That is the single most expensive mistake available on this endpoint.
 *
 * ── ⚠ A read translation is NOT a write translation ──────────────────────────
 * `wordCount` and `previousSlugs` are derived server-side, and the schema is
 * `.strict()` — so echoing a read straight back is a `400` naming `wordCount`,
 * a field the editor never typed. `toTranslationInput` is the narrowing, and
 * every element of the array goes through it, not just the edited one.
 *
 * ── ⚠ Renaming a slug retires the old one rather than freeing it ─────────────
 * Retired `(locale, slug)` pairs stay in `slug_keys` so jovi-mall can answer
 * `BLOG_ARTICLE_MOVED` and the marketing site can emit a 301 — and so no *other*
 * article can claim one, because a reused retired slug turns a permanent
 * redirect into a wrong answer. The dialog says so before the rename, because
 * afterwards it is not undoable.
 *
 * ── § E3 · one language drives the components, and it is `sourceLocale` ──────
 * The operator ask: *"the first blog is the component driver; all other language
 * blogs added for the same article inherit the same components."* There is no
 * backend concept of a shared structure — `body` is per translation and
 * free-form — so the whole of it is a client convention, implemented in
 * [`lib/article-structure.ts`](../../lib/article-structure.ts) and summarised
 * here because this is where it is enforced.
 *
 * | | |
 * |---|---|
 * | **A new language** | Opens with a clone of the driver's blocks, its words carried over, every block flagged *not yet translated* |
 * | **A block the driver grew** | Appears here on open, carrying the driver's words — the additive half, and it is automatic because adding destroys nothing |
 * | **A block the driver lost or moved** | ⚠ **Never automatic.** Confirmed per language, below the body, and only after being told what it costs |
 * | **Editing a non-driver language** | Every word is editable; the block list is not — see `ArticleBodyEditor`'s `follows` |
 *
 * ── 🔴 Why removal is confirmed, in one paragraph ────────────────────────────
 * This dialog sends **every** language on every save. A literal reading of *"a
 * deleted component should equally affect all other languages"* is therefore one
 * request that destroys translated prose in up to four languages, with a `200`
 * and no undo. So the driver's editor **names the languages and asks**, one
 * checkbox each, unticked.
 *
 * ⚠ **And it propagates by ORIGIN, not by position.** `StructurePlan` remembers
 * where each block sat when the dialog opened, so deleting the second of three
 * paragraphs carries the right prose in every language. Aligning by position
 * instead — keep whatever block has the same type at that index — is silently
 * wrong for exactly that edit, and the result renders perfectly.
 */
export function ArticleTranslationDialog({
    article,
    translation,
    open,
    onOpenChange,
    onSaved,
}: {
    article: Article;
    /** Absent means "add a language". */
    translation?: ArticleTranslation;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}) {
    const editing = translation !== undefined;

    const taken = new Set(article.translations.map((row) => row.locale));
    const available = CONTENT_LOCALES.filter((locale) => !taken.has(locale));

    const [locale, setLocale] = useState<ContentLocale>(
        translation?.locale ?? available[0] ?? 'en',
    );

    /**
     * The language whose block list this article's other languages follow.
     *
     * ⚠ **`sourceLocale`, never `translations[0]`** — the array comes back in
     * whatever order the last write sent, so a positional driver is repointed by
     * any client that sorts for display and saves. BR-019 § 1.
     *
     * `undefined` only for an article with no translations at all, which the
     * write schema does not permit; the dialog then behaves as a plain editor.
     */
    const driver = driverTranslation(article);
    /**
     * Whether *this* dialog is editing the driver.
     *
     * ⚠ Adding a language is never the driver, even on an article that has none
     * saved yet — `sourceLocale` is stamped by the create, and a language added
     * afterwards is by definition not the first.
     */
    const isDriver = driver === undefined || (editing && driver.locale === translation.locale);
    const follows = isDriver || !driver ? undefined : driver;

    const [slug, setSlug] = useState(translation?.slug ?? '');
    const [title, setTitle] = useState(translation?.title ?? '');
    const [metaTitle, setMetaTitle] = useState(translation?.metaTitle ?? '');
    const [excerpt, setExcerpt] = useState(translation?.excerpt ?? '');
    const [coverAlt, setCoverAlt] = useState(translation?.coverAlt ?? '');
    const [published, setPublished] = useState(translation?.published ?? true);
    /*
      The seed, and the three cases it covers:

      - a **new non-driver** language clones the driver whole;
      - an **existing non-driver** language gains whatever the driver grew since
        it was last written, appended and flagged;
      - anything else — the driver itself, or an article with no driver — opens
        on its own body, and a brand-new one on a single empty paragraph, because
        a body needs at least one block and an empty array is a state the editor
        can only leave.

      ⚠ `seedFromDriver` never removes and never overwrites. Everything it cannot
      do additively is drift, reported below rather than applied here.
    */
    const [body, setBody] = useState<ArticleBody>(() => {
        if (follows) return seedFromDriver(follows.body, translation?.body);
        return translation?.body ?? [emptyBlock('paragraph')];
    });

    /**
     * Where each block of the *driver's* body sat when this dialog opened.
     *
     * Kept only while editing the driver — it is what turns "the operator
     * deleted block 2" into an exact instruction for every other language. See
     * the module header.
     */
    const [plan, setPlan] = useState<StructurePlan>(() =>
        initialPlan(isDriver && translation ? translation.body : []),
    );
    /** The languages the operator has ticked to carry a structural change into. */
    const [carryTo, setCarryTo] = useState<ContentLocale[]>([]);
    const [showPreview, setShowPreview] = useState(false);

    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [slugError, setSlugError] = useState<string | null>(null);

    const bodyProblems = validateArticleBody(body);
    const slugRenamed = editing && translation.slug !== slug.trim();

    /** The other languages that would be affected by a structural change here. */
    const otherLanguages = article.translations.filter((row) => row.locale !== locale);
    const structureChanged = isDriver && editing && planRemovesOrReorders(plan);

    const drift = follows ? structureDrift(body, follows.body) : null;
    const untranslated = follows ? untranslatedIndices(body, follows.body) : [];

    function editBody(next: ArticleBody, edit: BodyEdit) {
        setBody(next);
        if (isDriver) setPlan((current) => applyEditToPlan(current, edit));
    }

    function slugProblem(): string | null {
        const value = slug.trim();
        if (value.length === 0) return 'A slug is required — it is the article’s public address';
        if (!ARTICLE_SLUG_PATTERN.test(value)) {
            return 'Lowercase letters, digits and single hyphens — no spaces, slashes or capitals';
        }
        // Checked here as well as server-side so the refusal is immediate: each
        // of these collides with a route on the public site rather than
        // resolving to an article.
        if ((RESERVED_SLUGS as readonly string[]).includes(value)) {
            return `“${value}” is reserved — it collides with a route on the public site`;
        }
        return null;
    }

    const localProblem = slugProblem();
    const canSave =
        localProblem === null &&
        title.trim().length > 0 &&
        excerpt.trim().length > 0 &&
        bodyProblems.length === 0 &&
        !busy;

    async function save() {
        setBusy(true);
        setFormError(null);
        setSlugError(null);

        const edited: ArticleTranslationInput = {
            locale,
            slug: slug.trim(),
            title: title.trim(),
            excerpt: excerpt.trim(),
            body,
            published,
        };
        // Omitted rather than sent as "" or null: both are `.min(1).optional()`,
        // so either would be a validation failure on a `.strict()` schema.
        if (metaTitle.trim().length > 0) edited.metaTitle = metaTitle.trim();
        if (coverAlt.trim().length > 0) edited.coverAlt = coverAlt.trim();

        /*
          The whole array, every element narrowed — see the header. The edited
          locale replaces its own row; a new locale is appended.

          ⚠ **A language the operator did not tick travels through UNCHANGED.**
          That is the default and it must stay the default: a structural change
          the driver makes is this dialog's to *offer*, never to apply on the way
          past. `carryTo` is empty unless somebody ticked a box.
        */
        const others = article.translations
            .filter((row) => row.locale !== locale)
            .map((row) => {
                const input = toTranslationInput(row);
                if (!structureChanged || !carryTo.includes(row.locale)) return input;
                // By origin, never by position — `applyStructure`'s own header
                // says what the positional version gets wrong.
                return { ...input, body: applyStructure(row.body, body, plan) };
            });

        try {
            await updateArticle(article.id, { translations: [...others, edited] });
            notify.success(editing ? 'Language saved' : 'Language added');
            onOpenChange(false);
            onSaved();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.code === CODE_SLUG_TAKEN) {
                    setSlugError(
                        'Another article already answers to that slug in this language — including one that used it and moved on.',
                    );
                    return;
                }
                if (error.code === CODE_SLUG_RESERVED) {
                    const reserved = error.details?.reserved;
                    setSlugError(
                        Array.isArray(reserved)
                            ? `Reserved on the public site. Pick anything but: ${reserved.join(', ')}.`
                            : 'That slug is reserved on the public site.',
                    );
                    return;
                }
            }
            setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/*
              § E1 · a writing surface rather than a form.

              ⚠ **The dialog itself no longer scrolls; the editor inside it
              does.** `overflow-y-auto` on the whole panel put the save button
              four hundred blocks below the fold on a long article, so an editor
              scrolled the header and the footer away to reach it. The shell is a
              fixed-height column — header, scrolling body, footer — which is
              what keeps Save reachable from anywhere in the prose.
            */}
            <DialogContent className="flex h-[92vh] max-w-[min(96vw,84rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,84rem)]">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                        {editing ? `Edit the ${locale} version` : 'Add a language'}
                        {isDriver && article.translations.length > 1 ? (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                                <Languages className="size-3.5" />
                                the article&rsquo;s source language
                                <InfoHint label="What the source language decides">
                                    Every other language of this article carries the same
                                    components as this one. Adding a block here offers it to them;
                                    removing or moving one is offered separately, per language,
                                    because it destroys prose that was written in them.
                                    <br />
                                    <br />
                                    Which language this is comes from the article&rsquo;s{' '}
                                    <code>sourceLocale</code> — stamped when the article was created
                                    and never rewritten, so it is not affected by the order the
                                    languages happen to be stored in.
                                </InfoHint>
                            </span>
                        ) : null}
                    </DialogTitle>
                    <DialogDescription>
                        Every language of an article lives in one document, which is what makes the
                        site&rsquo;s language alternates reconstructible.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                        <div className="space-y-1.5">
                            <Label htmlFor="translation-locale">Language</Label>
                            <Select
                                value={locale}
                                onValueChange={(next) => setLocale(next as ContentLocale)}
                                // Immutable on an edit: changing it would replace
                                // a different row and leave two of one language.
                                disabled={editing}
                            >
                                <SelectTrigger id="translation-locale">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(editing ? [locale] : available).map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {value}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="translation-title">Title</Label>
                            <Input
                                id="translation-title"
                                value={title}
                                maxLength={ARTICLE_TITLE_MAX}
                                onChange={(event) => setTitle(event.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="translation-slug">Slug</Label>
                        <Input
                            id="translation-slug"
                            value={slug}
                            maxLength={ARTICLE_SLUG_MAX}
                            className="font-mono text-xs"
                            placeholder="getting-paid-on-whatsapp"
                            aria-invalid={localProblem || slugError ? true : undefined}
                            onChange={(event) => {
                                setSlug(event.target.value);
                                setSlugError(null);
                            }}
                        />
                        {localProblem || slugError ? (
                            <p className="text-destructive text-xs">{localProblem ?? slugError}</p>
                        ) : slugRenamed ? (
                            <p className="text-warning text-xs">
                                Renaming keeps the old address working — it will answer with a
                                redirect to this one, permanently, and no other article can ever use
                                it. That is not undoable.
                            </p>
                        ) : (
                            <p className="text-muted-foreground text-xs">
                                The article&rsquo;s public address in this language. Any lowercase
                                script is allowed, so an Arabic or Portuguese slug does not have to
                                be transliterated.
                            </p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="translation-meta-title">
                            Search-result title (optional)
                        </Label>
                        <Input
                            id="translation-meta-title"
                            value={metaTitle}
                            maxLength={ARTICLE_META_TITLE_MAX}
                            onChange={(event) => setMetaTitle(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">
                            Used in place of the title on a search-results page. Leave it blank to
                            use the title itself.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="translation-excerpt">Excerpt</Label>
                        <Textarea
                            id="translation-excerpt"
                            value={excerpt}
                            rows={3}
                            maxLength={ARTICLE_EXCERPT_MAX}
                            onChange={(event) => setExcerpt(event.target.value)}
                        />
                    </div>

                    {/*
                      ⚠ Alt text for the article's SHARED cover, in this language
                      — it moved off `cover.alt` on 2026-08-25 because one image
                      serves up to five languages and a single string put English
                      into a French screen reader.

                      Offered even when the article has no cover yet, because a
                      `PATCH` can add one without touching `translations`: an
                      editor who writes the alt first should not have to come back
                      for it. The hint says which case they are in.
                    */}
                    <div className="space-y-1.5">
                        <Label htmlFor="translation-cover-alt">
                            Cover image description ({locale})
                        </Label>
                        <Input
                            id="translation-cover-alt"
                            value={coverAlt}
                            maxLength={COVER_ALT_MAX}
                            onChange={(event) => setCoverAlt(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">
                            {article.cover
                                ? published
                                    ? 'What a screen reader announces, and what a search engine puts on the shared card. Required in every live language before this article can be published.'
                                    : 'What a screen reader announces. This language is not live, so a missing description will not block publishing — it will as soon as the language goes live.'
                                : 'This article has no cover image yet. The description is kept for the day one is added, and only matters then.'}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Switch
                            id="translation-published"
                            checked={published}
                            onCheckedChange={setPublished}
                        />
                        <Label htmlFor="translation-published">Live in this language</Label>
                    </div>
                    <p className="text-muted-foreground -mt-2 text-xs">
                        A language can be held back on an article that is otherwise live. That
                        language then answers &ldquo;not found&rdquo; until it is switched on —
                        which is the right behaviour for a translation that does not exist yet, and
                        the reason readers are never shown a different language instead.
                    </p>

                    <div className="space-y-2 border-t pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label>Body</Label>
                            {follows && untranslated.length > 0 ? (
                                <p className="text-muted-foreground text-xs">
                                    {formatCount(untranslated.length)} of{' '}
                                    {formatCount(body.length)} block
                                    {body.length === 1 ? '' : 's'} still read as {follows.locale}
                                </p>
                            ) : null}
                        </div>
                        <ArticleBodyEditor
                            value={body}
                            onChange={editBody}
                            idPrefix="translation-body"
                            follows={
                                follows
                                    ? { driverBody: follows.body, driverLocale: follows.locale }
                                    : undefined
                            }
                        />
                    </div>

                    {/*
                      ⚠ The destructive half of § E3, and the only place it can
                      happen. Unticked by default, and the sentence leads with
                      the prose that would be lost rather than with a block
                      count — "three blocks removed" reads as tidying.
                    */}
                    {structureChanged && otherLanguages.length > 0 ? (
                        <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-4 py-3">
                            <p className="text-sm font-medium">
                                The components of this article have changed
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {otherLanguages.length === 1
                                    ? 'The other language of this article still has'
                                    : `The other ${formatCount(otherLanguages.length)} languages of this article still have`}{' '}
                                the previous structure. Carrying the change across rewrites{' '}
                                {otherLanguages.length === 1 ? 'its' : 'their'} block list to match
                                this one — <strong>prose in a removed block is gone</strong>, and
                                there is no undo.
                            </p>
                            <ul className="space-y-1.5">
                                {otherLanguages.map((row) => {
                                    const loss = structureLoss(
                                        row.body,
                                        translation?.body ?? [],
                                        plan,
                                    );
                                    return (
                                        <li key={row.locale} className="flex items-start gap-2">
                                            <Checkbox
                                                id={`carry-${row.locale}`}
                                                checked={carryTo.includes(row.locale)}
                                                onCheckedChange={(checked) =>
                                                    setCarryTo((current) =>
                                                        checked === true
                                                            ? [...current, row.locale]
                                                            : current.filter(
                                                                  (value) => value !== row.locale,
                                                              ),
                                                    )
                                                }
                                            />
                                            <Label
                                                htmlFor={`carry-${row.locale}`}
                                                className="text-xs leading-5 font-normal"
                                            >
                                                Apply to <strong>{row.locale}</strong>
                                                {loss.removedWithProse > 0
                                                    ? ` — ${formatCount(loss.removedWithProse)} block${loss.removedWithProse === 1 ? '' : 's'} of ${row.locale} prose would be destroyed`
                                                    : loss.removed > 0
                                                      ? ` — ${formatCount(loss.removed)} block${loss.removed === 1 ? '' : 's'} removed, none of them translated yet`
                                                      : ' — nothing of its own would be lost'}
                                            </Label>
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="text-muted-foreground text-xs">
                                Leave them unticked to change only {locale}. The others keep the old
                                structure and can be brought into line one at a time.
                            </p>
                        </div>
                    ) : null}

                    {/*
                      The other side of the same coin: a driver edit that was
                      saved without being carried across. The remedy aligns by
                      position and cannot do better, so it says so.
                    */}
                    {follows && drift && hasDrift(drift) ? (
                        <div className="space-y-2 rounded-lg border px-4 py-3">
                            <p className="text-sm font-medium">
                                Match the {follows.locale} version&rsquo;s structure
                            </p>
                            <p className="text-muted-foreground text-xs">
                                This language would end up with{' '}
                                {formatCount(follows.body.length)} block
                                {follows.body.length === 1 ? '' : 's'} rather than{' '}
                                {formatCount(body.length)}, keeping its own words wherever the two
                                agree on what a block is. ⚠ The match is <em>by position</em>,
                                which is right where a block was removed and wrong where two were
                                swapped — so read the result before saving.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    setBody((current) => alignToDriver(current, follows.body))
                                }
                            >
                                Take the {follows.locale} structure
                            </Button>
                        </div>
                    ) : null}

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                {/*
                  § E2 · the preview, beside the editor rather than over it.

                  ⚠ **It renders the UNSAVED state**, which is the whole reason
                  it is here: `GET /content/articles/:articleId/preview` returns
                  the exact public projection and can only ever show an article
                  that has been saved. The article screen offers that one; this
                  is the draft in the room.
                */}
                {showPreview ? (
                    <div className="bg-muted/20 hidden min-h-0 w-[26rem] shrink-0 overflow-y-auto border-l px-6 py-4 lg:block">
                        <p className="text-muted-foreground mb-3 text-xs">
                            Roughly as a reader sees it — the marketing site&rsquo;s own styling
                            lives in another repository, so this is the structure and the order
                            rather than the typeface.
                        </p>
                        <ArticleReaderView
                            header={{
                                locale,
                                title,
                                excerpt,
                                cover: article.cover,
                                coverAlt: coverAlt.trim().length > 0 ? coverAlt : null,
                                categoryKey: article.categoryKey,
                                author: article.author
                                    ? {
                                          id: article.author.id,
                                          name: article.author.name,
                                          type: article.author.type,
                                          // The byline's per-locale title and bio
                                          // are on the author record, not the
                                          // article, and this dialog holds only
                                          // the reference. The name is what a
                                          // reader sees at the top of the page.
                                          title: '',
                                          bio: '',
                                          avatarUrl: null,
                                      }
                                    : null,
                                body,
                            }}
                        />
                    </div>
                ) : null}
                </div>

                <DialogFooter className="border-t px-6 py-4 sm:justify-between">
                    <Button
                        type="button"
                        variant="ghost"
                        className="hidden lg:inline-flex"
                        onClick={() => setShowPreview((current) => !current)}
                    >
                        {showPreview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        {showPreview ? 'Hide the preview' : 'Preview'}
                    </Button>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="button" onClick={save} disabled={!canSave}>
                            {busy ? <InlineLoader /> : null}
                            {editing ? 'Save this language' : 'Add this language'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
