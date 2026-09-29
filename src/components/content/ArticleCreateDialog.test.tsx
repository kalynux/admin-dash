import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArticleCreateDialog } from '@/components/content/ArticleCreateDialog';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';

const author = { id: 'wimall-editorial', name: 'Wi-Mall Editorial', type: 'Organization' };

function setup() {
    const calls = stubFetch((call) => {
        if (call.url.includes('/content/authors')) return successResponse([author]);
        return successResponse({ id: 'getting-paid' }, { status: 201 });
    });
    renderWithProviders(
        <ArticleCreateDialog open onOpenChange={() => {}} onCreated={() => {}} />,
        { auth: { status: 'authenticated', admin: adminFixture() } },
    );
    return calls;
}

async function fillRequired() {
    await userEvent.type(screen.getByLabelText(/^id$/i), 'getting-paid');
    await userEvent.click(screen.getByLabelText(/byline/i));
    await userEvent.click(await screen.findByRole('option', { name: /wi-mall editorial/i }));
    await userEvent.type(screen.getByLabelText(/^title$/i), 'Getting paid');
    await userEvent.type(screen.getByLabelText(/^slug$/i), 'getting-paid');
    await userEvent.type(screen.getByLabelText(/^excerpt$/i), 'How the money reaches you.');
    await userEvent.type(screen.getByLabelText(/text run 1/i), 'Some prose.');
}

const created = (calls: FetchCall[]) => {
    const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/content/articles'));
    return call ? JSON.parse(call.body as string) : undefined;
};

describe('the cover image on create', () => {
    it('omits `cover` and `coverAlt` entirely when no cover is given', async () => {
        const calls = setup();
        await fillRequired();

        await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

        const sent = created(calls);
        expect(sent).toBeDefined();
        expect('cover' in sent).toBe(false);
        expect('coverAlt' in sent.translations[0]).toBe(false);
    });

    it('sends the cover on the article and its description on the first language', async () => {
        const calls = setup();
        await fillRequired();

        await userEvent.type(screen.getByLabelText(/image url/i), '/covers/getting-paid.jpg');
        await userEvent.type(screen.getByLabelText(/width in pixels/i), '1200');
        await userEvent.type(screen.getByLabelText(/height in pixels/i), '630');
        await userEvent.type(
            screen.getByLabelText(/cover description/i),
            'A phone showing a payout',
        );

        await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

        const sent = created(calls);
        // ⚠ No `alt` on the cover: `CoverSchema` is `.strict()` and refuses it.
        expect(sent.cover).toEqual({ url: '/covers/getting-paid.jpg', width: 1200, height: 630 });
        expect(sent.translations[0].coverAlt).toBe('A phone showing a payout');
    });

    it('holds the create while a started cover has no dimensions', async () => {
        setup();
        await fillRequired();

        await userEvent.type(screen.getByLabelText(/image url/i), '/covers/getting-paid.jpg');

        expect(screen.getByRole('button', { name: /create draft/i })).toBeDisabled();
        expect(screen.getByText(/fill in the width and height/i)).toBeInTheDocument();
    });
});
