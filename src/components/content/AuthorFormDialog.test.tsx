import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthorFormDialog } from '@/components/content/AuthorFormDialog';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';

/**
 * Answers the picker's listing and throws on anything else, so a stray request
 * from this dialog fails loudly rather than being absorbed.
 */
function stubLibrary(url: string | null) {
    return stubFetch((call) => {
        if (call.url.includes('/files/library')) {
            return successResponse(
                [
                    {
                        id: '6612a4f0c1a2b3d4e5f60718',
                        key: 'images/2026/08/editorial.png',
                        url,
                        access: url ? 'public' : 'authorized',
                        mimeType: 'image/png',
                        size: 9182,
                        originalName: 'editorial.png',
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

describe('the avatar is a url, and now it can be chosen', () => {
    /**
     * 🔴 **The hint on this field said *"no route on this service accepts a
     * file"*,** which was the contract until BR-015 landed `POST /files/upload`
     * on 2026-08-26 — so a shipped screen was asserting something false about the
     * service. Phase F replaced the sentence with the control it described.
     */
    it('fills the field from a file the administration uploaded', async () => {
        stubLibrary('https://cdn.example.com/authors/editorial.png');
        renderWithProviders(
            <AuthorFormDialog open onOpenChange={() => {}} onSaved={() => {}} />,
        );

        await userEvent.click(screen.getByRole('button', { name: /browse/i }));
        await userEvent.click(await screen.findByRole('button', { name: /editorial\.png/i }));

        expect(screen.getByLabelText(/avatar url/i)).toHaveValue(
            'https://cdn.example.com/authors/editorial.png',
        );
    });

    it('does not offer a file the byline could never serve', async () => {
        /**
         * ⚠ **A byline avatar is a stored string served to anonymous readers**,
         * exactly like an article cover — so a private-tree file (`url: null`, and
         * always) is unusable here for a reason that has nothing to do with
         * uploading. `requirePublicUrl` disables the tile rather than hiding it.
         */
        stubLibrary(null);
        renderWithProviders(
            <AuthorFormDialog open onOpenChange={() => {}} onSaved={() => {}} />,
        );

        await userEvent.click(screen.getByRole('button', { name: /browse/i }));

        expect(await screen.findByRole('button', { name: /editorial\.png/i })).toBeDisabled();
    });

    it('makes no request of its own until the picker is opened', async () => {
        // The dialog itself reads nothing — the byline is handed in as a prop.
        const calls = stubLibrary('https://cdn.example.com/authors/editorial.png');
        renderWithProviders(
            <AuthorFormDialog open onOpenChange={() => {}} onSaved={() => {}} />,
        );

        expect(calls).toHaveLength(0);
    });
});
