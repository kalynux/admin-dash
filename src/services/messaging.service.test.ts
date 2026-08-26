import { describe, expect, it } from 'vitest';

import { sendTelegramMessage } from '@/services/messaging.service';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

const USER_ID = '6612a4f0c1a2b3d4e5f60718';

describe('one message, to one person', () => {
    it('sends exactly one recipient — never both', async () => {
        /**
         * ⚠ A body naming both `userId` and `chatId` is a `400`, and this is
         * **stricter than jovi-mall's own schema on purpose**: there,
         * `TelegramNotificationService` prefers `chatId` and never resolves the
         * `userId`, so the message goes to the chat, the response says
         * `sent: true`, and the id that was supposed to identify the recipient
         * is never read — no error, no log line, nothing in the response that
         * differs from a correct send.
         *
         * The union type makes the impossible body a compile error too.
         */
        const calls = stubFetch(() => successResponse({ sent: true, chatId: '123456789' }));

        await sendTelegramMessage({ userId: USER_ID, message: 'Your payout was released.' });

        const call = calls[calls.length - 1];
        expect(new URL(call.url, 'http://localhost').pathname).toBe('/api/v1/messaging/telegram');
        const body = JSON.parse(call.body as string);
        expect(body).toEqual({ userId: USER_ID, message: 'Your payout was released.' });
        expect('chatId' in body).toBe(false);
    });

    it('returns the chat the platform actually resolved', async () => {
        // When the message was addressed to a `userId`, this is the only evidence
        // of *where* it went — a client ignoring it cannot tell a correct send
        // from one to a stale connection.
        stubFetch(() => successResponse({ sent: true, chatId: '987654321' }));

        const result = await sendTelegramMessage({ userId: USER_ID, message: 'Hello' });

        expect(result.chatId).toBe('987654321');
        expect(result.sent).toBe(true);
    });

    it('separates “nobody to send to” from “delivery failed”', async () => {
        /**
         * The 404 is *there is nobody to send to* — actionable, and retrying
         * will not help. The 502 is *try again*. The legacy handler flattened
         * both into `INTERNAL_SERVER_ERROR` at 400, which is why nobody could
         * tell them apart.
         */
        stubFetch(() =>
            errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                details: { platformCode: 'MESSAGING_CONNECTION_NOT_FOUND' },
            }),
        );

        await expect(
            sendTelegramMessage({ userId: USER_ID, message: 'Hello' }),
        ).rejects.toMatchObject({ platformCode: 'MESSAGING_CONNECTION_NOT_FOUND', status: 404 });
    });
});
