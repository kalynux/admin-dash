import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircleAlert } from 'lucide-react';

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
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_ROLE_CLOSED,
    PLATFORM_CODE_ROLE_CLOSURE_ALREADY_PENDING,
    PLATFORM_CODE_ROLE_CLOSURE_BLOCKED,
    PLATFORM_CODE_ROLE_CLOSURE_ROLE_NOT_HELD,
    PLATFORM_CODE_STATUS_CONFLICT,
    requestRoleClosure,
} from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import {
    ROLE_CLOSURE_BLOCKER_LABELS,
    ROLE_CLOSURE_REASON_MAX,
    ROLE_CLOSURE_REASON_MIN,
    ROLE_CLOSURE_TTL_DAYS,
    roleClosureBlockersOf,
    userDisplayName,
    type ClosableRole,
    type RoleClosureBlocker,
    type UserDetail,
} from '@/types/users.types';

const schema = z.object({
    reason: z
        .string()
        .trim()
        .min(ROLE_CLOSURE_REASON_MIN, `Write at least ${ROLE_CLOSURE_REASON_MIN} characters`)
        .max(ROLE_CLOSURE_REASON_MAX, `At most ${ROLE_CLOSURE_REASON_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

/** The two refusals that keep the dialog open and replace the form's purpose. */
type Refusal = { kind: 'blocked'; blockers: RoleClosureBlocker[] } | { kind: 'pending' };

/**
 * `POST /users/:userId/roles/:role/closure` · `users.close` (`destructive`,
 * tiers 1–2) — **ask** the user to close one role.
 *
 * ⛔ **This closes nothing, and the copy must never suggest it does.** The user
 * gets a notice and confirms or declines it in their own app, signed in as that
 * role, within seven days; there is no confirm anywhere on this dashboard. Say
 * "close", never "delete" — closing is anonymise-and-retain (ADR-A02 D-2).
 *
 * ── Refusals, by `details.platformCode` ───────────────────────────────────────
 * - `ROLE_CLOSURE_BLOCKED` (422) — `details.blockers[]` as a checklist, in the
 *   dialog. Nothing was sent, and retrying changes nothing until they settle.
 * - `ROLE_CLOSURE_ALREADY_PENDING` (409) — one is already waiting; point at the
 *   closure-requests panel on this same screen.
 * - `ROLE_CLOSURE_ROLE_NOT_HELD` (422) / `ROLE_CLOSED` (409) — this screen is
 *   stale. Close and refresh the profiles.
 * - `USER_STATUS_CONFLICT` (409) — the account is suspended or closed. ⚠ The
 *   catalog's sentence for that code (*"another administrator changed this
 *   account first"*) is written for suspend/restore and is false here, so it is
 *   worded on its own.
 */
export function RequestRoleClosureDialog({
    user,
    role,
    open,
    onOpenChange,
    onRequested,
    onStale,
}: {
    user: UserDetail;
    role: ClosableRole;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A request now exists — reload the panel and the activity trail. */
    onRequested: () => void;
    /** The screen disagrees with the platform — reload the account. */
    onStale: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<Refusal | null>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    const name = userDisplayName(user);
    const otherRoles = user.roles.filter((held) => held !== role);

    function close(next: boolean) {
        if (!next) {
            form.reset();
            setFormError(null);
            setRefusal(null);
        }
        onOpenChange(next);
    }

    async function onSubmit(values: Values) {
        setFormError(null);
        setRefusal(null);
        try {
            await requestRoleClosure(user.id, role, { reason: values.reason });
            notify.success(`Closure requested — ${name} will be asked to confirm`, {
                description: `Nothing changes unless they confirm in their ${role} app within ${ROLE_CLOSURE_TTL_DAYS} days.`,
            });
            close(false);
            onRequested();
        } catch (error) {
            if (error instanceof ApiError) {
                switch (error.platformCode) {
                    case PLATFORM_CODE_ROLE_CLOSURE_BLOCKED:
                        setRefusal({
                            kind: 'blocked',
                            blockers: roleClosureBlockersOf(error.details),
                        });
                        return;
                    case PLATFORM_CODE_ROLE_CLOSURE_ALREADY_PENDING:
                        setRefusal({ kind: 'pending' });
                        onRequested();
                        return;
                    case PLATFORM_CODE_ROLE_CLOSURE_ROLE_NOT_HELD:
                    case PLATFORM_CODE_ROLE_CLOSED:
                        notify.warning(
                            error.platformCode === PLATFORM_CODE_ROLE_CLOSED
                                ? `The ${role} role is already closed`
                                : `This user does not hold the ${role} role`,
                            { description: 'The roles on this screen were out of date and have been refreshed.' },
                        );
                        close(false);
                        onStale();
                        return;
                    case PLATFORM_CODE_STATUS_CONFLICT:
                        notify.warning('This account is suspended or closed', {
                            description:
                                'A closure can only be requested on an active account. The account has been refreshed.',
                        });
                        close(false);
                        onStale();
                        return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ask {name} to close their {role} role</DialogTitle>
                    <DialogDescription>
                        They will be asked to confirm or decline it themselves, in their {role}{' '}
                        app, within {ROLE_CLOSURE_TTL_DAYS} days. Nothing changes unless they
                        confirm.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">If they confirm, the closure cannot be undone.</p>
                        <p className="text-muted-foreground">
                            The role&rsquo;s name, contacts, addresses, payout details and identity
                            documents are removed. Orders, shipments and money records are kept,
                            without them.{' '}
                            {otherRoles.length > 0
                                ? `Their other roles (${otherRoles.join(', ')}) are not affected.`
                                : 'This is their only role, so confirming would close the whole account.'}
                        </p>
                    </div>

                    <FormField
                        id="role-closure-reason"
                        label="Reason"
                        error={form.formState.errors.reason?.message}
                        hint={`The user is shown this, word for word. ${ROLE_CLOSURE_REASON_MIN}–${ROLE_CLOSURE_REASON_MAX} characters.`}
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={ROLE_CLOSURE_REASON_MAX}
                                placeholder="You asked us by email to close your shop"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {refusal?.kind === 'blocked' ? <BlockerChecklist blockers={refusal.blockers} /> : null}

                    {refusal?.kind === 'pending' ? (
                        <div
                            role="alert"
                            className="border-warning/40 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">A request is already waiting for this role.</p>
                            <p className="text-muted-foreground">
                                Nothing new was sent. It is listed under{' '}
                                <a
                                    href="#role-closure-requests"
                                    className="text-foreground underline underline-offset-2"
                                    onClick={() => close(false)}
                                >
                                    Closure requests
                                </a>
                                , where it can be withdrawn.
                            </p>
                        </div>
                    ) : null}

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => close(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="destructive"
                            disabled={form.formState.isSubmitting || refusal !== null}
                        >
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Send closure request
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/**
 * `details.blockers[]`, one line each: what holds the role open, how many, and
 * what settles it. An unknown code renders by its raw name; an empty list (the
 * details did not arrive) still says the role is blocked.
 */
function BlockerChecklist({ blockers }: { blockers: RoleClosureBlocker[] }) {
    return (
        <div
            role="alert"
            className="border-destructive/40 bg-destructive/5 space-y-2 rounded-lg border px-3 py-2 text-sm"
        >
            <p className="font-medium">This role cannot be closed yet. Nothing was sent.</p>
            {blockers.length === 0 ? (
                <p className="text-muted-foreground">
                    Live work or money is still attached to it, and the platform did not say what.
                </p>
            ) : (
                <>
                    <p className="text-muted-foreground">These must be settled first:</p>
                    <ul className="space-y-1.5">
                        {blockers.map((blocker) => {
                            const label = ROLE_CLOSURE_BLOCKER_LABELS[blocker.code];
                            return (
                                <li key={blocker.code} className="flex gap-2">
                                    <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
                                    <div className="min-w-0">
                                        <p>
                                            {label?.what ?? blocker.code}
                                            <span className="text-muted-foreground">
                                                {' '}
                                                · {blocker.count}
                                                {blocker.amount !== undefined
                                                    ? ` · ${formatMoney(blocker.amount, blocker.currency ?? 'XAF')}`
                                                    : ''}
                                            </span>
                                        </p>
                                        {label ? (
                                            <p className="text-muted-foreground text-xs">
                                                Settled when: {label.settle.toLowerCase()}
                                            </p>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </div>
    );
}
