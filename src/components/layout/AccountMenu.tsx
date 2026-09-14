import { Link } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';

import { TierBadge } from '@/components/layout/TierBadge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/store';

/**
 * Initials for the avatar.
 *
 * There is no avatar image to fall back from: the service resolves no file URLs
 * for any `*FileId`, and this dashboard calls no other service — so initials are
 * the whole of it, not a placeholder waiting to be replaced.
 */
function initialsOf(displayName: string): string {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Who is signed in, what they can reach, and the way out. */
export function AccountMenu() {
    const { admin, signOut, isSigningOut } = useAuth();

    if (!admin) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label="Account menu"
                >
                    <Avatar className="size-8">
                        <AvatarFallback className="text-xs font-medium">
                            {initialsOf(admin.displayName)}
                        </AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-1 font-normal">
                    <p className="truncate text-sm font-medium">{admin.displayName}</p>
                    {/*
                      ⚠ Not a `CopyableValue`, though the same address is one on
                      Account & security. This is a `DropdownMenuLabel`: Radix
                      gives the open menu a roving tabindex over its *items*, so
                      a button nested in a label is mouse-only — Tab closes the
                      menu rather than reaching it. A copy affordance that a
                      keyboard cannot reach is worse than the two clicks to the
                      account page, which is one item below and where the value
                      is copyable properly.
                    */}
                    <p className="text-muted-foreground truncate text-xs">{admin.email}</p>
                    <div className="flex items-center gap-1.5 pt-1">
                        <TierBadge tier={admin.tier} />
                        {admin.mfaEnrolled ? (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                                <ShieldCheck className="size-3" aria-hidden />
                                2FA on
                            </span>
                        ) : null}
                    </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                    <Link to="/dashboard/account/security">Account &amp; security</Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                    <Link to="/dashboard/account/access">Your access</Link>
                </DropdownMenuItem>

                {/*
                  ADR-023. Ungated like the two above: `/employees/me` is declared
                  *self*, and the two `employees.*` permissions govern somebody
                  else's file. It stays reachable after activation because the
                  record has no lock — people move house and change their bank.
                */}
                <DropdownMenuItem asChild>
                    <Link to="/dashboard/account/employee-record">Employee record</Link>
                </DropdownMenuItem>

                {/*
                  Not gated on `notifications.read`, unlike the bell. The
                  preference routes are declared *self* and check no permission,
                  so hiding this behind one would be a rule this client invented.
                */}
                <DropdownMenuItem asChild>
                    <Link to="/dashboard/account/notifications">Notification preferences</Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    disabled={isSigningOut}
                    onSelect={(event) => {
                        // Keep the menu mounted while the request is in flight, so
                        // the disabled state is visible rather than the whole menu
                        // vanishing and leaving nothing to show progress.
                        event.preventDefault();
                        void signOut();
                    }}
                >
                    <LogOut className="size-4" aria-hidden />
                    {isSigningOut ? 'Signing out…' : 'Sign out'}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
