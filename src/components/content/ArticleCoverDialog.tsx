import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ArticleCoverFields } from '@/components/content/ArticleCoverFields';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { InfoHint } from '@/components/ui/info-hint';
import { readCoverDraft, type CoverDraft } from '@/lib/article-cover';
import { notify } from '@/lib/notify';
import { updateArticle } from '@/services/content.service';
import type { Article } from '@/types/content.types';

/**
 * § E5 — the cover image, which had **nowhere to be set**.
 *
 * `ArticleDetail` rendered `cover.url` and its dimensions read-only and offered
 * no editor at all, which was the honest answer to *"where do we set it?"* and
 * not a useful one. `PATCH /content/articles/:articleId` has accepted
 * `cover: { url, width, height } | null` all along.
 *
 * ── ⚠ `alt` is REFUSED here, and it is not an oversight ──────────────────────
 * `CoverSchema` is `.strict()`, so a stray `alt` is a `400` on the **whole
 * request** — not a stripped key. Alt text is per language, as
 * `translations[].coverAlt`, because one image serves up to five languages and a
 * shared string puts English into a French screen reader and onto the French
 * page's `og:image`. This dialog shows which languages have one and sends
 * **none of them**: it never touches `translations`.
 *
 * ── ⚠ Omitting `translations` is what keeps this write safe ──────────────────
 * `translations` on a `PATCH` is a full-array replace. Omitting the key entirely
 * leaves every language untouched, which is exactly what a cover change wants —
 * and it is the reason this is a separate dialog rather than a field on the
 * translation editor, where the whole array is in flight.
 *
 * ── ⚠ Width and height are required, and a wrong number is worse than none ───
 * They reserve the box so a loading cover does not shift the page under it. So
 * the dimensions are read from the image itself where the browser can load it,
 * rather than typed from memory — `FileDetail` carries neither, which is why
 * BR-015 § C recorded the measurement as this client's job before either half
 * of it existed.
 *
 * ✅ **The picker landed with Phase F on 2026-08-27** and fills the url field;
 * `ArticleCoverFields` then measures whatever is in it, picked or typed. ⚠ It is
 * `requirePublicUrl`, and that is not a preference: a cover url is a stored
 * string served to anonymous readers, so a private-tree file has `url: null` and
 * always will.
 */
export function ArticleCoverDialog({
    article,
    open,
    onOpenChange,
    onSaved,
}: {
    article: Article;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<CoverDraft>({
        url: article.cover?.url ?? '',
        width: String(article.cover?.width ?? ''),
        height: String(article.cover?.height ?? ''),
    });
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const { cover: nextCover } = readCoverDraft(draft);
    const canSave = nextCover !== null && !busy;

    async function save(cover: Article['cover']) {
        setBusy(true);
        setFormError(null);
        try {
            // ⚠ `translations` is deliberately absent: omitting the key leaves
            // every language untouched, and sending it would be a full-array
            // replace this dialog has no business making.
            await updateArticle(article.id, { cover });
            notify.success(cover ? 'Cover image saved' : 'Cover image removed');
            onOpenChange(false);
            onSaved();
        } catch (error) {
            setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    /** Languages that have written a description of the cover, and those that have not. */
    const described = article.translations.filter(
        (row) => (row.coverAlt ?? '').trim().length > 0,
    );
    const undescribed = article.translations.filter(
        (row) => (row.coverAlt ?? '').trim().length === 0,
    );
    const liveUndescribed = undescribed.filter((row) => row.published);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{article.cover ? 'Cover image' : 'Add a cover image'}</DialogTitle>
                    <DialogDescription>
                        One picture for every language of this article — it is a property of the
                        file, not of the prose. Its description is written per language.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <ArticleCoverFields idPrefix="cover" value={draft} onChange={setDraft} />

                    <div className="space-y-2 border-t pt-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-medium">Descriptions</p>
                            <InfoHint label="Why the description is not here">
                                The picture is shared across every language; the sentence that
                                describes it is not. One shared string would put English words into
                                a French screen reader and onto the French page&rsquo;s shared card,
                                so each language writes its own — as{' '}
                                <code>coverAlt</code>, on the translation.
                                <br />
                                <br />
                                The write schema for the cover is strict about this: sending an{' '}
                                <code>alt</code> alongside the url is refused outright, rather than
                                being quietly dropped.
                            </InfoHint>
                        </div>
                        {article.translations.length === 0 ? (
                            <p className="text-muted-foreground text-xs">
                                This article has no languages yet.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {described.map((row) => (
                                    <Badge key={row.locale} variant="secondary">
                                        {row.locale} · described
                                    </Badge>
                                ))}
                                {undescribed.map((row) => (
                                    <Badge key={row.locale} variant="outline">
                                        {row.locale} · no description
                                    </Badge>
                                ))}
                            </div>
                        )}
                        {liveUndescribed.length > 0 ? (
                            <p className="text-warning text-xs">
                                {liveUndescribed.map((row) => row.locale).join(', ')}{' '}
                                {liveUndescribed.length === 1 ? 'is live and has' : 'are live and have'}{' '}
                                no description of the cover. Publishing is refused until{' '}
                                {liveUndescribed.length === 1 ? 'it has one' : 'each has one'} — edit
                                that language to write it.
                            </p>
                        ) : null}
                    </div>

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter className="sm:justify-between">
                    {/*
                      ⚠ `null` clears it, and only `null` does: an omitted key
                      leaves the cover alone and `""` is refused by the url
                      schema. The descriptions each language wrote are NOT
                      cleared with it — they are kept for the day another cover
                      is added, which is why removing is not as destructive as it
                      looks.
                    */}
                    {article.cover ? (
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => save(null)}
                        >
                            <Trash2 className="size-4" />
                            Remove the cover
                        </Button>
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={!canSave}
                            onClick={() => {
                                if (nextCover) void save(nextCover);
                            }}
                        >
                            {busy ? <InlineLoader /> : null}
                            Save the cover
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
