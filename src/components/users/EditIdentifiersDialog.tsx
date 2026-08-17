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
import { Input } from '@/components/ui/input';
import { pickFieldErrors } from '@/lib/field-errors';
import { resolveErrorMessage } from '@/lib/errors';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_CONTACT_REQUIRED,
    PLATFORM_CODE_EMAIL_TAKEN,
    PLATFORM_CODE_PHONE_TAKEN,
    updateUserContact,
} from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import type { UpdateUserContactBody, User } from '@/types/users.types';

/**
 * ── What this form does and does not validate ─────────────────────────────────
 * Length only. **Format is jovi-mall's to judge** — it owns the login identifiers
 * and holds the one definition of what each may be (RFC 5322 for an address,
 * strict E.164 for a number), used by every platform write path. A copy of those
 * rules here would be a second definition of a rule this client does not own, and
 * the failure mode of drift is silent in the worst direction: an address accepted
 * at the admin door that every later edit by its owner is refused.
 *
 * So no `.email()` here, deliberately. A malformed value comes back as
 * `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's own code and message.
 *
 * The bounds are RFC 5321's and wi-admin's schema enforces them, so catching them
 * here is a round trip saved rather than a rule invented.
 */
const schema = z
    .object({
        email: z.string().trim().max(254, 'Use at most 254 characters'),
        phone: z.string().trim().max(24, 'Use at most 24 characters'),
    })
    .refine((values) => values.email.length === 0 || values.email.length >= 3, {
        path: ['email'],
        message: 'Use at least 3 characters, or clear the field to remove it',
    })
    .refine((values) => values.phone.length === 0 || values.phone.length >= 4, {
        path: ['phone'],
        message: 'Use at least 4 characters, or clear the field to remove it',
    })
    /**
     * The one business rule worth pre-empting: `login` resolves an account by
     * email **or** phone, so clearing both makes it permanently unreachable with
     * no self-service path back. jovi-mall refuses it with `422
     * USER_CONTACT_REQUIRED`; refusing it here as well means the operator finds
     * out while they can still undo it, on the field rather than in a toast.
     */
    .refine((values) => values.email.length > 0 || values.phone.length > 0, {
        path: ['email'],
        message: 'Keep at least one of email or phone — an account with neither can never sign in',
    });

type EditIdentifiersValues = z.infer<typeof schema>;

const SERVER_FIELDS = ['email', 'phone'] as const;

interface EditIdentifiersDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Refetch the detail. The write answers a different shape, so nothing is merged. */
    onUpdated: () => void;
}

/**
 * `PATCH /users/:userId` · `users.update` — the only user fields an administrator
 * may edit.
 *
 * ── Absent, cleared and changed are three different things ────────────────────
 * The contract's rule for an optional field is that **omitting the key leaves it
 * unchanged and sending `null` clears it**, and collapsing the two would silently
 * delete an identifier nobody touched. So the payload is built by diffing against
 * what was loaded: an untouched field contributes no key at all.
 *
 * That also keeps the audit row honest. Every edit is recorded with a
 * `before`/`after` diff, and a body that restates an unchanged value would put a
 * no-op in the trail as though somebody had acted on it.
 */
export function EditIdentifiersDialog({
    user,
    open,
    onOpenChange,
    onUpdated,
}: EditIdentifiersDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit login details</DialogTitle>
                    <DialogDescription>
                        The email address and phone number this person signs in with. Clearing one
                        removes it; the account must keep at least one.
                    </DialogDescription>
                </DialogHeader>

                {/*
                  The form is a child of `DialogContent`, which Radix unmounts when
                  the dialog closes — so every open starts from what the record says
                  *now*, with no errors left over from the last attempt.

                  Resetting in an effect instead would be the obvious spelling and a
                  worse one: it runs after paint, so a reopened dialog would flash the
                  previous attempt's values and messages before clearing them.
                */}
                <EditIdentifiersForm
                    user={user}
                    onCancel={() => onOpenChange(false)}
                    onSaved={() => {
                        onOpenChange(false);
                        onUpdated();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function EditIdentifiersForm({
    user,
    onCancel,
    onSaved,
}: {
    user: User;
    onCancel: () => void;
    onSaved: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<EditIdentifiersValues>({
        resolver: zodResolver(schema),
        defaultValues: { email: user.email ?? '', phone: user.phone ?? '' },
    });

    async function onSubmit(values: EditIdentifiersValues) {
        setFormError(null);

        const body: UpdateUserContactBody = {};
        // `null` clears; an absent key leaves alone. Only changed fields travel.
        if (values.email !== (user.email ?? '')) body.email = values.email || null;
        if (values.phone !== (user.phone ?? '')) body.phone = values.phone || null;

        if (Object.keys(body).length === 0) {
            // wi-admin answers "Nothing to update — send `email`, `phone`, or
            // both" for an empty body. Saying so here beats spending a request
            // to be told.
            setError('email', { message: 'Nothing has changed yet' });
            return;
        }

        try {
            await updateUserContact(user.id, body);
            notify.success('Login details updated');
            onSaved();
        } catch (error) {
            if (error instanceof ApiError) {
                /**
                 * **Branch on `platformCode`, never on `code`.** Every refusal
                 * below arrives as the same `PLATFORM_OPERATION_REJECTED`; the
                 * platform's own code is the only thing that says which.
                 */
                /*
                  Which *field* a refusal lands on is screen knowledge and stays
                  here; the sentence is catalogued under `errors.platform.*` and
                  is looked up rather than repeated. `CONTACT_REQUIRED` names no
                  single field — clearing both is what caused it — so it goes on
                  the email input, which is the one the form leads with.
                */
                switch (error.platformCode) {
                    case PLATFORM_CODE_EMAIL_TAKEN:
                    case PLATFORM_CODE_CONTACT_REQUIRED:
                        setError('email', { message: resolveErrorMessage(error) });
                        return;
                    case PLATFORM_CODE_PHONE_TAKEN:
                        setError('phone', { message: resolveErrorMessage(error) });
                        return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = Object.entries(fieldErrors);
                if (named.length > 0) {
                    for (const [field, message] of named) {
                        setError(field as (typeof SERVER_FIELDS)[number], { message });
                    }
                    return;
                }

                /**
                 * Anything left is either a format rejection jovi-mall phrased
                 * itself, or a dependency failure. Both belong in the banner
                 * rather than on a field: the first because its message names the
                 * rule better than any copy here could, the second because it is
                 * not about what was typed.
                 */
                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField id="user-email" label="Email" error={errors.email?.message}>
                {(field) => (
                    <Input
                        type="text"
                        autoComplete="off"
                        placeholder="Empty to remove"
                        {...field}
                        {...register('email')}
                    />
                )}
            </FormField>

            <FormField id="user-phone" label="Phone" error={errors.phone?.message}>
                {(field) => (
                    <Input
                        type="text"
                        autoComplete="off"
                        placeholder="Empty to remove"
                        {...field}
                        {...register('phone')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground text-xs">
                The platform checks the format and that nobody else holds the value. This change is
                recorded in the audit trail with the previous value.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Saving…" /> : 'Save changes'}
                </Button>
            </DialogFooter>
        </form>
    );
}
