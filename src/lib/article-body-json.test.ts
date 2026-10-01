import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateArticleBody } from '@/lib/article-body';
import {
    articleBodyFileName,
    articleBodyToJson,
    parseArticleBodyJson,
} from '@/lib/article-body-json';
import {
    initialPlan,
    planForReplacement,
    planRemovesOrReorders,
    sameLayout,
} from '@/lib/article-structure';
import type { ArticleBody } from '@/types/content.types';

const HERE = dirname(fileURLToPath(import.meta.url));
/** A real article an editor drafted as JSON, with its two images not yet uploaded. */
const SAMPLE = readFileSync(resolve(HERE, '../test/article-body-sample.json'), 'utf8');

const VALID: ArticleBody = [
    { type: 'heading', level: 2, id: 'paid', text: 'Getting paid' },
    {
        type: 'paragraph',
        text: [
            { type: 'text', text: 'Commission is ' },
            { type: 'text', text: 'taken', bold: true },
            { type: 'link', text: ' at payment', href: '/pricing' },
        ],
    },
    { type: 'list', ordered: true, items: [[{ type: 'text', text: 'Mobile money' }]] },
    { type: 'quote', text: 'It arrived the same day.', attribution: 'A vendor' },
    { type: 'callout', tone: 'tip', title: 'Tip', text: [{ type: 'text', text: 'Early.' }] },
    { type: 'image', url: '/media/a.png', alt: 'A stall', width: 800, height: 600 },
    { type: 'cta', title: 'Start', body: 'Ten minutes.', href: '/signup', label: 'Go' },
    { type: 'faq', items: [{ question: 'When?', answer: 'Two days.' }] },
    { type: 'divider' },
];

function refused(text: string) {
    const result = parseArticleBodyJson(text);
    if (result.ok) throw new Error('expected the import to be refused');
    return result.problems;
}

describe('export', () => {
    it('round-trips every block type unchanged and with no problems', () => {
        const result = parseArticleBodyJson(articleBodyToJson(VALID));
        expect(result).toEqual({ ok: true, body: VALID, problems: [] });
    });

    it('names the file after the article and the language', () => {
        expect(articleBodyFileName('whatsapp-sales', 'fr')).toBe('whatsapp-sales.fr.json');
        expect(articleBodyFileName('  ', 'en')).toBe('article-body.en.json');
    });
});

describe('the sample article', () => {
    it('loads, and only its two placeholder image urls stand between it and a save', () => {
        const result = parseArticleBodyJson(SAMPLE);
        if (!result.ok) throw new Error(JSON.stringify(result.problems));

        expect(result.body).toHaveLength(28);
        expect(result.problems.map((problem) => problem.blockIndex)).toEqual([7, 11]);
        expect(result.problems[0].message).toMatch(/image url/i);
    });
});

describe('a file the editor cannot display is refused, and says where', () => {
    it('refuses text that is not JSON', () => {
        expect(refused('[{"type": "divider"},]')[0].message).toMatch(/not valid JSON/);
    });

    it('refuses an empty file', () => {
        expect(refused('   ')[0].message).toMatch(/empty/);
    });

    it('refuses a single object rather than a list', () => {
        expect(refused('{"type":"divider"}')[0].message).toMatch(/list of blocks/);
    });

    it('refuses an unknown block type', () => {
        const [problem] = refused('[{"type":"divider"},{"type":"video","url":"/v.mp4"}]');
        expect(problem.blockIndex).toBe(1);
        expect(problem.message).toMatch(/unknown “type” "video"/);
    });

    it('refuses a misspelt key rather than dropping it', () => {
        const [problem] = refused(
            '[{"type":"callout","tone":"tip","titel":"Hi","text":[{"type":"text","text":"x"}]}]',
        );
        expect(problem.message).toMatch(/unknown field “titel”/);
    });

    it('refuses a number written as text', () => {
        const [problem] = refused(
            '[{"type":"image","url":"/a.png","alt":"a","width":"1200","height":800}]',
        );
        expect(problem.message).toMatch(/“width” must be a number/);
    });

    it('refuses a heading level the editor has no option for', () => {
        expect(refused('[{"type":"heading","level":4,"id":"a","text":"A"}]')[0].message).toMatch(
            /level/,
        );
    });

    it('refuses a run of text that is a bare string', () => {
        expect(refused('[{"type":"paragraph","text":"plain"}]')[0].message).toMatch(
            /list of text runs/,
        );
    });

    it('refuses an unknown callout tone', () => {
        expect(
            refused('[{"type":"callout","tone":"danger","text":[{"type":"text","text":"x"}]}]')[0]
                .message,
        ).toMatch(/tone/);
    });
});

describe('a file the editor can fix loads, with its problems on their blocks', () => {
    it('tolerates the byte-order mark a Windows editor writes', () => {
        expect(parseArticleBodyJson(String.fromCharCode(0xfeff) + articleBodyToJson(VALID)).ok).toBe(true);
    });

    it('flags a duplicate anchor and a locale-prefixed link without refusing', () => {
        const result = parseArticleBodyJson(
            JSON.stringify([
                { type: 'heading', level: 2, id: 'same', text: 'A' },
                { type: 'heading', level: 2, id: 'same', text: 'B' },
                {
                    type: 'paragraph',
                    text: [{ type: 'link', text: 'prices', href: '/fr/pricing' }],
                },
            ]),
        );
        expect(result.ok).toBe(true);
        expect(result.problems.map((problem) => problem.blockIndex).sort()).toEqual([1, 2]);
    });
});

describe('the length and blank-optional rules an import can break and the inputs cannot', () => {
    it('flags a heading over the schema maximum', () => {
        const problems = validateArticleBody([
            { type: 'heading', level: 2, id: 'long', text: 'x'.repeat(301) },
        ]);
        expect(problems[0].message).toMatch(/at most 300/);
    });

    it('flags a blank caption, which the schema refuses as ""', () => {
        const problems = validateArticleBody([
            { type: 'image', url: '/a.png', alt: 'a', width: 1, height: 1, caption: ' ' },
        ]);
        expect(problems[0].message).toMatch(/caption/);
    });
});

describe('replacing the driver body keeps the other languages attached by position', () => {
    const stored: ArticleBody = VALID.slice(0, 3);

    it('keeps every origin when only words changed', () => {
        const edited = structuredClone(stored);
        (edited[0] as { text: string }).text = 'Paid, faster';
        const plan = planForReplacement(initialPlan(stored), stored, edited);

        expect(plan.origins).toEqual([0, 1, 2]);
        expect(planRemovesOrReorders(plan)).toBe(false);
        expect(sameLayout(stored, edited)).toBe(true);
    });

    it('reports a block that disappeared from the file as a removal', () => {
        const plan = planForReplacement(initialPlan(stored), stored, [stored[0], stored[2]]);

        // Index 1 is now a list where a paragraph was, so it is new, and the old
        // paragraph and list both fall out of the plan.
        expect(plan.origins).toEqual([0, null]);
        expect(planRemovesOrReorders(plan)).toBe(true);
    });
});
