import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { findNavTrail } from '@/config/navigation';
import { cn } from '@/lib/utils';

/**
 * Where you are, derived from the navigation config.
 *
 * Read off `findNavTrail` rather than from the pathname's segments, so a crumb
 * cannot name a module differently from the sidebar link that leads to it — the
 * same "one object, not two lookups" rule the route guards follow.
 *
 * Three rules the shape encodes:
 *
 * - **The section is not a link.** Sections group the sidebar; they have no route,
 *   and a crumb you can click that goes nowhere is worse than one you cannot.
 * - **An index child is not its own crumb.** "All orders" lives at the same path
 *   as Orders, so rendering both would put the same URL on screen twice with two
 *   different names.
 * - **A path with no nav entry renders nothing.** The account pages and the 404
 *   are not modules; their `<h1>` says what they are, and inventing a trail for
 *   them would mean inventing labels this file does not own.
 */
export function Breadcrumbs({ className }: { className?: string }) {
    const { pathname } = useLocation();
    const trail = findNavTrail(pathname);

    // The dashboard root is where the trail starts, so at the root there is none.
    if (!trail || trail.item.path === '/dashboard') return null;

    const { section, item, child } = trail;
    const leafIsChild = Boolean(child && !child.index);

    const crumbs: { key: string; label: string; to?: string }[] = [
        { key: section.id, label: section.label },
        { key: item.id, label: item.label, to: leafIsChild ? item.path : undefined },
        ...(leafIsChild && child ? [{ key: child.id, label: child.label }] : []),
    ];

    return (
        <Breadcrumb className={cn('min-w-0', className)}>
            <BreadcrumbList className="flex-nowrap">
                {crumbs.map((crumb, index) => (
                    <Fragment key={crumb.key}>
                        {index > 0 && <BreadcrumbSeparator />}
                        <BreadcrumbItem className="min-w-0">
                            {crumb.to ? (
                                <BreadcrumbLink asChild className="truncate">
                                    <Link to={crumb.to}>{crumb.label}</Link>
                                </BreadcrumbLink>
                            ) : index === crumbs.length - 1 ? (
                                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                            ) : (
                                // A plain span, not `BreadcrumbPage`: that carries
                                // `aria-current="page"`, and marking the section as
                                // the current page would give a screen reader two
                                // answers to "where am I".
                                <span className="text-muted-foreground truncate">
                                    {crumb.label}
                                </span>
                            )}
                        </BreadcrumbItem>
                    </Fragment>
                ))}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
