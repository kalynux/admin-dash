import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { TimeZoneSelect } from '@/components/common/TimeZoneSelect';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { LOCALES, SUPPORTED_LOCALES, isLocale } from '@/i18n/config';
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
 * Job title and department are the organisation's description of a person, not
 * the person's own — so below tier 1 they are read-only here.
 *
 * ⚠ **This is a house rule, not the contract.** `PATCH /administrators/me`
 * accepts both fields from every tier and will not refuse them, which is exactly
 * why the lock has to be honoured on the way *out* as well as in the markup: the
 * submit handler never puts a locked key in the body, so a disabled input that
 * was re-enabled in a devtools panel still changes nothing. The real boundary is
 * `PATCH /administrators/:adminId` behind `administrators.update`, where somebody
 * who is allowed to describe other people's roles does it.
 *
 * Tier 1 keeps both, because there is no level above it to ask.
 */
function organisationFieldsLocked(administrator: Administrator, mode: EditMode): boolean {
    return mode.kind === 'self' && administrator.tier !== 1;
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
    const locked = organisationFieldsLocked(administrator, mode);

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
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

    /*
      Neither control is an `<input>`, so neither can be `register`ed. Reading
      the field and writing it back with `shouldDirty` keeps them inside the same
      dirty-tracking the clearable-field rule below depends on.

      `useWatch`, not `watch()`: the latter returns a fresh function every render
      and the React Compiler refuses to memoise a component that calls it, which
      is a lint error here rather than a style note.
    */
    const timezone = useWatch({ control, name: 'timezone' });
    const preferredLanguage = useWatch({ control, name: 'preferredLanguage' });

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
        // ⚠ The lock is enforced here, not only in the markup — see
        // `organisationFieldsLocked`. A disabled control is a hint; this is the rule.
        if (!locked && dirtyFields.jobTitle) body.jobTitle = values.jobTitle || null;
        if (!locked && dirtyFields.department) body.department = values.department || null;
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

            {locked ? (
                /*
                  Rendered as facts rather than as disabled inputs.
                  A greyed-out box still reads as "a field you could fill in if
                  you tried harder", and there is no amount of trying: the value
                  is somebody else's to set. Two lines of text and one sentence
                  saying who, which is the question this raises.
                */
                <div className="bg-muted/40 space-y-3 rounded-lg border px-3 py-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <LockedDetail label="Job title" value={administrator.jobTitle} />
                        <LockedDetail label="Department" value={administrator.department} />
                    </div>
                    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                        <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>
                            Your job title and department describe your place in the organisation,
                            so they are set for you. Ask a Developer-level administrator to change
                            either.
                        </span>
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        id="edit-job"
                        label="Job title"
                        error={errors.jobTitle?.message}
                        hint="Clear it to remove it."
                    >
                        {(field) => (
                            <Input maxLength={FIELD_MAX} {...field} {...register('jobTitle')} />
                        )}
                    </FormField>
                    <FormField
                        id="edit-department"
                        label="Department"
                        error={errors.department?.message}
                        hint="Clear it to remove it."
                    >
                        {(field) => (
                            <Input maxLength={FIELD_MAX} {...field} {...register('department')} />
                        )}
                    </FormField>
                </div>
            )}

            <FormField
                id="edit-timezone"
                label="Time zone"
                error={errors.timezone?.message}
                hint="Every date range on this dashboard is resolved in it, so a report covers your day rather than the browser's."
            >
                {(field) => (
                    <TimeZoneSelect
                        {...field}
                        value={timezone}
                        onChange={(zone) =>
                            setValue('timezone', zone, {
                                shouldDirty: true,
                                shouldValidate: true,
                            })
                        }
                    />
                )}
            </FormField>

            <FormField
                id="edit-language"
                label="Preferred language"
                error={errors.preferredLanguage?.message}
                hint="What this dashboard is shown in, on every device you sign in from."
            >
                {(field) => (
                    <Select
                        value={preferredLanguage}
                        onValueChange={(next) =>
                            setValue('preferredLanguage', next, {
                                shouldDirty: true,
                                shouldValidate: true,
                            })
                        }
                    >
                        <SelectTrigger {...field} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SUPPORTED_LOCALES.map((code) => (
                                <SelectItem key={code} value={code}>
                                    {LOCALES[code].nativeLabel}
                                    <span className="text-muted-foreground">
                                        {' '}
                                        — {LOCALES[code].label}
                                    </span>
                                </SelectItem>
                            ))}

                            {/*
                              ⚠ The stored value stays selectable when the
                              dashboard does not speak it.

                              `preferredLanguage` is a free 2–10 character string
                              on the wire and this field is shared with wi-admin's
                              own record, so a value like `pt` is data, not
                              corruption. Dropping it from the list would make the
                              Select show an empty trigger and silently rewrite the
                              administrator's saved language the first time they
                              opened this form to change their time zone.
                            */}
                            {preferredLanguage && !isLocale(preferredLanguage) ? (
                                <SelectItem value={preferredLanguage}>
                                    {preferredLanguage}
                                    <span className="text-muted-foreground">
                                        {' '}
                                        — not translated; shown in English
                                    </span>
                                </SelectItem>
                            ) : null}
                        </SelectContent>
                    </Select>
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

/** One of the two fields this administrator may read but not write. */
function LockedDetail({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium">{label}</p>
            <p className="text-sm">
                {value ?? <span className="text-muted-foreground">Not set</span>}
            </p>
        </div>
    );
}
