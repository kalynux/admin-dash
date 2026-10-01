import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArticleBodyJson } from '@/components/content/ArticleBodyJson';
import { renderWithProviders } from '@/test/utils';
import type { ArticleBody } from '@/types/content.types';

const CURRENT: ArticleBody = [
    { type: 'paragraph', text: [{ type: 'text', text: 'What is there now.' }] },
];

function setup(layoutNotice?: (next: ArticleBody) => string | null) {
    const onImport = vi.fn();
    renderWithProviders(
        <ArticleBodyJson
            body={CURRENT}
            onImport={onImport}
            locale="fr"
            fileName="a.fr.json"
            layoutNotice={layoutNotice}
        />,
    );
    return { onImport, user: userEvent.setup() };
}

/** `fireEvent.change` rather than typing: user-event treats `[` and `{` as key syntax. */
function paste(text: string) {
    fireEvent.change(screen.getByLabelText('Or paste it'), { target: { value: text } });
}

describe('importing a body from JSON', () => {
    it('refuses broken JSON and never touches the draft', async () => {
        const { onImport, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Import JSON' }));

        paste('[{"type": "paragraph", ');

        expect(screen.getByRole('alert')).toHaveTextContent(/can’t be imported/);
        expect(screen.getByRole('button', { name: 'Replace the body' })).toBeDisabled();
        expect(onImport).not.toHaveBeenCalled();
    });

    it('previews a readable body and replaces the draft only on confirmation', async () => {
        const { onImport, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Import JSON' }));

        const next: ArticleBody = [
            { type: 'heading', level: 2, id: 'new', text: 'A new heading' },
            { type: 'paragraph', text: [{ type: 'text', text: 'And new words.' }] },
        ];
        paste(JSON.stringify(next));

        expect(screen.getByText(/2 blocks/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'A new heading' })).toBeInTheDocument();
        expect(onImport).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Replace the body' }));
        expect(onImport).toHaveBeenCalledWith(next);
    });

    it('loads a body with fixable problems, and says Save will wait for them', async () => {
        const { onImport, user } = setup();
        await user.click(screen.getByRole('button', { name: 'Import JSON' }));

        paste(
            JSON.stringify([
                { type: 'image', url: '<<upload me>>', alt: 'A chart', width: 1200, height: 822 },
            ]),
        );

        expect(screen.getByText(/1 thing to fix before it can be saved/)).toBeInTheDocument();
        expect(screen.getByText(/Block 1:/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Replace the body' }));
        expect(onImport).toHaveBeenCalledOnce();
    });

    it('shows what the host says a layout change does to the other languages', async () => {
        const { user } = setup(() => 'The other languages follow this one.');
        await user.click(screen.getByRole('button', { name: 'Import JSON' }));

        paste('[{"type":"divider"}]');

        expect(screen.getByText('The other languages follow this one.')).toBeInTheDocument();
    });
});
