import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyableId } from '@/components/common/CopyableId';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '@/test/utils';

/**
 * The dashboard shows a lot of raw ids and has to: a 24-hex ObjectId is what an
 * operator pastes into a ticket, a query or a colleague's chat window, and for
 * several records the API returns no name at all. The complaint was that they
 * were shown *instead of* names and could not be copied — so this is the
 * affordance for the id half.
 */

const ID = '665f1c2a9b3e4a91c7d2e5f0';

function renderId(ui: React.ReactElement) {
    return renderWithProviders(<TooltipProvider>{ui}</TooltipProvider>);
}

/** jsdom has no clipboard; every test decides what `writeText` does. */
function stubClipboard(impl: () => Promise<void>) {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true,
    });
    return writeText;
}

beforeEach(() => {
    stubClipboard(() => Promise.resolve());
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('rendering', () => {
    it('keeps both ends of the id, never a bare prefix', async () => {
        // ObjectIds share a leading timestamp, so two ids minted in the same
        // second are identical for the first several characters. Truncating from
        // the left alone would render half a page of rows as the same string.
        renderId(<CopyableId value={ID} label="order ID" />);

        expect(screen.getByTitle(ID)).toHaveTextContent('665f1c…e5f0');
    });

    it('shows the value whole when asked', () => {
        renderId(<CopyableId value={ID} label="order ID" truncate={false} />);

        expect(screen.getByTitle(ID)).toHaveTextContent(ID);
    });

    it('carries the full value in the title however it is displayed', () => {
        renderId(<CopyableId value={ID} label="order ID" />);

        expect(screen.getByTitle(ID)).toBeInTheDocument();
    });

    it('renders an explicit gap for an absent id, not an empty box', () => {
        renderId(<CopyableId value={null} label="order ID" />);

        expect(screen.getByText('Not set')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('names the subject in the button, since a row can carry several', () => {
        renderId(<CopyableId value={ID} label="vendor ID" />);

        expect(screen.getByRole('button', { name: 'Copy vendor ID' })).toBeInTheDocument();
    });

    it('links the id when given a destination, without swallowing the copy button', () => {
        renderId(<CopyableId value={ID} label="order ID" to={`/dashboard/orders/${ID}`} />);

        expect(screen.getByRole('link')).toHaveAttribute('href', `/dashboard/orders/${ID}`);
        expect(screen.getByRole('button', { name: 'Copy order ID' })).toBeInTheDocument();
    });
});

describe('copying', () => {
    it('copies the full value, not the truncated display', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderId(<CopyableId value={ID} label="order ID" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(writeText).toHaveBeenCalledWith(ID);
    });

    it('confirms afterwards, in the accessible name as well as the icon', async () => {
        renderId(<CopyableId value={ID} label="order ID" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(await screen.findByRole('button', { name: 'order ID copied' })).toBeInTheDocument();
    });

    it('survives a refused clipboard and leaves the value on screen', async () => {
        // A non-secure origin, an unfocused document or a denied permission. The
        // id is selectable text either way, which is why this must not throw.
        stubClipboard(() => Promise.reject(new Error('denied')));
        renderId(<CopyableId value={ID} label="order ID" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(screen.getByTitle(ID)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'order ID copied' })).not.toBeInTheDocument();
    });

    it('survives a browser with no clipboard object at all', async () => {
        // On a plain-HTTP origin `navigator.clipboard` is undefined rather than a
        // method that rejects, so an unguarded call throws a TypeError.
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        renderId(<CopyableId value={ID} label="order ID" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(screen.getByTitle(ID)).toBeInTheDocument();
    });

    it('does not navigate when the copy button sits inside a link', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderId(<CopyableId value={ID} label="order ID" to={`/dashboard/orders/${ID}`} />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(writeText).toHaveBeenCalledWith(ID);
    });
});
