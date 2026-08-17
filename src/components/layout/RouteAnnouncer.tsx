import { usePublishedPageTitle } from '@/hooks/use-page-title';

/**
 * Says out loud which screen just opened.
 *
 * A single-page navigation swaps the content and tells assistive technology
 * nothing: no document load fires, focus stays where the link was, and a screen
 * reader user is left on a page that is no longer the page they were on. A full
 * page load announces the new document's title; this is that announcement,
 * rebuilt.
 *
 * Three properties it has to have, all of them easy to lose:
 *
 * - **Mounted in the shell, above the outlet.** The region must already exist,
 *   empty and stable, when the text arrives — a live region that appears in the
 *   same commit as its content is not reliably announced. That is why the title
 *   travels through `lib/page-title` instead of being a prop.
 * - **`polite`, never `assertive`.** Arriving somewhere is not an interruption.
 * - **`aria-atomic`**, so the whole name is read rather than the diff against
 *   the previous screen's name, which for "Vendors" → "Vendor" is a single
 *   letter.
 *
 * It renders no visible text. The page's own `<h1>` is the visible heading, and
 * a second copy of it on screen would be noise for everyone who can see it.
 */
export function RouteAnnouncer() {
    const title = usePublishedPageTitle();

    return (
        <div
            // `role="status"` as well as `aria-live`: some screen readers pick up
            // the implicit role and not the bare attribute, and the two together
            // are inert where both are honoured.
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
        >
            {title}
        </div>
    );
}
