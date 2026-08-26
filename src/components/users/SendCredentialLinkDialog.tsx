import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_CHANNEL_UNAVAILABLE,
    PLATFORM_CODE_CREDENTIAL_LINK_THROTTLED,
    PLATFORM_CODE_LOGIN_LINK_ROLE_UNSUPPORTED,
    PLATFORM_CODE_MESSAGING_DELIVERY_FAILED,
    PLATFORM_CODE_PARTY_ACCOUNT_SUSPENDED,
    sendLoginLink,
    sendPasswordResetLink,
} from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import {
    CREDENTIAL_CHANNELS,
    CREDENTIAL_CHANNEL_LABELS,
    userDisplayName,
    type CredentialChannel,
    type UserDetail,
} from '@/types/users.types';

const REASON_MIN = 3;
const REASON_MAX = 500;

/**
 * `channel` is pinned rather than open, matching wi-admin's schema — an
 * unrecognised value is a `400`, never a silent fallback to email.
 */
const schema = z.object({
    channel: z.enum(CREDENTIAL_CHANNELS),
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'Say why you are sending this — it is recorded')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['channel', 'reason'] as const;

/** Which of the two credentials this dialog sends. */
export type CredentialLinkKind = 'password-reset' | 'login';

const COPY: Record<
    CredentialLinkKind,
    { title: string; blurb: string; submit: string; lifetime: string }
> = {
    'password-reset': {
        title: 'Send a password-reset link',
        blurb:
            'They choose a new password, and doing so signs them out of every device. Until they do, nothing has changed on the account.',
        submit: 'Send reset link',
        lifetime: 'The link lasts 30 minutes and can be used once.',
    },
    login: {
        title: 'Send a sign-in link',
        blurb:
            'Whoever opens the message is signed in as this customer. Send it only to the person themselves, and only when you have confirmed who you are talking to.',
        submit: 'Send sign-in link',
        lifetime: 'The link and its 8-character code last 10 minutes, and using either kills the other.',
    },
};

/**
 * `POST /users/:userId/password-reset-link` · `users.password.reset`
 * `POST /users/:userId/login-link` · `users.login_link.send`
 *
 * One dialog for both because the body is identical (`channel` + `reason`) and
 * so is every failure. What differs is the **copy**, and the difference matters
 * enough to be spelled out rather than parameterised away: a reset link grants
 * nothing until the person chooses a password, and a sign-in link *is* a
 * session.
 *
 * ── There is no destination field, deliberately ───────────────────────────────
 * The address is read from the party's own record and is never accepted from the
 * caller. An operator who could type an address could mail a working credential
 * for somebody else's account to themselves, and no permission short of
 * withholding the endpoint would prevent that. The dialog therefore asks *which
 * channel*, never *where* — and the response's `destinationMasked` is the first
 * time anybody sees where it actually went.
 *
 * ── The five platform refusals each get their own sentence ────────────────────
 * All of these arrive as `details.platformCode` on a `PLATFORM_OPERATION_REJECTED`,
 * so branching on `error.code` would collapse them into one unhelpful message.
 * The throttle is the one worth care: `details.scope` is `party` or
 * `administrator`, and "wait" versus "ask a colleague" are different remedies.
 */
export function SendCredentialLinkDialog({
    user,
    kind,
    open,
    onOpenChange,
    onSent,
}: {
    user: UserDetail;
    kind: CredentialLinkKind;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSent: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const copy = COPY[kind];

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { channel: 'email', reason: '' },
    });

    // `useWatch`, not `useForm`'s `watch()` — the latter cannot be memoized, so
    // the compiler skips the whole component. Same convention as
    // `AgentWriteDialogs`.
    const channel = useWatch({ control: form.control, name: 'channel' });

    async function onSubmit(values: Values) {
        setFormError(null);
        const send = kind === 'login' ? sendLoginLink : sendPasswordResetLink;

        try {
            const result = await send(user.id, {
                channel: values.channel as CredentialChannel,
                reason: values.reason,
            });

            // `destinationMasked` is the whole point of showing anything: it
            // confirms the message went to the right person without handing the
            // operator an address they could retype somewhere else.
            notify.success(copy.title.replace('Send a', 'Sent a'), {
                description: `To ${result.destinationMasked} by ${result.channel}. ${copy.lifetime}`,
            });
            onOpenChange(false);
            onSent();
        } catch (error) {
            if (error instanceof ApiError) {
                switch (error.platformCode) {
                    case PLATFORM_CODE_CHANNEL_UNAVAILABLE:
                        form.setError('channel', {
                            message:
                                values.channel === 'telegram'
                                    ? 'They have never connected Telegram — the platform stores no chat id, so there is nothing to send to. Try another channel.'
                                    : 'They have no address on file for this channel. Try another one.',
                        });
                        return;
                    case PLATFORM_CODE_CREDENTIAL_LINK_THROTTLED: {
                        const scope = error.details?.scope;
                        const wait = error.details?.retryAfterSeconds;
                        const waitText =
                            typeof wait === 'number'
                                ? ` Try again in about ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'}.`
                                : '';
                        notify.warning('Too many links sent recently', {
                            description:
                                scope === 'administrator'
                                    ? `The limit is on your account, not theirs — a colleague can send this now.${waitText}`
                                    : `The limit is on this party, so a colleague would hit it too.${waitText}`,
                        });
                        return;
                    }
                    case PLATFORM_CODE_LOGIN_LINK_ROLE_UNSUPPORTED:
                        notify.warning('Sign-in links are for customers only', {
                            description:
                                'Every session this flow mints is scoped to `customer`, so it cannot be used on a vendor, agency or agent. Send a password-reset link instead.',
                        });
                        return;
                    case PLATFORM_CODE_PARTY_ACCOUNT_SUSPENDED:
                        notify.warning('This account is suspended', {
                            description:
                                'There is nothing to send them back into. Reinstate the account first, then send the link.',
                        });
                        return;
                    case PLATFORM_CODE_MESSAGING_DELIVERY_FAILED:
                        // Raised rather than swallowed on purpose: telling an
                        // administrator "sent" when nothing was sent closes the
                        // ticket with the party still locked out.
                        form.setError('channel', {
                            message:
                                'The channel accepted the request and did not deliver it. Nothing was sent — try another channel.',
                        });
                        return;
                    default:
                        break;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    form.setError('reason', { message: fieldErrors.reason });
                    return;
                }
                if (fieldErrors.channel) {
                    form.setError('channel', { message: fieldErrors.channel });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>
                        To {userDisplayName(user)}. {copy.blurb}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                        id="credential-link-channel"
                        label="Channel"
                        error={form.formState.errors.channel?.message}
                        hint="The address is read from their record. You cannot type one — that is what stops a link for somebody else's account being mailed to you."
                    >
                        {() => (
                            <Select
                                value={channel}
                                onValueChange={(value) =>
                                    form.setValue('channel', value as CredentialChannel, {
                                        shouldValidate: true,
                                    })
                                }
                            >
                                <SelectTrigger id="credential-link-channel">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CREDENTIAL_CHANNELS.map((channel) => (
                                        <SelectItem key={channel} value={channel}>
                                            {CREDENTIAL_CHANNEL_LABELS[channel]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </FormField>

                    <FormField
                        id="credential-link-reason"
                        label="Reason"
                        error={form.formState.errors.reason?.message}
                        hint="Recorded in the audit trail. The link itself never is — a trail carrying live credentials would be worse than no trail."
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REASON_MAX}
                                placeholder="Called in; could not receive the self-service email."
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    <p className="text-muted-foreground text-sm">
                        {copy.lifetime} Sending another of the same kind revokes this one, so a
                        double-click leaves one live link rather than two.
                    </p>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            {copy.submit}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
