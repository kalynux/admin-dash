import { Suspense, useCallback, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { PageLoader } from '@/components/common/Loading';
import { CommandPalette, CommandPaletteHotkey } from '@/components/layout/CommandPalette';
import { Header } from '@/components/layout/Header';
import { MobileHeader, MobileTabBar } from '@/components/layout/MobileNav';
import { RouteAnnouncer } from '@/components/layout/RouteAnnouncer';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkipToContent } from '@/components/layout/SkipToContent';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MAIN_CONTENT_ID } from '@/config/landmarks';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { useRouteFocus } from '@/hooks/use-route-focus';
import { useUIStore } from '@/store';
import type { HeldPermissions } from '@/lib/authorization';
import { cn } from '@/lib/utils';

interface AppShellProps {
    /**
     * What the caller holds, from `GET /permissions/me`.
     *
     * `DashboardShell` is what supplies it, and it does not render this component
     * until the set has arrived — so there is no "unknown" state to model here.
     */
    permissions: HeldPermissions;
    /**
     * Header-right slot — the account menu today, the inbox bell in Phase 4.
     * Passed through to both the desktop and mobile headers so nothing is
     * reachable on one and not the other.
     */
    actions?: React.ReactNode;
}

/**
 * The dashboard chrome: sidebar, header, content column, mobile bars.
 *
 * The error boundary sits *inside* the shell rather than around it, so a screen
 * that throws leaves navigation intact — an operator can move somewhere else
 * instead of losing the whole console.
 *
 * ── What the shell owes a keyboard ────────────────────────────────────────────
 * Four things live here because they are properties of *navigating*, and no page
 * can see a navigation happen:
 *
 * - `SkipToContent`, first in the tab order, past sixty sidebar links;
 * - `CommandPalette` on `⌘K`, so a destination can be typed rather than found;
 * - `useRouteFocus`, which resets scroll and focus the way a real page load does;
 * - `RouteAnnouncer`, which says where you landed.
 */
export function AppShell({ permissions, actions }: AppShellProps) {
    const isMobile = useIsMobile();
    const isTablet = useIsTablet();
    const { sidebarCollapsed, toggleSidebar } = useUIStore();
    const location = useLocation();
    const [paletteOpen, setPaletteOpen] = useState(false);

    // Stable, so the hotkey listener is bound once rather than on every render
    // of a shell that re-renders on every navigation.
    const openPalette = useCallback(() => setPaletteOpen(true), []);

    useRouteFocus(MAIN_CONTENT_ID);

    // In the tablet range the sidebar is pinned to its icon rail whatever the
    // manual toggle says, reclaiming horizontal space for content. Derived
    // rather than written back to the store, so the operator's own preference
    // survives the viewport widening again.
    const collapsed = isTablet || sidebarCollapsed;

    return (
        <TooltipProvider delayDuration={200}>
            <div className="bg-background min-h-screen">
                <SkipToContent />

                {!isMobile && (
                    <Sidebar
                        permissions={permissions}
                        collapsed={collapsed}
                        onToggle={toggleSidebar}
                        collapsible={!isTablet}
                    />
                )}

                <div
                    className={cn(
                        'transition-[margin] duration-300 ease-in-out',
                        isMobile ? 'ml-0' : collapsed ? 'ml-20' : 'ml-64',
                    )}
                >
                    {isMobile ? (
                        <MobileHeader permissions={permissions} actions={actions} />
                    ) : (
                        <Header actions={actions} onOpenPalette={openPalette} />
                    )}

                    <main
                        id={MAIN_CONTENT_ID}
                        // Focusable only programmatically — the skip link and the
                        // route reset both land here. `data-focus-silent` drops the
                        // ring: nothing in a landmark is actionable, and a ring
                        // around the whole page on every navigation reads as an
                        // error.
                        tabIndex={-1}
                        data-focus-silent
                        className={cn(
                            'px-4 py-6 outline-none md:px-8 md:py-8',
                            isMobile && 'pb-[calc(5rem+env(safe-area-inset-bottom))]',
                        )}
                    >
                        <div className="mx-auto w-full max-w-[1600px]">
                            <ErrorBoundary resetKey={location.pathname}>
                                <Suspense fallback={<PageLoader />}>
                                    <Outlet />
                                </Suspense>
                            </ErrorBoundary>
                        </div>
                    </main>
                </div>

                {isMobile && <MobileTabBar permissions={permissions} />}

                <CommandPaletteHotkey onOpen={openPalette} />
                <CommandPalette
                    permissions={permissions}
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                />
                <RouteAnnouncer />
            </div>
        </TooltipProvider>
    );
}
