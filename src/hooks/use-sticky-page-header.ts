import { useEffect, useState } from 'react';

/**
 * The pinned page header's height, published on `<html>`.
 *
 * Two readers, and both are CSS: `DataTable`'s header row pins *under* the page
 * header rather than under the app bar, and `scroll-padding-top` in `index.css`
 * keeps a focused element from being scrolled in beneath the pair. Neither can
 * know the height otherwise — it changes with the breakpoint and with how many
 * actions a page has.
 *
 * ⚠ The name is also written out literally in `DataTable.tsx` and `index.css`:
 * Tailwind scans class strings, so it cannot be interpolated there.
 */
export const PAGE_HEADER_HEIGHT_VAR = '--page-header-height';

/**
 * What a `position: sticky` page header needs beyond the CSS: its height
 * published for the things that pin beneath it, and whether it is pinned right
 * now, so the rule under it is drawn only while content is passing behind.
 *
 * A callback ref held in state, for the reason `useOverflowX` gives: the element
 * may arrive after mount, and may leave again — a page whose actions depend on
 * the record it loaded has no bar to measure until it has loaded.
 *
 * The height goes straight to a custom property rather than through state. It
 * has no reader in React, and a page that re-rendered on every wrap of its own
 * action row would be paying for nothing.
 *
 * Where there is no layout to measure — jsdom — the height reads `0px` and
 * `stuck` stays `false`, which is an ordinary unpinned header.
 */
export function useStickyPageHeader<T extends HTMLElement>() {
    const [element, setElement] = useState<T | null>(null);
    const [stuck, setStuck] = useState(false);

    useEffect(() => {
        if (!element || typeof ResizeObserver === 'undefined') return;

        const root = document.documentElement;
        let frame = 0;

        const measure = () => {
            frame = 0;
            const rect = element.getBoundingClientRect();

            // Rounded down, so whatever pins beneath tucks a fraction of a pixel
            // under the bar instead of leaving a hairline gap rows show through.
            root.style.setProperty(PAGE_HEADER_HEIGHT_VAR, `${Math.floor(rect.height)}px`);

            // Pinned once it has reached its own `top` offset. Read from the
            // computed style, so the two app-bar heights stay stated in one
            // place — the class list. Half a pixel of tolerance for zoom.
            const offset = Number.parseFloat(getComputedStyle(element).top);
            setStuck(rect.top <= offset + 0.5);
        };

        // One measurement per frame, however many scroll events land in it.
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };

        // Fires once on `observe()`, which is the first measurement.
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);

        return () => {
            observer.disconnect();
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            if (frame) cancelAnimationFrame(frame);
            root.style.removeProperty(PAGE_HEADER_HEIGHT_VAR);
        };
    }, [element]);

    /** Pass as `ref`. React calls it with the node on mount and `null` on unmount. */
    const ref: (node: T | null) => void = setElement;

    return { ref, stuck };
}
