import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { OneTimePasswordPanel } from '@/components/administrators/OneTimePasswordPanel';
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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { assignableTiers } from '@/lib/admin-escalation';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { createAdministrator } from '@/services/administrators.service';
import { ApiError } from '@/types/api.types';
import {
    CODE_ADMIN_ACCOUNT_ALREADY_EXISTS,
    CODE_APPROVAL_REQUIRED,
    type Administrator,
    type AdminTier,
} from '@/types/administrators.types';

const NAME_MIN = 2;
const NAME_MAX = 120;
const FIELD_MAX = 120;

/**
 * wi-admin's own bounds, so a malformed submission is a saved round trip.
 *
 * `tier` is **not** here: it is a `<Select>` whose options come from
 * `assignableTiers`, so it can only ever hold a level this actor may assign, and
 * there is nothing for a resolver to check. Keeping it in local state also keeps
 * `watch()` out of the render path.
 */
const schema = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    displayName: z
        .string()
        .trim()
        .min(NAME_MIN, `Use at least ${NAME_MIN} characters`)
        .max(NAME_MAX, `Use at most ${NAME_MAX} characters`),
    jobTitle: z.string().trim().max(FIELD_MAX, `Use at most ${FIELD_MAX} characters`),
    department: z.string().trim().max(FIELD_MAX, `Use at most ${FIELD_MAX} characters`),
});

type CreateValues = z.infer<typeof schema>;

/** `tier` is included: the server can still reject it, and that belongs on the field. */
const SERVER_FIELDS = ['email', 'displayName', 'jobTitle', 'department'] as const;

interface CreateAdministratorDialogProps {
    /** The caller's own level — what they may assign is derived from it. */
    actorTier: AdminTier;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}

/**
 * `POST /administrators` · `administrators.create` · 201.
 *
 * ── There is no password field, and the dialog says so ────────────────────────
 * The service generates one and returns it exactly once. A client that could
 * choose the password could choose a weak one, and there is nowhere to deliver
 * it from — so the creating administrator is the delivery channel, and the
 * result panel is part of the flow rather than a nicety.
 *
 * ── Why Developer is not in the list ──────────────────────────────────────────
 * `assignableTiers(actorTier, 'create')` excludes it even for a Developer,
 * because `POST /administrators` answers **`409 AUTHZ_APPROVAL_REQUIRED`** for
 * `tier: 1` rather than queueing: there is no approval path from create. The
 * documented route is to create at a lower level and then request a promotion,
 * which the four-eyes queue reviews — one reviewed step instead of two. The
 * absence is stated inline, because an unexplained missing option reads as a bug.
 */
export function CreateAdministratorDialog({
    actorTier,
    open,
    onOpenChange,
    onCreated,
}: CreateAdministratorDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                // Closing is handled by the form and the reveal panel, which
                // refuses to be dismissed by accident. Radix unmounts the
                // content, so every open starts clean.
                if (!next) onOpenChange(false);
            }}
        >
            <DialogContent
                // While the password is on screen, an outside click or Escape
                // would destroy the only copy that will ever exist.
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <CreateAdministratorBody
                    actorTier={actorTier}
                    onCancel={() => onOpenChange(false)}
                    onFinished={() => {
                        onOpenChange(false);
                        onCreated();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

interface Created {
    administrator: Administrator;
    oneTimePassword: string;
    message?: string;
}

function CreateAdministratorBody({
    actorTier,
    onCancel,
    onFinished,
}: {
    actorTier: AdminTier;
    onCancel: () => void;
    onFinished: () => void;
}) {
    const [created, setCreated] = useState<Created | null>(null);

    if (created) {
        return (
            <>
                <DialogHeader>
                    <DialogTitle>Administrator created</DialogTitle>
                    <DialogDescription>
                        The account exists. It cannot be used until they have this password.
                    </DialogDescription>
                </DialogHeader>
                <OneTimePasswordPanel
                    password={created.oneTimePassword}
                    administrator={created.administrator}
                    message={created.message}
                    onDone={onFinished}
                />
            </>
        );
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>New administrator</DialogTitle>
                <DialogDescription>
                    You do not choose a password. One is generated and shown to you once, on the
                    next screen.
                </DialogDescription>
            </DialogHeader>
            <CreateAdministratorForm
                actorTier={actorTier}
                onCancel={onCancel}
                onCreated={setCreated}
            />
        </>
    );
}

function CreateAdministratorForm({
    actorTier,
    onCancel,
    onCreated,
}: {
    actorTier: AdminTier;
    onCancel: () => void;
    onCreated: (created: Created) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const tiers = assignableTiers(actorTier, 'create');

    /*
     * The least privileged assignable level is the default — the safe answer
     * when somebody submits without thinking about it. `tiers` is never empty
     * here: the list screen hides the button entirely when it is.
     */
    const [tier, setTier] = useState<string>(String(tiers[tiers.length - 1]?.tier ?? ''));

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<CreateValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            email: '',
            displayName: '',
            jobTitle: '',
            department: '',
        },
    });

    async function onSubmit(values: CreateValues) {
        setFormError(null);
        try {
            const result = await createAdministrator({
                email: values.email,
                displayName: values.displayName,
                tier: Number(tier) as AdminTier,
                // Optional on the wire: send nothing rather than `''`, which is
                // a different statement on this contract.
                ...(values.jobTitle ? { jobTitle: values.jobTitle } : {}),
                ...(values.department ? { department: values.department } : {}),
            });

            onCreated({
                administrator: result.data.administrator,
                oneTimePassword: result.data.oneTimePassword,
                message: result.message,
            });
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.code === CODE_ADMIN_ACCOUNT_ALREADY_EXISTS) {
                    setError('email', { message: 'An administrator already uses that address.' });
                    return;
                }

                /*
                 * The belt to `assignableTiers`' braces — unreachable while the
                 * select is built from it, and a 409 rather than a 202, so it
                 * must never be read as "queued for approval".
                 */
                if (error.code === CODE_APPROVAL_REQUIRED) {
                    setFormError(error);
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = SERVER_FIELDS.find((field) => fieldErrors[field]);
                if (named) {
                    setError(named, { message: fieldErrors[named] });
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

            <FormField id="create-email" label="Email" error={errors.email?.message}>
                {(field) => (
                    <Input
                        type="email"
                        autoComplete="off"
                        placeholder="sam@wimall.cm"
                        {...field}
                        {...register('email')}
                    />
                )}
            </FormField>

            <FormField
                id="create-name"
                label="Display name"
                error={errors.displayName?.message}
            >
                {(field) => (
                    <Input
                        autoComplete="off"
                        maxLength={NAME_MAX}
                        {...field}
                        {...register('displayName')}
                    />
                )}
            </FormField>

            <div className="space-y-2">
                <Label htmlFor="create-tier">Access level</Label>
                <Select value={tier} onValueChange={setTier}>
                    <SelectTrigger id="create-tier" aria-label="Access level">
                        <SelectValue placeholder="Choose a level" />
                    </SelectTrigger>
                    <SelectContent>
                        {tiers.map((option) => (
                            <SelectItem key={option.tier} value={String(option.tier)}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                    You can only create an account below your own level.
                    {actorTier === 1
                        ? ' Developer is not offered: create the account lower, then request a promotion — that goes through a second administrator as one reviewed step instead of two.'
                        : null}
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="create-job">Job title</Label>
                    <Input
                        id="create-job"
                        maxLength={FIELD_MAX}
                        placeholder="Optional"
                        {...register('jobTitle')}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="create-department">Department</Label>
                    <Input
                        id="create-department"
                        maxLength={FIELD_MAX}
                        placeholder="Optional"
                        {...register('department')}
                    />
                </div>
            </div>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Creating…" /> : 'Create administrator'}
                </Button>
            </DialogFooter>
        </form>
    );
}
