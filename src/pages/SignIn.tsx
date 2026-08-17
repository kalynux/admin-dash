import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { MfaChallengeForm } from '@/components/auth/MfaChallengeForm';
import { SignInForm } from '@/components/auth/SignInForm';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { resolveErrorMessage } from '@/lib/errors';
import { resolveReturnTo } from '@/lib/return-to';
import { useAuth } from '@/store';
import type { LoginOutcome } from '@/store';

/**
 * Credentials, then — when the account is enrolled — the second factor.
 *
 * Both steps live on one route rather than two. The challenge is short-lived,
 * single-use state that exists only between two calls; giving it a URL would let
 * somebody reload onto a screen whose only credential has gone, or bookmark a dead
 * end.
 */
type Step =
    | { kind: 'credentials' }
    | { kind: 'challenge'; challengeId: string; email: string; issuedAt: number };

export function SignIn() {
    const navigate = useNavigate();
    const location = useLocation();
    const { bootstrapError, retryBootstrap } = useAuth();
    const [step, setStep] = useState<Step>({ kind: 'credentials' });

    const goToDestination = useCallback(() => {
        // The guard stashed where they were heading. Consuming it is the whole
        // point of having captured it.
        navigate(resolveReturnTo(location.state), { replace: true });
    }, [navigate, location.state]);

    const handleOutcome = useCallback(
        (outcome: LoginOutcome, email: string) => {
            switch (outcome.kind) {
                case 'mfa-challenge':
                    setStep({
                        kind: 'challenge',
                        challengeId: outcome.challengeId,
                        email,
                        issuedAt: Date.now(),
                    });
                    return;

                case 'mfa-enrolment-required':
                    // Carry `from` forward: after activation on an ordinary
                    // session the wizard sends them where they were going.
                    navigate('/mfa-setup', { replace: true, state: location.state });
                    return;

                case 'authenticated':
                    goToDestination();
            }
        },
        [goToDestination, location.state, navigate],
    );

    if (step.kind === 'challenge') {
        return (
            <AuthLayout
                title="Two-factor authentication"
                description="Your password was accepted. One more step."
            >
                <MfaChallengeForm
                    challengeId={step.challengeId}
                    email={step.email}
                    issuedAt={step.issuedAt}
                    onVerified={goToDestination}
                    onRestart={() => setStep({ kind: 'credentials' })}
                />
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title={env.appName} description="Sign in to the administration console.">
            {/*
              A boot that failed for network reasons, rather than because nobody
              was signed in. Saying so beats presenting a form that is about to
              fail in exactly the same way — and in development it is usually the
              CORS allowlist or a backend that is not running.
            */}
            {bootstrapError ? (
                <div
                    role="alert"
                    className="border-warning/40 bg-warning/10 mb-4 space-y-2 rounded-lg border p-3 text-sm"
                >
                    <p className="font-medium">Could not reach the server</p>
                    <p className="text-muted-foreground text-xs">
                        {resolveErrorMessage(bootstrapError)}
                    </p>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void retryBootstrap()}
                    >
                        Try again
                    </Button>
                </div>
            ) : null}

            <SignInForm onOutcome={handleOutcome} />
        </AuthLayout>
    );
}
