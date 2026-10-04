import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { notify } from '@/lib/notify';
import { CategoriesList } from '@/pages/categories/CategoriesList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { Category } from '@/types/categories.types';

const SHOES = '66ff0c1e2a4b5c6d7e8f9a01';
const CHAUSSURES = '66ff0c1e2a4b5c6d7e8f9a02';
const TYPO = '66ff0c1e2a4b5c6d7e8f9a03';

/** `categories.md`'s worked row, plus two to act on. */
function category(overrides: Partial<Category> = {}): Category {
    return {
        id: SHOES,
        name: 'Shoes',
        slug: 'shoes',
        aliasKeys: ['chaussure'],
        createdSource: 'vendor',
        createdByVendorId: '66aa00000000000000000001',
        productCount: 41,
        activeProductCount: 37,
        createdAt: '2026-10-04T09:12:00.000Z',
        updatedAt: '2026-10-05T14:30:00.000Z',
        ...overrides,
    };
}

const ROWS = [
    category({ id: CHAUSSURES, name: 'Chaussures', slug: 'chaussures', aliasKeys: [], productCount: 12, activeProductCount: 9 }),
    category(),
    category({ id: TYPO, name: 'Shoees', slug: 'shoees', aliasKeys: [], productCount: 0, activeProductCount: 0 }),
];

const meta = (total: number) => ({ total, page: 1, limit: 20, pages: total > 0 ? 1 : 0 });
const ref = (row: Category) => ({ id: row.id, name: row.name, slug: row.slug, aliasKeys: row.aliasKeys });

type Write = (call: FetchCall) => Response | undefined;

/** Answers the list; `write` answers anything else, and anything unanswered is a failure. */
function stub(write: Write = () => undefined) {
    return stubFetch((call: FetchCall) => {
        if (call.method === 'GET' && /\/categories(\?|$)/.test(call.url)) {
            return successResponse(ROWS, { meta: meta(ROWS.length) });
        }
        const answer = write(call);
        if (answer) return answer;
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(tier: 1 | 2 | 3) {
    return renderWithProviders(<CategoriesList />, {
        route: '/dashboard/categories',
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { status: 'ready', held: heldFixture(tier) },
    });
}

const row = async (name: string) =>
    (await screen.findByRole('link', { name })).closest('tr') as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe('the list', () => {
    it('shows each category with both product counts and who created it', async () => {
        stub();
        list(3);

        const shoes = await row('Shoes');
        expect(within(shoes).getByText('shoes')).toBeInTheDocument();
        expect(within(shoes).getByText('41')).toBeInTheDocument();
        expect(within(shoes).getByText('37')).toBeInTheDocument();
        expect(within(shoes).getByText('Vendor')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Shoes' })).toHaveAttribute(
            'href',
            `/dashboard/categories/${SHOES}`,
        );
    });

    it('lets Support read the list and offers them no action at all', async () => {
        stub();
        list(3);

        await row('Shoes');
        expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('offers Delete only on an unused category, and says why elsewhere', async () => {
        stub();
        list(2);

        expect(within(await row('Shoees')).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        const shoes = await row('Shoes');
        expect(within(shoes).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
        expect(within(shoes).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
        expect(within(shoes).getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    });

    it('filters by createdSource through the URL', async () => {
        const calls = stub();
        list(3);
        await row('Shoes');

        await userEvent.click(screen.getByRole('combobox', { name: 'Created by' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Migration' }));

        await waitFor(() => {
            const last = new URL(calls[calls.length - 1].url, 'http://localhost');
            expect(last.searchParams.get('createdSource')).toBe('migration');
        });
    });
});

describe('rename', () => {
    it('turns a taken name into an offer to merge, then merges and reports what moved', async () => {
        const success = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
        const chaussures = ROWS[0];
        const calls = stub((call) => {
            if (call.method === 'PATCH') {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'CATEGORY_NAME_TAKEN', existingId: SHOES, existingName: 'Shoes' },
                });
            }
            if (call.method === 'POST' && call.url.includes(`/categories/${CHAUSSURES}/merge`)) {
                return successResponse({ source: ref(chaussures), target: ref(ROWS[1]), productsUpdated: 11 });
            }
            return undefined;
        });
        list(2);

        await userEvent.click(within(await row('Chaussures')).getByRole('button', { name: 'Rename' }));
        const name = screen.getByLabelText('New name');
        await userEvent.clear(name);
        await userEvent.type(name, 'Shoes');
        await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

        // Not an error toast: an offer, naming the holder.
        expect(await screen.findByText('“Shoes” already has that name.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /merge into shoes instead/i }));

        // Straight to the confirmation — the target is already known.
        const dialog = await screen.findByRole('dialog');
        expect(
            within(dialog).getByText('Move 12 products from Chaussures to Shoes? This cannot be undone.'),
        ).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /merge and move 12 products/i }));

        await waitFor(() =>
            expect(success).toHaveBeenCalledWith(
                'Merged Chaussures into Shoes — 11 products moved',
                expect.anything(),
            ),
        );
        const merge = calls.find((call) => call.method === 'POST');
        expect(JSON.parse(merge?.body ?? '')).toEqual({ targetId: SHOES });
    });

    it('says what a valid name is when jovi-mall refuses one', async () => {
        stub((call) =>
            call.method === 'PATCH'
                ? errorResponse(400, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'validation',
                      details: { platformCode: 'CATEGORY_NAME_INVALID' },
                  })
                : undefined,
        );
        list(2);

        await userEvent.click(within(await row('Shoes')).getByRole('button', { name: 'Rename' }));
        const name = screen.getByLabelText('New name');
        await userEvent.clear(name);
        await userEvent.type(name, '!!');
        await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(await screen.findByText(/that name cannot be used/i)).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});

describe('merge', () => {
    it('picks a target from the list, leaving the source out, then confirms before moving anything', async () => {
        const calls = stub((call) =>
            call.method === 'POST'
                ? successResponse({ source: ref(ROWS[1]), target: ref(ROWS[0]), productsUpdated: 41 })
                : undefined,
        );
        list(2);

        await userEvent.click(within(await row('Shoes')).getByRole('button', { name: 'Merge' }));
        const dialog = await screen.findByRole('dialog');
        const picker = await within(dialog).findByRole('list', { name: 'Categories to merge into' });

        expect(within(picker).queryByText('Shoes')).not.toBeInTheDocument();
        await userEvent.click(within(picker).getByRole('button', { name: /chaussures/i }));
        expect(calls.some((call) => call.method === 'POST')).toBe(false);

        await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
        expect(
            await screen.findByText('Move 41 products from Shoes to Chaussures? This cannot be undone.'),
        ).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);

        await userEvent.click(screen.getByRole('button', { name: /merge and move 41 products/i }));
        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    });

    it('sends the operator back to the picker on CATEGORY_MERGE_INVALID, with the reason', async () => {
        stub((call) =>
            call.method === 'POST'
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'business_rule',
                      details: { platformCode: 'CATEGORY_MERGE_INVALID', reason: 'target_not_live' },
                  })
                : undefined,
        );
        list(2);

        await userEvent.click(within(await row('Shoes')).getByRole('button', { name: 'Merge' }));
        const picker = await screen.findByRole('list', { name: 'Categories to merge into' });
        await userEvent.click(within(picker).getByRole('button', { name: /chaussures/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await userEvent.click(await screen.findByRole('button', { name: /merge and move/i }));

        expect(await screen.findByText(/merged away or deleted in the meantime/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });
});

describe('delete', () => {
    it('turns CATEGORY_IN_USE into an offer to merge', async () => {
        stub((call) =>
            call.method === 'DELETE'
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'conflict',
                      details: { platformCode: 'CATEGORY_IN_USE', productCount: 2 },
                  })
                : undefined,
        );
        list(2);

        await userEvent.click(within(await row('Shoees')).getByRole('button', { name: 'Delete' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

        expect(await screen.findByText('2 products now use it, so it was not deleted.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /merge instead/i }));
        expect(await screen.findByRole('heading', { name: 'Merge Shoees into…' })).toBeInTheDocument();
    });

    it('refreshes when the category was already gone', async () => {
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
        const calls = stub((call) =>
            call.method === 'DELETE' ? errorResponse(404, 'NOT_FOUND', { category: 'not_found' }) : undefined,
        );
        list(2);

        await userEvent.click(within(await row('Shoees')).getByRole('button', { name: 'Delete' }));
        const before = calls.filter((call) => call.method === 'GET').length;
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(warning).toHaveBeenCalled());
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(before),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
