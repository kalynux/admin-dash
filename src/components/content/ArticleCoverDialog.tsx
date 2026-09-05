import { useEffect, useState } from 'react';
import { Images, Ruler, Trash2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import { ImageBox } from '@/components/files/ImageBox';
import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { imageUrlProblem } from '@/lib/article-body';
import { notify } from '@/lib/notify';
import { updateArticle } from '@/services/content.service';
import { IMAGE_URL_MAX, type Article } from '@/types/content.types';

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
 * `useImageSize` below then measures whatever is in it, picked or typed. ⚠ It is
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
    const [url, setUrl] = useState(article.cover?.url ?? '');
    const [width, setWidth] = useState(String(article.cover?.width ?? ''));
    const [height, setHeight] = useState(String(article.cover?.height ?? ''));
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const urlProblem = url.trim().length === 0 ? null : imageUrlProblem(url);
    const measured = useImageSize(urlProblem === null ? url.trim() : '');

    const widthValue = Number(width);
    const heightValue = Number(height);
    const dimensionsValid =
        Number.isInteger(widthValue) &&
        widthValue > 0 &&
        Number.isInteger(heightValue) &&
        heightValue > 0;

    const canSave =
        url.trim().length > 0 && urlProblem === null && dimensionsValid && !busy;

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
                    <div className="space-y-1.5">
                        <Label htmlFor="cover-url">Image url</Label>
                        <div className="flex items-start gap-2">
                            <Input
                                id="cover-url"
                                value={url}
                                maxLength={IMAGE_URL_MAX}
                                className="font-mono text-xs"
                                placeholder="/covers/getting-paid.jpg"
                                aria-invalid={urlProblem ? true : undefined}
                                onChange={(event) => setUrl(event.target.value)}
                            />
                            {/*
                              ⚠ **`requirePublicUrl` — this field stores the string
                              itself.** A cover url is served to anonymous readers,
                              so a private-tree file (`url: null`, and always) is
                              unusable here no matter what the operator picks. The
                              picker disables those rather than hiding them, so the
                              refusal is legible instead of looking like an empty
                              library.

                              ⚠ **The picker fills the field and does not save.**
                              The dimensions still have to be measured off the
                              loaded image, and the preview below is what an editor
                              checks before committing — writing on selection would
                              take both away.
                            */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setPickerOpen(true)}
                            >
                                <Images className="size-4" />
                                Browse
                            </Button>
                        </div>
                        {urlProblem ? (
                            <p className="text-destructive text-xs">{urlProblem}</p>
                        ) : (
                            <p className="text-muted-foreground text-xs">
                                An http(s):// url or an internal path the marketing site serves, or
                                choose one the administration has already uploaded.
                            </p>
                        )}
                    </div>

                    <MediaPickerDialog
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        title="Choose a cover image"
                        requirePublicUrl
                        onSelect={(file) => {
                            if (file.url) setUrl(file.url);
                        }}
                    />

                    {urlProblem === null && url.trim().length > 0 ? (
                        <ImageBox
                            src={url.trim()}
                            alt="The cover image as entered"
                            ratio={
                                measured ? measured.width / measured.height : undefined
                            }
                        />
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <div className="space-y-1.5">
                            <Label htmlFor="cover-width">Width in pixels</Label>
                            <Input
                                id="cover-width"
                                type="number"
                                min={1}
                                value={width}
                                onChange={(event) => setWidth(event.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cover-height">Height in pixels</Label>
                            <Input
                                id="cover-height"
                                type="number"
                                min={1}
                                value={height}
                                onChange={(event) => setHeight(event.target.value)}
                            />
                        </div>
                        {/*
                          Offered rather than applied: the numbers are what
                          reserve the box, and silently overwriting a figure an
                          editor typed would be the same class of mistake as
                          deriving a heading id from its text.
                        */}
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!measured}
                            onClick={() => {
                                if (!measured) return;
                                setWidth(String(measured.width));
                                setHeight(String(measured.height));
                            }}
                        >
                            <Ruler className="size-4" />
                            {measured
                                ? `Use ${measured.width}×${measured.height}`
                                : 'Measure the image'}
                        </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                        Both are required and must be the picture&rsquo;s real size: they reserve
                        the space so the page does not jump while it loads. A cover is also the
                        shared card&rsquo;s image, so 16:9 at 1200px wide or more is the
                        recommendation.
                    </p>

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
                            onClick={() =>
                                save({
                                    url: url.trim(),
                                    width: widthValue,
                                    height: heightValue,
                                })
                            }
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

/**
 * The image's real pixel size, or `null` while it is unknown.
 *
 * ⚠ **This is a measurement, not a fetch of the file** — the browser loads the
 * url the way an `<img>` would and `naturalWidth`/`naturalHeight` are read off
 * it. No wi-admin route is called, so there is no audit row and no permission
 * involved: the url is a public address the marketing site already serves.
 *
 * ⚠ **It can legitimately answer nothing.** A url that has not been typed fully,
 * a host that is not reachable from the operator's network, an image that is
 * still uploading — all of them leave the dimensions to be typed by hand, which
 * is why the button is an offer rather than the only way to fill the fields.
 */
function useImageSize(url: string): { width: number; height: number } | null {
    /**
     * ⚠ **Stamped with the url it came from**, and the stale one is filtered on
     * the way out rather than cleared in the effect. Two reasons, and the second
     * is the one that matters: clearing it with a `setState` in the effect body
     * cascades a render on every keystroke in the url field, and — worse — an
     * image that resolves *after* the url has moved on would otherwise report
     * the previous picture's dimensions against the current one. Reserving the
     * wrong box is the exact defect these fields exist to prevent.
     */
    const [measured, setMeasured] = useState<{
        url: string;
        width: number;
        height: number;
    } | null>(null);

    useEffect(() => {
        if (url.length === 0) return;

        let live = true;
        const image = new Image();
        image.onload = () => {
            if (live) {
                setMeasured({ url, width: image.naturalWidth, height: image.naturalHeight });
            }
        };
        image.onerror = () => {
            if (live) setMeasured(null);
        };
        image.src = url;

        return () => {
            live = false;
        };
    }, [url]);

    return measured && measured.url === url
        ? { width: measured.width, height: measured.height }
        : null;
}
