import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export interface UIState {
    theme: Theme;
    /** What `theme` currently resolves to, with `system` already applied. */
    resolvedTheme: 'light' | 'dark';
    setTheme: (theme: Theme) => void;
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
}

/**
 * The context and its hook live apart from the provider component so that
 * `ui.store.tsx` exports a component and nothing else — which is what keeps
 * fast refresh working on it.
 */
export const UIContext = createContext<UIState | null>(null);

export function useUIStore(): UIState {
    const context = useContext(UIContext);
    if (!context) throw new Error('useUIStore must be used inside <UIProvider>');
    return context;
}
