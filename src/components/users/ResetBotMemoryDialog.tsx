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
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { PLATFORM_CODE_PROFILE_NOT_FOUND, resetBotMemory } from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import {
    BOT_MEMORY_REASON_MAX,
    BOT_MEMORY_REASON_MIN,
    userDisplayName,
    type UserDetail,
} from '@/types/users.types';

/**
 * Optional, but when given it is trimmed 3–500 — so blank passes and one or two
 * characters do not. A blank field is sent as **no key at all**; see
 * `resetBotMemory`.
 */
const schema = z.object({
    reason: z
        .string()
        .trim()
        .refine(
            (value) => value.length === 0 || value.length >= BOT_MEMORY_REASON_MIN,
            `Leave it blank, or write at least ${BOT_MEMORY_REASON_MIN} characters`,
        )
        .refine(
            (value) => value.length <= BOT_MEMORY_REASON_MAX,
            `At most ${BOT_MEMORY_REASON_MAX} characters`,
        ),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

/**
 * `POST /users/:userId/bot-memory/reset` · `users.bot_memory.reset` · every tier.
 *
 * ── Why a confirmation at all, for something this cheap ───────────────────────
 * It is harmless — the worst a wrong press does is answer one customer's next
 * message without memory of the last chat, which is how every new customer
 * starts — but it is audited, and the customer notices it on their next
 * message. So one sentence of what happens, an optional reason, and a button.
 *
 * ── The copy never says "delete" or "clear history" ──────────────────────────
 * Administrators would read either as *the conversation is gone*, and it is
 * not: no message record, order or account field is touched. Only what the bot
 * remembers is reset.
 *
 * ── Two failures worth their own words ────────────────────────────────────────
 * `AUTH_PROFILE_NOT_FOUND` is an absence (no customer profile, so no memory) and
 * closes the dialog like Telegram's no-connection case. `502`/`503` means
 * jovi-mall failed or could not be reached and **the reset may or may not have
 * happened** — wi-admin never retries a write — and since two resets are as
 * harmless as one, the copy says pressing again is safe.
 */
export function ResetBotMemoryDialog({
    user,
    open,
    onOpenChange,
    onReset,
}: {
    user: UserDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onReset: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    function close(next: boolean) {
        if (!next) {
            form.reset();
            setFormError(null);
        }
        onOpenChange(next);
    }

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            const { message } = await resetBotMemory(user.id, { reason: values.reason });
            notify.success(message ?? 'Bot memory reset — the next conversation starts fresh', {
                description:
                    'Orders, messages and the account itself are unchanged. The reset is recorded in the activity trail.',
            });
            close(false);
            onReset();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_PROFILE_NOT_FOUND) {
                    notify.warning('This account has never used the bot', {
                        description:
                            'It has no customer profile, so the bot holds no memory of it and there is nothing to reset.',
                    });
                    close(false);
                    return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    const unreachable =
        formError instanceof ApiError && (formError.status === 502 || formError.status === 503);

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Make the bot forget this customer&rsquo;s chat</DialogTitle>
                    <DialogDescription>
                        The bot on WhatsApp and Telegram will start {userDisplayName(user)}&rsquo;s
                        next conversation from nothing, as it would for a new customer.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">Only the bot&rsquo;s memory is reset.</p>
                        <p className="text-muted-foreground">
                            Orders, message records and the account are not affected, and nobody is
                            signed out. Use this when the bot keeps returning to something from an
                            earlier chat.
                        </p>
                    </div>

                    <FormField
                        id="bot-memory-reason"
                        label="Reason (optional)"
                        error={form.formState.errors.reason?.message}
                        hint={`Recorded in the activity trail. ${BOT_MEMORY_REASON_MIN}–${BOT_MEMORY_REASON_MAX} characters, or leave it blank.`}
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={BOT_MEMORY_REASON_MAX}
                                placeholder="Customer says the bot keeps quoting an order they cancelled"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {unreachable ? (
                        <div
                            role="alert"
                            className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">The reset may not have happened.</p>
                            <p className="text-muted-foreground">
                                The platform did not answer, and nothing retries it automatically.
                                Pressing again is safe — a second reset does no harm.
                            </p>
                        </div>
                    ) : null}
                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => close(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Reset memory
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
