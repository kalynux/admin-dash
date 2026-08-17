import { useEffect, useSyncExternalStore } from 'react';

import { env } from '@/config/env';
import { getPageTitle, setPageTitle, subscribePageTitle } from '@/lib/page-title';

/**
 * Declare this screen's name.
 *
 * Called once, from `PageHeader` — which every screen inside the shell already
 * renders and which already holds the string. That is the whole point: no page
 * has to remember to set a document title, so none can forget, and the tab, the
 * `<h1>` and the announcement cannot drift apart because there is only one
 * value.
 *
 * The document title is written **in an effect, not during render**. Setting it
 * during render is a side effect on a shared global that React may run twice or
 * throw away, and in a concurrent render it would leave the tab named after a
 * screen that never committed.
 */
export function usePageTitle(title: string): void {
    useEffect(() => {
        setPageTitle(title);
        document.title = title ? `${title} · ${env.appName}` : env.appName;
    }, [title]);
}

/**
 * The published screen name, for the shell's live region.
 *
 * `useSyncExternalStore` rather than `useState` + a subscribe effect: the store
 * is written from a *child's* effect, which runs before the parent's, so a
 * subscription established in the parent's own effect would miss the first
 * publish of every navigation and announce the previous screen.
 */
export function usePublishedPageTitle(): string {
    return useSyncExternalStore(subscribePageTitle, getPageTitle, getPageTitle);
}
