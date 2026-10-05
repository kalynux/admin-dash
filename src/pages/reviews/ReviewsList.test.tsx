import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { notify } from '@/lib/notify';
import { ReviewsList } from '@/pages/reviews/ReviewsList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { Review } from '@/types/reviews.types';

const PRODUCT_REVIEW = '6700a1b2c3d4e5f6a7b8c901';
const DELIVERY_REVIEW = '6700a1b2c3d4e5f6a7b8c902';
const HIDDEN_REVIEW = '6700a1b2c3d4e5f6a7b8c903';

/** `reviews.md`'s worked row. */
function review(overrides: Partial<Review> = {}): Review {
    return {
        id: PRODUCT_REVIEW,
        subjectType: 'product',
        status: 'published',
        publiclyVisible: true,
        rating: 2,
        title: 'Arrived late',
        body: 'The shoes were fine but took two weeks.',
        hasText: true,
        author: { userId: '66f0aaaaaaaaaaaaaaaaaa01', role: 'customer', name: 'Awa N.' },
        product: { id: '66f1aaaaaaaaaaaaaaaaaa22', name: 'Leather sandals' },
        vendor: { id: '66f2aaaaaaaaaaaaaaaaaa33', name: 'Chez Awa' },
        agent: null,
        agency: null,
        orderId: '66f3aaaaaaaaaaaaaaaaaa44',
        shipmentId: null,
        lastModeration: null,
        availableActions: ['unpublish', 'delete'],
        publishedAt: '2026-10-05T09:12:00.000Z',
        createdAt: '2026-10-05T09:12:00.000Z',
        updatedAt: '2026-10-05T09:12:00.000Z',
        ...overrides,
    };
}

const DELIVERY = review({
    id: DELIVERY_REVIEW,
    subjectType: 'delivery',
    publiclyVisible: false,
    rating: 5,
    title: 'Quick courier',
    body: null,
    author: { userId: '66f0aaaaaaaaaaaaaaaaaa02', role: 'vendor', name: 'Chez Awa' },
    product: null,
    agent: { id: '66f4aaaaaaaaaaaaaaaaaa55', name: 'Jean K.' },
    agency: { id: '66f5aaaaaaaaaaaaaaaaaa66', name: 'Rapide Express' },
    shipmentId: '66f6aaaaaaaaaaaaaaaaaa77',
});

const HIDDEN = review({
    id: HIDDEN_REVIEW,
    status: 'unpublished',
    publiclyVisible: false,
    rating: 1,
    title: 'Rude words',
    body: null,
    availableActions: ['republish', 'delete'],
});

const ROWS = [review(), DELIVERY, HIDDEN];

const meta = (total: number) => ({ total, page: 1, limit: 20, pages: total > 0 ? 1 : 0 });

type Write = (call: FetchCall) => Response | undefined;

const isList = (call: FetchCall) => call.method === 'GET' && /\/reviews(\?|$)/.test(call.url);
const params = (call: FetchCall) => new URL(call.url, 'http://localhost').searchParams;
/** A tab count is a `limit=1` read. */
const isCount = (call: FetchCall) => isList(call) && params(call).get('limit') === '1';

/** Answers the list and the three counts; `write` answers the rest. */
function stub(write: Write = () => undefined, rows: Review[] = ROWS) {
    return stubFetch((call: FetchCall) => {
        if (isCount(call)) {
            const status = params(call).get('status');
            const total = status === 'published' ? 2 : status === 'unpublished' ? 1 : 3;
            return successResponse(rows.slice(0, 1), { meta: { ...meta(total), limit: 1 } });
        }
        if (isList(call)) return successResponse(rows, { meta: meta(rows.length) });
        const answer = write(call);
        if (answer) return answer;
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(held: ReadonlySet<string> = heldFixture(3), route = '/dashboard/reviews') {
    return renderWithProviders(<ReviewsList />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { status: 'ready', held },
    });
}

const row = async (title: string) =>
    (await screen.findByRole('link', { name: title })).closest('tr') as HTMLElement;

const without = (...names: string[]) => {
    const held = new Set(heldFixture(3));
    for (const name of names) held.delete(name);
    return held;
};

afterEach(() => vi.restoreAllMocks());

describe('the list', () => {
    it('shows the stars, the words, what it is about, the shop and the author', async () => {
        stub();
        list();

        const product = await row('Arrived late');
        expect(within(product).getByRole('img', { name: '2 of 5 stars' })).toBeInTheDocument();
        expect(within(product).getByText('The shoes were fine but took two weeks.')).toBeInTheDocument();
        expect(within(product).getByRole('link', { name: 'Leather sandals' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/66f2aaaaaaaaaaaaaaaaaa33/products/66f1aaaaaaaaaaaaaaaaaa22',
        );
        expect(within(product).getByRole('link', { name: 'Chez Awa' })).toBeInTheDocument();
        expect(within(product).getByText('Awa N.')).toBeInTheDocument();
        expect(within(product).getByText('Customer')).toBeInTheDocument();

        const delivery = await row('Quick courier');
        expect(within(delivery).getByRole('link', { name: 'Jean K.' })).toBeInTheDocument();
        expect(within(delivery).getByRole('link', { name: 'Rapide Express' })).toBeInTheDocument();
        expect(within(delivery).getByText('Shop')).toBeInTheDocument();
    });

    it('never calls a published delivery review public — it reads publiclyVisible, not status', async () => {
        stub();
        list();

        expect(within(await row('Arrived late')).getByText('Public')).toBeInTheDocument();

        const delivery = await row('Quick courier');
        expect(within(delivery).queryByText('Public')).not.toBeInTheDocument();
        expect(within(delivery).getByText('Internal')).toBeInTheDocument();
        expect(
            within(delivery).getByText("Internal: counts towards the agent's and agency's rating"),
        ).toBeInTheDocument();

        expect(within(await row('Rude words')).getByText('Hidden')).toBeInTheDocument();
    });

    it('renders an unknown status and subject type as plain text', async () => {
        stub(undefined, [
            review({ status: 'flagged', publiclyVisible: false, subjectType: 'booking', product: null }),
        ]);
        list();

        const odd = await row('Arrived late');
        expect(within(odd).getByText('flagged')).toBeInTheDocument();
        expect(within(odd).getAllByText('booking').length).toBeGreaterThan(0);
    });

    it('opens newest first and counts each tab with its own limit=1 read', async () => {
        const calls = stub();
        list();
        await row('Arrived late');

        const main = calls.filter((call) => isList(call) && !isCount(call));
        expect(params(main[0]).get('sort')).toBe('-createdAt');
        expect(params(main[0]).has('status')).toBe(false);

        expect(await screen.findByRole('tab', { name: 'All (3)' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Published (2)' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Hidden (1)' })).toBeInTheDocument();
    });

    it('sends the status tab and "With comments only" as filters', async () => {
        const calls = stub();
        list();
        await row('Arrived late');

        await userEvent.click(screen.getByRole('tab', { name: /^Hidden/ }));
        await waitFor(() => {
            const last = calls.filter((call) => isList(call) && !isCount(call)).at(-1)!;
            expect(params(last).get('status')).toBe('unpublished');
        });

        await userEvent.click(screen.getByRole('switch', { name: 'With comments only' }));
        await waitFor(() => {
            const last = calls.filter((call) => isList(call) && !isCount(call)).at(-1)!;
            expect(params(last).get('hasText')).toBe('true');
        });
    });

    it('reads a deep link scoped to one record, and never forwards a dead status', async () => {
        const calls = stub();
        list(heldFixture(3), '/dashboard/reviews?vendorId=66f2aaaaaaaaaaaaaaaaaa33&status=pending');
        await row('Arrived late');

        const main = calls.filter((call) => isList(call) && !isCount(call))[0];
        expect(params(main).get('vendorId')).toBe('66f2aaaaaaaaaaaaaaaaaa33');
        expect(params(main).has('status')).toBe(false);
        expect(screen.getByText(/Showing the reviews of one shop only/)).toBeInTheDocument();
    });
});

describe('who sees which button', () => {
    it('gives Support all three — every tier moderates', async () => {
        stub();
        list(heldFixture(3));

        const published = await row('Arrived late');
        expect(within(published).getByRole('button', { name: 'Hide' })).toBeInTheDocument();
        expect(within(published).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(within(published).queryByRole('button', { name: 'Show again' })).not.toBeInTheDocument();

        const hidden = await row('Rude words');
        expect(within(hidden).getByRole('button', { name: 'Show again' })).toBeInTheDocument();
        expect(within(hidden).queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    });

    it('needs the permission as well as availableActions', async () => {
        stub();
        list(without('reviews.moderate'));

        const published = await row('Arrived late');
        expect(within(published).queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
        expect(within(published).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('withholds Delete without reviews.delete', async () => {
        stub();
        list(without('reviews.delete'));

        const published = await row('Arrived late');
        expect(within(published).getByRole('button', { name: 'Hide' })).toBeInTheDocument();
        expect(within(published).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('builds no Approve or Reject anywhere', async () => {
        stub();
        list(heldFixture(1));
        await row('Arrived late');
        expect(screen.queryByRole('button', { name: /approve|reject/i })).not.toBeInTheDocument();
    });
});

describe('hide', () => {
    it('refuses a missing reason, then sends it and replaces the row', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        const calls = stub((call) =>
            call.method === 'POST' && call.url.includes(`/reviews/${PRODUCT_REVIEW}/unpublish`)
                ? successResponse(
                      review({
                          status: 'unpublished',
                          publiclyVisible: false,
                          availableActions: ['republish', 'delete'],
                      }),
                  )
                : undefined,
        );
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Hide' }));
        const dialog = await screen.findByRole('dialog');
        const reason = within(dialog).getByLabelText(
            'Note for other administrators (not shown to the author)',
        );

        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide review' }));
        expect(await within(dialog).findByText('Write at least 3 characters')).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);

        await userEvent.type(reason, 'Abusive language');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide review' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const post = calls.find((call) => call.method === 'POST')!;
        expect(JSON.parse(post.body ?? 'null')).toEqual({ reason: 'Abusive language' });

        const replaced = await row('Arrived late');
        expect(within(replaced).getByText('Hidden')).toBeInTheDocument();
        expect(within(replaced).getByRole('button', { name: 'Show again' })).toBeInTheDocument();
    });

    it('puts a server-side reason refusal on the field', async () => {
        stub((call) =>
            call.method === 'POST'
                ? errorResponse(400, 'VALIDATION_ERROR', {
                      category: 'validation',
                      details: { fields: [{ path: 'reason', message: 'Too short after trimming' }] },
                  })
                : undefined,
        );
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Hide' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'abc',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide review' }));

        expect(await within(dialog).findByText('Too short after trimming')).toBeInTheDocument();
    });

    it('refreshes the row when someone else changed it first (REVIEW_STATUS_CONFLICT)', async () => {
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
        const calls = stub((call) => {
            if (call.method === 'POST') {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'REVIEW_STATUS_CONFLICT', status: 'unpublished' },
                });
            }
            if (call.method === 'GET' && call.url.endsWith(`/reviews/${PRODUCT_REVIEW}`)) {
                return successResponse(
                    review({ status: 'unpublished', publiclyVisible: false, availableActions: ['republish', 'delete'] }),
                );
            }
            return undefined;
        });
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Hide' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'Abusive language',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide review' }));

        await waitFor(() => expect(warning).toHaveBeenCalledWith('Someone else already changed this review', expect.anything()));
        await waitFor(() =>
            expect(calls.some((call) => call.method === 'GET' && call.url.endsWith(`/reviews/${PRODUCT_REVIEW}`))).toBe(true),
        );
        expect(within(await row('Arrived late')).getByText('Hidden')).toBeInTheDocument();
    });

    it('says nothing changed when the platform cannot be reached', async () => {
        stub((call) =>
            call.method === 'POST'
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' })
                : undefined,
        );
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Hide' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'Abusive language',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide review' }));

        expect(await within(dialog).findByText('Nothing was changed. Try again.')).toBeInTheDocument();
    });
});

describe('show again', () => {
    it('takes no reason, and sends an empty body when none is written', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        const calls = stub((call) =>
            call.method === 'POST' && call.url.includes(`/reviews/${HIDDEN_REVIEW}/republish`)
                ? successResponse({ ...HIDDEN, status: 'published', publiclyVisible: true, availableActions: ['unpublish', 'delete'] })
                : undefined,
        );
        list();

        await userEvent.click(within(await row('Rude words')).getByRole('button', { name: 'Show again' }));
        const dialog = await screen.findByRole('dialog');
        expect(
            within(dialog).getByLabelText(
                'Note for other administrators (not shown to the author) — optional',
            ),
        ).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Show again' }));

        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        expect(JSON.parse(calls.find((call) => call.method === 'POST')!.body ?? 'null')).toEqual({});
        expect(within(await row('Rude words')).getByText('Public')).toBeInTheDocument();
    });
});

describe('delete', () => {
    it('says it cannot be undone and that the author may write again, then removes the row', async () => {
        vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        const calls = stub((call) =>
            call.method === 'DELETE' ? successResponse({ id: PRODUCT_REVIEW, deleted: true }) : undefined,
        );
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/can't be restored/)).toBeInTheDocument();
        expect(within(dialog).getByText(/its author will be able to write a new one/)).toBeInTheDocument();

        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'Spam',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

        await waitFor(() =>
            expect(screen.queryByRole('link', { name: 'Arrived late' })).not.toBeInTheDocument(),
        );
        const del = calls.find((call) => call.method === 'DELETE')!;
        expect(del.url).toMatch(new RegExp(`/reviews/${PRODUCT_REVIEW}$`));
        expect(JSON.parse(del.body ?? 'null')).toEqual({ reason: 'Spam' });
        expect(screen.getByRole('link', { name: 'Quick courier' })).toBeInTheDocument();
    });

    it.each([
        ['wi-admin', 404, 'NOT_FOUND', undefined],
        ['jovi-mall', 404, 'PLATFORM_OPERATION_REJECTED', { platformCode: 'REVIEW_NOT_FOUND' }],
    ] as const)('removes the row on %s’s 404 and says it was already deleted', async (_, status, code, details) => {
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
        stub((call) =>
            call.method === 'DELETE'
                ? errorResponse(status, code, { category: 'not_found', ...(details ? { details } : {}) })
                : undefined,
        );
        list();

        await userEvent.click(within(await row('Arrived late')).getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText('Note for other administrators (not shown to the author)'),
            'Spam',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

        await waitFor(() =>
            expect(screen.queryByRole('link', { name: 'Arrived late' })).not.toBeInTheDocument(),
        );
        expect(warning).toHaveBeenCalledWith('This review was already deleted', expect.anything());
    });
});
