import { ImageBox } from '@/components/files/ImageBox';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import type { ArticleBlock, ArticleBody, RichText } from '@/types/content.types';

/**
 * The article body as a **reader** gets it — § E2.
 *
 * ── ⚠ What this is, and what it is not ───────────────────────────────────────
 * It is an approximation of the marketing site's own renderer, built from the
 * same nine-block union, and it is **labelled as one** wherever it is shown. It
 * is not the marketing site's stylesheet and cannot be: that lives in another
 * repository, against another design system, and copying its CSS here would
 * produce a preview that is exactly as accurate as the day it was copied.
 *
 * What it is *for* is the question an editor actually has — *does this read
 * right?* — which is about order, hierarchy and length rather than typeface.
 *
 * ⚠ **It renders UNSAVED state, which `/preview` cannot.**
 * `GET /content/articles/:articleId/preview` returns the exact public
 * projection and is the better answer for a saved article; it has nothing to
 * say about a draft in a dialog that has not been sent yet. The two are
 * complements, and both are offered — see `ArticlePreviewPane` and
 * `ArticleSavedPreview`.
 *
 * ── ⚠ Spans concatenate with NO separator ────────────────────────────────────
 * `"Commission is taken "` and its trailing space are meaningful, so the runs
 * are emitted adjacent and nothing between them is trimmed. Getting this wrong
 * in a *preview* would be worse than getting it wrong in the editor: it would
 * show the editor prose that reads correctly and ship prose that does not.
 *
 * ── ⚠ No `dangerouslySetInnerHTML`, here least of all ────────────────────────
 * The block union exists because an HTML string would have to be sanitised on
 * the way in and rendered as markup on the way out, on the same origin as the
 * auth pages. A preview that took the shortcut would reintroduce exactly the
 * hole the wire format was designed to close, on a screen an administrator has
 * open with a session. Every branch below renders through React elements.
 */
export function ArticleBodyPreview({
    body,
    className,
}: {
    body: ArticleBody;
    className?: string;
}) {
    if (body.length === 0) {
        return (
            <p className={cn('text-muted-foreground text-sm italic', className)}>
                Nothing written yet.
            </p>
        );
    }

    return (
        <div className={cn('space-y-4', className)}>
            {body.map((block, index) => (
                <BlockPreview key={index} block={block} index={index} />
            ))}
        </div>
    );
}

function BlockPreview({ block, index }: { block: ArticleBlock; index: number }) {
    switch (block.type) {
        case 'heading':
            // `id` on the element as well as the text, because the anchor is the
            // point of the field — an editor checking a heading is checking the
            // link readers will share.
            return block.level === 2 ? (
                <h2 id={block.id} className="scroll-m-20 text-xl font-semibold tracking-tight">
                    {block.text}
                </h2>
            ) : (
                <h3 id={block.id} className="scroll-m-20 text-base font-semibold tracking-tight">
                    {block.text}
                </h3>
            );

        case 'paragraph':
            return (
                <p className="text-sm leading-7">
                    <Spans value={block.text} />
                </p>
            );

        case 'list': {
            const items = block.items.map((item, at) => (
                <li key={at} className="text-sm leading-7">
                    <Spans value={item} />
                </li>
            ));
            return block.ordered ? (
                <ol className="list-decimal space-y-1 pl-6">{items}</ol>
            ) : (
                <ul className="list-disc space-y-1 pl-6">{items}</ul>
            );
        }

        case 'quote':
            return (
                <blockquote className="border-primary/40 space-y-1 border-l-2 pl-4">
                    <p className="text-sm leading-7 italic">{block.text}</p>
                    {block.attribution ? (
                        <footer className="text-muted-foreground text-xs">
                            — {block.attribution}
                        </footer>
                    ) : null}
                </blockquote>
            );

        case 'callout':
            return (
                <aside
                    className={cn(
                        'space-y-1 rounded-lg border px-4 py-3',
                        block.tone === 'warning' && 'border-warning/30 bg-warning/10',
                        block.tone === 'tip' && 'border-primary/30 bg-primary/5',
                        block.tone === 'note' && 'bg-muted/40',
                    )}
                >
                    {block.title ? <p className="text-sm font-medium">{block.title}</p> : null}
                    <p className="text-sm leading-7">
                        <Spans value={block.text} />
                    </p>
                </aside>
            );

        case 'image':
            /*
              ⚠ `ImageBox src`, and no audit row — the direct-render variant.

              An article image is a url stored on the article and served to
              anonymous readers; nothing is disclosed by drawing it that the
              article did not already publish. The audited `file` variant is for
              the private trees, and reaching for it here would file a
              disclosure every time somebody previewed a paragraph.

              The `ratio` comes from the block's own dimensions, which is what
              the required `width`/`height` are for: the preview reserves the
              same box the published page will.
            */
            return (
                <figure className="space-y-1">
                    <ImageBox
                        src={block.url}
                        alt={block.alt}
                        ratio={
                            block.width > 0 && block.height > 0
                                ? block.width / block.height
                                : undefined
                        }
                        caption={block.caption}
                    />
                    {block.caption ? (
                        <figcaption className="text-muted-foreground text-xs">
                            {block.caption}
                        </figcaption>
                    ) : null}
                </figure>
            );

        case 'cta':
            return (
                <div className="bg-muted/40 space-y-2 rounded-lg border px-4 py-4 text-center">
                    <p className="text-base font-semibold">{block.title}</p>
                    <p className="text-muted-foreground text-sm leading-6">{block.body}</p>
                    {/*
                      Rendered as a disabled-looking pill rather than an `<a>`:
                      this is a picture of the published page, and a live link
                      inside a preview navigates an operator out of the dialog
                      they are writing in. The target is printed instead, which
                      is also what they are checking.
                    */}
                    <p>
                        <span className="bg-primary text-primary-foreground inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium">
                            {block.label}
                        </span>
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">{block.href}</p>
                </div>
            );

        case 'faq':
            return (
                <Accordion type="multiple" className="rounded-lg border px-4">
                    {block.items.map((item, at) => (
                        <AccordionItem key={at} value={`faq-${index}-${at}`}>
                            <AccordionTrigger className="text-sm">{item.question}</AccordionTrigger>
                            <AccordionContent className="text-sm leading-7">
                                {item.answer}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            );

        case 'divider':
            return <hr className="border-border" />;
    }
}

/**
 * One rich-text field.
 *
 * ⚠ **Adjacent, with nothing between them.** A `join(' ')` or a gap utility here
 * would put a space inside a word that a bold run splits.
 */
function Spans({ value }: { value: RichText }) {
    return (
        <>
            {value.map((span, index) => {
                const marked = (
                    <span
                        className={cn(
                            span.bold && 'font-semibold',
                            span.italic && 'italic',
                            span.code && 'bg-muted rounded px-1 py-0.5 font-mono text-xs',
                        )}
                    >
                        {span.text}
                    </span>
                );

                // Links render as underlined text, never as an `<a href>` — see
                // the `cta` note: a preview must not navigate.
                return span.type === 'link' ? (
                    <span
                        key={index}
                        className="text-primary underline decoration-dotted underline-offset-2"
                        title={span.href}
                    >
                        {marked}
                    </span>
                ) : (
                    <span key={index}>{marked}</span>
                );
            })}
        </>
    );
}
