import { useCallback, useEffect, useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { OtpField } from '@/components/auth/OtpField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { useAuth } from '@/store';
import {
    ApiError,
    CODE_ACCOUNT_LOCKED,
    CODE_ACCOUNT_SUSPENDED,
    CODE_MFA_INVALID,
    CODE_RATE_LIMIT_EXCEEDED,
} from '@/types/api.types';

/** The challenge lives five minutes. The response does not say from when, so we count from arrival. */
const CHALLENGE_TTL_MS = 300_000;

interface MfaChallengeFormProps {
    challengeId: string;
    email: string;
    /** Issued when the challenge arrived, so the countdown is honest about elapsed time. */
    issuedAt: number;
    onVerified: () => void;
    onRestart: () => void;
}

export function MfaChallengeForm({
    challengeId,
    email,
    issuedAt,
    onVerified,
    onRestart,
}: MfaChallengeFormProps) {
    const { completeMfaChallenge } = useAuth();
    const [code, setCode] = useState('');
    const [formError, setFormError] = useState<unknown>(null);
    const [attempts, setAttempts] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(issuedAt));

    /**
     * A local countdown, and **advisory only** — the server is the judge of when a
     * challenge has expired, and the response carries no `expiresAt` to sync
     * against. It exists so somebody who walked away sees why their code will not
     * work, rather than reading it as a broken authenticator.
     */
    useEffect(() => {
        const timer = setInterval(() => setSecondsLeft(remainingSeconds(issuedAt)), 1000);
        return () => clearInterval(timer);
    }, [issuedAt]);

    const expired = secondsLeft <= 0;
    const isLocked = formError instanceof ApiError && formError.code === CODE_ACCOUNT_LOCKED;

    const submit = useCallback(
        async (value: string) => {
            if (isSubmitting) return;
            setIsSubmitting(true);
            setFormError(null);
            try {
                await completeMfaChallenge({ challengeId, code: value });
                onVerified();
            } catch (error) {
                if (error instanceof ApiError) {
                    if (
                        error.code === CODE_MFA_INVALID ||
                        error.code === CODE_ACCOUNT_LOCKED ||
                        error.code === CODE_ACCOUNT_SUSPENDED ||
                        error.code === CODE_RATE_LIMIT_EXCEEDED ||
                        error.isValidation
                    ) {
                        setFormError(error);
                        setAttempts((n) => n + 1);
                        // Clear the field, but **keep the same challengeId**: a
                        // wrong code does not consume the challenge server-side,
                        // so sending somebody back to the password step would
                        // cost them a login they had already half-completed.
                        setCode('');
                        return;
                    }
                }
                notify.apiError(error);
            } finally {
                setIsSubmitting(false);
            }
        },
        [challengeId, completeMfaChallenge, isSubmitting, onVerified],
    );

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} context="auth" />

            {expired ? (
                <div
                    role="status"
                    className="border-border bg-muted/50 text-muted-foreground mb-4 rounded-lg border p-3 text-sm"
                >
                    This challenge has probably expired — they last about five minutes. Sign in again
                    to get a new one.
                </div>
            ) : null}

            <p className="text-muted-foreground text-sm">
                Enter the six-digit code from the authenticator app for{' '}
                <span className="text-foreground font-medium">{email}</span>.
            </p>

            <OtpField
                value={code}
                onChange={setCode}
                onComplete={submit}
                disabled={isSubmitting || isLocked || expired}
            />

            {/*
              Attempts against this endpoint count toward the account lockout —
              five failures locks the account for fifteen minutes. `auth.md` claims
              that only applies to activation; the service counts them here too.
              Worth saying before somebody guesses their way into a lockout.
            */}
            {attempts >= 2 && !isLocked ? (
                <p className="text-muted-foreground text-center text-xs">
                    Failed codes count toward the account lockout. Check that your device's clock is
                    correct before trying again.
                </p>
            ) : null}

            <Button
                type="button"
                className="w-full"
                disabled={code.length !== 6 || isSubmitting || isLocked || expired}
                onClick={() => void submit(code)}
            >
                {isSubmitting ? <InlineLoader label="Verifying…" /> : 'Verify'}
            </Button>

            <Button type="button" variant="ghost" className="w-full" onClick={onRestart}>
                Use a different account
            </Button>

            {!expired && secondsLeft <= 60 ? (
                <p className="text-muted-foreground text-center text-xs">
                    This challenge expires in about {secondsLeft}s.
                </p>
            ) : null}
        </div>
    );
}

function remainingSeconds(issuedAt: number): number {
    return Math.max(0, Math.ceil((issuedAt + CHALLENGE_TTL_MS - Date.now()) / 1000));
}
