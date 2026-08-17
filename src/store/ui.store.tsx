/**
 * UI state: theme and the sidebar rail.
 *
 * A React context provider, matching the sibling dashboards' convention rather
 * than reaching for a global store — this state is small, synchronous, and read
 * only by the shell.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { UIContext, type Theme, type UIState } from './ui-context';

const THEME_KEY = 'admin-dash:theme';
const SIDEBAR_KEY = 'admin-dash:sidebar-collapsed';

function readStoredTheme(): Theme {
    try {
        const raw = localStorage.getItem(THEME_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
        // Private mode or storage disabled — fall through to the default.
    }
    return 'system';
}

function readStoredCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
        return false;
    }
}

function prefersDark(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: Theme, systemDark: boolean): 'light' | 'dark' {
    if (theme === 'system') return systemDark ? 'dark' : 'light';
    return theme;
}

function persist(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not persisting is survivable; failing to apply the change is not.
    }
}

export function UIProvider({ children }: { children: ReactNode }) {
    // Read synchronously on the first render rather than syncing in an effect,
    // so the shell never paints one frame in the wrong theme.
    const [theme, setThemeState] = useState<Theme>(readStoredTheme);
    const [systemDark, setSystemDark] = useState<boolean>(prefersDark);
    const [sidebarCollapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed);

    // Follow the OS while the choice is `system`, so the dashboard changes with
    // it rather than at the next reload.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setSystemDark(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    const resolvedTheme = resolve(theme, systemDark);

    // The class goes on <html>: it has to sit above <body>, which carries
    // `bg-background` / `text-foreground`.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('dark', resolvedTheme === 'dark');
        // Native widgets — scrollbars, date pickers, autofill — follow this
        // rather than our tokens, and stay light on dark without it.
        root.style.colorScheme = resolvedTheme;
    }, [resolvedTheme]);

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next);
        persist(THEME_KEY, next);
    }, []);

    const setSidebarCollapsed = useCallback((collapsed: boolean) => {
        setCollapsedState(collapsed);
        persist(SIDEBAR_KEY, String(collapsed));
    }, []);

    const toggleSidebar = useCallback(() => {
        setCollapsedState((previous) => {
            const next = !previous;
            persist(SIDEBAR_KEY, String(next));
            return next;
        });
    }, []);

    const value = useMemo<UIState>(
        () => ({
            theme,
            resolvedTheme,
            setTheme,
            sidebarCollapsed,
            toggleSidebar,
            setSidebarCollapsed,
        }),
        [theme, resolvedTheme, setTheme, sidebarCollapsed, toggleSidebar, setSidebarCollapsed],
    );

    return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
