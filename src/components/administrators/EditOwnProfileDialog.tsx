import { EditAdministratorDialog } from '@/components/administrators/EditAdministratorDialog';
import { ErrorState } from '@/components/common/DataState';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { DetailSkeleton } from '@/components/common/Loading';
import { useAsyncData } from '@/hooks/use-async-data';
import { getOwnProfile } from '@/services/administrators.service';

/**
 * Editing your own profile, from a screen that only holds an `AdminProfile`.
 *
 * ── Why this fetches rather than reusing what the auth store has ──────────────
 * `EditAdministratorDialog` needs an `Administrator`, and the auth store holds an
 * `AdminProfile`. They are two projections of two different concerns and
 * **deliberately not assignable**: `AdminProfile` has nullable `timezone` and
 * `preferredLanguage` and no `tierLabel`, and adapting one into the other by
 * hand is precisely the aliasing `types/administrators.types.ts` refuses. So
 * this reads `GET /administrators/me`, which needs no permission and returns the
 * right shape.
 *
 * The read is lazy — mounted only while the dialog is open — so opening the
 * account screen does not pay for a form nobody asked for.
 */
export function EditOwnProfileDialog({
    open,
    onOpenChange,
    onUpdated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * ⚠ Must call `refreshProfile()`, not merge a response.
     *
     * `PATCH /administrators/me` answers the `Administrator` projection, which
     * has no `mfaRequired` — and `deriveMfaEnrolmentRequired` reads exactly that
     * field to recover a scoped enrolment session across a page reload. Merging
     * would set it to `undefined` and break MFA enrolment recovery for every
     * tier-1 account.
     */
    onUpdated: () => void;
}) {
    // Not rendered at all when closed, so the read fires on open and the form
    // always starts from what the service currently holds.
    if (!open) return null;

    return <OwnProfileLoader onOpenChange={onOpenChange} onUpdated={onUpdated} />;
}

function OwnProfileLoader({
    onOpenChange,
    onUpdated,
}: {
    onOpenChange: (open: boolean) => void;
    onUpdated: () => void;
}) {
    const profile = useAsyncData('/administrators/me', (signal) => getOwnProfile({ signal }));

    if (profile.data) {
        return (
            <EditAdministratorDialog
                administrator={profile.data}
                mode={{ kind: 'self' }}
                open
                onOpenChange={onOpenChange}
                onUpdated={onUpdated}
            />
        );
    }

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit your profile</DialogTitle>
                    <DialogDescription>Loading your current details.</DialogDescription>
                </DialogHeader>
                {profile.isLoading ? (
                    <DetailSkeleton />
                ) : (
                    <ErrorState error={profile.error} onRetry={profile.reload} />
                )}
            </DialogContent>
        </Dialog>
    );
}
