import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, EyeOff, Languages, PenLine, Send, Trash2 } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ArticleTranslationDialog } from '@/components/content/ArticleTranslationDialog';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    archiveArticle,
    deleteArticle,
    getArticle,
    publishArticle,
    unpublishArticle,
} from '@/services/content.service';
import { useAdmin } from '@/store';
import { ApiError } from '@/types/api.types';
import {
    ARTICLE_ARCHIVABLE_FROM,
    ARTICLE_PUBLISHABLE_FROM,
    ARTICLE_UNPUBLISHABLE_FROM,
    CODE_ARTICLE_DELETE_NOT_ALLOWED,
    CODE_ARTICLE_NOT_PUBLISHABLE,
    CONTENT_LOCALES,
    type ContentLocale,
} from '@/types/content.types';

/**
 * `GET /content/articles/:articleId` — one article and its lifecycle.
 *
 * ── ✅ The body IS editable here now ─────────────────────────────────────────
 * `content.md` still names none of the nine block types — it says `body` is *"a
 * discriminated union of nine block types, `.strict()` throughout"* and stops —
 * so for a long time this screen managed the lifecycle and reported the prose
 * without being able to author it. Authoring against a guess would have failed
 * closed on every save: every unknown block type *and* every unknown key on a
 * known block is a `400`.
 *
 * That is closed. `docs/admin/article-blocks.ts` mirrors the backend's own
 * validator byte for byte, `content-blocks.test.ts` diffs the nine names against
 * it, and `ArticleTranslationDialog` carries the editor.
 *
 * ── ⚠ Editing one language sends ALL of them ─────────────────────────────────
 * `translations` is a full-array replace, so the dialog takes the whole article
 * and swaps one element. Sending only the edited language would delete the rest,
 * silently, with a `200`.
 *
 * ── The publish blockers are a checklist, not a first failure ─────────────────
 * `422 BLOG_ARTICLE_NOT_PUBLISHABLE` carries `details.blockers` with **every**
 * reason at once, and all of them are rendered: telling an editor about one
 * missing piece at a time over three round-trips is how a publish button earns a
 * reputation for being broken.
 *
 * ── Delete is refused once an article has ever been published ─────────────────
 * The test is `published_at`, not `status` — an already-unpublished article was
 * still live once, and its address may carry inbound links. So the refusal
 * points at `archive`, which keeps the URL answering `410 Gone` with the
 * category hub.
 */
export function ArticleDetail() {
    const { articleId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const [busy, setBusy] = useState(false);
    const [blockers, setBlockers] = useState<string[] | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    // The locale being edited rather than the translation object: the article is
    // re-read after every save, so a held object would be a stale copy of a row
    // that has just changed underneath it.
    const [editingLocale, setEditingLocale] = useState<ContentLocale | null>(null);
    const [addingLanguage, setAddingLanguage] = useState(false);

    const article = useAsyncData(`/content/articles/${articleId}#${reloadToken}`, (signal) =>
        getArticle(articleId, { signal }),
    );

    async function run(action: () => Promise<unknown>, success: string) {
        setBusy(true);
        setBlockers(null);
        try {
            await action();
            notify.success(success);
            setReloadToken((token) => token + 1);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.code === CODE_ARTICLE_NOT_PUBLISHABLE) {
                    // The whole checklist, rendered in place rather than as a
                    // toast that slides away while the editor fixes it.
                    const list = error.details?.blockers;
                    setBlockers(
                        Array.isArray(list)
                            ? list.filter((item): item is string => typeof item === 'string')
                            : ['This article is not ready to publish.'],
                    );
                    return;
                }
                if (error.code === CODE_ARTICLE_DELETE_NOT_ALLOWED) {
                    notify.warning('A published article cannot be deleted', {
                        description:
                            'It was live once, so its address may have inbound links. Archive it instead — the URL keeps answering with the category hub.',
                    });
                    return;
                }
            }
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    if (article.isLoading) {
        return (
            <PageContainer title="Article">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!article.data) {
        return (
            <PageContainer title="Article">
                <div className="space-y-4">
                    <ErrorState
                        error={article.error}
                        onRetry={article.reload}
                        deniedTitle="No such article"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = article.data;
    const primary = record.translations[0];
    /* Never published means never live — the one condition delete allows. */
    const everPublished = record.publishedAt !== null;

    /**
     * Live languages whose cover has no description yet.
     *
     * ⚠ **Only `published` translations count.** A drafted language with no alt
     * text does not stop English shipping, so listing it here would report a
     * blocker that is not one. Empty when the article has no cover at all —
     * there is nothing to describe.
     */
    const missingCoverAlt = record.cover
        ? record.translations
              .filter((row) => row.published && row.coverAlt === null)
              .map((row) => row.locale)
        : [];

    return (
        <PageContainer
            title={primary?.title ?? record.id}
            description={record.id}
            actions={
                <>
                    <Can permission="content.articles.publish">
                        {ARTICLE_PUBLISHABLE_FROM.includes(record.status) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                    // `publishedAt` deliberately omitted: the first
                                    // publish stamps it and a republish must not
                                    // re-stamp, because it is the sort key the
                                    // index, sitemap and prev/next links share.
                                    run(() => publishArticle(record.id), 'Article published')
                                }
                            >
                                <Send className="size-4" />
                                Publish
                            </Button>
                        ) : null}

                        {ARTICLE_UNPUBLISHABLE_FROM.includes(record.status) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                    run(() => unpublishArticle(record.id), 'Article unpublished')
                                }
                            >
                                <EyeOff className="size-4" />
                                Unpublish
                            </Button>
                        ) : null}

                        {ARTICLE_ARCHIVABLE_FROM.includes(record.status) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                    run(() => archiveArticle(record.id), 'Article archived')
                                }
                            >
                                <Archive className="size-4" />
                                Archive
                            </Button>
                        ) : null}
                    </Can>

                    {/*
                      Hidden once the article has ever been published, because the
                      only outcome would be BLOG_ARTICLE_DELETE_NOT_ALLOWED. The
                      handler still covers that code: `publishedAt` could be
                      stamped between this read and the click.
                    */}
                    <Can permission="content.articles.delete">
                        {everPublished ? null : (
                            <Button
                                variant="destructive"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                    run(() => deleteArticle(record.id), 'Draft deleted')
                                }
                            >
                                <Trash2 className="size-4" />
                                Delete draft
                            </Button>
                        )}
                    </Can>
                </>
            }
        >
            <BackLink />

            {blockers ? (
                <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-4 py-3 text-sm">
                    <p className="font-medium">This article is not ready to publish.</p>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                        {blockers.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Publication</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Status">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                        variant={
                                            record.status === 'published' ? 'default' : 'outline'
                                        }
                                    >
                                        {record.status}
                                    </Badge>
                                    {record.featured ? (
                                        <Badge variant="secondary">Featured</Badge>
                                    ) : null}
                                </div>
                                <p className="text-muted-foreground mt-1 text-xs">
                                    {record.status === 'archived'
                                        ? 'Archived: the public address answers “gone” and offers the category hub, so inbound links are not wasted.'
                                        : record.status === 'draft'
                                          ? 'A draft is invisible publicly — its address answers “not found”, as though it had never existed.'
                                          : 'Live on the marketing site.'}
                                </p>
                            </Definition>

                            <Definition
                                label="First published"
                                hint={
                                    <InfoHint label="About this date">
                                        Stamped once and kept. A republish does not re-stamp it —
                                        it is the sort key the index, the sitemap and the
                                        prev/next links all share, so moving it would silently
                                        reorder pages that link to each other.
                                    </InfoHint>
                                }
                            >
                                {record.publishedAt ? (
                                    formatInstantInZone(record.publishedAt, timeZone)
                                ) : (
                                    <NotSet>Never</NotSet>
                                )}
                            </Definition>

                            <Definition
                                label="Content last changed"
                                hint={
                                    <InfoHint label="Not the same as “updated”">
                                        Stamped from a comparison of the fields a reader would
                                        see, plus the cover. Toggling “featured” is not a
                                        revision; adding or removing a language is, because the
                                        article&rsquo;s language set changed.
                                    </InfoHint>
                                }
                            >
                                {record.updatedAt ? (
                                    formatInstantInZone(record.updatedAt, timeZone)
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>

                            <Definition label="Category">{record.categoryKey}</Definition>

                            <Definition
                                label="Cover image"
                                hint={
                                    <InfoHint label="One image, five descriptions">
                                        The picture is shared across every language — it is a
                                        property of the file. Its <em>description</em> is not: a
                                        single shared one would put English words into a French
                                        screen reader and onto the French page&rsquo;s shared card,
                                        so each language writes its own.
                                    </InfoHint>
                                }
                            >
                                {record.cover ? (
                                    <div className="space-y-1">
                                        <p className="font-mono text-xs">{record.cover.url}</p>
                                        <p className="text-muted-foreground text-xs">
                                            {record.cover.width}×{record.cover.height}
                                        </p>
                                        {/*
                                          ⚠ A missing description is the one publish
                                          blocker that is otherwise invisible from
                                          the article screen, and it is per language.
                                          Only a LIVE language blocks — a drafted one
                                          with no alt text does not stop English
                                          shipping — so unpublished rows are not
                                          counted here either.
                                        */}
                                        {missingCoverAlt.length > 0 ? (
                                            <p className="text-warning text-xs">
                                                No description in{' '}
                                                {missingCoverAlt.join(', ')} — publishing is
                                                refused until{' '}
                                                {missingCoverAlt.length === 1
                                                    ? 'it has one'
                                                    : 'each has one'}
                                                .
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>

                            <Definition
                                label="Byline"
                                hint={
                                    <InfoHint label="Not the administrator">
                                        The editorial credit the public site renders, in its own
                                        collection. Which administrator touched the article is a
                                        separate stamp and never leaves this service.
                                    </InfoHint>
                                }
                            >
                                {/*
                                  `author` is resolved onto the article so no
                                  second call is needed. `null` means the byline
                                  was removed — which a publish refuses, so it is
                                  worth saying rather than showing a bare id.
                                */}
                                {record.author ? (
                                    <div className="space-y-0.5">
                                        <Link
                                            to="/dashboard/content/authors"
                                            className="font-medium hover:underline"
                                        >
                                            {record.author.name}
                                        </Link>
                                        <p className="text-muted-foreground text-xs">
                                            {record.author.type === 'Person'
                                                ? 'A named person'
                                                : 'An organisation'}{' '}
                                            · {record.authorId}
                                        </p>
                                    </div>
                                ) : (
                                    <NotSet>
                                        Removed — this article cannot be published until it credits
                                        a byline that exists
                                    </NotSet>
                                )}
                            </Definition>

                            <Definition
                                label="Words"
                                hint={
                                    <InfoHint label="About the count">
                                        Counted <em>per language</em> — a translation and its
                                        original are different lengths, and the structured data is
                                        per page. Derived when the article is saved, so it cannot
                                        drift from the prose.
                                    </InfoHint>
                                }
                            >
                                {record.translations.length === 0 ? (
                                    <NotSet />
                                ) : (
                                    formatCount(
                                        record.translations.reduce(
                                            (total, translation) => total + translation.wordCount,
                                            0,
                                        ),
                                    )
                                )}
                                {record.translations.length > 1 ? (
                                    <span className="text-muted-foreground">
                                        {' '}
                                        across {record.translations.length} languages
                                    </span>
                                ) : null}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                        <CardTitle>Languages</CardTitle>
                        <Can permission="content.articles.write">
                            {/*
                              Capped at the five locales: one translation per
                              language is the array's one cross-element rule, so
                              once every language exists there is nothing to add.
                            */}
                            {record.translations.length < CONTENT_LOCALES.length ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAddingLanguage(true)}
                                >
                                    <Languages className="size-4" />
                                    Add a language
                                </Button>
                            ) : null}
                        </Can>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {record.translations.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No translations. An article with no live language cannot be
                                published.
                            </p>
                        ) : (
                            <ul className="space-y-3">
                                {record.translations.map((translation) => (
                                    <li
                                        key={translation.locale}
                                        className="space-y-1 rounded-lg border px-3 py-2"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">
                                                    {translation.title}
                                                </span>
                                                <Badge variant="outline">
                                                    {translation.locale}
                                                </Badge>
                                                {/*
                                                  A language may be individually
                                                  unpublished on a live article:
                                                  that language 404s until it
                                                  flips, which is correct for a
                                                  missing translation and why
                                                  there is no fallback.
                                                */}
                                                {!translation.published ? (
                                                    <Badge variant="secondary">Not live</Badge>
                                                ) : null}
                                            </div>
                                            <Can permission="content.articles.write">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setEditingLocale(translation.locale)}
                                                >
                                                    <PenLine className="size-4" />
                                                    Edit
                                                </Button>
                                            </Can>
                                        </div>
                                        <p className="text-muted-foreground font-mono text-xs">
                                            /{translation.slug}
                                        </p>
                                        <p className="text-sm">{translation.excerpt}</p>
                                        <p className="text-muted-foreground text-xs">
                                            {formatCount(translation.body.length)} content block
                                            {translation.body.length === 1 ? '' : 's'} ·{' '}
                                            {formatCount(translation.wordCount)} word
                                            {translation.wordCount === 1 ? '' : 's'}
                                        </p>
                                        {/*
                                          ⚠ Retired slugs still answer, permanently,
                                          with a redirect to the current one — and no
                                          other article may ever claim them. Shown
                                          because that is a consequence an editor
                                          should be able to see, not a detail.
                                        */}
                                        {translation.previousSlugs.length > 0 ? (
                                            <p className="text-muted-foreground text-xs">
                                                Also answers, and always will:{' '}
                                                {translation.previousSlugs
                                                    .map((old) => `/${old}`)
                                                    .join(', ')}
                                            </p>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/*
              Both dialogs are handed `record` whole, because `translations` is a
              full-array replace: the write needs every language, not just the one
              on screen. Keyed on the locale so switching rows remounts with fresh
              state rather than carrying the previous language's prose across.
            */}
            {editingLocale ? (
                <ArticleTranslationDialog
                    key={editingLocale}
                    article={record}
                    translation={record.translations.find(
                        (row) => row.locale === editingLocale,
                    )}
                    open
                    onOpenChange={(next) => setEditingLocale(next ? editingLocale : null)}
                    onSaved={() => {
                        setEditingLocale(null);
                        setReloadToken((token) => token + 1);
                    }}
                />
            ) : null}

            {addingLanguage ? (
                <ArticleTranslationDialog
                    article={record}
                    open
                    onOpenChange={setAddingLanguage}
                    onSaved={() => {
                        setAddingLanguage(false);
                        setReloadToken((token) => token + 1);
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/content/articles"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
            <ArrowLeft className="size-4" />
            All articles
        </Link>
    );
}
