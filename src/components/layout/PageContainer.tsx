import type { ReactNode } from 'react';

import { usePageTitle } from '@/hooks/use-page-title';
import { useStickyPageHeader } from '@/hooks/use-sticky-page-header';
import { cn } from '@/lib/utils';

interface PageContainerProps {
    /** The page's name. Rendered as the document's only `<h1>`. */
    title: string;
    /**
     * The subtitle. `ReactNode`, not `string`, so a detail screen can put a
     * `CopyableId` here — the record's identifier belongs under its name, and it
     * needs to be an element to be copyable.
     *
     * `title` stays a plain string: it also becomes the document title and the
     * route announcement, neither of which can render an element.
     */
    description?: ReactNode;
    /**
     * Primary actions for the page, right-aligned on wide screens. A page that
     * passes any keeps its name and these pinned under the app bar while it
     * scrolls.
     */
    actions?: ReactNode;
    className?: string;
    children: ReactNode;
    /** Applied to the content below the header, not to the header itself. */
    contentClassName?: string;
}

/**
 * A page: its heading, then its content.
 *
 * Deliberately **not** a layout box. The gutter and the `max-w-[1600px]` column
 * belong to `AppShell`'s `<main>`, and moving them here would mean every
 * full-bleed element inside a page re-deriving a negative margin against a value
 * it can no longer see. This supplies the heading and the vertical rhythm; the
 * frame stays where it was.
 *
 * ── The heading is the only `<h1>` on screen ──────────────────────────────────
 * It used to live in the app header, which meant no page owned its own name: a
 * screen could not title itself after the record it had just loaded, and the
 * header had to guess a label from the pathname. The header now carries the
 * breadcrumb trail instead, and the page carries the heading, which is also the
 * only arrangement in which the two do not say the same thing twice.
 *
 * A screen with no nav entry behind it — a detail route, the 404 — passes
 * whatever it knows. That is why `title` is a plain string rather than being
 * looked up here.
 *
 * ── It also names the tab and the announcement ────────────────────────────────
 * The same string becomes the document title and the text the shell's route
 * announcer reads out. Wired **here** rather than per page, so no screen can
 * forget to do it and none can drift from its own heading — a detail screen that
 * renames itself after the record it loaded renames the tab with it, for free.
 *
 * ── The name and the actions stay in reach ────────────────────────────────────
 * On a page with actions, the row holding the name and the actions pins under
 * the app bar. A detail screen is several viewports tall, and the button that
 * acts on the record should not be a scroll back to the top away from the
 * evidence that decides whether to press it.
 *
 * - **Only with actions.** A pinned name alone costs every list a row of table
 *   to repeat what the breadcrumb trail already says.
 * - **The description is not in the pinned row.** It is prose, sometimes two
 *   lines of it, and it would be paid for in viewport on every scroll. It sits
 *   directly beneath and scrolls away.
 * - **The row has to be a direct child of the page's own box.** A sticky element
 *   travels only as far as its parent reaches; wrapped in a header-sized `<div>`
 *   it would have nowhere to go and would never pin.
 * - **`-mt-2 py-2`** buys the pinned row its breathing room under the app bar
 *   without moving the heading while it is at rest, and **`-mx-2 px-2`** covers
 *   the card shadows and focus rings that reach a few pixels past the column.
 * - `z-[25]` is between the table header rows that pin beneath it (`z-20`) and
 *   the app bar (`z-30`).
 */
export function PageContainer({
    title,
    description,
    actions,
    className,
    contentClassName,
    children,
}: PageContainerProps) {
    usePageTitle(title);

    const pinned = Boolean(actions);
    const { ref, stuck } = useStickyPageHeader<HTMLDivElement>();

    return (
        <div className={className}>
            <div
                ref={pinned ? ref : undefined}
                className={cn(
                    'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
                    pinned && 'bg-background sticky top-14 z-[25] -mx-2 -mt-2 px-2 py-2 md:top-16',
                    // Only while something is passing behind it: at rest the
                    // row is part of the page and a rule under it would be a
                    // line across every screen.
                    pinned && stuck && 'shadow-[0_1px_0_hsl(var(--border))]',
                )}
            >
                <h1 className="font-display min-w-0 truncate text-2xl font-semibold tracking-tight">
                    {title}
                </h1>

                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>

            {description ? (
                <p
                    className={cn(
                        'text-muted-foreground max-w-2xl text-sm',
                        // The pinned row's own bottom padding is the gap.
                        !pinned && 'mt-1',
                    )}
                >
                    {description}
                </p>
            ) : null}

            <div
                className={cn(
                    'space-y-6',
                    // 24px under the header either way — less the padding the
                    // pinned row already carries when nothing sits between.
                    pinned && !description ? 'mt-4' : 'mt-6',
                    contentClassName,
                )}
            >
                {children}
            </div>
        </div>
    );
}
