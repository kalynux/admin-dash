import type { ReactNode } from 'react';

import { usePageTitle } from '@/hooks/use-page-title';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
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
    /** Primary actions for the page, right-aligned on wide screens. */
    actions?: ReactNode;
    className?: string;
}

/**
 * The page's title block — and **the only `<h1>` on screen**.
 *
 * The heading used to live in the app header, which meant no page owned its own
 * name: a screen could not title itself after the record it had just loaded, and
 * the header had to guess a label from the pathname. The header now carries the
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
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
    usePageTitle(title);

    return (
        <div
            className={cn(
                'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
                className,
            )}
        >
            <div className="min-w-0 space-y-1">
                <h1 className="font-display truncate text-2xl font-semibold tracking-tight">
                    {title}
                </h1>
                {description ? (
                    <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
                ) : null}
            </div>

            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
    );
}

interface PageContainerProps extends PageHeaderProps {
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
 */
export function PageContainer({
    title,
    description,
    actions,
    className,
    contentClassName,
    children,
}: PageContainerProps) {
    return (
        <div className={cn('space-y-6', className)}>
            <PageHeader title={title} description={description} actions={actions} />
            <div className={cn('space-y-6', contentClassName)}>{children}</div>
        </div>
    );
}
