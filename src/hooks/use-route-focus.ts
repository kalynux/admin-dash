import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Put the operator at the top of the new screen, keyboard and all.
 *
 * Two things a browser does for free on a real navigation and that a client-side
 * router does not:
 *
 * - **Scroll to the top.** Without it, following a record link from row 180 of a
 *   list opens the detail screen already scrolled past its own heading. This is
 *   the single most common complaint about SPA dashboards and it is four lines
 *   to fix.
 * - **Reset focus.** Focus otherwise stays on the link that was clicked — which
 *   has just been unmounted, so it falls to `<body>`, and the next Tab starts
 *   again from the very first element on the page. For a keyboard operator that
 *   is the whole sidebar, on every navigation.
 *
 * ── Why `pathname` and not the whole location ─────────────────────────────────
 * Every list keeps its filters in the query string, and the search box writes
 * there on **every keystroke**. Reacting to `search` would scroll the page to
 * the top and yank focus out of the input mid-word. A pathname change is the
 * only thing that means "a different screen".
 *
 * ── Why the first render is skipped ───────────────────────────────────────────
 * On a cold load the browser has already placed focus and scroll itself, and it
 * may have restored a position on a back-navigation. Overriding that would undo
 * the one case the browser gets right.
 */
export function useRouteFocus(targetId: string): void {
    const { pathname } = useLocation();
    const previous = useRef<string | null>(null);

    useEffect(() => {
        // First run: adopt the browser's own state rather than replacing it.
        if (previous.current === null) {
            previous.current = pathname;
            return;
        }
        if (previous.current === pathname) return;
        previous.current = pathname;

        window.scrollTo({ top: 0, left: 0 });

        const target = document.getElementById(targetId);
        // `preventScroll`, because focusing an element scrolls it into view and
        // that would fight the `scrollTo` above on any layout where the content
        // region does not start at the top of the document.
        target?.focus({ preventScroll: true });
    }, [pathname, targetId]);
}
