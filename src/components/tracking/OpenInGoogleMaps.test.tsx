import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenInGoogleMaps } from '@/components/tracking/OpenInGoogleMaps';
import { googleMapsUrl } from '@/lib/geo';

const URL_DOUALA = googleMapsUrl(4.0511, 9.7043)!;

/** A stand-in for the window `window.open` hands back. */
function fakeWindow() {
    return { opener: {} as unknown, focus: vi.fn() };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OpenInGoogleMaps', () => {
    it('renders nothing when there is no URL', () => {
        // The normal answer for a pair that is not a place. A dead button would
        // be worse than no button.
        const { container } = render(<OpenInGoogleMaps url={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('is a real link, so it works with the keyboard and with copy-link', () => {
        render(<OpenInGoogleMaps url={URL_DOUALA} />);
        const link = screen.getByRole('link', { name: /open in google maps/i });
        expect(link).toHaveAttribute('href', URL_DOUALA);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('opens a popup and suppresses the navigation when one comes back', () => {
        const popup = fakeWindow();
        const open = vi.fn(() => popup);
        vi.stubGlobal('open', open);

        render(<OpenInGoogleMaps url={URL_DOUALA} />);
        const link = screen.getByRole('link');
        const handled = fireEvent.click(link);

        expect(open).toHaveBeenCalledTimes(1);
        const [url, name, features] = open.mock.calls[0] as unknown as [string, string, string];
        expect(url).toBe(URL_DOUALA);
        // A constant name, so a second click steers the window already open
        // rather than stacking another — this sits on every row of the trail.
        expect(name).toBe('wi-admin-map');
        expect(features).toContain('popup=1');
        expect(features).toMatch(/width=\d+/);
        expect(features).toMatch(/height=\d+/);
        // `noopener` in the feature string would make `window.open` return null,
        // which is indistinguishable from a blocked popup — the fallback would
        // then fire as well and the map would open twice.
        expect(features).not.toContain('noopener');

        // `fireEvent.click` returns false when the default was prevented.
        expect(handled).toBe(false);
        expect(popup.opener).toBeNull();
        expect(popup.focus).toHaveBeenCalled();
    });

    it('falls back to the anchor when the popup is blocked', () => {
        const open = vi.fn(() => null);
        vi.stubGlobal('open', open);

        render(<OpenInGoogleMaps url={URL_DOUALA} />);
        const handled = fireEvent.click(screen.getByRole('link'));

        expect(open).toHaveBeenCalledTimes(1);
        // Default NOT prevented: the browser navigates the link itself, so the
        // operator gets a tab rather than a dead button and an error toast.
        expect(handled).toBe(true);
    });

    it('leaves a modified click to the browser', () => {
        const open = vi.fn(() => fakeWindow());
        vi.stubGlobal('open', open);

        render(<OpenInGoogleMaps url={URL_DOUALA} />);
        const link = screen.getByRole('link');

        for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
            expect(fireEvent.click(link, modifier)).toBe(true);
        }
        // An operator asking for a background tab has asked for a background tab.
        expect(open).not.toHaveBeenCalled();
    });

    it('keeps an accessible name when it is icon-only', () => {
        render(<OpenInGoogleMaps url={URL_DOUALA} iconOnly label="Open 08:41 in Google Maps" />);
        const link = screen.getByRole('link', { name: 'Open 08:41 in Google Maps' });
        expect(link).toHaveAttribute('title', 'Open 08:41 in Google Maps');
        expect(link).not.toHaveTextContent('Open 08:41');
    });
});
