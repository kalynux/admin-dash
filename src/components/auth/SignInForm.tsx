import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { useAuth } from '@/store';
import {
    ApiError,
    CODE_ACCOUNT_LOCKED,
    CODE_ACCOUNT_SUSPENDED,
    CODE_INVALID_CREDENTIALS,
    CODE_RATE_LIMIT_EXCEEDED,
} from '@/types/api.types';
import type { LoginOutcome } from '@/store';

/**
 * `.trim()` and `.toLowerCase()` pipe **before** the format check, not after: an
 * address pasted with a trailing space is a valid address the operator typed
 * correctly, and rejecting it on whitespace would be a puzzle rather than a
 * message. The service normalises the same way.
 *
 * The password rule is `min(1)` and nothing else — **no length floor, no strength
 * meter.** Strength is enforced where a password is *set*, never where one is
 * *checked*; a client-side floor here would tell somebody probing the form which
 * candidates are worth trying.
 */
const signInSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
    password: z.string().min(1, 'Enter your password'),
});

type SignInValues = z.infer<typeof signInSchema>;

const FORM_FIELDS = ['email', 'password'] as const;

/** Codes whose remedy is "wait" — the submit button stays down until they lapse. */
const BLOCKING_CODES = new Set<string>([CODE_ACCOUNT_LOCKED, CODE_RATE_LIMIT_EXCEEDED]);

interface SignInFormProps {
    /**
     * The normalised email is handed back with the outcome because the challenge
     * screen names the account being signed into, and by then this form is
     * unmounted. Reading it out of the response is not an option: the challenge
     * shape carries a `challengeId` and nothing else.
     */
    onOutcome: (outcome: LoginOutcome, email: string) => void;
}

export function SignInForm({ onOutcome }: SignInFormProps) {
    const { signIn } = useAuth();
    const [formError, setFormError] = useState<unknown>(null);
    const [showPassword, setShowPassword] = useState(false);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SignInValues>({
        resolver: zodResolver(signInSchema),
        defaultValues: { email: '', password: '' },
    });

    const isBlocked = formError instanceof ApiError && BLOCKING_CODES.has(formError.code);

    async function onSubmit(values: SignInValues) {
        setFormError(null);
        try {
            onOutcome(await signIn(values), values.email);
        } catch (error) {
            if (error instanceof ApiError) {
                // A 400 is the one case with somewhere better to go than the
                // banner: the server named a field, so point at it.
                const fieldErrors = pickFieldErrors(error, FORM_FIELDS);
                const named = Object.entries(fieldErrors);
                if (named.length > 0) {
                    for (const [field, message] of named) {
                        setError(field as (typeof FORM_FIELDS)[number], { message });
                    }
                    return;
                }

                // Everything the operator can act on stays on the form. Note that
                // `INVALID_CREDENTIALS` deliberately does NOT become a field
                // error — see AuthFormError.
                if (
                    error.code === CODE_INVALID_CREDENTIALS ||
                    error.code === CODE_ACCOUNT_SUSPENDED ||
                    BLOCKING_CODES.has(error.code)
                ) {
                    setFormError(error);
                    return;
                }
            }

            // A fault rather than an answer — the form stays usable and the toast
            // carries the reference id support will ask for.
            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} context="auth" />

            <FormField id="email" label="Email" error={errors.email?.message}>
                {(field) => (
                    <Input
                        type="email"
                        autoComplete="username"
                        autoFocus
                        spellCheck={false}
                        {...field}
                        {...register('email')}
                    />
                )}
            </FormField>

            <FormField id="password" label="Password" error={errors.password?.message}>
                {(field) => (
                    <div className="relative">
                        <Input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            className="pr-10"
                            {...field}
                            {...register('password')}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((shown) => !shown)}
                            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? (
                                <EyeOff className="size-4" aria-hidden />
                            ) : (
                                <Eye className="size-4" aria-hidden />
                            )}
                        </button>
                    </div>
                )}
            </FormField>

            <Button type="submit" className="w-full" disabled={isSubmitting || isBlocked}>
                {isSubmitting ? <InlineLoader label="Signing in…" /> : 'Sign in'}
            </Button>

            {/* There is no email delivery on this service and no forgot-password
                flow anywhere — saying so beats a link that goes nowhere. */}
            <p className="text-muted-foreground text-center text-xs">
                Lost your password? Another administrator has to reset it for you.
            </p>
        </form>
    );
}
