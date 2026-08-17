import { MAIN_CONTENT_ID } from '@/config/landmarks';

/**
 * The first thing in the tab order, and invisible until it is reached.
 *
 * The sidebar carries about sixty links. Without this, every keyboard operator
 * tabs through all of them on every page to reach the table they came for — and
 * the ones who navigate by keyboard on an operations console are typically the
 * ones doing it all day.
 *
 * Positioned off-canvas rather than `hidden`, because a hidden element is not
 * focusable and a skip link that cannot be focused is a skip link that does not
 * exist. It slides into the top-left corner on focus.
 *
 * A plain `<a href="#…">`, not a router `<Link>`: this is a fragment jump within
 * the current document, and routing it would push a history entry whose only
 * effect is to move focus.
 */
export function SkipToContent() {
    return (
        <a
            href={`#${MAIN_CONTENT_ID}`}
            className="bg-background text-foreground ring-ring focus:ring-2 sr-only rounded-md px-4 py-2 text-sm font-medium shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
            Skip to content
        </a>
    );
}
