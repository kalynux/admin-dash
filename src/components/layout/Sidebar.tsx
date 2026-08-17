import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { AppLogo } from '@/components/layout/AppLogo';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { env } from '@/config/env';
import { permittedChildren, permittedSections, type NavChild, type NavItem } from '@/config/navigation';
import type { HeldPermissions } from '@/lib/authorization';
import { cn } from '@/lib/utils';

interface SidebarProps {
    /**
     * What the caller holds, from `GET /permissions/me`.
     *
     * **Required, and a prop rather than a hook.** Required because there is no
     * honest sidebar to draw without it — `DashboardShell` holds the loader until
     * the set arrives, so a permissive "unknown means show everything" default
     * would only ever be reachable by mistake. A prop because it keeps this
     * component presentational: every test that renders the shell would otherwise
     * need a permissions provider stood up around it.
     */
    permissions: HeldPermissions;
    /**
     * Resolved collapse state, passed in rather than read from the store: the
     * tablet range force-collapses the rail, and deriving that here would mean
     * writing to the store during render.
     */
    collapsed: boolean;
    onToggle: () => void;
    collapsible?: boolean;
}

const rowClass =
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none';

function activeClass(isActive: boolean) {
    return isActive
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground';
}

/** Is this module, or anything under it, the current page? */
function isWithin(pathname: string, path: string): boolean {
    return pathname === path || pathname.startsWith(`${path}/`);
}

function ChildLink({ child, onNavigate }: { child: NavChild; onNavigate?: () => void }) {
    return (
        <NavLink
            to={child.path}
            // An index child shares its parent's path, so without `end` it would
            // stay highlighted while a sibling is open.
            end={child.index}
            onClick={onNavigate}
            className={({ isActive }) =>
                cn(
                    'block rounded-md py-1.5 pr-3 pl-3 text-sm transition-colors',
                    isActive
                        ? 'text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground/70 hover:text-sidebar-accent-foreground',
                    !child.implemented && 'opacity-55',
                )
            }
        >
            <span className="truncate">{child.label}</span>
        </NavLink>
    );
}

/**
 * A module and, where it has them, its sub-destinations.
 *
 * The module row stays a link even when it only contains children: clicking it
 * lands on the index child or, for a pure container, on the first child this
 * administrator may open. The chevron is a **separate** button so expanding a
 * group never navigates and navigating never collapses one.
 */
function SidebarItem({
    item,
    entries,
    collapsed,
}: {
    item: NavItem;
    /** The children this administrator may open. Already filtered. */
    entries: readonly NavChild[];
    collapsed: boolean;
}) {
    const { pathname } = useLocation();
    const within = isWithin(pathname, item.path);
    const [open, setOpen] = useState(within);
    const [flyoutOpen, setFlyoutOpen] = useState(false);

    // A container has no page of its own, so React Router's own `isActive` on the
    // parent path is not the whole answer — a child being open must light the
    // module up too. The root is the exception and matches exactly, mirroring the
    // `end` prop it carries.
    const active = item.path === '/dashboard' ? pathname === item.path : within;

    const link = (
        <NavLink
            to={item.path}
            end={item.path === '/dashboard'}
            /**
             * A **string**, not `NavLink`'s render-prop form.
             *
             * This element is handed to a Radix `asChild` trigger below, and Slot
             * merges `className` by joining it — so a function lands in the DOM
             * stringified, as the literal source of the callback. Computing
             * `active` above is what makes the plain string possible.
             */
            className={cn(
                rowClass,
                activeClass(active),
                // Not built yet: reachable, but visibly not the real thing.
                !item.implemented && 'opacity-55',
                collapsed ? 'justify-center px-0' : 'flex-1',
            )}
            // The label is not rendered on the rail, so without this the link
            // announces only its icon — which is to say, nothing.
            aria-label={collapsed ? item.label : undefined}
        >
            <item.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
    );

    if (collapsed) {
        // The rail is too narrow for a sub-list, so the children move into a
        // flyout. Without one they would be unreachable from a collapsed sidebar
        // except by first navigating to the module — which is a dead end for a
        // container whose landing screen is itself a child.
        if (entries.length > 0) {
            return (
                <Popover open={flyoutOpen} onOpenChange={setFlyoutOpen}>
                    <PopoverTrigger asChild>
                        {/*
                          Hover and focus both open it, and the trigger's own click
                          still navigates. Keyboard users reach the children by
                          tabbing to the module — a flyout that opened only on
                          hover would be invisible to them.
                        */}
                        <div
                            className="w-full"
                            onMouseEnter={() => setFlyoutOpen(true)}
                            onMouseLeave={() => setFlyoutOpen(false)}
                            onFocus={() => setFlyoutOpen(true)}
                        >
                            {link}
                        </div>
                    </PopoverTrigger>
                    <PopoverContent
                        side="right"
                        align="start"
                        className="w-56 p-2"
                        onMouseEnter={() => setFlyoutOpen(true)}
                        onMouseLeave={() => setFlyoutOpen(false)}
                        // Radix moves focus into the content on open, which steals
                        // it from the rail every time the pointer passes over.
                        onOpenAutoFocus={(event) => event.preventDefault()}
                    >
                        <p className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                            {item.label}
                        </p>
                        {entries.map((child) => (
                            <ChildLink
                                key={child.id}
                                child={child}
                                onNavigate={() => setFlyoutOpen(false)}
                            />
                        ))}
                    </PopoverContent>
                </Popover>
            );
        }

        return (
            <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
        );
    }

    if (entries.length === 0) return link;

    return (
        <div>
            <div className="flex items-center gap-1">
                {link}
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-sidebar-foreground/70 size-7 shrink-0"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
                    onClick={() => setOpen((previous) => !previous)}
                >
                    <ChevronRight
                        className={cn('size-4 transition-transform', open && 'rotate-90')}
                    />
                </Button>
            </div>

            {open && (
                <div className="border-sidebar-border mt-1 ml-5 space-y-0.5 border-l pl-2">
                    {entries.map((child) => (
                        <ChildLink key={child.id} child={child} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function Sidebar({
    permissions,
    collapsed: sidebarCollapsed,
    onToggle: toggleSidebar,
    collapsible = true,
}: SidebarProps) {
    const sections = permittedSections(permissions);

    return (
        <aside
            className={cn(
                'bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r',
                'transition-[width] duration-300 ease-in-out',
                sidebarCollapsed ? 'w-20' : 'w-64',
            )}
        >
            <div
                className={cn(
                    'flex h-16 shrink-0 items-center gap-2 px-4',
                    sidebarCollapsed && 'justify-center px-0',
                )}
            >
                <AppLogo className="size-8 shrink-0" />
                {!sidebarCollapsed && (
                    <div className="min-w-0">
                        <p className="text-sidebar-foreground font-display truncate text-sm font-semibold">
                            {env.appName}
                        </p>
                    </div>
                )}
            </div>

            {/*
              `min-h-0` is load-bearing, not tidying.

              A flex item's default `min-height` is `auto`, and the Radix
              ScrollArea Root is a plain `position: relative` box with no
              `overflow` of its own — so nothing zeroes that auto-minimum. Left
              off, the item cannot shrink below its content: it grows to the full
              height of the nav, the Viewport therefore never overflows its own
              box, and Radix leaves the scrollbar `hidden`. Since the `aside` is
              `fixed` and creates no page scroll, everything past the fold —
              including the Collapse button below — becomes unreachable.

              A tier-1 Developer sees six section headers and eighteen modules
              before expanding anything, and groups auto-expand when the current
              route is inside them, so this fires during ordinary navigation.

              Same pattern as `ui/sheet.tsx` and shadcn's own `ui/sidebar.tsx`.
            */}
            <ScrollArea className="min-h-0 flex-1">
                <nav className="space-y-6 px-3 pb-4" aria-label="Main">
                    {sections.map((section) => (
                        <div key={section.id} className="space-y-1">
                            {!sidebarCollapsed && (
                                <p className="text-muted-foreground px-3 py-1 text-[11px] font-semibold tracking-wider uppercase">
                                    {section.label}
                                </p>
                            )}
                            {section.items.map((item) => (
                                <SidebarItem
                                    key={item.id}
                                    item={item}
                                    // Filtered here, not in the child row: a child
                                    // the caller cannot open is removed, never
                                    // greyed. `opacity-55` means "not built yet",
                                    // and reusing it for "not yours" would make
                                    // two different facts look the same.
                                    entries={permittedChildren(item, permissions)}
                                    collapsed={sidebarCollapsed}
                                />
                            ))}
                        </div>
                    ))}
                </nav>
            </ScrollArea>

            {collapsible && (
                <div className="border-sidebar-border shrink-0 border-t p-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSidebar}
                        className={cn('w-full justify-start gap-3', sidebarCollapsed && 'justify-center')}
                        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {sidebarCollapsed ? (
                            <PanelLeftOpen className="size-4" />
                        ) : (
                            <>
                                <PanelLeftClose className="size-4" />
                                <span>Collapse</span>
                            </>
                        )}
                    </Button>
                </div>
            )}
        </aside>
    );
}
