import { Search } from 'lucide-react';

import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

interface HeaderProps {
    className?: string;
    /** Slot for the tier badge, the inbox bell and the account menu. */
    actions?: React.ReactNode;
    /** Opens the command palette. Omitted where there is none to open. */
    onOpenPalette?: () => void;
}

/**
 * The sticky top bar: where you are, and what you can do from anywhere.
 *
 * It carries the **breadcrumb trail, not the page title**. The heading belongs to
 * the page — see `PageContainer` — and putting both here would render the same
 * words twice, once as a trail and once as a heading, while still leaving no page
 * able to title itself after a record it loaded.
 *
 * ── Why the palette has a visible trigger at all ──────────────────────────────
 * `⌘K` is bound globally and needs no button. But a shortcut nobody has been told
 * about is a shortcut nobody uses, and this is the one place every screen shows.
 * It is drawn as a search field rather than a button because that is what it
 * behaves like, and the shortcut is printed on it so the next time is faster than
 * this one.
 */
export function Header({ className, actions, onOpenPalette }: HeaderProps) {
    return (
        <header
            className={cn(
                'bg-background/80 border-border sticky top-0 z-30 flex h-16 items-center gap-4 border-b px-6 backdrop-blur md:px-8',
                className,
            )}
        >
            <div className="min-w-0 flex-1">
                <Breadcrumbs />
            </div>

            {onOpenPalette ? (
                <button
                    type="button"
                    onClick={onOpenPalette}
                    className="border-input bg-background/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground hidden h-9 w-56 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors lg:flex"
                >
                    <Search className="size-4 shrink-0" />
                    <span className="flex-1 text-left">Go to…</span>
                    {/*
                      Decoration, not content: the button already announces "Go
                      to…", and a screen reader reading "Command K" after it is
                      noise to somebody who reaches this with a keyboard anyway.
                    */}
                    <Kbd aria-hidden>⌘K</Kbd>
                </button>
            ) : null}

            <div className="flex shrink-0 items-center gap-1">
                {actions}
                <LanguageToggle />
                <ThemeToggle />
            </div>
        </header>
    );
}
