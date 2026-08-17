import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import { useRouteFocus } from '@/hooks/use-route-focus';

const TARGET = 'main-content';

function Harness() {
    useRouteFocus(TARGET);

    return (
        <>
            <main id={TARGET} tabIndex={-1}>
                <Link to="/detail?page=2">Open a record</Link>
                <Link to="/?search=am">Type in the filter</Link>
                <Routes>
                    <Route path="/" element={<p>the list</p>} />
                    <Route path="/detail" element={<p>the record</p>} />
                </Routes>
            </main>
        </>
    );
}

function harness(route = '/') {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <Harness />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    window.scrollTo = vi.fn();
});

describe('landing on a new screen', () => {
    it('leaves the browser alone on the first render', () => {
        // A cold load has already placed focus and scroll, and may have restored
        // a position on a back-navigation. That is the one case it gets right.
        harness();

        expect(window.scrollTo).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.body);
    });

    it('scrolls to the top when the pathname changes', async () => {
        harness();

        await userEvent.click(screen.getByRole('link', { name: 'Open a record' }));

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    });

    it('moves focus into the content, so Tab does not restart at the sidebar', async () => {
        harness();

        await userEvent.click(screen.getByRole('link', { name: 'Open a record' }));

        expect(document.activeElement).toBe(document.getElementById(TARGET));
    });
});

describe('what must not count as a navigation', () => {
    it('ignores a query-string change', async () => {
        // Every list keeps its filters in the query string and the search box
        // writes there on every keystroke. Reacting would yank focus out of the
        // input mid-word.
        harness();

        await userEvent.click(screen.getByRole('link', { name: 'Type in the filter' }));

        expect(window.scrollTo).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(document.getElementById(TARGET));
    });
});
