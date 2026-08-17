import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { renderWithProviders } from '@/test/utils';

/**
 * The stand-in for a screen that has not been built yet.
 *
 * ── Why this is tested here rather than through the shell ─────────────────────
 * It used to be pinned in `App.test.tsx` against whichever module happened to be
 * unbuilt, and that fixture had to move three times — agencies, then agents, then
 * administrators — as each shipped, with the file's own docstring warning that it
 * would eventually run out of candidates. It has: once system and developer tools
 * ship there is no unbuilt module left to point at, and `screenFor`'s fallback is
 * reachable only by a nav entry that has no screen registered.
 *
 * So the contract under test is the component's own, and it does not depend on
 * anything being unbuilt: **stand in for whatever entry owns this path, naming
 * the phase that owns it and the permissions the real screen will be gated on.**
 * It reads neither `implemented` nor any endpoint, which is what makes it safe to
 * render for an entry that has since been built.
 */
describe('the unbuilt-screen placeholder', () => {
    it('names the entry, its owning phase and the permission the route checks', () => {
        renderWithProviders(<ModulePlaceholder />, { route: '/dashboard/permissions' });

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Permission matrix');
        expect(screen.getByText(/is not built yet/i)).toBeInTheDocument();
        expect(screen.getByText(/phase 14/i)).toBeInTheDocument();
        expect(screen.getByText('permissions.read')).toBeInTheDocument();
    });

    it('resolves the deepest entry, not its container', () => {
        renderWithProviders(<ModulePlaceholder />, { route: '/dashboard/cod/deposits' });

        // Naming the container instead would print `cod.overview.read` and friends — a
        // permission the route does not actually check.
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deposits');
        expect(screen.getByText('cod.deposits.read')).toBeInTheDocument();
        expect(screen.queryByText('cod.overview.read')).not.toBeInTheDocument();
    });

    it('says so plainly for a path no nav entry claims', () => {
        renderWithProviders(<ModulePlaceholder />, { route: '/dashboard/nonsense' });

        expect(screen.getByText(/no screen behind it yet/i)).toBeInTheDocument();
        // No phase and no permission badges to show, so it must not invent either.
        expect(screen.queryByText(/phase \d/i)).not.toBeInTheDocument();
    });

    it('calls no endpoint, so nothing on it can be mistaken for live data', () => {
        // No `stubFetch` at all: an unstubbed `fetch` would reject and surface here.
        renderWithProviders(<ModulePlaceholder />, { route: '/dashboard/permissions' });

        expect(screen.getByText(/is not built yet/i)).toBeInTheDocument();
    });
});
