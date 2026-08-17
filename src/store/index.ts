/**
 * Store barrel.
 *
 * Kept so components import from `@/store` rather than reaching into a specific
 * slice — the same convention the sibling dashboards use, and what the generated
 * `components/ui/sonner.tsx` already expects.
 */

export { UIProvider } from './ui.store';
export { useUIStore, type Theme, type UIState } from './ui-context';

export { AuthProvider } from './auth.store';
export {
    useAdmin,
    useAuth,
    type AuthState,
    type AuthStatus,
    type LoginOutcome,
} from './auth-context';

export { PermissionsProvider } from './permissions.store';
export {
    useCan,
    usePermissions,
    type CanPredicate,
    type PermissionsState,
    type PermissionsStatus,
} from './permissions-context';

export { NotificationsProvider } from './notifications.store';
export { useNotifications, type NotificationsState } from './notifications-context';
