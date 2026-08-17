import { ErrorState } from '@/components/common/DataState';
import { PageLoader } from '@/components/common/Loading';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { NotificationsProvider, useAuth, usePermissions } from '@/store';

/**
 * The shell, once it can be drawn honestly.
 *
 * Navigation is built from `GET /permissions/me`, so there are three states
 * before it, not one:
 *
 * - **loading** — hold. The alternative is rendering the full sidebar and
 *   collapsing it a moment later, which shows every administrator modules they
 *   cannot open and then takes them away.
 * - **error** — say so, full screen. A `/permissions/me` failure is not a dead
 *   session and must not sign anybody out; it means the navigation cannot be
 *   drawn, and drawing it anyway would be a guess about someone's access.
 * - **ready** — the shell, with the real set.
 *
 * **Deliberately separate from `PermissionsProvider`.** Fusing the two would make
 * this untestable: a test injecting a ready context would be shadowed by the
 * provider the component mounted itself.
 */
export function DashboardShell({ actions }: { actions?: React.ReactNode }) {
    const { status, held, error, reload } = usePermissions();
    const { signOut, isSigningOut } = useAuth();

    if (status === 'ready' && held) {
        /**
         * `NotificationsProvider` mounts **here**, not around the router.
         *
         * It decides whether to poll from `useCan('notifications.read')`, so it
         * needs a resolved permission set — and mounting it above this branch
         * would start it against an unknown one, which fails closed and then
         * never re-enables. Inside the ready branch there is only one answer.
         */
        return (
            <NotificationsProvider>
                <AppShell permissions={held} actions={actions} />
            </NotificationsProvider>
        );
    }

    if (status === 'error') {
        return (
            <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4">
                <div className="w-full space-y-4">
                    <ErrorState error={error} onRetry={() => void reload()} />
                    {/*
                      `ErrorState` offers its own retry only where retrying could
                      plausibly work, so a failure it judges terminal would leave
                      this screen with no way forward at all — no navigation, no
                      shell, nothing. Both exits live here instead.
                    */}
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void reload()}>
                            Try again
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void signOut()}
                            disabled={isSigningOut}
                        >
                            Sign out
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // A different label from `RequireAuth`'s "Checking your session…". Two
    // identical loaders back to back read as one that is stuck.
    return <PageLoader label="Loading your access…" />;
}
