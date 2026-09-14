import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, MessageCircleWarning, Phone, ShieldAlert } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import * as authService from '@/services/auth.service';
import { ApiError } from '@/types/api.types';
import type { AdminProfile, PhoneCodeSent } from '@/types/auth.types';

/**
 * The administrator's own contact number, and proving it over WhatsApp.
 *
 * ── Why this is not part of "Edit your profile" ───────────────────────────────
 * The number has its own route (`PATCH /auth/me/phone`) and its own record.
 * `PATCH /administrators/me` — what that dialog posts — neither accepts `phone`
 * nor returns it, so putting the field there would send a key the schema drops
 * in silence. Two writes, two places.
 *
 * ── ⚠ This is a CONTACT detail, not a second factor ───────────────────────────
 * Nothing in wi-admin's auth path reads `phone` or `phoneVerified`, and this card
 * must not imply otherwise — an administrator who reads "verify your phone" as
 * "secure your account" will believe they have hardened a login that has not
 * changed. Two-factor is the card above this one, and it is the stronger proof.
 *
 * ── ⚠ The send fails for most administrators today, and that is not a bug ─────
 * WhatsApp permits a free-form message only inside Meta's 24-hour service window,
 * which opens when the *person* messages the platform. Outside it an approved
 * AUTHENTICATION template is required and this deployment has none approved
 * (measured 2026-09-14). An administrator who has never messaged the platform is
 * therefore always outside the window, and the send answers
 * `PHONE_VERIFICATION_DELIVERY_FAILED`.
 *
 * So the button ships enabled and the explanation is attached to the failure
 * rather than standing in front of every operator: it is a real remedy the person
 * can act on — message the platform, then retry — and it costs nothing to the
 * ones for whom the send simply works. It also self-heals the day a template is
 * approved, with no change here.
 */
export function PhoneNumberCard({
    admin,
    /** Refetches `/auth/me`. Both writes change a field the store holds. */
    onChanged,
}: {
    admin: AdminProfile;
    onChanged: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [verifying, setVerifying] = useState(false);

    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Phone className="text-muted-foreground size-4" aria-hidden />
                        Phone number
                    </CardTitle>
                    <CardDescription>
                        How the platform reaches you. It is a contact detail, not a sign-in step —
                        your second factor is the authenticator above, and this changes nothing
                        about how you sign in.
                    </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    {admin.phone ? 'Change' : 'Add a number'}
                </Button>
            </CardHeader>

            <CardContent className="space-y-4">
                {admin.phone ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <CopyableValue
                            variant="phone"
                            value={admin.phone}
                            label="your phone number"
                        />
                        {admin.phoneVerified ? (
                            <Badge variant="outline" className="text-success border-success/40">
                                <CheckCircle2 className="size-3.5" aria-hidden />
                                Verified
                            </Badge>
                        ) : (
                            <Badge variant="secondary">
                                <ShieldAlert className="size-3.5" aria-hidden />
                                Not verified
                            </Badge>
                        )}
                    </div>
                ) : (
                    <p className="text-muted-foreground text-sm">No number saved.</p>
                )}

                {admin.phone && !admin.phoneVerified ? (
                    <div className="space-y-2">
                        <p className="text-muted-foreground text-sm">
                            Verifying sends a six-digit code to this number on WhatsApp and proves
                            you can be reached there.
                        </p>
                        <Button size="sm" onClick={() => setVerifying(true)}>
                            Verify this number
                        </Button>
                    </div>
                ) : null}
            </CardContent>

            <SetPhoneDialog
                open={editing}
                onOpenChange={setEditing}
                current={admin.phone}
                wasVerified={admin.phoneVerified}
                onSaved={onChanged}
            />

            <VerifyPhoneDialog open={verifying} onOpenChange={setVerifying} onVerified={onChanged} />
        </Card>
    );
}

// ─── Saving the number ────────────────────────────────────────────────────────

/**
 * Length only, 6–20, matching `SetAdminPhoneSchema`.
 *
 * **No format rule**, the same division `EditIdentifiersDialog` draws and for the
 * same reason: jovi-mall owns E.164 and judges it when the code is sent. A second
 * definition here would drift silently in the worst direction — a number accepted
 * at this door that no send can ever reach.
 */
const setPhoneSchema = z.object({
    phone: z
        .string()
        .trim()
        .min(6, 'Use at least 6 characters')
        .max(20, 'Use at most 20 characters'),
});

type SetPhoneValues = z.infer<typeof setPhoneSchema>;

function SetPhoneDialog({
    open,
    onOpenChange,
    current,
    wasVerified,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    current: string | null;
    wasVerified: boolean;
    onSaved: () => void;
}) {
    const [error, setError] = useState<unknown>(null);
    const form = useForm<SetPhoneValues>({
        resolver: zodResolver(setPhoneSchema),
        defaultValues: { phone: current ?? '' },
    });

    const submit = form.handleSubmit(async ({ phone }) => {
        setError(null);
        try {
            await authService.setPhone(phone);
            notify.success('Phone number saved');
            onSaved();
            onOpenChange(false);
        } catch (caught) {
            setError(caught);
        }
    });

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setError(null);
                    form.reset({ phone: current ?? '' });
                }
                onOpenChange(next);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{current ? 'Change your number' : 'Add a number'}</DialogTitle>
                    <DialogDescription>
                        Include the country code, for example +237600123456.
                    </DialogDescription>
                </DialogHeader>

                <AuthFormError error={error} />

                {/*
                  ⚠ Said before the field, not after saving. The service clears
                  `phone_verified` unconditionally — including when the number is
                  unchanged — and by the time the response arrives there is
                  nothing to undo.
                */}
                {wasVerified ? (
                    <p className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-xs">
                        This number is verified today. Saving marks it unverified again, even if you
                        save the same number, and you will need a new code.
                    </p>
                ) : null}

                <form onSubmit={submit} className="space-y-4">
                    <FormField
                        id="account-phone"
                        label="Phone number"
                        error={form.formState.errors.phone?.message}
                    >
                        {(field) => (
                            <Input
                                {...field}
                                {...form.register('phone')}
                                type="tel"
                                autoComplete="tel"
                                placeholder="+237600123456"
                            />
                        )}
                    </FormField>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={form.formState.isSubmitting}
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Proving it ───────────────────────────────────────────────────────────────

const confirmSchema = z.object({
    code: z
        .string()
        .trim()
        .min(4, 'Enter the code from the message')
        .max(12, 'Use at most 12 characters'),
});

type ConfirmValues = z.infer<typeof confirmSchema>;

/** The delegated refusal that is the ordinary case on this deployment. */
export const PLATFORM_CODE_DELIVERY_FAILED = 'PHONE_VERIFICATION_DELIVERY_FAILED';

/**
 * Proving the number.
 *
 * ── The send is a click, never an open ────────────────────────────────────────
 * Opening this dialog sends nothing. A send puts a real WhatsApp message in front
 * of a real person and starts a 60-second account-scoped cooldown, so a misclick
 * would cost both — and on this deployment it would also greet most operators
 * with an error banner for a dialog they had only just opened.
 *
 * ── There is no probe for "is a code already in flight" ───────────────────────
 * wi-admin publishes no equivalent of jovi-mall's `GET /me/phone/verify`, so
 * `expiresAt` lives in component state and is lost on a reload. The remedy is the
 * one the operator would reach for anyway — send another — and the cooldown
 * refusal that may follow carries the wait in its own sentence.
 */
function VerifyPhoneDialog({
    open,
    onOpenChange,
    onVerified,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onVerified: () => void;
}) {
    const [sent, setSent] = useState<PhoneCodeSent | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const form = useForm<ConfirmValues>({
        resolver: zodResolver(confirmSchema),
        defaultValues: { code: '' },
    });

    const reset = useCallback(() => {
        setSent(null);
        setIsSending(false);
        setError(null);
        form.reset({ code: '' });
    }, [form]);

    const send = useCallback(async () => {
        setIsSending(true);
        setError(null);
        try {
            setSent(await authService.requestPhoneCode());
        } catch (caught) {
            setError(caught);
        } finally {
            setIsSending(false);
        }
    }, []);

    const submit = form.handleSubmit(async ({ code }) => {
        setError(null);
        try {
            await authService.confirmPhoneCode(code);
            notify.success('Your phone number is verified');
            onVerified();
            onOpenChange(false);
        } catch (caught) {
            setError(caught);
            form.reset({ code: '' });
        }
    });

    /*
      ⚠ Read off `details.platformCode`, NOT off `isPlatformRejection`. A failed
      send is a 502 `SERVICE_DEPENDENCY_UNAVAILABLE` — wi-admin remaps every
      delegated 5xx — so the usual predicate is false here while the code is
      present. The 5xx branch of `projectDetails` keeps `platformCode` for exactly
      this, and the *message* is replaced with a registry default, which is why
      the explanation below is ours rather than the server's.
    */
    const deliveryFailed =
        error instanceof ApiError && error.platformCode === PLATFORM_CODE_DELIVERY_FAILED;

    /*
      ⚠ A 429 here is ONE of two refusals and we cannot tell which. wi-admin's
      `rate_limit` branch allowlists `retryAfterSeconds`/`limit`/`windowSeconds`
      and drops `platformCode`, so `RESEND_TOO_SOON` (wait, the code still lives)
      and `TOO_MANY_ATTEMPTS` (the code is destroyed, send another) arrive
      identical. `rate_limit` is not message-bearing either, so jovi-mall's own
      sentence is dropped and the generic resolver lands on "The platform refused
      this" — the floor, with no remedy in it.

      So the notice states BOTH remedies rather than guessing one. Guessing wrong
      is not symmetric: telling somebody to wait when their code is already
      destroyed leaves them staring at a dead form. BR-025 asks for the code, and
      this branch collapses to a single sentence the day it arrives.
    */
    const rateLimited = error instanceof ApiError && error.isRateLimit;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) reset();
                onOpenChange(next);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Verify your phone number</DialogTitle>
                    <DialogDescription>
                        {sent
                            ? `We sent a six-digit code to ${sent.phoneMasked} on WhatsApp. It is good for about ten minutes.`
                            : 'We will send a six-digit code to the number on your account, over WhatsApp.'}
                    </DialogDescription>
                </DialogHeader>

                {deliveryFailed ? <DeliveryFailedNotice /> : null}
                {!deliveryFailed && rateLimited ? (
                    <RateLimitedNotice
                        retryAfterSeconds={(error as ApiError).retryAfterSeconds}
                    />
                ) : null}
                {!deliveryFailed && !rateLimited ? <AuthFormError error={error} /> : null}

                {sent ? (
                    <form onSubmit={submit} className="space-y-4">
                        <FormField
                            id="account-phone-code"
                            label="Code"
                            hint="Six digits, from the WhatsApp message."
                            error={form.formState.errors.code?.message}
                        >
                            {(field) => (
                                <Input
                                    {...field}
                                    {...form.register('code')}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="123456"
                                />
                            )}
                        </FormField>

                        <DialogFooter className="sm:justify-between">
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={isSending || form.formState.isSubmitting}
                                onClick={() => void send()}
                            >
                                {isSending ? <InlineLoader /> : null}
                                Send another
                            </Button>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? <InlineLoader /> : null}
                                Verify
                            </Button>
                        </DialogFooter>
                    </form>
                ) : (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={isSending}
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="button" disabled={isSending} onClick={() => void send()}>
                            {isSending ? <InlineLoader /> : null}
                            Send code
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

/**
 * What to do when WhatsApp refused the send.
 *
 * Written as a remedy rather than a fault, because it usually is one: the window
 * is opened by the person, not by us. It deliberately does not name the missing
 * template — that is our deployment's problem, not something an administrator can
 * act on — but it does say the send may be impossible today, so nobody retries in
 * a loop believing they mistyped something.
 */
function DeliveryFailedNotice() {
    return (
        <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mb-4 flex gap-2.5 rounded-lg border p-3 text-sm"
        >
            <MessageCircleWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-1.5">
                <p className="font-medium">WhatsApp would not deliver the code</p>
                <p className="text-destructive/85 text-xs">
                    WhatsApp only lets us message you freely for 24 hours after you message us. Send
                    anything to the platform&rsquo;s WhatsApp number from this phone, then come back
                    and try again.
                </p>
                <p className="text-destructive/85 text-xs">
                    If that does not help, the code cannot be sent on this deployment yet. Nothing
                    is wrong with your number, and your account is unaffected — a verified number is
                    a contact detail, not a sign-in requirement.
                </p>
            </div>
        </div>
    );
}

/**
 * The cooldown and the spent attempt limit, which arrive indistinguishable.
 *
 * Both remedies are given because the client cannot choose between them — see
 * the branch that renders this. `retryAfterSeconds` is the one field that does
 * survive, so the wait is named whenever the service sent it.
 */
function RateLimitedNotice({ retryAfterSeconds }: { retryAfterSeconds?: number }) {
    return (
        <div
            role="alert"
            className="border-warning/40 bg-warning/10 mb-4 flex gap-2.5 rounded-lg border p-3 text-sm"
        >
            <MessageCircleWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-1.5">
                <p className="font-medium">
                    {retryAfterSeconds === undefined
                        ? 'Too many attempts'
                        : `Too many attempts — try again in ${retryAfterSeconds}s`}
                </p>
                <p className="text-muted-foreground text-xs">
                    If you just asked for a code, wait a moment and ask again. If you typed several
                    wrong ones, that code has been destroyed — send a new one.
                </p>
            </div>
        </div>
    );
}
