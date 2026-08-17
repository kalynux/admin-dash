/**
 * The current screen's name, published once and read in three places.
 *
 * A page already declares what it is called — `PageContainer` takes a `title`
 * and renders it as the document's only `<h1>`. Three other things need that
 * same string and none of them can see it:
 *
 * - the **document title**, so a tab in a row of tabs says which console screen
 *   it is holding, and so browser history is legible;
 * - the **route announcer**, a live region in the shell — a single-page
 *   navigation replaces the content without telling a screen reader anything,
 *   so without this a keyboard user hears silence and has to go looking for
 *   what changed;
 * - the **focus target**'s accessible name, for the same navigation.
 *
 * A module-level publisher rather than context, for the reason `session-events`
 * is one: the reader lives *above* the writer in the tree. The live region has
 * to be mounted and stable **before** the text lands in it — a region that
 * appears in the same commit as its content is not reliably announced — so it
 * belongs to the shell, while the title belongs to the page inside the outlet.
 * Context would mean lifting the title into a provider that every page then
 * writes to during render, which is the same subscription with more ceremony.
 *
 * Deliberately not the *document* title: this is the bare screen name. Whoever
 * renders it decides on the suffix.
 */

let current = '';

const listeners = new Set<() => void>();

/** The screen name as last published. `''` before any page has mounted. */
export function getPageTitle(): string {
    return current;
}

/**
 * Publish the current screen's name.
 *
 * A no-op when the title has not actually changed, which matters: this feeds a
 * live region, and re-announcing an identical string on an unrelated re-render
 * is how a screen reader ends up repeating the page name at somebody.
 */
export function setPageTitle(title: string): void {
    if (title === current) return;
    current = title;
    for (const listener of [...listeners]) listener();
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function subscribePageTitle(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test helper — forget the published title and every subscriber. */
export function resetPageTitle(): void {
    current = '';
    listeners.clear();
}
