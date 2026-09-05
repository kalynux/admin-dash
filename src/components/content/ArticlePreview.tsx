import { ArticleBodyPreview } from '@/components/content/ArticleBodyPreview';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { ImageBox } from '@/components/files/ImageBox';
import { Badge } from '@/components/ui/badge';
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useAsyncData } from '@/hooks/use-async-data';
import { previewArticle } from '@/services/content.service';
import type {
    ArticleBody,
    ArticleCover,
    ArticleKey,
    ContentLocale,
    PublicAuthor,
} from '@/types/content.types';

/**
 * § E2 — *"see it as a customer would"*, in the two forms that answer it.
 *
 * ── The two previews are complements, not alternatives ───────────────────────
 * | | Renders | Accuracy |
 * |---|---|---|
 * | `ArticleReaderView` on dialog state | **unsaved** prose, as you type | An approximation of the marketing site, labelled as one |
 * | `ArticleSavedPreview` over `/preview` | the **saved** article | The exact public projection — the same DTO a reader gets |
 *
 * ⚠ **The saved one cannot see a draft in a dialog** — it reads the database —
 * and the unsaved one cannot promise byte accuracy. An editor wants the first
 * while writing and the second before publishing, which is why both ship rather
 * than one replacing the other.
 */

/** What a reader sees at the top of the page, above the prose. */
export interface ReaderHeader {
    locale: ContentLocale;
    title: string;
    excerpt: string;
    cover: ArticleCover | null;
    /** This language's description of the shared cover. */
    coverAlt: string | null;
    categoryKey: string;
    author?: PublicAuthor | null;
    body: ArticleBody;
}

/**
 * One language of an article laid out as a page.
 *
 * ⚠ **`alt` on the cover falls back to the title, and that is not a nicety.** An
 * empty `alt` is the HTML for *this image is decorative, skip it*, which is a
 * lie about a cover — so the backend's own public projection stands the title in
 * for a missing `coverAlt`, and this view does the same thing for the same
 * reason. What it must **not** do is hide that the description is missing:
 * publishing is refused for it, so the gap is called out beside the picture.
 */
export function ArticleReaderView({ header }: { header: ReaderHeader }) {
    const missingAlt = header.cover !== null && (header.coverAlt ?? '').trim().length === 0;

    return (
        <article className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{header.locale}</Badge>
                <Badge variant="secondary">{header.categoryKey}</Badge>
            </div>

            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
                {header.title.trim().length > 0 ? header.title : 'Untitled'}
            </h1>

            {header.excerpt.trim().length > 0 ? (
                <p className="text-muted-foreground text-sm leading-6">{header.excerpt}</p>
            ) : null}

            {header.author ? (
                <p className="text-muted-foreground text-xs">
                    {header.author.name}
                    {header.author.title ? ` · ${header.author.title}` : null}
                </p>
            ) : null}

            {header.cover ? (
                <div className="space-y-1">
                    {/*
                      `src`, not `file` — a cover is a stored url served to
                      anonymous readers, so drawing it discloses nothing the
                      article has not already published and writes no audit row.
                      The block's own dimensions set the box, exactly as they
                      will on the page.
                    */}
                    <ImageBox
                        src={header.cover.url}
                        alt={(header.coverAlt ?? '').trim() || header.title || 'Article cover'}
                        ratio={
                            header.cover.width > 0 && header.cover.height > 0
                                ? header.cover.width / header.cover.height
                                : undefined
                        }
                    />
                    {missingAlt ? (
                        <p className="text-warning text-xs">
                            This language has no description for the cover. A reader using a screen
                            reader hears the headline instead, and publishing this language is
                            refused until one is written.
                        </p>
                    ) : null}
                </div>
            ) : null}

            <ArticleBodyPreview body={header.body} className="pt-2" />
        </article>
    );
}

/**
 * The **saved** article, through `GET /content/articles/:articleId/preview`.
 *
 * ⚠ **This is the public projection, so three things differ from the editor's
 * view and all three are the point:**
 *
 * - it is one language, flattened — no `translations`, no `status`;
 * - neither administrative stamp is on it, by construction;
 * - **`publishedAt` falls back to `createdAt` on a draft**, because the field is
 *   non-optional on the wire and a draft has no publication date. It is
 *   deliberately not rendered as one here.
 *
 * ⚠ **It reads the database, so it is behind by one save.** The banner says so
 * rather than leaving an editor to wonder why their last paragraph is missing.
 */
export function ArticleSavedPreview({
    articleId,
    locale,
    onOpenChange,
}: {
    articleId: ArticleKey;
    locale: ContentLocale;
    onOpenChange: (open: boolean) => void;
}) {
    /*
      ⚠ **Mounted only while it is open**, by the caller, and that is a read
      rather than a style: `useAsyncData` fires on mount, so a sheet that stayed
      mounted behind a closed flag would call `/preview` on every article the
      operator opens, whether or not anybody asked for one.

      Keyed on both ids, so switching language re-reads rather than showing the
      previous one's prose under the new badge.
    */
    const preview = useAsyncData(
        `/content/articles/${articleId}/preview?locale=${locale}`,
        (signal) => previewArticle(articleId, locale, { signal }),
    );

    return (
        <Sheet open onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-2xl">
                <SheetHeader>
                    <SheetTitle>As a reader sees it</SheetTitle>
                    <SheetDescription>
                        The published projection of the saved article, in {locale} — the same shape
                        the marketing site is served. Anything written since the last save is not in
                        here.
                    </SheetDescription>
                </SheetHeader>
                <SheetBody className="overflow-y-auto">
                    {preview.isLoading ? (
                        <DetailSkeleton />
                    ) : preview.data ? (
                        <ArticleReaderView
                            header={{
                                locale: preview.data.locale,
                                title: preview.data.title,
                                excerpt: preview.data.excerpt,
                                cover: preview.data.cover,
                                // The public shape has already resolved the alt
                                // for this language — and guarantees it is never
                                // empty, standing the title in on a draft.
                                coverAlt: preview.data.cover?.alt ?? null,
                                categoryKey: preview.data.categoryKey,
                                author: preview.data.author,
                                body: preview.data.body,
                            }}
                        />
                    ) : (
                        <ErrorState
                            error={preview.error}
                            onRetry={preview.reload}
                            deniedTitle="No preview for this language"
                        />
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}
