import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
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
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { PLATFORM_CODE_STATUS_CONFLICT, suspendUser } from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import { userDisplayName, type User } from '@/types/users.types';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** wi-admin's own bounds (`reasonText`, 3–500 trimmed), so this is a saved round trip. */
const schema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required to suspend an account')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type SuspendValues = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

interface SuspendUserDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuspended: () => void;
}

/**
 * `POST /users/:userId/suspend` · `users.suspend`.
 *
 * ── Why the reason is mandatory, and where it ends up ─────────────────────────
 * A suspension is a *state* somebody has to be able to explain later, so it
 * carries who and why on the account row. But **reinstating clears all of it** —
 * the reason, the timestamp and the actor — leaving the audit trail as the only
 * surviving record that any of it happened. So this text is not a note on a
 * record; it is the permanent explanation, and the copy says so.
 *
 * ── What the confirmation has to be honest about ──────────────────────────────
 * Two things an operator will otherwise assume:
 *
 * - It takes effect on the person's **next request**, not their next sign-in.
 *   Live sessions die immediately. That is also why there is no separate "sign
 *   out everywhere" action anywhere on this screen.
 * - It does **not** cascade to their role entities. A vendor's store and an
 *   agent's record keep their own status on their own axis, deliberately —
 *   collapsing the two would make reinstatement guess which was true before.
 */
export function SuspendUserDialog({
    user,
    open,
    onOpenChange,
    onSuspended,
}: SuspendUserDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Suspend {userDisplayName(user)}?</DialogTitle>
                    <DialogDescription>
                        Sign-in is blocked on every device from their next request — any session
                        they have open dies immediately, not at its expiry.
                    </DialogDescription>
                </DialogHeader>

                {/*
                  A child of `DialogContent`, which Radix unmounts on close, so every
                  open starts with an empty reason and no stale error. A reason is a
                  permanent record; carrying one over from an abandoned attempt on a
                  different account is the failure worth designing out.
                */}
                <SuspendUserForm
                    user={user}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onSuspended();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SuspendUserForm({
    user,
    onCancel,
    onDone,
}: {
    user: User;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SuspendValues>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: SuspendValues) {
        setFormError(null);
        try {
            await suspendUser(user.id, { reason: values.reason });
            notify.success('Account suspended', {
                description: 'Every device is signed out on the next request.',
            });
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                /**
                 * The compare-and-set lost: somebody else moved this account while
                 * the dialog was open. Not a fault and not retryable as-is — the
                 * remedy is to look at the state that actually exists now, so the
                 * dialog closes and the detail refetches.
                 */
                if (error.platformCode === PLATFORM_CODE_STATUS_CONFLICT) {
                    notify.warning('This account is no longer active', {
                        description:
                            'Another administrator changed it while this was open. Reloading what it says now.',
                    });
                    onDone();
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField
                id="suspend-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Reinstating clears this from the account, so the audit trail becomes the only record of it. Write it for someone reading in six months."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="What happened, and any reference an investigator would need"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground text-xs">
                Their vendor, agency or agent records are untouched — those have their own status on
                their own screens.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Suspending…" /> : 'Suspend account'}
                </Button>
            </DialogFooter>
        </form>
    );
}
