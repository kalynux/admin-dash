import { AccountMenu } from '@/components/layout/AccountMenu';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { TierBadge } from '@/components/layout/TierBadge';
import { useAuth } from '@/store';

/**
 * The header-right cluster: level, inbox, then the account menu.
 *
 * The badge is here rather than only inside the menu because what every screen
 * offers depends on the level, and an operator comparing a screen with a
 * colleague's should not have to open a menu to find out which level they are
 * looking at. It is also the visible half of a demotion: `tier` is re-read from
 * the database on every request, so a level change lands mid-session.
 *
 * **Desktop only.** `MobileHeader` shares this same slot in a 14px bar that
 * already carries the brand, the page title, the avatar and the theme toggle.
 *
 * Reads `useAuth()` with a null guard rather than `useAdmin()`, which throws:
 * the shell renders during sign-out, when the profile is already gone.
 */
export function AccountArea() {
    const { admin } = useAuth();

    return (
        <div className="flex items-center gap-2">
            {admin ? <TierBadge tier={admin.tier} className="hidden md:inline-flex" /> : null}
            {/*
              The bell hides itself when the caller lacks `notifications.read`,
              rather than being conditionally mounted here — the permission
              question belongs with the thing that asks it, and every level holds
              it today anyway.
            */}
            <NotificationBell />
            <AccountMenu />
        </div>
    );
}
