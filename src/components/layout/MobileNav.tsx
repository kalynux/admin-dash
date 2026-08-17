import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { AppLogo } from '@/components/layout/AppLogo';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { env } from '@/config/env';
import { findNavEntry, permittedChildren, permittedSections } from '@/config/navigation';
import type { HeldPermissions } from '@/lib/authorization';
import { cn } from '@/lib/utils';

interface MobileNavProps {
    /** What the caller holds. Required, and a prop — see `Sidebar`. */
    permissions: HeldPermissions;
}

interface MobileHeaderProps extends MobileNavProps {
    /**
     * Mirrors the desktop `Header`'s slot. Without it the account menu — and so
     * signing out — would be unreachable on a phone.
     */
    actions?: React.ReactNode;
}

/** The top bar on mobile: brand, current page, and the drawer trigger. */
export function MobileHeader({ permissions, actions }: MobileHeaderProps) {
    const [open, setOpen] = useState(false);
    const { pathname } = useLocation();
    const active = findNavEntry(pathname);
    const sections = permittedSections(permissions);

    return (
        <header className="bg-background/80 border-border sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Open navigation">
                        <Menu className="size-5" />
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0">
                    <SheetHeader className="flex-row items-center gap-2">
                        <AppLogo className="size-7" />
                        <SheetTitle className="text-sm">{env.appName}</SheetTitle>
                    </SheetHeader>
                    <SheetBody className="px-3">
                        <nav className="space-y-6 pb-6" aria-label="Main">
                            {sections.map((section) => (
                                <div key={section.id} className="space-y-1">
                                    <p className="text-muted-foreground px-3 py-1 text-[11px] font-semibold tracking-wider uppercase">
                                        {section.label}
                                    </p>
                                    {section.items.map((item) => (
                                        <div key={item.id}>
                                            <NavLink
                                                to={item.path}
                                                end={item.path === '/dashboard'}
                                                onClick={() => setOpen(false)}
                                                className={({ isActive }) =>
                                                    cn(
                                                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                                                        isActive
                                                            ? 'bg-accent text-accent-foreground'
                                                            : 'text-foreground/80 hover:bg-accent/60',
                                                        !item.implemented && 'opacity-55',
                                                    )
                                                }
                                            >
                                                <item.icon className="size-4 shrink-0" />
                                                <span className="truncate">{item.label}</span>
                                            </NavLink>

                                            {/*
                                              Children are always expanded here.
                                              The sheet scrolls, so nothing is won
                                              by hiding them behind a disclosure —
                                              and a collapsed group on a phone is a
                                              second tap for every destination.
                                            */}
                                            {permittedChildren(item, permissions).map((child) => (
                                                <NavLink
                                                    key={child.id}
                                                    to={child.path}
                                                    end={child.index}
                                                    onClick={() => setOpen(false)}
                                                    className={({ isActive }) =>
                                                        cn(
                                                            'ml-7 block rounded-lg px-3 py-1.5 text-sm',
                                                            isActive
                                                                ? 'text-accent-foreground font-medium'
                                                                : 'text-foreground/60 hover:bg-accent/40',
                                                            !child.implemented && 'opacity-55',
                                                        )
                                                    }
                                                >
                                                    <span className="truncate">{child.label}</span>
                                                </NavLink>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </nav>
                    </SheetBody>
                </SheetContent>
            </Sheet>

            {/*
              The deepest label alone, and not a heading. A full breadcrumb trail
              does not fit beside a menu button on a phone, and the page's own
              `<h1>` is the heading — a second one here would compete with it.
            */}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {active?.label ?? 'Dashboard'}
            </p>

            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
    );
}

/**
 * The bottom tab bar.
 *
 * Shows the first four permitted destinations. Which four depends on what the
 * administrator holds — a Support administrator and a Developer legitimately see
 * different tabs, and pinning a fixed set would give one of them dead buttons.
 */
export function MobileTabBar({ permissions }: MobileNavProps) {
    // No fallback when the permitted list comes back empty. Falling back to the
    // full catalogue would be fail-open: the one case that produces an empty list
    // is an administrator who may reach nothing, and answering that with every
    // tab is the opposite of the answer. An empty bar is honest, and the Home
    // item — which needs no permission — keeps it from happening in practice.
    const tabs = permittedSections(permissions)
        .flatMap((section) => section.items)
        .slice(0, 4);

    return (
        <nav
            className="bg-background/95 border-border safe-area-inset-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t backdrop-blur"
            aria-label="Primary"
        >
            {tabs.map((item) => (
                <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.path === '/dashboard'}
                    className={({ isActive }) =>
                        cn(
                            'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
                            isActive ? 'text-primary' : 'text-muted-foreground',
                            !item.implemented && 'opacity-55',
                        )
                    }
                >
                    <item.icon className="size-5" />
                    <span className="max-w-full truncate px-1">{item.label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
