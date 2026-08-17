import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    isSingleRepeatedCharacter,
    readPasswordPolicyFailures,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PASSWORD_POLICY_RULES,
} from '@/lib/password-policy';
import * as authService from '@/services/auth.service';
import {
    ApiError,
    CODE_INVALID_CREDENTIALS,
    CODE_PASSWORD_WEAK,
    CODE_RATE_LIMIT_EXCEEDED,
} from '@/types/api.types';

/**
 * The current password gets `min(1)` and no format rule — it is being *checked*,
 * exactly like the login form, and a stricter rule here would only reject a
 * correct old password set under an older policy.
 *
 * The new one **is** pre-validated, and that is not a contradiction: it is being
 * *set*, the policy is public, and every rule caught here is a `422` round trip
 * the operator does not have to wait for. The common-password list is the one rule
 * left to the server, because shipping it would publish it.
 */
const schema = z
    .object({
        currentPassword: z.string().min(1, 'Enter your current password'),
        newPassword: z
            .string()
            .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
            .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
            .refine((v) => !isSingleRepeatedCharacter(v), 'Do not repeat a single character'),
        confirmPassword: z.string().min(1, 'Repeat the new password'),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
        path: ['confirmPassword'],
        message: 'These do not match',
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
        path: ['newPassword'],
        message: 'Choose a password different from your current one',
    });

type ChangePasswordValues = z.infer<typeof schema>;

const SERVER_FIELDS = ['currentPassword', 'newPassword'] as const;

interface ChangePasswordFormProps {
    /** Every other session is ended by a successful change — the list is now stale. */
    onChanged?: (sessionsEnded: number) => void;
}

export function ChangePasswordForm({ onChanged }: ChangePasswordFormProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [policyFailures, setPolicyFailures] = useState<string[]>([]);

    const {
        register,
        handleSubmit,
        setError,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ChangePasswordValues>({
        resolver: zodResolver(schema),
        defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    });

    async function onSubmit(values: ChangePasswordValues) {
        setFormError(null);
        setPolicyFailures([]);
        try {
            const { sessionsEnded } = await authService.changePassword({
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
            });

            reset();
            notify.success('Password changed', {
                description:
                    sessionsEnded > 0
                        ? `${sessionsEnded} other session${sessionsEnded === 1 ? ' was' : 's were'} signed out.`
                        : 'No other sessions were signed in.',
            });
            onChanged?.(sessionsEnded);
        } catch (error) {
            if (error instanceof ApiError) {
                /**
                 * Attaching this to a field is right here and **wrong on the login
                 * form**. The caller is already authenticated, so confirming that
                 * a password was wrong reveals nothing they do not already know —
                 * whereas on a login form the same precision would confirm an
                 * account exists.
                 */
                if (error.code === CODE_INVALID_CREDENTIALS) {
                    setError('currentPassword', { message: 'That is not your current password' });
                    return;
                }

                if (error.code === CODE_PASSWORD_WEAK) {
                    const failures = readPasswordPolicyFailures(error);
                    setPolicyFailures(failures.length > 0 ? failures : [...PASSWORD_POLICY_RULES]);
                    setError('newPassword', { message: 'This password does not meet the policy' });
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

                // This route sits behind the credential limiter despite being
                // authenticated — 10/min/IP, shared with login and refresh.
                if (error.code === CODE_RATE_LIMIT_EXCEEDED) {
                    setFormError(error);
                    return;
                }
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-sm space-y-4">
            <AuthFormError error={formError} context="auth" />

            <FormField
                id="currentPassword"
                label="Current password"
                error={errors.currentPassword?.message}
            >
                {(field) => (
                    <Input
                        type="password"
                        autoComplete="current-password"
                        {...field}
                        {...register('currentPassword')}
                    />
                )}
            </FormField>

            <FormField
                id="newPassword"
                label="New password"
                error={errors.newPassword?.message}
                hint={`At least ${PASSWORD_MIN_LENGTH} characters, and not a common password.`}
                /*
                  The server's `PASSWORD_WEAK` answer names *which* rules failed,
                  and that list is the actionable half — "does not meet the
                  policy" alone leaves the operator guessing. It is a second
                  described element rather than part of the message because it is
                  a list, and a list does not belong inside the `<p>` the message
                  renders as.
                */
                describedBy={policyFailures.length > 0 ? 'newPassword-policy' : undefined}
            >
                {(field) => (
                    <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                        {...register('newPassword')}
                    />
                )}
            </FormField>

            {policyFailures.length > 0 ? (
                <ul id="newPassword-policy" className="text-destructive space-y-0.5 text-xs">
                    {policyFailures.map((rule) => (
                        <li key={rule}>• {rule}</li>
                    ))}
                </ul>
            ) : null}

            <FormField
                id="confirmPassword"
                label="Repeat new password"
                error={errors.confirmPassword?.message}
            >
                {(field) => (
                    <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                        {...register('confirmPassword')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground text-xs">
                Changing your password signs out every other session. This one stays.
            </p>

            <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <InlineLoader label="Changing…" /> : 'Change password'}
            </Button>
        </form>
    );
}
