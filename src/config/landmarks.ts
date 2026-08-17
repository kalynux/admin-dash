/**
 * Ids that two components have to agree on.
 *
 * The skip link targets the content region; the shell renders it; the route
 * focus hook moves focus into it. Three files, one string — and a typo in any
 * of them fails silently, which is the worst kind of accessibility bug because
 * nothing on screen looks wrong.
 */

/** The `<main>` element: the skip link's destination and the post-navigation focus target. */
export const MAIN_CONTENT_ID = 'main-content';
