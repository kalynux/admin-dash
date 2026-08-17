import { useEffect, useRef, useState } from 'react';

/**
 * Whether an element's content is wider than the element.
 *
 * ── The two things that hang off the answer ───────────────────────────────────
 * **A tab stop.** An `overflow-x: auto` container scrolls with a pointer and a
 * trackpad, and with nothing else. It is not focusable, so a keyboard has no way
 * to reach the columns past the right-hand edge — a wide table's last three
 * columns are simply unavailable to anyone not using a mouse. The fix is a tab
 * stop on the container, and it needs measuring rather than being unconditional
 * because these screens carry a lot of tables: a permanent extra stop in front
 * of every one of them is its own tax on the same operator.
 *
 * **A sticky header.** An element that scrolls on one axis is a scroll container
 * on *both*, which scopes `position: sticky` inside it to that container instead
 * of to the page. A table that fits can therefore drop the overflow entirely and
 * keep its header pinned under the app bar; a table that does not has to scroll,
 * and gives the sticky header up. See `DataTable`.
 *
 * ── Why there is no manual first measurement ──────────────────────────────────
 * `ResizeObserver` fires its callback once on `observe()`, which *is* the first
 * measurement. Calling a `setState` measure directly in the effect body would
 * also trip `react-hooks/set-state-in-effect`, and the rule is right: the value
 * would then be written twice on mount for no gain.
 *
 * Where `ResizeObserver` is missing — jsdom, in this repo's suite — the answer
 * stays `false`. That is the correct failure: a table renders un-scrolled with
 * no extra tab stop, which is what a table with no measurable layout should do.
 */
export function useOverflowX<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [overflows, setOverflows] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            // A pixel of tolerance: sub-pixel layout rounding otherwise reports
            // a permanent one-pixel overflow on tables that fit exactly, which
            // would flip the container between its two modes forever.
            setOverflows(element.scrollWidth - element.clientWidth > 1);
        });

        observer.observe(element);
        // The container's own box does not change when a column is added — the
        // table inside it does. Watch both.
        if (element.firstElementChild) observer.observe(element.firstElementChild);

        return () => observer.disconnect();
    }, []);

    return { ref, overflows };
}
