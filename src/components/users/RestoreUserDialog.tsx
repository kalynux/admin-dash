import { useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { notify } from '@/lib/notify';
import { PLATFORM_CODE_STATUS_CONFLICT, restoreUser } from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import { userDisplayName, type User } from '@/types/users.types';

interface RestoreUserDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRestored: () => void;
}

/**
 * `POST /users/:userId/restore` · **`users.suspend`** — the same permission
 * governs both directions.
 *
 * ── No reason, and no form ────────────────────────────────────────────────────
 * The endpoint takes no body. That asymmetry is deliberate rather than an
 * oversight, and it is why suspend and restore are two POST sub-resources instead
 * of one `PATCH { status }`: a status field could not require a reason on one
 * direction and forbid it on the other, and the two are separate audit actions
 * (`users.suspend` and `users.reinstate`) precisely so a feed can tell them apart.
 *
 * ── What the operator needs to know before clicking ───────────────────────────
 * Reinstating **erases the suspension block** — the reason, the timestamp and who
 * imposed it — from the account. The audit trail keeps it, and that is the only
 * place it survives. Someone lifting a suspension should know they are removing
 * the on-screen explanation, not merely flipping a flag.
 *
 * ── `AlertDialog`, like every other input-free confirmation here ──────────────
 * Nothing is typed, so this is a yes/no question and takes the primitive for
 * one: `role="alertdialog"`, focus placed on the two answers, and **no dismissal
 * by clicking outside** — an accidental click should not silently abandon a
 * decision an operator is in the middle of. The dialogs that ask for a reason
 * stay `Dialog`, because there the outside click is discarding a draft rather
 * than answering a question.
 */
export function RestoreUserDialog({
    user,
    open,
    onOpenChange,
    onRestored,
}: RestoreUserDialogProps) {
    const [error, setError] = useState<unknown>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function restore() {
        setError(null);
        setIsSubmitting(true);
        try {
            await restoreUser(user.id);
            notify.success('Account restored', {
                description: 'They can sign in again immediately.',
            });
            onOpenChange(false);
            onRestored();
        } catch (caught) {
            if (caught instanceof ApiError) {
                // Somebody else already lifted it, or the account was never
                // suspended by the time this ran. Show what is true now.
                if (caught.platformCode === PLATFORM_CODE_STATUS_CONFLICT) {
                    notify.warning('This account is not suspended', {
                        description:
                            'Another administrator changed it while this was open. Reloading what it says now.',
                    });
                    onOpenChange(false);
                    onRestored();
                    return;
                }

                setError(caught);
                return;
            }

            notify.apiError(caught);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Restore {userDisplayName(user)}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        They can sign in again immediately, on every device.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-3">
                    <AuthFormError error={error} />

                    <p className="text-muted-foreground text-sm">
                        This clears the suspension reason, its timestamp and who imposed it from the
                        account. The audit trail keeps all three — after this, the Activity tab is
                        the only place the suspension is recorded.
                    </p>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                    {/*
                      `preventDefault`, because Radix closes on `Action` and the
                      write can fail — a refusal has to land on the panel above
                      rather than behind a dialog that has already gone.
                    */}
                    <AlertDialogAction
                        disabled={isSubmitting}
                        onClick={(event) => {
                            event.preventDefault();
                            void restore();
                        }}
                    >
                        {isSubmitting ? <InlineLoader label="Restoring…" /> : 'Restore account'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
