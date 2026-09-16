import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, MessageCircleWarning, Phone, ShieldAlert } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import {
    CODE_PHONE_VERIFICATION_MISMATCH,
    PLATFORM_CODE_DELIVERY_FAILED,
    PLATFORM_CODE_RESEND_TOO_SOON,
    PLATFORM_CODE_TOO_MANY_ATTEMPTS,
    attemptsLeftOf,
    confirmSchema,
    setPhoneSchema,
} from '@/components/auth/phone-contract';
import type { ConfirmValues, SetPhoneValues } from '@/components/auth/phone-contract';
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
import { formatRelative } from '@/lib/format';
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
 * ── ✅ The send works, since 2026-09-15 — build the ordinary flow ─────────────
 * This block said the opposite for a day, and the correction is worth keeping.
 * WhatsApp permits a free-form message only inside Meta's 24-hour service window,
 * which opens when the *person* messages the platform; outside it an approved
 * AUTHENTICATION template is required, and this deployment had **none approved**
 * (measured 2026-09-14). An administrator who had never messaged the platform was
 * therefore always outside the window, and every send answered
 * `PHONE_VERIFICATION_DELIVERY_FAILED`. Two faults closed within a day of each
 * other: the WABA's owning business reached `verified`, so Meta approved
 * `wi_mall_phone_verification` in `en` and `fr`, and the 24-hour window is now
 * recorded on every inbound message rather than never. **No code changed on
 * either side** — the send path had always tried the template first.
 *
 * ⚠ **So a delivery failure is the edge case it reads as, and the notice below
 * must not say otherwise.** Telling somebody their own silence caused it sends
 * them chasing a remedy they do not need. The in-window trick survives as a
 * *fallback* in {@link DeliveryFailedNotice}, not as the primary path.
 *
 * ── ⚠ Why this card never renders during onboarding ──────────────────────────
 * None of the three routes is on `ONBOARDING_ROUTE_ALLOWLIST`, so a `pending`
 * administrator gets `403 ADMIN_ACTIVATION_REQUIRED` on all three — **and that is
 * correct rather than an oversight: a verified phone is not part of activation.**
 * Readiness wants *a phone number on the employee record* (gap code
 * `phone_missing`) and never consults `phone_verified`.
 *
 * Nothing here enforces that, and nothing should: `AccountSecurity` sits inside
 * `RequireActivated`, which sends a pending session to `/onboarding` before this
 * component can mount. The structure is the guard — an `if (admin.status ===
 * 'pending')` here would be a second rule that can disagree with the first.
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

            /*
              ⚠ Two refusals leave **no code in flight**, so the form they were
              typed into cannot succeed and must not stay in front of them:
              `ADMIN_PHONE_VERIFICATION_MISMATCH` (the number changed under the
              code — wi-admin writes nothing) and `TOO_MANY_ATTEMPTS` (jovi-mall
              destroyed it). Dropping `sent` puts the **Send code** button back,
              which is the remedy in both cases. Every other refusal leaves the
              code alive and the form is still the right thing to show.
            */
            if (
                caught instanceof ApiError &&
                (caught.code === CODE_PHONE_VERIFICATION_MISMATCH ||
                    caught.platformCode === PLATFORM_CODE_TOO_MANY_ATTEMPTS)
            ) {
                setSent(null);
            }
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
      ✅ **The day arrived.** This branch used to state BOTH remedies at once,
      because a 429 was indistinguishable: wi-admin's `rate_limit` allowlist was
      `retryAfterSeconds`/`limit`/`windowSeconds` and dropped `platformCode`, so
      `RESEND_TOO_SOON` (wait — the code still lives) and `TOO_MANY_ATTEMPTS`
      (the code is destroyed, send another) arrived identical, with `rate_limit`
      not message-bearing either. BR-025 § 2 put `platformcode` on that allowlist
      on 2026-09-15, so the two are finally separable and each gets its own
      sentence.

      ⚠ **The unnamed arm stays, and it is not dead code.** wi-admin applies its
      own per-identity ceiling on these routes, which is a plain
      `RATE_LIMIT_EXCEEDED` and carries no platform code at all — a different
      fact from either of jovi-mall's, with "wait" as its only honest remedy. A
      *delegated* 429 with no code should no longer happen; if one does, the
      both-remedies floor is still the only truthful thing to say, so it is kept
      for that case rather than assumed away.
    */
    const platformCode = error instanceof ApiError ? error.platformCode : undefined;
    const cooldown = platformCode === PLATFORM_CODE_RESEND_TOO_SOON;
    const codeDestroyed = platformCode === PLATFORM_CODE_TOO_MANY_ATTEMPTS;
    const rateLimited = error instanceof ApiError && error.isRateLimit;
    /** wi-admin's own ceiling — ours, not the platform's, so "wait" is the whole story. */
    const ourCeiling = rateLimited && !(error as ApiError).isPlatformRejection;
    const attemptsLeft = attemptsLeftOf(error);

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
                    {/*
                      ⚠ The expiry is read from `expiresAt`, never from the
                      WhatsApp message. Meta writes and localises that body
                      itself, and its *"Expires in 10 minutes"* footer is frozen
                      inside the approved template — lower `PHONE_VERIFY_TTL_SECONDS`
                      and the message keeps saying ten. `auth.md` says outright
                      not to build a countdown from the template text.
                    */}
                    <DialogDescription>
                        {sent
                            ? `We sent a six-digit code to ${sent.phoneMasked} on WhatsApp${
                                  formatRelative(sent.expiresAt)
                                      ? `. It expires ${formatRelative(sent.expiresAt)}.`
                                      : '.'
                              }`
                            : 'We will send a six-digit code to the number on your account, over WhatsApp.'}
                    </DialogDescription>
                </DialogHeader>

                {deliveryFailed ? <DeliveryFailedNotice /> : null}
                {!deliveryFailed && rateLimited ? (
                    <RateLimitedNotice
                        kind={
                            cooldown
                                ? 'cooldown'
                                : codeDestroyed
                                  ? 'spent'
                                  : ourCeiling
                                    ? 'ours'
                                    : 'unknown'
                        }
                        retryAfterSeconds={(error as ApiError).retryAfterSeconds}
                    />
                ) : null}
                {!deliveryFailed && !rateLimited ? (
                    <AuthFormError error={error} />
                ) : null}
                {/*
                  ⚠ Beside the catalogued sentence, never instead of it. "That
                  code is not right" is the remedy; the counter is the thing the
                  operator cannot work out for themselves, and it only exists on
                  this one verdict.
                */}
                {attemptsLeft !== undefined ? (
                    <p className="text-muted-foreground -mt-2 text-xs">
                        {attemptsLeft === 0
                            ? 'That was the last try on this code — send a new one.'
                            : `${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left on this code.`}
                    </p>
                ) : null}

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
 * ⚠ **Retuned on 2026-09-15, and the direction matters.** It used to lead with
 * *"WhatsApp only lets us message you freely for 24 hours after you message
 * us"*, because at the time that was the cause of every failure on this
 * deployment — there was no approved template, so nobody outside the window
 * could be reached. There is one now, so a failure here is genuinely unusual,
 * and leading with the window would tell an operator their own silence caused
 * something it did not.
 *
 * So: a retry first, the in-window trick second and explicitly as a fallback,
 * and the account reassurance kept — a person who cannot prove a number should
 * not be left wondering whether they are locked out of anything.
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
                    This is unusual — nothing is wrong with your number. Try again in a moment.
                </p>
                <p className="text-destructive/85 text-xs">
                    If it keeps failing: send any WhatsApp message to the platform&rsquo;s business
                    number from this phone, then press Verify again within the day. That opens a
                    direct channel and the code arrives as an ordinary message.
                </p>
                <p className="text-destructive/85 text-xs">
                    Your account is unaffected either way — a verified number is a contact detail,
                    not a sign-in requirement.
                </p>
            </div>
        </div>
    );
}

/**
 * The four ways a 429 can land here, which are **not** one fact.
 *
 * ⚠ **`cooldown` and `spent` are opposite remedies**, and telling somebody the
 * wrong one is not symmetric: *wait* in front of a destroyed code leaves them at
 * a form that cannot succeed, however long they wait. They arrived
 * indistinguishable until BR-025 § 2 put `platformCode` on the `rate_limit`
 * allowlist (2026-09-15); before that this notice had to state both.
 *
 * `ours` is wi-admin's own per-identity ceiling — not a verdict on the code at
 * all, so it says nothing about one. `unknown` is the floor kept for a delegated
 * 429 that somehow carries no code: both remedies, because that is all that can
 * honestly be said.
 */
function RateLimitedNotice({
    kind,
    retryAfterSeconds,
}: {
    kind: 'cooldown' | 'spent' | 'ours' | 'unknown';
    retryAfterSeconds?: number;
}) {
    const wait = retryAfterSeconds === undefined ? '' : ` — try again in ${retryAfterSeconds}s`;

    const title =
        kind === 'cooldown'
            ? `A code was just sent${wait}`
            : kind === 'spent'
              ? 'That code has been destroyed'
              : `Too many requests${wait}`;

    const body =
        kind === 'cooldown' ? (
            <>
                The code already in your message still works — type it in rather than asking for
                another.
            </>
        ) : kind === 'spent' ? (
            <>Too many wrong codes were entered. Send a new one and use that.</>
        ) : kind === 'ours' ? (
            <>You have made a lot of requests in a short time. Wait a moment and try again.</>
        ) : (
            <>
                If you just asked for a code, wait a moment and ask again. If you typed several
                wrong ones, that code has been destroyed — send a new one.
            </>
        );

    return (
        <div
            role="alert"
            className="border-warning/40 bg-warning/10 mb-4 flex gap-2.5 rounded-lg border p-3 text-sm"
        >
            <MessageCircleWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-1.5">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground text-xs">{body}</p>
            </div>
        </div>
    );
}
