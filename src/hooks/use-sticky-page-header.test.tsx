import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { PAGE_HEADER_HEIGHT_VAR, useStickyPageHeader } from '@/hooks/use-sticky-page-header';

/**
 * A `ResizeObserver` the test drives by hand — the suite's own stub observes
 * nothing, which is also what a hook that never measured would look like.
 */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    observed: Element[] = [];
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        FakeResizeObserver.instances.push(this);
    }

    observe(target: Element) {
        this.observed.push(target);
    }

    unobserve() {}

    disconnect() {
        this.observed = [];
    }

    static resize(target: Element) {
        for (const observer of FakeResizeObserver.instances) {
            if (observer.observed.includes(target)) {
                observer.callback([], observer as unknown as ResizeObserver);
            }
        }
    }
}

/** Where the bar is on screen, and where its own `top` says it pins. */
function layout(bar: HTMLElement, { top, height }: { top: number; height: number }) {
    bar.style.top = '64px';
    bar.getBoundingClientRect = () => ({ top, height }) as DOMRect;
}

/** The hook measures once per animation frame; let that frame run. */
async function nextFrame() {
    await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
}

function Bar({ present = true }: { present?: boolean }) {
    const { ref, stuck } = useStickyPageHeader<HTMLDivElement>();

    return present ? <div ref={ref} data-testid="bar" data-stuck={String(stuck)} /> : null;
}

function publishedHeight(): string {
    return document.documentElement.style.getPropertyValue(PAGE_HEADER_HEIGHT_VAR);
}

describe('the pinned page header', () => {
    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * The bar arrives LATE on purpose — a detail screen has no actions until the
     * record has loaded. A hook that looked for its element once, at mount,
     * would publish nothing, and the table header would pin on top of the bar.
     */
    it('publishes its height for what pins beneath it, when the bar arrives after mount', async () => {
        const view = render(<Bar present={false} />);
        expect(publishedHeight()).toBe('');

        view.rerender(<Bar />);
        const bar = screen.getByTestId('bar');
        layout(bar, { top: 88, height: 52.6 });
        FakeResizeObserver.resize(bar);
        await nextFrame();

        // Rounded down: a table header that tucks a fraction under the bar,
        // never one that leaves a gap above itself.
        expect(publishedHeight()).toBe('52px');
    });

    it('follows the bar when its actions wrap onto a second row', async () => {
        render(<Bar />);
        const bar = screen.getByTestId('bar');

        layout(bar, { top: 88, height: 52 });
        FakeResizeObserver.resize(bar);
        await nextFrame();
        expect(publishedHeight()).toBe('52px');

        layout(bar, { top: 88, height: 100 });
        FakeResizeObserver.resize(bar);
        await nextFrame();
        expect(publishedHeight()).toBe('100px');
    });

    it('says it is pinned only once it has reached its own offset', async () => {
        render(<Bar />);
        const bar = screen.getByTestId('bar');

        // At rest: below the app bar by the page's own top padding.
        layout(bar, { top: 88, height: 52 });
        FakeResizeObserver.resize(bar);
        await nextFrame();
        expect(bar).toHaveAttribute('data-stuck', 'false');

        layout(bar, { top: 64, height: 52 });
        window.dispatchEvent(new Event('scroll'));
        await nextFrame();
        expect(bar).toHaveAttribute('data-stuck', 'true');

        // Back to the top of the page.
        layout(bar, { top: 88, height: 52 });
        window.dispatchEvent(new Event('scroll'));
        await nextFrame();
        expect(bar).toHaveAttribute('data-stuck', 'false');
    });

    /**
     * The next page may pin nothing, and its table header reads this same
     * property: a height left behind would float every column label 52px below
     * the app bar with nothing above it.
     */
    it('takes its height back when the bar goes', async () => {
        const view = render(<Bar />);
        const bar = screen.getByTestId('bar');
        layout(bar, { top: 88, height: 52 });
        FakeResizeObserver.resize(bar);
        await nextFrame();
        expect(publishedHeight()).toBe('52px');

        view.rerender(<Bar present={false} />);
        expect(publishedHeight()).toBe('');
    });
});
