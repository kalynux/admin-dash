import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { ArticleBodyPreview } from '@/components/content/ArticleBodyPreview';
import { renderWithProviders } from '@/test/utils';
import { ARTICLE_BLOCK_TYPES, type ArticleBody } from '@/types/content.types';

/** One of each, so a block type that renders nothing fails rather than hides. */
const EVERY_BLOCK: ArticleBody = [
    { type: 'heading', level: 2, id: 'paid', text: 'Getting paid' },
    { type: 'paragraph', text: [{ type: 'text', text: 'Commission is taken at payment.' }] },
    { type: 'list', items: [[{ type: 'text', text: 'Mobile money' }]] },
    { type: 'quote', text: 'It arrived the same day.', attribution: 'A vendor in Douala' },
    {
        type: 'callout',
        tone: 'warning',
        title: 'Watch the cut-off',
        text: [{ type: 'text', text: 'Payouts after 4pm settle the next day.' }],
    },
    { type: 'image', url: '/media/momo.png', alt: 'A market stall', width: 800, height: 600 },
    {
        type: 'cta',
        title: 'Start selling',
        body: 'It takes ten minutes.',
        href: '/signup',
        label: 'Create an account',
    },
    { type: 'faq', items: [{ question: 'When am I paid?', answer: 'Within two days.' }] },
    { type: 'divider' },
];

describe('every block type renders as a reader would see it', () => {
    it('draws all nine, and the union is still nine', () => {
        // `ARTICLE_BLOCK_TYPES` is itself diffed against the backend's own
        // validator by `content-blocks.test.ts`, so a tenth type fails there and
        // leaves this preview visibly incomplete here.
        renderWithProviders(<ArticleBodyPreview body={EVERY_BLOCK} />);

        expect(ARTICLE_BLOCK_TYPES).toHaveLength(9);
        expect(screen.getByRole('heading', { name: 'Getting paid' })).toBeInTheDocument();
        expect(screen.getByText(/commission is taken at payment/i)).toBeInTheDocument();
        expect(screen.getByText('Mobile money')).toBeInTheDocument();
        expect(screen.getByText(/it arrived the same day/i)).toBeInTheDocument();
        expect(screen.getByText(/a vendor in douala/i)).toBeInTheDocument();
        expect(screen.getByText('Watch the cut-off')).toBeInTheDocument();
        expect(screen.getByText('Start selling')).toBeInTheDocument();
        expect(screen.getByText('When am I paid?')).toBeInTheDocument();
    });

    it('gives a heading its anchor id, which is the point of the field', () => {
        // Readers link straight to it, and an editor checking a heading is
        // checking the address somebody will share.
        const { container } = renderWithProviders(<ArticleBodyPreview body={EVERY_BLOCK} />);
        expect(container.querySelector('#paid')).not.toBeNull();
    });

    it('reserves the image’s own box rather than a default one', () => {
        // ⚠ `width` and `height` are required on the block precisely so a
        // loading image does not shift the paragraph under it. A preview that
        // ignored them would be reassuring about the one thing it can check.
        const { container } = renderWithProviders(
            <ArticleBodyPreview
                body={[
                    {
                        type: 'image',
                        url: '/media/momo.png',
                        alt: 'A market stall',
                        width: 800,
                        height: 400,
                    },
                ]}
            />,
        );

        // Radix reserves the box as a percentage padding on the frame's wrapper,
        // so 2:1 is 50% rather than a literal `aspect-ratio` declaration.
        const frame = container.querySelector('[data-slot="aspect-ratio"]')?.parentElement;
        expect(frame?.getAttribute('style')).toContain('padding-bottom: 50%');
    });

    it('says so when there is nothing written yet', () => {
        renderWithProviders(<ArticleBodyPreview body={[]} />);
        expect(screen.getByText(/nothing written yet/i)).toBeInTheDocument();
    });
});

describe('rich text', () => {
    it('concatenates spans with NO separator', () => {
        /**
         * ⚠ **The one that would be worse to get wrong here than in the editor.**
         * `"Commission is taken "` and its trailing space are meaningful — the
         * renderer joins spans with nothing between them, so a preview that
         * added a space would show prose that reads correctly and ship prose
         * that does not.
         */
        const { container } = renderWithProviders(
            <ArticleBodyPreview
                body={[
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

        expect(container.querySelector('p')?.textContent).toBe('Commission is taken at payment.');
    });

    it('renders a link as text and never as a navigable anchor', () => {
        /**
         * A preview is a picture of the published page. A live link inside one
         * navigates the operator out of the dialog they are writing in — and
         * inside the translation editor that would discard unsaved prose.
         */
        renderWithProviders(
            <ArticleBodyPreview
                body={[
                    {
                        type: 'paragraph',
                        text: [{ type: 'link', text: 'our pricing', href: '/pricing' }],
                    },
                ]}
            />,
        );

        expect(screen.getByText('our pricing')).toBeInTheDocument();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders markup in the prose as TEXT, which is the whole reason the wire format is blocks', () => {
        /**
         * ⚠ **No `dangerouslySetInnerHTML`, here least of all.** The block union
         * exists because an HTML string would have to be sanitised on the way in
         * and rendered as markup on the way out, on the same origin as the auth
         * pages. A preview taking that shortcut would reopen the hole on a
         * screen an administrator has open with a session.
         */
        const { container } = renderWithProviders(
            <ArticleBodyPreview
                body={[
                    {
                        type: 'paragraph',
                        text: [{ type: 'text', text: '<img src=x onerror="alert(1)">' }],
                    },
                ]}
            />,
        );

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
    });
});
