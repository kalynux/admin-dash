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
import { notify } from '@/lib/notify';
import { updateAdministrator, updateOwnProfile } from '@/services/administrators.service';
import { ApiError } from '@/types/api.types';
import type {
    Administrator,
    UpdateAdministratorProfileBody,
} from '@/types/administrators.types';

const NAME_MIN = 2;
const NAME_MAX = 120;
const FIELD_MAX = 120;
const ZONE_MAX = 64;
const LANGUAGE_MIN = 2;
const LANGUAGE_MAX = 10;

const schema = z.object({
    displayName: z
        .string()
        .trim()
        .min(NAME_MIN, `Use at least ${NAME_MIN} characters`)
        .max(NAME_MAX, `Use at most ${NAME_MAX} characters`),
    jobTitle: z.string().trim().max(FIELD_MAX, `Use at most ${FIELD_MAX} characters`),
    department: z.string().trim().max(FIELD_MAX, `Use at most ${FIELD_MAX} characters`),
    timezone: z
        .string()
        .trim()
        .min(1, 'A time zone is required')
        .max(ZONE_MAX, `Use at most ${ZONE_MAX} characters`),
    preferredLanguage: z
        .string()
        .trim()
        .min(LANGUAGE_MIN, `Use at least ${LANGUAGE_MIN} characters`)
        .max(LANGUAGE_MAX, `Use at most ${LANGUAGE_MAX} characters`),
});

type EditValues = z.infer<typeof schema>;

const SERVER_FIELDS = [
    'displayName',
    'jobTitle',
    'department',
    'timezone',
    'preferredLanguage',
] as const;

/**
 * Which endpoint, which audit action, and what happens afterwards.
 *
 * **Not cosmetic.** `PATCH /administrators/me` audits as
 * `administrators.profile.update_self` and needs no permission;
 * `PATCH /administrators/:adminId` audits as `administrators.update`, needs
 * `administrators.update`, and **refuses a self-edit** with
 * `403 AUTHZ_SELF_ACTION_FORBIDDEN`. The catalog keeps the two apart on purpose,
 * so a denial row says which was attempted.
 */
export type EditMode = { kind: 'self' } | { kind: 'other'; adminId: string };

interface EditAdministratorDialogProps {
    administrator: Administrator;
    mode: EditMode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Called after a successful write.
     *
     * ⚠ In `self` mode the caller must **discard the response and call
     * `refreshProfile()`**, not merge what came back. See the note on the
     * submit handler below.
     */
    onUpdated: () => void;
}

/**
 * Edit an administrator's profile — the five fields that are theirs to hold.
 *
 * ── `tier` and `status` are not here, and must not be added ───────────────────
 * From the contract, verbatim: *"A `tier` field quietly accepted by a profile
 * PATCH would route the most dangerous write in the service through the least
 * examined path."* Levels change through one endpoint with one permission and
 * dual control at the top; suspension has its own endpoint because it has its
 * own consequences and its own required reason.
 */
export function EditAdministratorDialog({
    administrator,
    mode,
    open,
    onOpenChange,
    onUpdated,
}: EditAdministratorDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {mode.kind === 'self' ? 'Edit your profile' : 'Edit profile'}
                    </DialogTitle>
                    <DialogDescription>
                        Your time zone decides how every date filter on this dashboard resolves a
                        day. Access level and account status are changed elsewhere.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so each open reloads from the record. */}
                <EditAdministratorForm
                    administrator={administrator}
                    mode={mode}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onUpdated();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function EditAdministratorForm({
    administrator,
    mode,
    onCancel,
    onDone,
}: {
    administrator: Administrator;
    mode: EditMode;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        formState: { errors, isSubmitting, dirtyFields },
    } = useForm<EditValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            displayName: administrator.displayName,
            jobTitle: administrator.jobTitle ?? '',
            department: administrator.department ?? '',
            timezone: administrator.timezone,
            preferredLanguage: administrator.preferredLanguage,
        },
    });

    async function onSubmit(values: EditValues) {
        setFormError(null);

        /*
         * ── The clearable-field trap ─────────────────────────────────────────
         * Three states per key: **omitted** means unchanged, **null** means
         * clear, a value means set. React Hook Form gives `''` for both "never
         * touched" and "emptied", so `dirtyFields` is the only thing that can
         * tell them apart — which is why this is assembled key by key and never
         * by spreading `values`. A spread would send `jobTitle: ''` for a field
         * nobody touched and silently clear it.
         */
        const body: UpdateAdministratorProfileBody = {};
        if (dirtyFields.displayName) body.displayName = values.displayName;
        if (dirtyFields.jobTitle) body.jobTitle = values.jobTitle || null;
        if (dirtyFields.department) body.department = values.department || null;
        if (dirtyFields.timezone) body.timezone = values.timezone;
        if (dirtyFields.preferredLanguage) body.preferredLanguage = values.preferredLanguage;

        // An empty body is a `400 VALIDATION_ERROR` ("No fields to update").
        // Nothing changed, so nothing needs saying.
        if (Object.keys(body).length === 0) {
            onCancel();
            return;
        }

        try {
            /*
             * ⚠ The response is deliberately discarded in both modes.
             *
             * These endpoints answer the `Administrator` projection, which has
             * no `mfaRequired`. Merging one into the auth store would set that
             * field to `undefined`, and `deriveMfaEnrolmentRequired` reads
             * exactly it to recover a scoped enrolment session across a page
             * reload — so the merge would break MFA enrolment recovery for
             * every tier-1 account. The caller refetches instead.
             */
            if (mode.kind === 'self') await updateOwnProfile(body);
            else await updateAdministrator(mode.adminId, body);

            notify.success('Profile updated');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
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

            <FormField
                id="edit-name"
                label="Display name"
                error={errors.displayName?.message}
            >
                {(field) => (
                    <Input maxLength={NAME_MAX} {...field} {...register('displayName')} />
                )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="edit-job" label="Job title" hint="Clear it to remove it.">
                    {(field) => (
                        <Input maxLength={FIELD_MAX} {...field} {...register('jobTitle')} />
                    )}
                </FormField>
                <FormField id="edit-department" label="Department" hint="Clear it to remove it.">
                    {(field) => (
                        <Input maxLength={FIELD_MAX} {...field} {...register('department')} />
                    )}
                </FormField>
            </div>

            <FormField
                id="edit-timezone"
                label="Time zone"
                error={errors.timezone?.message}
                hint="An IANA zone name. Every date range on this dashboard is resolved in it, so a report covers your day rather than the browser's."
            >
                {(field) => (
                    <div className="flex items-center gap-2">
                        <Input
                            maxLength={ZONE_MAX}
                            placeholder="Africa/Douala"
                            {...field}
                            {...register('timezone')}
                        />
                        {/*
                          A full zone picker is not worth a dependency, and the
                          browser already knows the answer for the common case. The
                          service validates the string.
                        */}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() =>
                                setValue(
                                    'timezone',
                                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                                    { shouldDirty: true, shouldValidate: true },
                                )
                            }
                        >
                            Use this device
                        </Button>
                    </div>
                )}
            </FormField>

            <FormField
                id="edit-language"
                label="Preferred language"
                error={errors.preferredLanguage?.message}
            >
                {(field) => (
                    <Input
                        maxLength={LANGUAGE_MAX}
                        placeholder="en"
                        {...field}
                        {...register('preferredLanguage')}
                    />
                )}
            </FormField>

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
