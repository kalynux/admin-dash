import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArticleBodyEditor } from '@/components/content/ArticleBodyEditor';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import { ARTICLE_BLOCK_TYPES, type ArticleBody } from '@/types/content.types';

/**
 * A harness that owns the body, so what is asserted is the value the editor
 * actually produces rather than the props it was handed.
 */
function Harness({ initial = [] as ArticleBody }: { initial?: ArticleBody }) {
    const [body, setBody] = useState<ArticleBody>(initial);
    return (
        <>
            <ArticleBodyEditor value={body} onChange={setBody} idPrefix="t" />
            <pre data-testid="body">{JSON.stringify(body)}</pre>
        </>
    );
}

function currentBody(): ArticleBody {
    return JSON.parse(screen.getByTestId('body').textContent ?? '[]');
}

async function addBlock(label: RegExp) {
    await userEvent.click(screen.getByLabelText(/add a block/i));
    await userEvent.click(await screen.findByRole('option', { name: label }));
}

describe('it can produce every one of the nine block types', () => {
    // The definition of done for the body editor, asserted rather than assumed.
    // `ARTICLE_BLOCK_TYPES` is itself diffed against the backend's validator by
    // `content-blocks.test.ts`, so a tenth type fails there and here.
    const cases: [RegExp, string][] = [
        [/^heading/i, 'heading'],
        [/^paragraph/i, 'paragraph'],
        [/^list/i, 'list'],
        [/^quote/i, 'quote'],
        [/^callout/i, 'callout'],
        [/^image/i, 'image'],
        [/^call to action/i, 'cta'],
        [/^faq/i, 'faq'],
        [/^divider/i, 'divider'],
    ];

    it('offers exactly nine, and no more', async () => {
        renderWithProviders(<Harness />);
        await userEvent.click(screen.getByLabelText(/add a block/i));

        expect(await screen.findAllByRole('option')).toHaveLength(9);
        expect(ARTICLE_BLOCK_TYPES).toHaveLength(9);
    });

    for (const [label, type] of cases) {
        it(`adds a ${type}`, async () => {
            renderWithProviders(<Harness />);
            await addBlock(label);

            expect(currentBody().map((block) => block.type)).toEqual([type]);
        });
    }
});

describe('the shapes it starts blocks in', () => {
    it('gives rich text one span rather than an empty array', async () => {
        // Rich text needs at least one span; an empty array is a `400` rather
        // than an empty paragraph.
        renderWithProviders(<Harness />);
        await addBlock(/^paragraph/i);

        const [block] = currentBody();
        expect(block).toEqual({ type: 'paragraph', text: [{ type: 'text', text: '' }] });
    });

    it('starts an image at zero dimensions, which cannot be saved', async () => {
        /**
         * ⚠ A guess would reserve the wrong box, which is the defect the field
         * exists to prevent — so it starts at a value the validator refuses
         * rather than at a plausible-looking default.
         */
        renderWithProviders(<Harness />);
        await addBlock(/^image/i);

        expect(currentBody()[0]).toMatchObject({ width: 0, height: 0 });
        // The url is empty too and is reported first — one problem per block, in
        // field order, so the editor is not handed four complaints at once.
        expect(await screen.findByText(/needs a url/i)).toBeInTheDocument();
    });

    it('reports the missing dimensions once the url is filled in', async () => {
        renderWithProviders(
            <Harness initial={[{ type: 'image', url: '/x.png', alt: 'A chart', width: 0, height: 400 }]} />,
        );

        expect(await screen.findByText(/real pixel width/i)).toBeInTheDocument();
    });

    it('omits `ordered` on a new list rather than sending false', async () => {
        // Absent means unordered. An explicit `false` is noise the backend would
        // store and echo back forever.
        renderWithProviders(<Harness />);
        await addBlock(/^list/i);

        expect('ordered' in currentBody()[0]).toBe(false);
    });
});

describe('reordering and removal', () => {
    it('swaps two blocks', async () => {
        renderWithProviders(
            <Harness
                initial={[
                    { type: 'heading', level: 2, id: 'first', text: 'First' },
                    { type: 'divider' },
                ]}
            />,
        );

        await userEvent.click(screen.getByLabelText(/move block 2 up/i));

        expect(currentBody().map((block) => block.type)).toEqual(['divider', 'heading']);
    });

    it('disables the moves at the ends, so there is no silent no-op', async () => {
        renderWithProviders(
            <Harness initial={[{ type: 'divider' }, { type: 'divider' }]} />,
        );

        expect(screen.getByLabelText(/move block 1 up/i)).toBeDisabled();
        expect(screen.getByLabelText(/move block 2 down/i)).toBeDisabled();
    });

    it('removes a block', async () => {
        renderWithProviders(
            <Harness initial={[{ type: 'divider' }, { type: 'divider' }]} />,
        );

        await userEvent.click(screen.getByLabelText(/remove block 1/i));

        expect(currentBody()).toHaveLength(1);
    });
});

describe('the heading id is authored, never derived', () => {
    it('does not follow the text as it is typed', async () => {
        /**
         * ⚠ The rule this editor exists to respect. A live binding breaks every
         * shared anchor the moment a title is retouched — silently, because the
         * page still renders.
         */
        renderWithProviders(<Harness initial={[{ type: 'heading', level: 2, id: '', text: '' }]} />);

        await userEvent.type(screen.getByLabelText(/^text$/i), 'How it works');

        expect(currentBody()[0]).toMatchObject({ text: 'How it works', id: '' });
    });

    it('fills one in on demand, once', async () => {
        renderWithProviders(<Harness initial={[{ type: 'heading', level: 2, id: '', text: '' }]} />);

        await userEvent.type(screen.getByLabelText(/^text$/i), 'How it works');
        await userEvent.click(screen.getByRole('button', { name: /suggest/i }));

        expect(currentBody()[0]).toMatchObject({ id: 'how-it-works' });

        // …and then stays put while the text moves on.
        await userEvent.type(screen.getByLabelText(/^text$/i), ' now');
        expect(currentBody()[0]).toMatchObject({ id: 'how-it-works', text: 'How it works now' });
    });
});

describe('validation surfaces on the block that has the problem', () => {
    it('names the second of two colliding anchors', async () => {
        renderWithProviders(
            <Harness
                initial={[
                    { type: 'heading', level: 2, id: 'pricing', text: 'Pricing' },
                    { type: 'heading', level: 3, id: 'pricing', text: 'Again' },
                ]}
            />,
        );

        expect(await screen.findByText(/block 1 already uses it/i)).toBeInTheDocument();
    });

    it('refuses a locale-prefixed internal link inside a paragraph', async () => {
        // `/fr/pricing` renders as `/fr/fr/pricing` — broken on the published
        // page and invisible in the editor, which is why it is refused here.
        renderWithProviders(
            <Harness
                initial={[
                    {
                        type: 'paragraph',
                        text: [{ type: 'link', text: 'Pricing', href: '/fr/pricing' }],
                    },
                ]}
            />,
        );

        // Twice on purpose: once under the href field that has the mistake in
        // it, and once as the block's own problem. On a four-hundred-block body
        // the second is what makes the first findable.
        expect(await screen.findAllByText(/must not carry a locale prefix/i)).toHaveLength(2);
    });
});

describe('the running word count', () => {
    it('joins spans with no separator, matching the backend', async () => {
        // Joining with a space would inflate every count by the number of bold
        // runs, so the number would jump on save.
        renderWithProviders(
            <Harness
                initial={[
                    {
                        type: 'paragraph',
                        text: [
                            { type: 'text', text: 'Commission is taken ' },
                            { type: 'text', text: 'at payment', bold: true },
                            { type: 'text', text: '.' },
                        ],
                    },
                ]}
            />,
        );

        expect(screen.getByText(/5 words/i)).toBeInTheDocument();
    });
});

// ─── § E3 · a language that follows another ──────────────────────────────────

/** The same harness, in the mode a non-driver language is edited in. */
function FollowingHarness({
    initial,
    driverBody,
}: {
    initial: ArticleBody;
    driverBody: ArticleBody;
}) {
    const [body, setBody] = useState<ArticleBody>(initial);
    return (
        <>
            <ArticleBodyEditor
                value={body}
                onChange={setBody}
                idPrefix="t"
                follows={{ driverBody, driverLocale: 'en' }}
            />
            <pre data-testid="body">{JSON.stringify(body)}</pre>
        </>
    );
}

const para = (text: string): ArticleBody[number] => ({
    type: 'paragraph',
    text: [{ type: 'text', text }],
});

describe('a language that inherits its structure', () => {
    it('offers no way to add a block', async () => {
        // ⚠ The operator ask is explicit that inherited structure is not
        // removable, and a language that could grow its own blocks would drift
        // from the driver on the next keystroke with nothing able to express it.
        renderWithProviders(
            <FollowingHarness initial={[para('Un')]} driverBody={[para('One')]} />,
        );

        expect(screen.queryByLabelText(/add a block/i)).not.toBeInTheDocument();
        expect(screen.getByText(/structure inherited from en/i)).toBeInTheDocument();
    });

    it('disables removing and reordering rather than hiding the controls', async () => {
        // A missing button reads as a bug in the editor; a disabled one that
        // says where the decision lives sends the operator to the right screen.
        renderWithProviders(
            <FollowingHarness
                initial={[para('Un'), para('Deux')]}
                driverBody={[para('One'), para('Two')]}
            />,
        );

        expect(screen.getByLabelText(/remove block 1/i)).toBeDisabled();
        expect(screen.getByLabelText(/move block 1 down/i)).toBeDisabled();
        expect(screen.getByLabelText(/move block 2 up/i)).toBeDisabled();
    });

    it('flags a block that still reads as the driver, and clears it on the first edit', async () => {
        renderWithProviders(
            <FollowingHarness
                initial={[para('Un'), para('Two')]}
                driverBody={[para('One'), para('Two')]}
            />,
        );

        // Only the untranslated one carries the badge — block 2, whose prose is
        // still the driver's. Block 1 has been translated and does not.
        expect(screen.getAllByText(/not yet translated/i)).toHaveLength(1);

        // Every block's first run shares an aria-label, so the index is what
        // picks the second block rather than the label.
        await userEvent.type(screen.getAllByLabelText(/text run 1$/i)[1], 'x');

        // The flag is derived — there is no marker field to clear, because the
        // block schemas are `.strict()` and an extra key is a 400.
        expect(screen.queryByText(/not yet translated/i)).not.toBeInTheDocument();
    });

    it('reports drift without repairing it', async () => {
        // ⚠ The remedy costs prose, so it belongs behind a confirmation the
        // dialog owns — not in the editor, which would apply it as a side effect
        // of opening a language.
        renderWithProviders(
            <FollowingHarness
                initial={[para('Un'), para('Deux')]}
                driverBody={[para('One')]}
            />,
        );

        expect(screen.getByText(/no longer matches the en version/i)).toBeInTheDocument();
        expect(currentBody()).toHaveLength(2);
    });

    it('says nothing about drift when the two agree', () => {
        renderWithProviders(
            <FollowingHarness initial={[para('Un')]} driverBody={[para('One')]} />,
        );

        expect(screen.queryByText(/no longer matches/i)).not.toBeInTheDocument();
    });
});

describe('the image block picks from the media library', () => {
    /**
     * ✅ **The picker BR-015 was opened for**, shipped with Phase F on
     * 2026-08-27. Until then this field carried a note saying the picker was
     * coming — and before that, one saying uploading was impossible, which had
     * become false when `POST /files/upload` landed.
     */
    function stubLibrary(url: string | null) {
        return stubFetch((call) => {
            if (call.url.includes('/files/library')) {
                return successResponse(
                    [
                        {
                            id: '6612a4f0c1a2b3d4e5f60718',
                            key: 'images/2026/08/momo.png',
                            url,
                            access: url ? 'public' : 'authorized',
                            mimeType: 'image/png',
                            size: 4821,
                            originalName: 'momo-payouts.png',
                            createdAt: '2026-08-11T09:14:00.000Z',
                            owner: { type: 'admin', id: 'a'.repeat(24), name: 'Ada Mensah' },
                            usage: { referenceCount: 0, references: [] },
                        },
                    ],
                    {
                        meta: {
                            total: 1,
                            page: 1,
                            limit: 12,
                            pages: 1,
                            referenceSampleCap: 5,
                            publicUrlsConfigured: true,
                        },
                    },
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('fills the url from the chosen file', async () => {
        stubLibrary('https://cdn.example.com/images/2026/08/momo.png');
        renderWithProviders(<Harness />);
        await addBlock(/^image/i);

        await userEvent.click(screen.getByRole('button', { name: /browse/i }));
        await userEvent.click(await screen.findByRole('button', { name: /momo-payouts\.png/i }));

        expect(currentBody()[0]).toMatchObject({
            type: 'image',
            url: 'https://cdn.example.com/images/2026/08/momo.png',
        });
    });

    it('does not offer a file the article could never serve', async () => {
        /**
         * ⚠ **The blog's constraint, and it is real.** An article's `url` is a
         * stored string served to anonymous readers, so a private-tree file
         * (`url: null`, and always) is unusable here — the content route is a
         * different mechanism, not a URL this field could carry. The tile is
         * disabled with the reason on it rather than hidden, because a short page
         * reads as "there are no files".
         */
        stubLibrary(null);
        renderWithProviders(<Harness />);
        await addBlock(/^image/i);

        await userEvent.click(screen.getByRole('button', { name: /browse/i }));

        expect(await screen.findByRole('button', { name: /momo-payouts\.png/i })).toBeDisabled();
        expect(screen.getByText(/no public address/i)).toBeInTheDocument();
    });
});
