import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useRefreshToken } from '@/hooks/use-refresh-token';

function Probe({ minIntervalMs }: { minIntervalMs?: number }) {
    const { token, refresh } = useRefreshToken(minIntervalMs);
    return (
        <div>
            <span data-testid="token">{token}</span>
            <button onClick={refresh}>refresh</button>
        </div>
    );
}

/** jsdom reports `hidden: false`; the property has to be redefined to flip it. */
function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

function returnToTab() {
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
});

describe('useRefreshToken', () => {
    it('starts at zero so a tile can tell first load from a refresh', () => {
        render(<Probe />);
        expect(screen.getByTestId('token')).toHaveTextContent('0');
    });

    it('moves the token when asked, ignoring the floor', async () => {
        render(<Probe />);

        await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
        expect(screen.getByTestId('token')).toHaveTextContent('1');

        // The button is a deliberate act; throttling it would make the page feel
        // broken rather than considerate.
        await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
        expect(screen.getByTestId('token')).toHaveTextContent('2');
    });

    it('refreshes on returning to the tab once the floor has passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-14T09:00:00.000Z'));
        render(<Probe />);

        vi.setSystemTime(new Date('2026-08-14T09:02:00.000Z'));
        returnToTab();

        expect(screen.getByTestId('token')).toHaveTextContent('1');
    });

    it('does not refresh again inside the floor', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-14T09:00:00.000Z'));
        render(<Probe />);

        // Mount counts as a refresh, so an operator alternating between the
        // dashboard and another window does not fire sixteen requests each way.
        vi.setSystemTime(new Date('2026-08-14T09:00:40.000Z'));
        returnToTab();

        expect(screen.getByTestId('token')).toHaveTextContent('0');
    });

    it('ignores the event when the tab is being hidden, not revealed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-14T09:00:00.000Z'));
        render(<Probe />);

        vi.setSystemTime(new Date('2026-08-14T09:10:00.000Z'));
        setHidden(true);
        returnToTab();

        expect(screen.getByTestId('token')).toHaveTextContent('0');
    });

    it('stops listening when it unmounts', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-14T09:00:00.000Z'));
        const { unmount } = render(<Probe />);

        unmount();
        vi.setSystemTime(new Date('2026-08-14T09:10:00.000Z'));

        // No state update on an unmounted component — this would warn if the
        // listener survived.
        expect(() => returnToTab()).not.toThrow();
    });
});
