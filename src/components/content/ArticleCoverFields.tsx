import { useEffect, useState } from 'react';
import { Images, Ruler } from 'lucide-react';

import { ImageBox } from '@/components/files/ImageBox';
import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { imageUrlProblem } from '@/lib/article-body';
import type { CoverDraft } from '@/lib/article-cover';
import { IMAGE_URL_MAX } from '@/types/content.types';

/**
 * The cover's url, picker, preview and dimensions — shared by `ArticleCoverDialog`
 * (a saved article) and `ArticleCreateDialog` (a new one), so the two cannot
 * drift apart on the rules below.
 *
 * ⚠ **No alt text here, on purpose.** `CoverSchema` is `.strict()` and refuses
 * `alt`; the description is per language, as `translations[].coverAlt`, and
 * each caller places that field beside the language it belongs to.
 *
 * ⚠ **`requirePublicUrl`** — a cover url is a stored string served to anonymous
 * readers, so a private-tree file (`url: null`, and always) is unusable here.
 * The picker fills the field and does not save: the dimensions still have to be
 * measured, and the preview is what an editor checks before committing.
 *
 * ⚠ **Width and height are offered from a measurement, never overwritten by
 * one.** They reserve the box so the page does not jump while the picture loads,
 * and silently replacing a typed figure is the same class of mistake as deriving
 * a heading id from its text.
 */
export function ArticleCoverFields({
    idPrefix,
    value,
    onChange,
}: {
    idPrefix: string;
    value: CoverDraft;
    onChange: (next: CoverDraft) => void;
}) {
    const [pickerOpen, setPickerOpen] = useState(false);

    const url = value.url.trim();
    const urlProblem = url.length === 0 ? null : imageUrlProblem(url);
    const measured = useImageSize(urlProblem === null ? url : '');

    return (
        <div className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-url`}>Image url</Label>
                <div className="flex items-start gap-2">
                    <Input
                        id={`${idPrefix}-url`}
                        value={value.url}
                        maxLength={IMAGE_URL_MAX}
                        className="font-mono text-xs"
                        placeholder="/covers/getting-paid.jpg"
                        aria-invalid={urlProblem ? true : undefined}
                        onChange={(event) => onChange({ ...value, url: event.target.value })}
                    />
                    <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
                        <Images className="size-4" />
                        Browse
                    </Button>
                </div>
                {urlProblem ? (
                    <p className="text-destructive text-xs">{urlProblem}</p>
                ) : (
                    <p className="text-muted-foreground text-xs">
                        An http(s):// url or an internal path the marketing site serves, or choose
                        one the administration has already uploaded.
                    </p>
                )}
            </div>

            <MediaPickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                title="Choose a cover image"
                requirePublicUrl
                onSelect={(file) => {
                    if (file.url) onChange({ ...value, url: file.url });
                }}
            />

            {urlProblem === null && url.length > 0 ? (
                <ImageBox
                    src={url}
                    alt="The cover image as entered"
                    ratio={measured ? measured.width / measured.height : undefined}
                    className="max-w-md"
                />
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                    <Label htmlFor={`${idPrefix}-width`}>Width in pixels</Label>
                    <Input
                        id={`${idPrefix}-width`}
                        type="number"
                        min={1}
                        value={value.width}
                        onChange={(event) => onChange({ ...value, width: event.target.value })}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor={`${idPrefix}-height`}>Height in pixels</Label>
                    <Input
                        id={`${idPrefix}-height`}
                        type="number"
                        min={1}
                        value={value.height}
                        onChange={(event) => onChange({ ...value, height: event.target.value })}
                    />
                </div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={!measured}
                    onClick={() => {
                        if (!measured) return;
                        onChange({
                            ...value,
                            width: String(measured.width),
                            height: String(measured.height),
                        });
                    }}
                >
                    <Ruler className="size-4" />
                    {measured ? `Use ${measured.width}×${measured.height}` : 'Measure the image'}
                </Button>
            </div>
            <p className="text-muted-foreground text-xs">
                Both are required and must be the picture&rsquo;s real size: they reserve the space
                so the page does not jump while it loads. A cover is also the shared card&rsquo;s
                image, so 16:9 at 1200px wide or more is the recommendation.
            </p>
        </div>
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
     * the way out rather than cleared in the effect. Clearing it with a
     * `setState` in the effect body cascades a render on every keystroke, and an
     * image that resolves *after* the url has moved on would otherwise report
     * the previous picture's dimensions against the current one — reserving the
     * wrong box, the exact defect these fields exist to prevent.
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
