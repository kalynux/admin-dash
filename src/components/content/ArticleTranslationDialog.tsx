import { useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ArticleBodyEditor } from '@/components/content/ArticleBodyEditor';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
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
    const [slug, setSlug] = useState(translation?.slug ?? '');
    const [title, setTitle] = useState(translation?.title ?? '');
    const [metaTitle, setMetaTitle] = useState(translation?.metaTitle ?? '');
    const [excerpt, setExcerpt] = useState(translation?.excerpt ?? '');
    const [coverAlt, setCoverAlt] = useState(translation?.coverAlt ?? '');
    const [published, setPublished] = useState(translation?.published ?? true);
    // A new language starts with one empty paragraph rather than nothing: a body
    // needs at least one block, so an empty array is a state the editor can only
    // leave, never a state they wanted.
    const [body, setBody] = useState<ArticleBody>(
        translation?.body ?? [emptyBlock('paragraph')],
    );

    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [slugError, setSlugError] = useState<string | null>(null);

    const bodyProblems = validateArticleBody(body);
    const slugRenamed = editing && translation.slug !== slug.trim();

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

        // The whole array, every element narrowed — see the header. The edited
        // locale replaces its own row; a new locale is appended.
        const others = article.translations
            .filter((row) => row.locale !== locale)
            .map(toTranslationInput);

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
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {editing ? `Edit the ${locale} version` : 'Add a language'}
                    </DialogTitle>
                    <DialogDescription>
                        Every language of an article lives in one document, which is what makes the
                        site&rsquo;s language alternates reconstructible.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
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
                        <Label>Body</Label>
                        <ArticleBodyEditor
                            value={body}
                            onChange={setBody}
                            idPrefix="translation-body"
                        />
                    </div>

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={!canSave}>
                        {busy ? <InlineLoader /> : null}
                        {editing ? 'Save this language' : 'Add this language'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
