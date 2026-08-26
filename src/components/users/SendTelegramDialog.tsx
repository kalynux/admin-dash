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
import { sendTelegramMessage } from '@/services/messaging.service';
import { ApiError } from '@/types/api.types';
import {
    PLATFORM_CODE_MESSAGING_CONNECTION_NOT_FOUND,
    PLATFORM_CODE_TELEGRAM_DELIVERY_FAILED,
    TELEGRAM_MESSAGE_MAX,
} from '@/types/messaging.types';
import { userDisplayName, type UserDetail } from '@/types/users.types';

const schema = z.object({
    message: z
        .string()
        .trim()
        .min(1, 'Write something to send')
        .max(TELEGRAM_MESSAGE_MAX, `Telegram allows at most ${TELEGRAM_MESSAGE_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['message'] as const;

/**
 * `POST /messaging/telegram` · `messaging.telegram.send`.
 *
 * ── One person, addressed by `userId` ─────────────────────────────────────────
 * The body takes **exactly one** of `userId` / `chatId` and a body naming both
 * is a `400`. From a user's detail screen the id is the one we have, so the
 * `chatId` branch is not offered here at all — it exists for a raw chat id an
 * operator was handed out of band, which is not this screen.
 *
 * ── The dialog says what is recorded, because it is unusual ───────────────────
 * The audit row keeps **the full message body**. Every other payload on this
 * service records the fields that changed on a record that still exists, so the
 * row is a pointer and the record is the evidence — but jovi-mall keeps no
 * record of a send, so this row *is* the evidence. An operator should know that
 * before they type, not after.
 *
 * ── Two failures, shown differently ───────────────────────────────────────────
 * `MESSAGING_CONNECTION_NOT_FOUND` means there is nobody to send to and
 * retrying will not help; `MESSAGING_DELIVERY_FAILED` means Telegram refused and
 * it is worth another go. The legacy handler flattened both into a 400
 * `INTERNAL_SERVER_ERROR`, which is why nobody could tell them apart.
 */
export function SendTelegramDialog({
    user,
    open,
    onOpenChange,
    onSent,
}: {
    user: UserDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSent: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { message: '' },
    });

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            const result = await sendTelegramMessage({
                userId: user.id,
                message: values.message,
            });

            notify.success('Message sent', {
                description: `Delivered to Telegram chat ${result.chatId}. That id is the only record of where it went — the platform keeps no delivery log.`,
            });
            onOpenChange(false);
            onSent();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_MESSAGING_CONNECTION_NOT_FOUND) {
                    notify.warning('They have not connected Telegram', {
                        description:
                            'Only accounts that ran /connect with the bot can be messaged. There is nobody to send to — trying again will not change that.',
                    });
                    onOpenChange(false);
                    return;
                }
                if (error.platformCode === PLATFORM_CODE_TELEGRAM_DELIVERY_FAILED) {
                    // Distinct from the 404 on purpose: the chat resolved and
                    // Telegram refused, so this one is worth retrying.
                    setFormError(error);
                    return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.message) {
                    form.setError('message', { message: fields.message });
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
                    <DialogTitle>Send a Telegram message</DialogTitle>
                    <DialogDescription>
                        One message to {userDisplayName(user)}, if they have connected Telegram to
                        their account.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">The whole message is recorded.</p>
                        <p className="text-muted-foreground">
                            The platform keeps no copy of what it sends, so the audit trail is the
                            only record this message will ever leave. Write it as something you
                            would be content to have quoted back.
                        </p>
                    </div>

                    <FormField
                        id="telegram-message"
                        label="Message"
                        error={form.formState.errors.message?.message}
                        hint={`Up to ${TELEGRAM_MESSAGE_MAX} characters. Sent once, immediately — there is no scheduling and no recall.`}
                    >
                        {(field) => (
                            <Textarea
                                rows={5}
                                maxLength={TELEGRAM_MESSAGE_MAX}
                                placeholder="Your payout of 45 000 XAF was released this morning."
                                {...field}
                                {...form.register('message')}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Send message
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
