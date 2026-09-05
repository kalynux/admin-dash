import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
import { Textarea } from '@/components/ui/textarea';
import { useAsyncData } from '@/hooks/use-async-data';
import { emptyBlock, suggestHeadingId, validateArticleBody } from '@/lib/article-body';
import { notify } from '@/lib/notify';
import { createArticle, listAuthors } from '@/services/content.service';
import { ApiError } from '@/types/api.types';
import {
    ARTICLE_CATEGORY_KEYS,
    ARTICLE_EXCERPT_MAX,
    ARTICLE_ID_MAX,
    ARTICLE_ID_MIN,
    ARTICLE_ID_PATTERN,
    ARTICLE_SLUG_MAX,
    ARTICLE_SLUG_PATTERN,
    ARTICLE_TITLE_MAX,
    CODE_ARTICLE_KEY_TAKEN,
    CODE_SLUG_RESERVED,
    CODE_SLUG_TAKEN,
    CONTENT_LOCALES,
    DEFAULT_CONTENT_LOCALE,
    RESERVED_SLUGS,
    type ArticleBody,
    type ArticleCategoryKey,
    type ContentLocale,
} from '@/types/content.types';

/**
 * `POST /content/articles` — create an article with its first language.
 *
 * ── ⚠ An article always lands as a DRAFT ─────────────────────────────────────
 * `status` is not settable here, deliberately: "created" and "published" are
 * different decisions, and the second has a checklist
 * (`POST /:articleId/publish`) that a create body could quietly skip. So there
 * is no publish control on this dialog — publishing happens on the article
 * itself, where the blockers can be rendered.
 *
 * ── ⚠ The body field is `id`, even though the path parameter is `:articleId` ─
 * The schema is `.strict()`, so `key` is a `400`. See `content.types.ts` for how
 * that mismatch went unnoticed.
 *
 * ── The id is immutable once created ──────────────────────────────────────────
 * The marketing frontend hashes it to generate the article's cover art, so a
 * change would repaint an article a reader has already seen. There is no rename
 * endpoint; this is the only chance to choose it.
 *
 * ── At least one translation is required ──────────────────────────────────────
 * An article with no language has nothing to render, so the create schema
 * demands one. It also needs a body of at least one block — which is why the
 * block editor is on this dialog rather than only on the detail screen.
 */
export function ArticleCreateDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}) {
    const navigate = useNavigate();

    const [id, setId] = useState('');
    const [categoryKey, setCategoryKey] = useState<ArticleCategoryKey>(ARTICLE_CATEGORY_KEYS[0]);
    const [authorId, setAuthorId] = useState('');
    const [locale, setLocale] = useState<ContentLocale>(DEFAULT_CONTENT_LOCALE);
    const [slug, setSlug] = useState('');
    const [title, setTitle] = useState('');
    const [excerpt, setExcerpt] = useState('');
    const [body, setBody] = useState<ArticleBody>([emptyBlock('paragraph')]);

    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [idError, setIdError] = useState<string | null>(null);
    const [slugError, setSlugError] = useState<string | null>(null);

    // The byline must already exist — a publish is refused otherwise, and the
    // list is small and unpaginated, so offering the real set beats a free-text
    // box that can name something that is not there.
    const authors = useAsyncData('/content/authors', (signal) => listAuthors({ signal }));
    const authorRows = authors.data ?? [];

    const bodyProblems = validateArticleBody(body);

    function idProblem(): string | null {
        const value = id.trim();
        if (value.length < ARTICLE_ID_MIN) return `Use at least ${ARTICLE_ID_MIN} characters`;
        if (value.length > ARTICLE_ID_MAX) return `Use at most ${ARTICLE_ID_MAX} characters`;
        if (!ARTICLE_ID_PATTERN.test(value)) {
            return 'Lowercase letters, digits and single hyphens — no accents, spaces or capitals';
        }
        return null;
    }

    function slugProblem(): string | null {
        const value = slug.trim();
        if (value.length === 0) return 'A slug is required — it is the article’s public address';
        if (!ARTICLE_SLUG_PATTERN.test(value)) {
            return 'Lowercase letters, digits and single hyphens — no spaces, slashes or capitals';
        }
        if ((RESERVED_SLUGS as readonly string[]).includes(value)) {
            return `“${value}” is reserved — it collides with a route on the public site`;
        }
        return null;
    }

    const localIdProblem = idProblem();
    const localSlugProblem = slugProblem();

    const canSave =
        localIdProblem === null &&
        localSlugProblem === null &&
        authorId.length > 0 &&
        title.trim().length > 0 &&
        excerpt.trim().length > 0 &&
        bodyProblems.length === 0 &&
        !busy;

    async function save() {
        setBusy(true);
        setFormError(null);
        setIdError(null);
        setSlugError(null);

        const articleId = id.trim();

        try {
            await createArticle({
                id: articleId,
                categoryKey,
                authorId,
                translations: [
                    {
                        locale,
                        slug: slug.trim(),
                        title: title.trim(),
                        excerpt: excerpt.trim(),
                        body,
                    },
                ],
            });
            notify.success('Draft created');
            onCreated();
            // Straight into the article: the next thing anybody does is add a
            // language or publish, and both live there.
            navigate(`/dashboard/content/articles/${encodeURIComponent(articleId)}`);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.code === CODE_ARTICLE_KEY_TAKEN) {
                    setIdError('Another article already uses that id.');
                    return;
                }
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
              § E1 · the same shell as the translation editor — a fixed-height
              column whose middle scrolls, rather than a panel that scrolls its
              own header and footer away once the body is a few blocks long.
            */}
            <DialogContent className="flex h-[92vh] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)]">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>New article</DialogTitle>
                    <DialogDescription>
                        It is created as a draft — invisible on the public site until it is
                        published, which is a separate step with its own checklist.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="article-id">Id</Label>
                        <Input
                            id="article-id"
                            value={id}
                            maxLength={ARTICLE_ID_MAX}
                            className="font-mono text-xs"
                            placeholder="getting-paid-on-whatsapp"
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={id.length > 0 && (localIdProblem || idError) ? true : undefined}
                            onChange={(event) => {
                                setId(event.target.value);
                                setIdError(null);
                            }}
                        />
                        {id.length > 0 && (localIdProblem || idError) ? (
                            <p className="text-destructive text-xs">{localIdProblem ?? idError}</p>
                        ) : (
                            <p className="text-muted-foreground text-xs">
                                Permanent. The marketing site generates this article&rsquo;s cover
                                art from it, so changing it later would repaint an article readers
                                have already seen — and there is no rename.
                            </p>
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="article-category">Category</Label>
                            <Select
                                value={categoryKey}
                                onValueChange={(next) =>
                                    setCategoryKey(next as ArticleCategoryKey)
                                }
                            >
                                <SelectTrigger id="article-category">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ARTICLE_CATEGORY_KEYS.map((value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {value}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="article-author">Byline</Label>
                            <Select value={authorId} onValueChange={setAuthorId}>
                                <SelectTrigger id="article-author">
                                    <SelectValue
                                        placeholder={
                                            authors.isLoading ? 'Loading…' : 'Choose a byline'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {authorRows.map((author) => (
                                        <SelectItem key={author.id} value={author.id}>
                                            {author.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!authors.isLoading && authorRows.length === 0 ? (
                                <p className="text-warning text-xs">
                                    There are no bylines yet, and an article cannot be published
                                    without one. Create a byline first.
                                </p>
                            ) : null}
                        </div>
                    </div>

                    <div className="space-y-3 border-t pt-4">
                        <p className="text-sm font-medium">The first language</p>
                        {/*
                          ⚠ § E3 · this choice is not just "which language do I
                          write first". The backend stamps it as the article's
                          `sourceLocale` at create and **never rewrites it**, and
                          every language added afterwards inherits this one's
                          block list. So it decides where the article's structure
                          is edited for the rest of its life.
                        */}
                        <p className="text-muted-foreground text-xs">
                            Whichever language this is becomes the article&rsquo;s source language:
                            every language added later inherits its components, and adding, removing
                            or reordering a block is done here from then on. It is recorded when the
                            article is created and cannot be moved afterwards.
                        </p>

                        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                            <div className="space-y-1.5">
                                <Label htmlFor="article-locale">Language</Label>
                                <Select
                                    value={locale}
                                    onValueChange={(next) => setLocale(next as ContentLocale)}
                                >
                                    <SelectTrigger id="article-locale">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CONTENT_LOCALES.map((value) => (
                                            <SelectItem key={value} value={value}>
                                                {value}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="article-title">Title</Label>
                                <Input
                                    id="article-title"
                                    value={title}
                                    maxLength={ARTICLE_TITLE_MAX}
                                    // The slug is NOT derived from this as it is
                                    // typed. "From title" below is a one-shot
                                    // convenience: once an article is live its
                                    // slug is an address, and a live binding
                                    // would move that address on every edit.
                                    onChange={(event) => setTitle(event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="article-slug">Slug</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="article-slug"
                                    value={slug}
                                    maxLength={ARTICLE_SLUG_MAX}
                                    className="font-mono text-xs"
                                    placeholder="getting-paid-on-whatsapp"
                                    aria-invalid={
                                        slug.length > 0 && (localSlugProblem || slugError)
                                            ? true
                                            : undefined
                                    }
                                    onChange={(event) => {
                                        setSlug(event.target.value);
                                        setSlugError(null);
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={title.trim().length === 0}
                                    onClick={() => {
                                        setSlug(suggestHeadingId(title));
                                        setSlugError(null);
                                    }}
                                >
                                    From title
                                </Button>
                            </div>
                            {slug.length > 0 && (localSlugProblem || slugError) ? (
                                <p className="text-destructive text-xs">
                                    {localSlugProblem ?? slugError}
                                </p>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    The public address in this language. Suggesting one from the
                                    title is a starting point, not a binding — once this is live the
                                    slug is an address, and renaming it leaves a permanent redirect
                                    behind.
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="article-excerpt">Excerpt</Label>
                            <Textarea
                                id="article-excerpt"
                                value={excerpt}
                                rows={3}
                                maxLength={ARTICLE_EXCERPT_MAX}
                                onChange={(event) => setExcerpt(event.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Body</Label>
                            <ArticleBodyEditor
                                value={body}
                                onChange={setBody}
                                idPrefix="article-body"
                            />
                        </div>
                    </div>

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter className="border-t px-6 py-4">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={!canSave}>
                        {busy ? <InlineLoader /> : null}
                        Create draft
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
