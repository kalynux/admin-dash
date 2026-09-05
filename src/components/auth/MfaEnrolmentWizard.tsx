import { useCallback, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, ShieldCheck, TriangleAlert } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { OtpField } from '@/components/auth/OtpField';
import { InlineLoader, PageLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import * as authService from '@/services/auth.service';
import {
    ApiError,
    CODE_ACCOUNT_LOCKED,
    CODE_MFA_ALREADY_ENROLLED,
    CODE_MFA_INVALID,
    CODE_MFA_NOT_ENROLLED,
} from '@/types/api.types';
import type { MfaEnrolmentOffer } from '@/types/auth.types';
import { useClipboard } from '@/hooks/use-clipboard';

type Step =
    | { kind: 'intro' }
    | { kind: 'issuing' }
    /** `offer` is null on the reload path, where the secret was already spent. */
    | { kind: 'scan'; offer: MfaEnrolmentOffer }
    | { kind: 'activate'; offer: MfaEnrolmentOffer | null };

interface MfaEnrolmentWizardProps {
    /** Fired when an **ordinary** session activated MFA and keeps its session. */
    onActivated: () => void;
    /**
     * Fired when a **scoped** session activated MFA. The server has already ended
     * it and cleared the cookies, so there is nothing left to sign out of.
     */
    onReauthenticationRequired: () => void;
    /** Rendered under the wizard — the sign-out escape hatch, when there is one. */
    footer?: React.ReactNode;
}

/**
 * TOTP enrolment: issue a secret, prove the authenticator holds it, activate.
 *
 * One component, two mounts — full-screen at `/mfa-setup` for a scoped session
 * that cannot go anywhere else, and inline on the security page for somebody
 * enrolling voluntarily. The only difference between them is what happens
 * afterwards, which is why both outcomes are props.
 */
export function MfaEnrolmentWizard({
    onActivated,
    onReauthenticationRequired,
    footer,
}: MfaEnrolmentWizardProps) {
    const [step, setStep] = useState<Step>({ kind: 'intro' });
    const [error, setError] = useState<unknown>(null);

    /**
     * Enrolment is not idempotent: the first call stages a secret, and every call
     * after it answers `409`. StrictMode double-invokes effects, and a
     * double-clicked button does the same thing — so the guard is a ref, not a
     * disabled attribute.
     */
    const issuing = useRef(false);

    const beginEnrolment = useCallback(async () => {
        if (issuing.current) return;
        issuing.current = true;
        setError(null);
        setStep({ kind: 'issuing' });

        try {
            setStep({ kind: 'scan', offer: await authService.enrolMfa() });
        } catch (caught) {
            if (caught instanceof ApiError && caught.code === CODE_MFA_ALREADY_ENROLLED) {
                /**
                 * **The reload path, and not a failure.** The secret is issued
                 * exactly once and cannot be reissued, so the only way forward is
                 * the code the administrator already scanned. Treating this as an
                 * error would strand them on a screen with no exit.
                 */
                setStep({ kind: 'activate', offer: null });
                return;
            }
            setError(caught);
            setStep({ kind: 'intro' });
        } finally {
            issuing.current = false;
        }
    }, []);

    const activate = useCallback(
        async (code: string) => {
            setError(null);
            try {
                const result = await authService.activateMfa(code);
                if (result?.reauthenticationRequired) {
                    onReauthenticationRequired();
                    return;
                }
                onActivated();
            } catch (caught) {
                if (caught instanceof ApiError) {
                    if (caught.code === CODE_MFA_NOT_ENROLLED) {
                        // Nothing staged — the secret expired or was cleared.
                        // Start over rather than looping on a code that cannot
                        // match anything.
                        setError(caught);
                        setStep({ kind: 'intro' });
                        return;
                    }
                    if (
                        caught.code === CODE_MFA_INVALID ||
                        caught.code === CODE_ACCOUNT_LOCKED ||
                        caught.isValidation
                    ) {
                        setError(caught);
                        return;
                    }
                }
                notify.apiError(caught);
            }
        },
        [onActivated, onReauthenticationRequired],
    );

    if (step.kind === 'issuing') return <PageLoader label="Preparing your authenticator…" />;

    if (step.kind === 'intro') {
        return (
            <div className="space-y-4">
                <AuthFormError error={error} context="auth" />
                <div className="flex gap-3">
                    <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                    <p className="text-muted-foreground text-sm">
                        Your access level requires two-factor authentication. You will scan a code
                        into an authenticator app, then confirm it once.
                    </p>
                </div>
                <Button type="button" className="w-full" onClick={() => void beginEnrolment()}>
                    Set up two-factor authentication
                </Button>
                {footer}
            </div>
        );
    }

    if (step.kind === 'scan') {
        return (
            <ScanStep
                offer={step.offer}
                onContinue={() => setStep({ kind: 'activate', offer: step.offer })}
                footer={footer}
            />
        );
    }

    return (
        <ActivateStep
            offer={step.offer}
            error={error}
            onSubmit={activate}
            onBack={step.offer ? () => setStep({ kind: 'scan', offer: step.offer! }) : undefined}
            footer={footer}
        />
    );
}

function ScanStep({
    offer,
    onContinue,
    footer,
}: {
    offer: MfaEnrolmentOffer;
    onContinue: () => void;
    footer?: React.ReactNode;
}) {
    /*
     * ── ⚠ Why this is not `<CopyableValue variant="plain">` ───────────────────
     * The A2 sweep folded the dashboard's value renders onto that primitive and
     * stopped here, for the reason spelled out on `OneTimePasswordPanel`: the
     * primitive is *"an enhancement, never the only route"* — a ghost icon
     * beside a value — and on this screen copying the key **is** the route. The
     * secret is returned exactly once, and an administrator who continues
     * without it needs another administrator to clear the enrolment. That wants
     * a real control, not an inline icon.
     *
     * What the primitive standardises is here anyway: the shared `useClipboard`,
     * and a value that stays rendered and selectable whatever the clipboard did.
     */
    const { copy, copied } = useClipboard({ resetAfterMs: 2000 });

    async function copySecret() {
        // A denied clipboard permission is not worth an error state — the secret
        // is on screen and can be typed.
        //
        // ⚠ **The secret itself must NOT go in the toast**, and this used to put
        // it there. `OneTimePasswordPanel` states the rule for its own sibling
        // value in as many words — *"never in a toast — a toast outlives the
        // screen that fired it and lands in a corner of every subsequent page"* —
        // and a TOTP secret is the stronger case of the two: it is returned by
        // `/auth/mfa/enroll` exactly once and it is a standing credential, not a
        // password that will be changed on first use. A toast carrying it
        // survives the wizard unmounting and follows the operator onto whatever
        // they navigate to next, in a corner nobody is guarding.
        //
        // The toast stays, because a silently failed copy reads as a broken
        // button. What it carries is the *instruction*; the secret stays where
        // it already is — on screen, selectable, beside the QR code.
        if (!(await copy(offer.secret))) {
            notify.info('Copy the secret manually', {
                description: 'Select it below and copy it by hand — this browser refused the copy.',
            });
        }
    }

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
                Scan this with Google Authenticator, 1Password, Authy or any TOTP app.
            </p>

            {/* White plate regardless of theme: a QR code inverted by a dark
                background will not scan on many readers. */}
            <div className="flex justify-center">
                <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={offer.otpauthUri} size={176} marginSize={0} />
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                    Cannot scan? Enter this key by hand:
                </p>
                <div className="flex items-center gap-2">
                    {/*
                      `select-all` so one click takes the whole key. It is the
                      property `CopyableValue` gives every other value on the
                      dashboard and the one this block was missing:
                      `navigator.clipboard` is absent on any non-secure origin,
                      and a double-click on a base32 key stops at nothing useful.
                      `OneTimePasswordPanel` already reads this way.
                    */}
                    <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-sm break-all select-all">
                        {offer.secret}
                    </code>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => void copySecret()}
                        aria-label="Copy the setup key"
                    >
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </Button>
                </div>
            </div>

            {/* The plaintext secret is returned exactly once. If it is lost before
                an authenticator holds it, only another administrator can clear the
                enrolment — so this warning is load-bearing, not decoration. */}
            <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="text-xs">
                    This key is shown <span className="font-medium">once</span>. Make sure your
                    authenticator has it before continuing — it cannot be shown again, and recovering
                    from a lost secret needs another administrator.
                </p>
            </div>

            <Button type="button" className="w-full" onClick={onContinue}>
                I have saved it — continue
            </Button>
            {footer}
        </div>
    );
}

function ActivateStep({
    offer,
    error,
    onSubmit,
    onBack,
    footer,
}: {
    offer: MfaEnrolmentOffer | null;
    error: unknown;
    onSubmit: (code: string) => Promise<void>;
    onBack?: () => void;
    footer?: React.ReactNode;
}) {
    const [code, setCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isLocked = error instanceof ApiError && error.code === CODE_ACCOUNT_LOCKED;

    const submit = useCallback(
        async (value: string) => {
            if (isSubmitting) return;
            setIsSubmitting(true);
            try {
                await onSubmit(value);
            } finally {
                setIsSubmitting(false);
                setCode('');
            }
        },
        [isSubmitting, onSubmit],
    );

    return (
        <div className="space-y-4">
            <AuthFormError error={error} context="auth" />

            <p className="text-muted-foreground text-sm">
                {offer
                    ? 'Enter the six digits your authenticator is showing now.'
                    : 'A key was already issued for this account. Enter the six digits from the authenticator you set up.'}
            </p>

            <OtpField
                value={code}
                onChange={setCode}
                onComplete={submit}
                disabled={isSubmitting || isLocked}
            />

            <p className="text-muted-foreground text-center text-xs">
                Wrong codes count toward the account lockout.
            </p>

            <Button
                type="button"
                className="w-full"
                disabled={code.length !== 6 || isSubmitting || isLocked}
                onClick={() => void submit(code)}
            >
                {isSubmitting ? <InlineLoader label="Activating…" /> : 'Activate'}
            </Button>

            {onBack ? (
                <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
                    Back to the code
                </Button>
            ) : null}

            {footer}
        </div>
    );
}
