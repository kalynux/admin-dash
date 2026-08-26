import { Bold, Code, Italic, Link2, Plus, Trash2, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { hrefProblem } from '@/lib/article-body';
import { cn } from '@/lib/utils';
import { HREF_MAX, type RichText, type RichTextSpan } from '@/types/content.types';

/**
 * The control for a rich-text field — a **flat array of spans**, edited as one.
 *
 * ── ⚠ Why this is a span list and not a WYSIWYG box ───────────────────────────
 * Because the wire format is a span list, and the flatness is a **security
 * property rather than a simplification**. An HTML string from a contenteditable
 * has to be sanitised on the way in and rendered with `dangerouslySetInnerHTML`
 * on the way out; one missed edge case is stored XSS on the marketing domain,
 * which is the same origin as the auth pages. A span array renders through React
 * components that cannot emit markup nobody asked for by name.
 *
 * Building a WYSIWYG surface over it would mean writing an HTML→spans parser,
 * which is the sanitiser problem again wearing a different hat. So the editor
 * shows the runs the way they are stored: one row per span, marks as toggles.
 *
 * ── ⚠ Spans are never trimmed ────────────────────────────────────────────────
 * `"Commission is taken "` and its trailing space are meaningful — the renderer
 * concatenates spans with **no separator**, so trimming would jam the words
 * either side of a bold run together. The inputs below do not trim, and nothing
 * downstream may either.
 *
 * ── Marks compose; links are a span type, not a mark ──────────────────────────
 * Bold, italic and code are independent flags on one span. A link is a different
 * `type` because it carries an `href` — so "make this a link" replaces the span
 * rather than adding a flag, and the marks survive the change.
 */
export function RichTextField({
    value,
    onChange,
    label,
    idPrefix,
}: {
    value: RichText;
    onChange: (next: RichText) => void;
    label: string;
    idPrefix: string;
}) {
    function replace(index: number, span: RichTextSpan) {
        onChange(value.map((existing, at) => (at === index ? span : existing)));
    }

    function toggleMark(index: number, mark: 'bold' | 'italic' | 'code') {
        const span = value[index];
        // Written as absent rather than `false`: the schema is `.strict()` and
        // the marks are optional, so an explicit `false` is noise on the wire
        // that the backend would store and echo back forever.
        const next = { ...span };
        if (next[mark]) delete next[mark];
        else next[mark] = true;
        replace(index, next);
    }

    function toggleLink(index: number) {
        const span = value[index];
        if (span.type === 'link') {
            // Rebuilt field by field rather than spread-minus-href, because a
            // `text` span carrying a stray `href` is a `400` from a `.strict()`
            // schema — and a spread is exactly how one survives. The marks are
            // carried across deliberately: unlinking should not un-bold.
            replace(index, {
                type: 'text',
                text: span.text,
                ...(span.bold ? { bold: true } : {}),
                ...(span.italic ? { italic: true } : {}),
                ...(span.code ? { code: true } : {}),
            });
            return;
        }
        replace(index, { ...span, type: 'link', href: '' });
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange([...value, { type: 'text', text: '' }])}
                >
                    <Plus className="size-4" />
                    Add a run
                </Button>
            </div>

            <ul className="space-y-2">
                {value.map((span, index) => {
                    const linkProblem = span.type === 'link' ? hrefProblem(span.href) : null;

                    return (
                        <li
                            // Index as key: spans have no id, and reordering is
                            // not offered here — a run is edited or removed in
                            // place, so the index is stable for its lifetime.
                            key={index}
                            className="bg-muted/30 space-y-2 rounded-lg border p-2"
                        >
                            <div className="flex flex-wrap items-center gap-1.5">
                                <Input
                                    id={`${idPrefix}-span-${index}`}
                                    value={span.text}
                                    // No trim, deliberately — see the header.
                                    onChange={(event) =>
                                        replace(index, { ...span, text: event.target.value })
                                    }
                                    placeholder="A run of text"
                                    className={cn(
                                        'min-w-40 flex-1',
                                        span.bold && 'font-bold',
                                        span.italic && 'italic',
                                        span.code && 'font-mono',
                                    )}
                                    aria-label={`${label} run ${index + 1}`}
                                />

                                <MarkToggle
                                    pressed={span.bold === true}
                                    onPressedChange={() => toggleMark(index, 'bold')}
                                    label="Bold"
                                    icon={Bold}
                                />
                                <MarkToggle
                                    pressed={span.italic === true}
                                    onPressedChange={() => toggleMark(index, 'italic')}
                                    label="Italic"
                                    icon={Italic}
                                />
                                <MarkToggle
                                    pressed={span.code === true}
                                    onPressedChange={() => toggleMark(index, 'code')}
                                    label="Code"
                                    icon={Code}
                                />
                                <MarkToggle
                                    pressed={span.type === 'link'}
                                    onPressedChange={() => toggleLink(index)}
                                    label={span.type === 'link' ? 'Remove the link' : 'Make a link'}
                                    icon={span.type === 'link' ? Unlink : Link2}
                                />

                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Remove run ${index + 1}`}
                                    // The last run is not removable: rich text
                                    // needs at least one span, and an empty array
                                    // is a `400` rather than an empty paragraph.
                                    disabled={value.length <= 1}
                                    onClick={() => onChange(value.filter((_, at) => at !== index))}
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>

                            {span.type === 'link' ? (
                                <div className="space-y-1">
                                    <Input
                                        id={`${idPrefix}-href-${index}`}
                                        value={span.href}
                                        onChange={(event) =>
                                            replace(index, { ...span, href: event.target.value })
                                        }
                                        placeholder="/pricing"
                                        maxLength={HREF_MAX}
                                        aria-label={`Link target for run ${index + 1}`}
                                        aria-invalid={linkProblem ? true : undefined}
                                        className="font-mono text-xs"
                                    />
                                    {linkProblem ? (
                                        <p className="text-destructive text-xs">{linkProblem}</p>
                                    ) : (
                                        <p className="text-muted-foreground text-xs">
                                            An internal path, a #fragment, a mailto: address, or an
                                            http(s):// URL. Internal paths carry no language
                                            prefix.
                                        </p>
                                    )}
                                </div>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function MarkToggle({
    pressed,
    onPressedChange,
    label,
    icon: Icon,
}: {
    pressed: boolean;
    onPressedChange: () => void;
    label: string;
    icon: typeof Bold;
}) {
    return (
        <Toggle
            size="sm"
            pressed={pressed}
            onPressedChange={onPressedChange}
            aria-label={label}
            title={label}
        >
            <Icon className="size-4" />
        </Toggle>
    );
}
