import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommandPalette, CommandPaletteHotkey } from '@/components/layout/CommandPalette';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';

/*
  `cmdk` filters on each item's `value`, and jsdom gives it no layout — so these
  assert on what is *offered*, not on what survives a fuzzy match. Which rows
  exist is the part that carries the authorization rule; the matching is the
  library's own and is tested by the library.
*/

function palette(tier: 1 | 2 | 3, onOpenChange = vi.fn()) {
    renderWithProviders(
        <CommandPalette permissions={heldFixture(tier)} open onOpenChange={onOpenChange} />,
    );
    return onOpenChange;
}

describe('what the palette offers', () => {
    it('lists a destination the caller can open', () => {
        palette(1);

        expect(screen.getByRole('option', { name: /users/i })).toBeInTheDocument();
    });

    it('omits what the sidebar omits', () => {
        // Support holds 23 of 110 permissions and never sees the administrator
        // directory. The palette is built from the same two functions the
        // sidebar filters on, so it cannot disagree with it — a second list
        // would eventually offer a destination that answers 403.
        palette(3);

        expect(screen.queryByRole('option', { name: /^administrators/i })).not.toBeInTheDocument();
    });

    it('names a child by its module, so a module name finds it', () => {
        palette(1);

        // "Disputes" lives under Orders and does not contain the word.
        const disputes = screen.getByRole('option', { name: /disputes/i });
        expect(disputes).toHaveTextContent(/orders/i);
    });

    it('does not list a pure container as a destination of its own', () => {
        palette(1);

        // Money has no index child — its path redirects to the first child the
        // caller may open — so a "Money" row would land on the same screen as
        // the child row beneath it. Two rows, one destination.
        expect(screen.queryByRole('option', { name: /^money$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: /payouts/i })).toBeInTheDocument();
    });

    it('lists a module whose landing screen is real', () => {
        palette(1);

        // Orders *does* have an index child, so the module row is the list
        // screen and belongs in the palette.
        expect(screen.getByRole('option', { name: /^orders$/i })).toBeInTheDocument();
    });
});

describe('navigating', () => {
    it('closes on select', async () => {
        const onOpenChange = palette(1);

        await userEvent.click(screen.getByRole('option', { name: /users/i }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('the hotkey', () => {
    it('opens on ⌘K and on Ctrl+K', async () => {
        const onOpen = vi.fn();
        renderWithProviders(<CommandPaletteHotkey onOpen={onOpen} />);

        await userEvent.keyboard('{Control>}k{/Control}');
        expect(onOpen).toHaveBeenCalledTimes(1);

        await userEvent.keyboard('{Meta>}k{/Meta}');
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('ignores a bare k, which is a character somebody is typing', async () => {
        const onOpen = vi.fn();
        renderWithProviders(<CommandPaletteHotkey onOpen={onOpen} />);

        await userEvent.keyboard('k');

        expect(onOpen).not.toHaveBeenCalled();
    });
});
