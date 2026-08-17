import { useState } from 'react';
import { ShieldOff } from 'lucide-react';

import { OneTimePasswordPanel } from '@/components/administrators/OneTimePasswordPanel';
import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import {
    resetAdministratorMfa,
    resetAdministratorPassword,
} from '@/services/administrators.service';
import { ApiError } from '@/types/api.types';
import { administratorDisplayName, type Administrator } from '@/types/administrators.types';

/**
 * The two break-glass paths, and why they are two.
 *
 * They remove **different controls** — the thing you know and the thing you
 * have — and the contract keeps them behind separate permissions for exactly
 * that reason: *"handing over both from one call would hand over the account."*
 * `administrators.mfa.reset` is escalation-flagged and Developer-only;
 * `administrators.password.reset` is not. So they are two dialogs and two
 * buttons, and neither offers to do the other's job.
 */

interface CredentialDialogProps {
    administrator: Administrator;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

// ─── Password reset ───────────────────────────────────────────────────────────

interface ResetResult {
    oneTimePassword: string;
    administrator: Administrator;
    sessionsEnded: number;
    message?: string;
}

/**
 * `POST /administrators/:adminId/password-reset` · `administrators.password.reset`.
 *
 * No body — the password is generated, never supplied. **Every session dies**:
 * *"a reset that leaves the old sessions alive does not recover an account, it
 * adds a second way in."*
 *
 * Not an `AlertDialog`, despite being a yes/no confirmation, because the
 * *result* has to be rendered in place and cannot be dismissed by accident — the
 * password exists exactly once and there is nowhere to fetch it from again.
 */
export function ResetAdministratorPasswordDialog({
    administrator,
    open,
    onOpenChange,
    onDone,
}: CredentialDialogProps) {
    const [result, setResult] = useState<ResetResult | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function reset() {
        setError(null);
        setIsSubmitting(true);
        try {
            const answer = await resetAdministratorPassword(administrator.id);
            setResult({
                oneTimePassword: answer.data.oneTimePassword,
                administrator: answer.data.administrator,
                sessionsEnded: answer.data.sessionsEnded,
                message: answer.message,
            });
        } catch (caught) {
            if (caught instanceof ApiError) setError(caught);
            else notify.apiError(caught);
        } finally {
            setIsSubmitting(false);
        }
    }

    function finish() {
        setResult(null);
        setError(null);
        onOpenChange(false);
        onDone();
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && !result && onOpenChange(false)}>
            <DialogContent
                // While the password is showing, a stray click or Escape would
                // destroy the only copy that will ever exist.
                onInteractOutside={(event) => result && event.preventDefault()}
                onEscapeKeyDown={(event) => result && event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>
                        {result
                            ? 'Password reset'
                            : `Reset the password for ${administratorDisplayName(administrator)}?`}
                    </DialogTitle>
                    <DialogDescription>
                        {result
                            ? 'The account cannot be used until they have this password.'
                            : 'A new one-time password is generated and shown to you once. Every one of their sessions ends.'}
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <OneTimePasswordPanel
                        password={result.oneTimePassword}
                        administrator={result.administrator}
                        message={result.message}
                        sessionsEnded={result.sessionsEnded}
                        onDone={finish}
                    />
                ) : (
                    <div className="space-y-4">
                        <AuthFormError error={error} />

                        <p className="text-muted-foreground text-sm">
                            Every session ends with it. A reset that left the old sessions alive
                            would not recover the account — it would add a second way in.
                        </p>
                        <p className="text-muted-foreground text-sm">
                            This does not touch their two-factor enrolment. That is a separate
                            control and a separate action.
                        </p>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={isSubmitting}
                                onClick={() => void reset()}
                            >
                                {isSubmitting ? (
                                    <InlineLoader label="Resetting…" />
                                ) : (
                                    'Reset password'
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── MFA reset ────────────────────────────────────────────────────────────────

/**
 * `POST /administrators/:adminId/mfa-reset` · `administrators.mfa.reset` —
 * **Developer only**.
 *
 * Before this existed, `mfaEnrolled` was a one-way door: re-enrolment 409s,
 * nothing cleared the flag, and MFA is mandatory at the senior level — so a
 * wiped phone made an account permanently unusable.
 *
 * No secret comes back, only the record and the count. They sign in with their
 * **existing password** and are routed straight into enrolment.
 */
export function ResetAdministratorMfaDialog({
    administrator,
    open,
    onOpenChange,
    onDone,
}: CredentialDialogProps) {
    const [error, setError] = useState<unknown>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function reset() {
        setError(null);
        setIsSubmitting(true);
        try {
            const answer = await resetAdministratorMfa(administrator.id);

            notify.success('Two-factor enrolment cleared', {
                description:
                    answer.message ??
                    `${answer.data.sessionsEnded} session${answer.data.sessionsEnded === 1 ? '' : 's'} ended. They enrol a new authenticator on their next sign-in.`,
            });
            onOpenChange(false);
            onDone();
        } catch (caught) {
            if (caught instanceof ApiError) setError(caught);
            else notify.apiError(caught);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldOff className="size-4 shrink-0" aria-hidden />
                        Clear two-factor for {administratorDisplayName(administrator)}?
                    </DialogTitle>
                    <DialogDescription>
                        For a lost or wiped authenticator. They keep their password.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <AuthFormError error={error} />

                    <p className="text-muted-foreground text-sm">
                        This removes a different control from a password reset — the thing they
                        have, not the thing they know. Handing over both from one action would hand
                        over the account, which is why they are separate.
                    </p>
                    <p className="text-muted-foreground text-sm">
                        Every session ends. They sign in with their existing password and are routed
                        straight back into enrolment.
                    </p>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={isSubmitting}
                            onClick={() => void reset()}
                        >
                            {isSubmitting ? <InlineLoader label="Clearing…" /> : 'Clear two-factor'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
