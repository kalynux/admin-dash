/**
 * An article body as JSON — export, and import with a check before anything is
 * replaced.
 *
 * The file format is not a new one. It is **the body exactly as the service
 * stores it**: a bare array of blocks, the shape `ArticleBodySchema` in
 * [`api-doc/admin/article-blocks.ts`](../../api-doc/admin/article-blocks.ts)
 * validates. Exporting is `JSON.stringify` of the draft, and a file written by
 * hand in that shape is a body the block editor can open.
 *
 * ── Two kinds of problem, and why they are treated differently ────────────────
 * An import is checked in two passes, and only the first can refuse it.
 *
 * 1. **Shape** — is this something the block editor can render at all? Not JSON,
 *    not an array, an unknown block `type`, a field of the wrong kind (`"width":
 *    "1200"`), a heading at level 4, a key the schema does not know. The editor
 *    has no control that could show or repair any of these, so the import is
 *    **refused** and the draft is left exactly as it was.
 * 2. **Rules** — `validateArticleBody`: an empty run of text, a placeholder image
 *    url, a locale-prefixed link, a duplicate anchor. Every one of these has a
 *    field in the editor where it can be fixed, so the body **loads** and the
 *    problems are shown on their blocks; Save stays disabled until they are gone,
 *    exactly as it does for a body typed by hand.
 *
 * ⚠ **An unknown key is a shape problem, not a rule problem, and is never
 * dropped.** The schema is `.strict()`, so the server would refuse it — but the
 * editor cannot display it either, so loading it would leave an operator with a
 * Save button that fails for a reason no field on screen explains. Stripping it
 * silently would be worse: `"titel"` on a callout is a typo for a title somebody
 * meant to publish.
 *
 * ⚠ **This is a convenience, never the gate** — the same rule as
 * `article-body.ts`. The server's schema is the only thing between a body and a
 * public page; nothing here may *pass* a body it would refuse.
 */

import { validateArticleBody, type BodyProblem } from '@/lib/article-body';
import {
    ARTICLE_BLOCK_TYPES,
    CALLOUT_TONES,
    type ArticleBlock,
    type ArticleBody,
} from '@/types/content.types';

// ─── Export ───────────────────────────────────────────────────────────────────

/** Two-space indentation: the file is meant to be read and edited by a person. */
export function articleBodyToJson(body: ArticleBody): string {
    return `${JSON.stringify(body, null, 2)}\n`;
}

/** `getting-paid-on-whatsapp.fr.json`, or `article-body.fr.json` before an id exists. */
export function articleBodyFileName(articleId: string, locale: string): string {
    const base = articleId.trim().length > 0 ? articleId.trim() : 'article-body';
    return `${base}.${locale}.json`;
}

// ─── Import ───────────────────────────────────────────────────────────────────

export type ArticleBodyImport =
    /** Refused: the draft must not change. `problems` is never empty. */
    | { ok: false; problems: BodyProblem[] }
    /** Readable. `problems` are rule problems the editor can fix; Save waits on them. */
    | { ok: true; body: ArticleBody; problems: BodyProblem[] };

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: Json): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'a list';
    if (typeof value === 'object') return 'an object';
    return `a ${typeof value}`;
}

/** The keys each block may carry — `.strict()` refuses any other. */
const BLOCK_KEYS: Record<ArticleBlock['type'], readonly string[]> = {
    heading: ['type', 'level', 'id', 'text'],
    paragraph: ['type', 'text'],
    list: ['type', 'ordered', 'items'],
    quote: ['type', 'text', 'attribution'],
    callout: ['type', 'tone', 'title', 'text'],
    image: ['type', 'url', 'alt', 'width', 'height', 'caption'],
    cta: ['type', 'title', 'body', 'href', 'label'],
    faq: ['type', 'items'],
    divider: ['type'],
};

const SPAN_KEYS = {
    text: ['type', 'text', 'bold', 'italic', 'code'],
    link: ['type', 'text', 'href', 'bold', 'italic', 'code'],
} as const;

/**
 * Collects shape problems for one block. Each `need*` call reports at most one
 * problem per field, and the messages name the field as it is spelt in the file,
 * because the file is where the operator will go to fix it.
 */
class ShapeCheck {
    readonly messages: string[] = [];

    unknownKeys(record: Record<string, Json>, allowed: readonly string[], where: string) {
        for (const key of Object.keys(record)) {
            if (!allowed.includes(key)) {
                this.messages.push(
                    `${where}has an unknown field “${key}” — allowed: ${allowed.join(', ')}`,
                );
            }
        }
    }

    string(record: Record<string, Json>, key: string, where = '', optional = false) {
        const value = record[key];
        if (value === undefined && optional) return;
        if (typeof value !== 'string') {
            this.messages.push(
                value === undefined
                    ? `${where}is missing “${key}”`
                    : `${where}“${key}” must be text, not ${describe(value)}`,
            );
        }
    }

    number(record: Record<string, Json>, key: string) {
        const value = record[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            this.messages.push(
                value === undefined
                    ? `is missing “${key}”`
                    : `“${key}” must be a number, not ${describe(value)}`,
            );
        }
    }

    boolean(record: Record<string, Json>, key: string, where = '') {
        const value = record[key];
        if (value !== undefined && typeof value !== 'boolean') {
            this.messages.push(`${where}“${key}” must be true or false, not ${describe(value)}`);
        }
    }

    array(record: Record<string, Json>, key: string): Json[] | null {
        const value = record[key];
        if (Array.isArray(value)) return value;
        this.messages.push(
            value === undefined
                ? `is missing “${key}”`
                : `“${key}” must be a list, not ${describe(value)}`,
        );
        return null;
    }

    /** A rich-text field: a list of `text` / `link` runs. */
    richText(value: Json, where: string) {
        if (!Array.isArray(value)) {
            this.messages.push(
                value === undefined
                    ? `is missing ${where}`
                    : `${where} must be a list of text runs, not ${describe(value)}`,
            );
            return;
        }
        value.forEach((span, index) => {
            const at = `${where}, run ${index + 1}, `;
            if (!isRecord(span)) {
                this.messages.push(`${at}must be an object, not ${describe(span)}`);
                return;
            }
            if (span.type !== 'text' && span.type !== 'link') {
                this.messages.push(`${at}“type” must be "text" or "link"`);
                return;
            }
            this.unknownKeys(span, SPAN_KEYS[span.type], at);
            this.string(span, 'text', at);
            if (span.type === 'link') this.string(span, 'href', at);
            for (const mark of ['bold', 'italic', 'code']) this.boolean(span, mark, at);
        });
    }
}

function blockShapeProblems(block: Json): string[] {
    const check = new ShapeCheck();

    if (!isRecord(block)) return [`must be an object, not ${describe(block)}`];

    const type = block.type;
    if (typeof type !== 'string' || !(ARTICLE_BLOCK_TYPES as readonly string[]).includes(type)) {
        return [
            `has an unknown “type”${typeof type === 'string' ? ` "${type}"` : ''} — use one of: ${ARTICLE_BLOCK_TYPES.join(', ')}`,
        ];
    }
    const blockType = type as ArticleBlock['type'];
    check.unknownKeys(block, BLOCK_KEYS[blockType], '');

    switch (blockType) {
        case 'heading':
            if (block.level !== 2 && block.level !== 3) {
                check.messages.push('“level” must be 2 or 3 — the title is the only level 1');
            }
            check.string(block, 'id');
            check.string(block, 'text');
            break;
        case 'paragraph':
            check.richText(block.text, '“text”');
            break;
        case 'list': {
            check.boolean(block, 'ordered');
            const items = check.array(block, 'items');
            items?.forEach((item, index) => check.richText(item, `item ${index + 1}`));
            break;
        }
        case 'quote':
            check.string(block, 'text');
            check.string(block, 'attribution', '', true);
            break;
        case 'callout':
            if (!(CALLOUT_TONES as readonly Json[]).includes(block.tone)) {
                check.messages.push(`“tone” must be one of: ${CALLOUT_TONES.join(', ')}`);
            }
            check.string(block, 'title', '', true);
            check.richText(block.text, '“text”');
            break;
        case 'image':
            check.string(block, 'url');
            check.string(block, 'alt');
            check.number(block, 'width');
            check.number(block, 'height');
            check.string(block, 'caption', '', true);
            break;
        case 'cta':
            for (const key of ['title', 'body', 'href', 'label']) check.string(block, key);
            break;
        case 'faq': {
            const items = check.array(block, 'items');
            items?.forEach((item, index) => {
                const at = `question ${index + 1}, `;
                if (!isRecord(item)) {
                    check.messages.push(`${at}must be an object, not ${describe(item)}`);
                    return;
                }
                check.unknownKeys(item, ['question', 'answer'], at);
                check.string(item, 'question', at);
                check.string(item, 'answer', at);
            });
            break;
        }
        case 'divider':
            break;
    }

    return check.messages;
}

/**
 * Read a pasted or uploaded file as an article body.
 *
 * A leading byte-order mark is tolerated — Windows editors write one, and
 * `JSON.parse` refuses it with a message that names no visible character.
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function parseArticleBodyJson(text: string): ArticleBodyImport {
    const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;

    if (source.trim().length === 0) {
        return { ok: false, problems: [{ blockIndex: null, message: 'The file is empty.' }] };
    }

    let parsed: Json;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            problems: [{ blockIndex: null, message: `This is not valid JSON: ${detail}` }],
        };
    }

    if (!Array.isArray(parsed)) {
        return {
            ok: false,
            problems: [
                {
                    blockIndex: null,
                    message: `Expected a list of blocks — the file should start with “[” — but it holds ${describe(parsed)}.`,
                },
            ],
        };
    }

    const shapeProblems: BodyProblem[] = parsed.flatMap((block, index) =>
        blockShapeProblems(block).map((message) => ({ blockIndex: index, message })),
    );
    if (shapeProblems.length > 0) return { ok: false, problems: shapeProblems };

    const body = parsed as ArticleBody;
    return { ok: true, body, problems: validateArticleBody(body) };
}
