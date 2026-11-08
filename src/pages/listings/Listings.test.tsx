import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ListingsModule } from '@/pages/listings/ListingsModule';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    LISTING_ID,
    contactSetFixture,
    listingContactsFixture,
    listingContentFixture,
    listingDetailFixture,
    listingQueueItemFixture,
    liveListingFixture,
} from '@/test/listing-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';

afterEach(() => vi.restoreAllMocks());

const auth = { status: 'authenticated' as const, admin: adminFixture({ timezone: 'Africa/Douala' }) };
const meta = (total: number) => ({ total, page: 1, limit: 20, pages: total === 0 ? 0 : 1 });
const pathOf = (call: FetchCall) => new URL(call.url).pathname.replace(/^\/api\/v1/, '');
const searchOf = (call: FetchCall) => new URL(call.url).searchParams;

function open(route: string, tier: 1 | 2 | 3 = 3, held?: ReadonlySet<string>) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/listings/*" element={<ListingsModule />} />
        </Routes>,
        { route, auth, permissions: { status: 'ready', held: held ?? heldFixture(tier) } },
    );
}

describe('the review queue', () => {
    it('opens on the listings waiting for review, oldest submission first', async () => {
        const calls = stubFetch(() =>
            successResponse(
                [
                    listingQueueItemFixture(),
                    listingQueueItemFixture({
                        id: '6730aabbccddeeff00112299',
                        title: 'Wedding photography',
                        status: 'live',
                        isRevision: true,
                        preflagCount: 2,
                    }),
                ],
                { meta: meta(2) },
            ),
        );
        open('/dashboard/listings');

        expect(await screen.findByText('Plumbing repairs in Akwa')).toBeInTheDocument();
        const page = calls.find((call) => searchOf(call).get('limit') === '20')!;
        expect(searchOf(page).get('reviewState')).toBe('pending_review');
        expect(searchOf(page).get('sort')).toBe('submittedAt');

        // A change to a live listing says so, and so do contacts found in the text.
        const revision = screen.getByText('Wedding photography').closest('a')!;
        expect(within(revision).getByText('Change to a live listing')).toBeInTheDocument();
        expect(within(revision).getByText('2 contacts found in the text')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Plumbing repairs in Akwa/ })).toHaveAttribute(
            'href',
            `/dashboard/listings/${LISTING_ID}`,
        );
    });

    it('⛔ never asks for hidden contacts', async () => {
        const calls = stubFetch(() => successResponse([listingQueueItemFixture()], { meta: meta(1) }));
        open('/dashboard/listings');
        await screen.findByText('Plumbing repairs in Akwa');
        expect(calls.some((call) => pathOf(call).endsWith('/contacts'))).toBe(false);
    });

    it('the All view drops the review filter and lists newest first', async () => {
        const calls = stubFetch(() => successResponse([], { meta: meta(0) }));
        open('/dashboard/listings?view=all&status=suspended');
        expect(await screen.findByText('No listings match these filters')).toBeInTheDocument();
        const page = calls.find((call) => searchOf(call).get('limit') === '20')!;
        expect(searchOf(page).get('reviewState')).toBeNull();
        expect(searchOf(page).get('status')).toBe('suspended');
        expect(searchOf(page).get('sort')).toBe('-createdAt');
    });

    it('reads a hand-edited status outside the vocabulary as no filter, not a 400', async () => {
        const calls = stubFetch(() => successResponse([], { meta: meta(0) }));
        open('/dashboard/listings?status=bogus');
        await screen.findByText(/Nothing is waiting for review|No listings match/);
        expect(calls.every((call) => searchOf(call).get('status') === null)).toBe(true);
    });
});

describe('the listing detail', () => {
    function stub(detail = listingDetailFixture(), onCall?: (call: FetchCall) => Response | undefined) {
        return stubFetch((call) => {
            const answer = onCall?.(call);
            if (answer) return answer;
            if (pathOf(call).endsWith('/contacts')) return successResponse(listingContactsFixture());
            if (pathOf(call).endsWith('/leads')) return successResponse([], { meta: meta(0) });
            return successResponse(detail);
        });
    }

    it('offers Approve and Reject to Support, who holds catalog.listings.review', async () => {
        stub();
        open(`/dashboard/listings/${LISTING_ID}`, 3);
        expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Take offline' })).not.toBeInTheDocument();
    });

    it('hides a verb whose permission is not held, even when the state allows it', async () => {
        stub();
        open(`/dashboard/listings/${LISTING_ID}`, 3, new Set(['catalog.listings.read']));
        await screen.findByText('What the provider submitted');
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('⛔ loads the hidden contacts only on the click, and the button says the view is recorded', async () => {
        const calls = stub();
        open(`/dashboard/listings/${LISTING_ID}`);
        const button = await screen.findByRole('button', { name: /Show hidden contacts/ });
        expect(button).toHaveTextContent('Your view is recorded in the audit trail');
        expect(calls.some((call) => pathOf(call).endsWith('/contacts'))).toBe(false);

        await userEvent.click(button);
        expect(await screen.findByText('+237690000111')).toBeInTheDocument();
        expect(calls.filter((call) => pathOf(call).endsWith('/contacts'))).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Open the video/ })).toHaveAttribute('href', 'https://youtu.be/abc123');

        await userEvent.click(screen.getByRole('button', { name: 'Hide the contacts again' }));
        expect(screen.queryByText('+237690000111')).not.toBeInTheDocument();
    });

    it('on a change to a live listing, shows both copies and marks what changed — contacts too', async () => {
        const detail = listingDetailFixture({
            status: 'live',
            isRevision: true,
            published: listingContentFixture(),
            pending: listingContentFixture({ description: 'Now call 690 00 01 11 directly' }),
            review: {
                ...listingDetailFixture().review!,
                preflags: [{ kind: 'phone', field: 'description', excerpt: '690 00 01 11' }],
            },
        });
        stub(detail, (call) =>
            pathOf(call).endsWith('/contacts')
                ? successResponse(
                      listingContactsFixture({
                          published: contactSetFixture(),
                          pending: contactSetFixture({ whatsapp: '+237699999999' }),
                      }),
                  )
                : undefined,
        );
        open(`/dashboard/listings/${LISTING_ID}`);

        expect(await screen.findByText('The change under review')).toBeInTheDocument();
        expect(screen.getByText('Live now')).toBeInTheDocument();
        expect(screen.getByText('The automatic check found 1 contact in the public text')).toBeInTheDocument();
        // The excerpt is marked inside the description.
        expect(screen.getByText('690 00 01 11', { selector: 'mark' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Show hidden contacts/ }));
        expect(await screen.findByText('+237699999999')).toBeInTheDocument();
        expect(screen.getByText('In the change under review')).toBeInTheDocument();
        // The description and the WhatsApp number are both marked as changed.
        expect(screen.getAllByText('Changed').length).toBeGreaterThanOrEqual(2);
    });

    it('rejects with every reason typed, and says the provider reads them', async () => {
        const calls = stub(listingDetailFixture(), (call) =>
            call.method === 'POST' ? successResponse(listingDetailFixture({ status: 'rejected', availableActions: [] })) : undefined,
        );
        open(`/dashboard/listings/${LISTING_ID}`);
        await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/The provider sees every reason you write/)).toBeInTheDocument();
        expect(within(dialog).getByText(/indexing fee they paid to submit is refunded/)).toBeInTheDocument();
        await userEvent.type(within(dialog).getByLabelText('Reason 1'), 'The description shows a phone number');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add a reason' }));
        await userEvent.type(within(dialog).getByLabelText('Reason 2'), 'Photo 2 shows a sign with a number');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Reject listing' }));

        await waitFor(() => expect(calls.some((call) => pathOf(call).endsWith('/reject'))).toBe(true));
        const post = calls.find((call) => pathOf(call).endsWith('/reject'))!;
        expect(JSON.parse(post.body!)).toEqual({
            reasons: ['The description shows a phone number', 'Photo 2 shows a sign with a number'],
        });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument());
    });

    it('takes a live listing offline with a note the form says the provider sees', async () => {
        const calls = stub(liveListingFixture(), (call) =>
            call.method === 'POST' ? successResponse(liveListingFixture({ status: 'suspended', availableActions: ['unsuspend'] })) : undefined,
        );
        open(`/dashboard/listings/${LISTING_ID}`);
        await userEvent.click(await screen.findByRole('button', { name: 'Take offline' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/The provider sees this on their listing/)).toBeInTheDocument();
        await userEvent.type(within(dialog).getByLabelText('Note to the provider'), 'Photo shows a phone number');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Take offline' }));

        await waitFor(() => expect(calls.some((call) => pathOf(call).endsWith('/suspend'))).toBe(true));
        expect(await screen.findByRole('button', { name: 'Put back' })).toBeInTheDocument();
    });

    it('closes and re-reads when someone else decided first', async () => {
        let reads = 0;
        stub(listingDetailFixture(), (call) => {
            if (call.method === 'POST') {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    details: { platformCode: 'LISTING_STATUS_CONFLICT' },
                });
            }
            if (pathOf(call) === `/listings/${LISTING_ID}`) {
                reads += 1;
                return successResponse(reads > 1 ? liveListingFixture() : listingDetailFixture());
            }
            return undefined;
        });
        open(`/dashboard/listings/${LISTING_ID}`);
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve and publish' }));

        expect(await screen.findByRole('button', { name: 'Take offline' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(reads).toBe(2);
    });

    it('lists the leads on their own tab', async () => {
        stub(liveListingFixture());
        open(`/dashboard/listings/${LISTING_ID}?tab=leads`);
        expect(await screen.findByText('No leads yet')).toBeInTheDocument();
    });
});
