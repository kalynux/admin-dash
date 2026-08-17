import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { useListQueryState } from '@/hooks/use-list-query-state';

const KEYS = ['search', 'role', 'sort'] as const;
const DEFAULTS = { sort: '-createdAt' } as const;

/** Renders the hook's state and exposes the URL, so assertions read both halves. */
function Probe() {
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(KEYS, DEFAULTS);
    const { search } = useLocation();

    return (
        <div>
            <output data-testid="url">{search}</output>
            <output data-testid="values">{JSON.stringify(values)}</output>
            <output data-testid="page">{page}</output>
            <output data-testid="filtered">{String(isFiltered)}</output>

            <button onClick={() => set({ search: 'amina' })}>set search</button>
            <button onClick={() => set({ role: 'agent' })}>set role</button>
            <button onClick={() => set({ sort: 'email' })}>sort by email</button>
            <button onClick={() => set({ sort: '-createdAt' })}>sort by default</button>
            <button onClick={() => set({ search: null })}>clear search</button>
            <button onClick={() => setPage(3)}>page 3</button>
            <button onClick={() => setPage(1)}>page 1</button>
            <button onClick={reset}>reset</button>
        </div>
    );
}

function mount(route = '/dashboard/users') {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <Probe />
        </MemoryRouter>,
    );
}

const url = () => screen.getByTestId('url').textContent;
const values = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}');

describe('reading', () => {
    it('resolves an absent key to its default, and to empty with none', () => {
        mount();

        expect(values()).toEqual({ search: '', role: '', sort: '-createdAt' });
    });

    it('reads what the URL holds', () => {
        mount('/dashboard/users?search=amina&role=agent&sort=email&page=4');

        expect(values()).toEqual({ search: 'amina', role: 'agent', sort: 'email' });
        expect(screen.getByTestId('page')).toHaveTextContent('4');
    });

    it('floors a page below one rather than sending it', () => {
        // `?page=0` typed by hand is a 400 — the schema is `.min(1)`.
        mount('/dashboard/users?page=0');

        expect(screen.getByTestId('page')).toHaveTextContent('1');
    });

    it('reports filtered only when something differs from the defaults', () => {
        mount('/dashboard/users?sort=-createdAt');

        // Sorting by the default is not a filter, and offering "clear filters"
        // over it is a button that does nothing.
        expect(screen.getByTestId('filtered')).toHaveTextContent('false');
    });
});

describe('writing', () => {
    it('resets to page one when a filter changes', async () => {
        // Page 4 of the unfiltered directory is not page 4 of the filtered one,
        // and keeping it lands on an empty table over a result set with rows.
        mount('/dashboard/users?page=4');

        await userEvent.click(screen.getByRole('button', { name: 'set search' }));

        expect(url()).toContain('search=amina');
        expect(url()).not.toContain('page=');
        expect(screen.getByTestId('page')).toHaveTextContent('1');
    });

    it('keeps the filters when only the page moves', async () => {
        mount('/dashboard/users?search=amina');

        await userEvent.click(screen.getByRole('button', { name: 'page 3' }));

        expect(url()).toContain('search=amina');
        expect(url()).toContain('page=3');
    });

    it('drops the page parameter at page one rather than writing it', async () => {
        mount('/dashboard/users?search=amina&page=3');

        await userEvent.click(screen.getByRole('button', { name: 'page 1' }));

        expect(url()).toContain('search=amina');
        expect(url()).not.toContain('page=');
    });

    it('removes a key set back to its default', async () => {
        mount('/dashboard/users?sort=email');

        await userEvent.click(screen.getByRole('button', { name: 'sort by default' }));

        expect(url()).not.toContain('sort=');
        expect(values().sort).toBe('-createdAt');
    });

    it('removes a key cleared with null', async () => {
        mount('/dashboard/users?search=amina&role=agent');

        await userEvent.click(screen.getByRole('button', { name: 'clear search' }));

        expect(url()).not.toContain('search=');
        expect(url()).toContain('role=agent');
    });

    it('clears every declared key and the page on reset', async () => {
        mount('/dashboard/users?search=amina&role=agent&sort=email&page=2');

        await userEvent.click(screen.getByRole('button', { name: 'reset' }));

        expect(url()).toBe('');
        expect(values()).toEqual({ search: '', role: '', sort: '-createdAt' });
    });

    it('leaves parameters it does not own alone', async () => {
        // The hook is handed the keys a screen owns. Anything else in the query
        // string belongs to somebody else and must survive a filter change.
        mount('/dashboard/users?tab=activity&search=old');

        await userEvent.click(screen.getByRole('button', { name: 'set role' }));

        expect(url()).toContain('tab=activity');
        expect(url()).toContain('search=old');
        expect(url()).toContain('role=agent');
    });

    it('applies two writes in a row without losing the first', async () => {
        // The functional updater form matters here: reading `searchParams` from
        // the closure instead would drop whichever write rendered second.
        mount();

        await act(async () => {
            await userEvent.click(screen.getByRole('button', { name: 'set search' }));
            await userEvent.click(screen.getByRole('button', { name: 'set role' }));
        });

        expect(url()).toContain('search=amina');
        expect(url()).toContain('role=agent');
    });
});
