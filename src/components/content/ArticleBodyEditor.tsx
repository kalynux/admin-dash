import { ChevronDown, ChevronUp, Plus, Trash2, Wand2 } from 'lucide-react';

import { RichTextField } from '@/components/content/RichTextField';
import { Button } from '@/components/ui/button';
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
import { countWords, emptyBlock, suggestHeadingId, validateArticleBody } from '@/lib/article-body';
import { formatCount } from '@/lib/format';
import {
    ARTICLE_BLOCK_TYPES,
    ARTICLE_BODY_MAX_BLOCKS,
    CALLOUT_TONES,
    CTA_BODY_MAX,
    CTA_LABEL_MAX,
    CTA_TITLE_MAX,
    CALLOUT_TITLE_MAX,
    FAQ_ANSWER_MAX,
    FAQ_QUESTION_MAX,
    HEADING_ID_MAX,
    HEADING_TEXT_MAX,
    HREF_MAX,
    IMAGE_ALT_MAX,
    IMAGE_CAPTION_MAX,
    IMAGE_URL_MAX,
    QUOTE_ATTRIBUTION_MAX,
    QUOTE_TEXT_MAX,
    type ArticleBlock,
    type ArticleBody,
    type ArticleBlockType,
    type CalloutTone,
    type FaqItem,
} from '@/types/content.types';

/** What each block is called in the picker, and what it is for. */
const BLOCK_LABELS: Record<ArticleBlockType, { label: string; hint: string }> = {
    heading: { label: 'Heading', hint: 'A section title, with the anchor readers link to' },
    paragraph: { label: 'Paragraph', hint: 'Prose, with bold, italic, code and links' },
    list: { label: 'List', hint: 'Bulleted or numbered' },
    quote: { label: 'Quote', hint: 'A pull quote, optionally attributed' },
    callout: { label: 'Callout', hint: 'A note, a tip or a warning, set apart' },
    image: { label: 'Image', hint: 'A picture, with the dimensions that reserve its space' },
    cta: { label: 'Call to action', hint: 'A titled block with one button' },
    faq: { label: 'FAQ', hint: 'Questions and answers — also emitted as structured data' },
    divider: { label: 'Divider', hint: 'A rule between sections' },
};

/**
 * The article body editor.
 *
 * ── What made this buildable ──────────────────────────────────────────────────
 * `content.md` still names none of the nine block types — it says `body` is *"a
 * discriminated union of nine block types, `.strict()` throughout"* and stops.
 * The union comes from [`docs/admin/article-blocks.ts`](../../../docs/admin/article-blocks.ts),
 * a byte-identical mirror of the backend's own validator, and
 * `content-blocks.test.ts` diffs it against `ARTICLE_BLOCK_TYPES` so a tenth
 * block type fails the build rather than leaving this editor silently unable to
 * produce it.
 *
 * ── ⚠ The schema is `.strict()`, so shape errors are hard errors ─────────────
 * An unknown block type **and every unknown key on a known block** is a `400`,
 * never a silently dropped field. Two consequences run through this file:
 *
 * - **an optional field that is blank is omitted, never sent as `""`** — see
 *   `pruneOptional`;
 * - **`wordCount` is never sent.** The backend derives it on write so it cannot
 *   drift from the prose. The count shown below is the same algorithm run
 *   locally, so the number does not jump on save.
 *
 * ── ⚠ Heading ids are authored, never derived ────────────────────────────────
 * There is a "suggest" button and it is a **one-shot convenience**, never a live
 * binding. Deriving the id from the text on every keystroke breaks every anchor
 * anyone has shared the moment a title is retouched — silently, because the page
 * still renders. That is the whole reason the field exists separately.
 */
export function ArticleBodyEditor({
    value,
    onChange,
    idPrefix,
}: {
    value: ArticleBody;
    onChange: (next: ArticleBody) => void;
    idPrefix: string;
}) {
    const problems = validateArticleBody(value);
    const problemFor = (index: number) =>
        problems.find((problem) => problem.blockIndex === index)?.message;
    const bodyProblems = problems.filter((problem) => problem.blockIndex === null);

    function update(index: number, block: ArticleBlock) {
        onChange(value.map((existing, at) => (at === index ? block : existing)));
    }

    function move(index: number, by: -1 | 1) {
        const target = index + by;
        if (target < 0 || target >= value.length) return;
        const next = [...value];
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                    {formatCount(value.length)} block{value.length === 1 ? '' : 's'} ·{' '}
                    {formatCount(countWords(value))} word{countWords(value) === 1 ? '' : 's'}
                </p>
                <AddBlock
                    disabled={value.length >= ARTICLE_BODY_MAX_BLOCKS}
                    onAdd={(type) => onChange([...value, emptyBlock(type)])}
                />
            </div>

            {bodyProblems.length > 0 ? (
                <ul className="border-destructive/30 bg-destructive/10 text-destructive space-y-1 rounded-lg border px-3 py-2 text-sm">
                    {bodyProblems.map((problem) => (
                        <li key={problem.message}>{problem.message}</li>
                    ))}
                </ul>
            ) : null}

            <ul className="space-y-3">
                {value.map((block, index) => (
                    <li key={index} className="space-y-2 rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium">
                                    {BLOCK_LABELS[block.type].label}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    Block {index + 1} of {value.length}
                                </p>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Move block ${index + 1} up`}
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    <ChevronUp className="size-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Move block ${index + 1} down`}
                                    disabled={index === value.length - 1}
                                    onClick={() => move(index, 1)}
                                >
                                    <ChevronDown className="size-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Remove block ${index + 1}`}
                                    onClick={() => onChange(value.filter((_, at) => at !== index))}
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        </div>

                        <BlockFields
                            block={block}
                            idPrefix={`${idPrefix}-${index}`}
                            onChange={(next) => update(index, next)}
                        />

                        {problemFor(index) ? (
                            <p className="text-destructive text-xs">{problemFor(index)}</p>
                        ) : null}
                    </li>
                ))}
            </ul>

            {value.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm">
                    Nothing written yet. Add a block to begin.
                </p>
            ) : null}
        </div>
    );
}

function AddBlock({
    onAdd,
    disabled,
}: {
    onAdd: (type: ArticleBlockType) => void;
    disabled: boolean;
}) {
    return (
        <Select
            // Never holds a value: it is an action menu wearing a select, so it
            // resets to the placeholder after every choice.
            value=""
            onValueChange={(next) => onAdd(next as ArticleBlockType)}
            disabled={disabled}
        >
            <SelectTrigger className="w-56" aria-label="Add a block">
                <Plus className="size-4" />
                <SelectValue placeholder="Add a block" />
            </SelectTrigger>
            <SelectContent>
                {ARTICLE_BLOCK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                        <span className="font-medium">{BLOCK_LABELS[type].label}</span>
                        <span className="text-muted-foreground block text-xs">
                            {BLOCK_LABELS[type].hint}
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/**
 * ⚠ **An optional field left blank is REMOVED, not sent as `""`.**
 *
 * The schema is `.strict()` and these fields are `.min(1).optional()`, so an
 * empty string is a validation failure rather than "no value" — the difference
 * between omitting a key and sending an empty one is the difference between a
 * save and a `400`.
 */
function pruneOptional<T extends object, K extends keyof T>(block: T, key: K, raw: string): T {
    const next = { ...block };
    if (raw.length === 0) delete next[key];
    else next[key] = raw as T[K];
    return next;
}

function BlockFields({
    block,
    onChange,
    idPrefix,
}: {
    block: ArticleBlock;
    onChange: (next: ArticleBlock) => void;
    idPrefix: string;
}) {
    switch (block.type) {
        case 'heading':
            return (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-level`}>Level</Label>
                            <Select
                                value={String(block.level)}
                                onValueChange={(next) =>
                                    onChange({ ...block, level: Number(next) as 2 | 3 })
                                }
                            >
                                <SelectTrigger id={`${idPrefix}-level`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* No h1: the article title is the h1. */}
                                    <SelectItem value="2">Heading 2</SelectItem>
                                    <SelectItem value="3">Heading 3</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-text`}>Text</Label>
                            <Input
                                id={`${idPrefix}-text`}
                                value={block.text}
                                maxLength={HEADING_TEXT_MAX}
                                onChange={(event) =>
                                    onChange({ ...block, text: event.target.value })
                                }
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-id`}>Anchor id</Label>
                        <div className="flex gap-2">
                            <Input
                                id={`${idPrefix}-id`}
                                value={block.id}
                                maxLength={HEADING_ID_MAX}
                                placeholder="how-momo-payouts-work"
                                className="font-mono text-xs"
                                onChange={(event) =>
                                    onChange({ ...block, id: event.target.value })
                                }
                            />
                            <Button
                                type="button"
                                variant="outline"
                                // ⚠ One shot, on demand. NOT bound to the text —
                                // see the module header.
                                onClick={() =>
                                    onChange({ ...block, id: suggestHeadingId(block.text) })
                                }
                                disabled={block.text.trim().length === 0}
                            >
                                <Wand2 className="size-4" />
                                Suggest
                            </Button>
                        </div>
                        <p className="text-muted-foreground text-xs">
                            Readers link straight to this anchor, so it is written once and then
                            left alone — editing the heading text afterwards must not change it, or
                            every shared link breaks silently.
                        </p>
                    </div>
                </div>
            );

        case 'paragraph':
            return (
                <RichTextField
                    label="Text"
                    idPrefix={idPrefix}
                    value={block.text}
                    onChange={(text) => onChange({ ...block, text })}
                />
            );

        case 'list':
            return (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            id={`${idPrefix}-ordered`}
                            checked={block.ordered === true}
                            onCheckedChange={(checked) => {
                                // Absent means unordered; an explicit `false` is
                                // noise the backend would store forever.
                                const next = { ...block };
                                if (checked) next.ordered = true;
                                else delete next.ordered;
                                onChange(next);
                            }}
                        />
                        <Label htmlFor={`${idPrefix}-ordered`}>Numbered</Label>
                    </div>

                    {block.items.map((item, at) => (
                        <div key={at} className="flex items-start gap-2">
                            <div className="flex-1">
                                <RichTextField
                                    label={`Item ${at + 1}`}
                                    idPrefix={`${idPrefix}-item-${at}`}
                                    value={item}
                                    onChange={(next) =>
                                        onChange({
                                            ...block,
                                            items: block.items.map((existing, i) =>
                                                i === at ? next : existing,
                                            ),
                                        })
                                    }
                                />
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove item ${at + 1}`}
                                disabled={block.items.length <= 1}
                                onClick={() =>
                                    onChange({
                                        ...block,
                                        items: block.items.filter((_, i) => i !== at),
                                    })
                                }
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            onChange({
                                ...block,
                                items: [...block.items, [{ type: 'text', text: '' }]],
                            })
                        }
                    >
                        <Plus className="size-4" />
                        Add an item
                    </Button>
                </div>
            );

        case 'quote':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-quote`}>Quote</Label>
                        <Textarea
                            id={`${idPrefix}-quote`}
                            value={block.text}
                            maxLength={QUOTE_TEXT_MAX}
                            rows={3}
                            onChange={(event) => onChange({ ...block, text: event.target.value })}
                        />
                        <p className="text-muted-foreground text-xs">
                            Plain text — a pull quote is one voice, so it carries no formatting or
                            links.
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-attribution`}>Attribution (optional)</Label>
                        <Input
                            id={`${idPrefix}-attribution`}
                            value={block.attribution ?? ''}
                            maxLength={QUOTE_ATTRIBUTION_MAX}
                            onChange={(event) =>
                                onChange(pruneOptional(block, 'attribution', event.target.value))
                            }
                        />
                    </div>
                </div>
            );

        case 'callout':
            return (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-tone`}>Tone</Label>
                            <Select
                                value={block.tone}
                                onValueChange={(next) =>
                                    onChange({ ...block, tone: next as CalloutTone })
                                }
                            >
                                <SelectTrigger id={`${idPrefix}-tone`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CALLOUT_TONES.map((tone) => (
                                        <SelectItem key={tone} value={tone}>
                                            {tone}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-callout-title`}>Title (optional)</Label>
                            <Input
                                id={`${idPrefix}-callout-title`}
                                value={block.title ?? ''}
                                maxLength={CALLOUT_TITLE_MAX}
                                onChange={(event) =>
                                    onChange(pruneOptional(block, 'title', event.target.value))
                                }
                            />
                        </div>
                    </div>
                    <RichTextField
                        label="Text"
                        idPrefix={idPrefix}
                        value={block.text}
                        onChange={(text) => onChange({ ...block, text })}
                    />
                </div>
            );

        case 'image':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-url`}>Image url</Label>
                        <Input
                            id={`${idPrefix}-url`}
                            value={block.url}
                            maxLength={IMAGE_URL_MAX}
                            placeholder="/media/2026/momo-payouts.png"
                            className="font-mono text-xs"
                            onChange={(event) => onChange({ ...block, url: event.target.value })}
                        />
                        <p className="text-muted-foreground text-xs">
                            This dashboard cannot upload — no route on this service accepts a file
                            body. Point at a url the marketing site already serves.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-alt`}>Alt text</Label>
                        <Input
                            id={`${idPrefix}-alt`}
                            value={block.alt}
                            maxLength={IMAGE_ALT_MAX}
                            onChange={(event) => onChange({ ...block, alt: event.target.value })}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-width`}>Width in pixels</Label>
                            <Input
                                id={`${idPrefix}-width`}
                                type="number"
                                min={1}
                                value={block.width || ''}
                                onChange={(event) =>
                                    onChange({ ...block, width: Number(event.target.value) })
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-height`}>Height in pixels</Label>
                            <Input
                                id={`${idPrefix}-height`}
                                type="number"
                                min={1}
                                value={block.height || ''}
                                onChange={(event) =>
                                    onChange({ ...block, height: Number(event.target.value) })
                                }
                            />
                        </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                        Both are required, and they must be the image&rsquo;s real dimensions: they
                        reserve the box so the paragraph underneath does not jump while the picture
                        loads.
                    </p>

                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-caption`}>Caption (optional)</Label>
                        <Input
                            id={`${idPrefix}-caption`}
                            value={block.caption ?? ''}
                            maxLength={IMAGE_CAPTION_MAX}
                            onChange={(event) =>
                                onChange(pruneOptional(block, 'caption', event.target.value))
                            }
                        />
                    </div>
                </div>
            );

        case 'cta':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-cta-title`}>Title</Label>
                        <Input
                            id={`${idPrefix}-cta-title`}
                            value={block.title}
                            maxLength={CTA_TITLE_MAX}
                            onChange={(event) => onChange({ ...block, title: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={`${idPrefix}-cta-body`}>Body</Label>
                        <Textarea
                            id={`${idPrefix}-cta-body`}
                            value={block.body}
                            maxLength={CTA_BODY_MAX}
                            rows={2}
                            onChange={(event) => onChange({ ...block, body: event.target.value })}
                        />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-cta-label`}>Button label</Label>
                            <Input
                                id={`${idPrefix}-cta-label`}
                                value={block.label}
                                maxLength={CTA_LABEL_MAX}
                                onChange={(event) =>
                                    onChange({ ...block, label: event.target.value })
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor={`${idPrefix}-cta-href`}>Button target</Label>
                            <Input
                                id={`${idPrefix}-cta-href`}
                                value={block.href}
                                maxLength={HREF_MAX}
                                placeholder="/signup"
                                className="font-mono text-xs"
                                onChange={(event) =>
                                    onChange({ ...block, href: event.target.value })
                                }
                            />
                        </div>
                    </div>
                </div>
            );

        case 'faq':
            return (
                <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                        Rendered as an accordion <em>and</em> as structured data a search engine
                        reads, which is why the answers are plain text rather than rich.
                    </p>
                    {block.items.map((item, at) => (
                        <FaqRow
                            key={at}
                            item={item}
                            index={at}
                            idPrefix={idPrefix}
                            removable={block.items.length > 1}
                            onChange={(next) =>
                                onChange({
                                    ...block,
                                    items: block.items.map((existing, i) =>
                                        i === at ? next : existing,
                                    ),
                                })
                            }
                            onRemove={() =>
                                onChange({
                                    ...block,
                                    items: block.items.filter((_, i) => i !== at),
                                })
                            }
                        />
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            onChange({
                                ...block,
                                items: [...block.items, { question: '', answer: '' }],
                            })
                        }
                    >
                        <Plus className="size-4" />
                        Add a question
                    </Button>
                </div>
            );

        case 'divider':
            return (
                <p className="text-muted-foreground text-sm">
                    A horizontal rule. Nothing to configure.
                </p>
            );
    }
}

function FaqRow({
    item,
    index,
    idPrefix,
    removable,
    onChange,
    onRemove,
}: {
    item: FaqItem;
    index: number;
    idPrefix: string;
    removable: boolean;
    onChange: (next: FaqItem) => void;
    onRemove: () => void;
}) {
    return (
        <div className="bg-muted/30 space-y-2 rounded-lg border p-2">
            <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`${idPrefix}-q-${index}`}>Question {index + 1}</Label>
                    <Input
                        id={`${idPrefix}-q-${index}`}
                        value={item.question}
                        maxLength={FAQ_QUESTION_MAX}
                        onChange={(event) => onChange({ ...item, question: event.target.value })}
                    />
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove question ${index + 1}`}
                    disabled={!removable}
                    onClick={onRemove}
                >
                    <Trash2 className="size-4" />
                </Button>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-a-${index}`}>Answer</Label>
                <Textarea
                    id={`${idPrefix}-a-${index}`}
                    value={item.answer}
                    maxLength={FAQ_ANSWER_MAX}
                    rows={2}
                    onChange={(event) => onChange({ ...item, answer: event.target.value })}
                />
            </div>
        </div>
    );
}
