import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ReviewsPanel } from '@/components/reviews/ReviewsPanel';
import { notify } from '@/lib/notify';
import { ReviewDetail } from '@/pages/reviews/ReviewDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { Review } from '@/types/reviews.types';

const ID = '6700a1b2c3d4e5f6a7b8c901';
const ADMIN = '665f1c2a9b3e4a91c7d2e5f0';
const AGENCY = '66f5aaaaaaaaaaaaaaaaaa66';

function review(overrides: Partial<Review> = {}): Review {
    return {
        id: ID,
        subjectType: 'product',
        status: 'unpublished',
        publiclyVisible: false,
        rating: 1,
        title: 'Rude words',
        body: 'Something abusive.',
        hasText: true,
        author: { userId: '66f0aaaaaaaaaaaaaaaaaa01', role: 'customer', name: 'Awa N.' },
        product: { id: '66f1aaaaaaaaaaaaaaaaaa22', name: 'Leather sandals' },
        vendor: { id: '66f2aaaaaaaaaaaaaaaaaa33', name: 'Chez Awa' },
        agent: null,
        agency: null,
        orderId: '66f3aaaaaaaaaaaaaaaaaa44',
        shipmentId: null,
        lastModeration: {
            action: 'unpublished',
            at: '2026-10-05T10:00:00.000Z',
            reason: 'Abusive language',
            bySource: 'admin',
            byAdministratorId: ADMIN,
        },
        availableActions: ['republish', 'delete'],
        publishedAt: '2026-10-05T09:12:00.000Z',
        createdAt: '2026-10-05T09:12:00.000Z',
        updatedAt: '2026-10-05T10:00:00.000Z',
        ...overrides,
    };
}

const auth = { status: 'authenticated' as const, admin: adminFixture({ timezone: 'Africa/Douala' }) };

function detail(tier: 1 | 2 | 3 = 3) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/reviews/:reviewId" element={<ReviewDetail />} />
            <Route path="/dashboard/reviews" element={<p>The reviews list</p>} />
        </Routes>,
        {
            route: `/dashboard/reviews/${ID}`,
            auth,
            permissions: { status: 'ready', held: heldFixture(tier) },
        },
    );
}

afterEach(() => vi.restoreAllMocks());

describe('the review detail', () => {
    it('shows the last moderation and links to the full history in the audit trail', async () => {
        stubFetch(() => successResponse(review()));
        detail();

        expect(await screen.findByText('Abusive language')).toBeInTheDocument();
        expect(screen.getByText('Hidden', { selector: 'dd' })).toBeInTheDocument();
        expect(screen.getByText(/An administrator/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Full history in the audit trail' })).toHaveAttribute(
            'href',
            `/dashboard/audit?targetType=review&targetId=${ID}`,
        );
        // Status-derived and permission-gated: Show again, not Hide.
        expect(screen.getByRole('button', { name: 'Show again' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    });

    it('says when nobody has moderated it', async () => {
        stubFetch(() =>
            successResponse(
                review({
                    status: 'published',
                    publiclyVisible: true,
                    lastModeration: null,
                    availableActions: ['unpublish', 'delete'],
                }),
            ),
        );
        detail();

        expect(await screen.findByText('Nobody has hidden or shown this review again.')).toBeInTheDocument();
        expect(screen.getByText('Public')).toBeInTheDocument();
    });

    it('returns to the list after a delete', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        stubFetch((call: FetchCall) =>
            call.method === 'DELETE' ? successResponse({ id: ID, deleted: true }) : successResponse(review()),
        );
        detail();

        await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'Spam',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

        expect(await screen.findByText('The reviews list')).toBeInTheDocument();
    });
});

describe('the per-record Reviews tab', () => {
    it('scopes the read to its record and links to the full list, scoped the same way', async () => {
        const calls = stubFetch(() =>
            successResponse(
                [
                    review({
                        subjectType: 'delivery',
                        status: 'published',
                        publiclyVisible: false,
                        product: null,
                        agent: { id: '66f4aaaaaaaaaaaaaaaaaa55', name: 'Jean K.' },
                        agency: { id: AGENCY, name: 'Rapide Express' },
                        availableActions: ['unpublish', 'delete'],
                    }),
                ],
                { meta: { total: 1, page: 1, limit: 10, pages: 1 } },
            ),
        );
        renderWithProviders(<ReviewsPanel scope={{ agencyId: AGENCY }} timeZone="Africa/Douala" noun="this agency" />, {
            route: `/dashboard/agencies/${AGENCY}`,
            auth,
            permissions: { status: 'ready', held: heldFixture(3) },
        });

        expect(await screen.findByText('Internal')).toBeInTheDocument();
        const params = new URL(calls[0].url, 'http://localhost').searchParams;
        expect(params.get('agencyId')).toBe(AGENCY);
        expect(screen.getByRole('link', { name: 'Open in Reviews' })).toHaveAttribute(
            'href',
            `/dashboard/reviews?agencyId=${AGENCY}`,
        );

        await userEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
        await waitFor(() =>
            expect(new URL(calls.at(-1)!.url, 'http://localhost').searchParams.get('status')).toBe('unpublished'),
        );
        // Local state: the host page's URL is left alone.
        expect(window.location.search).not.toContain('status=');
    });
});
