/**
 * `/messaging` — one route.
 *
 * Source: `api-doc/admin/api/messaging.md`. Delegated to jovi-mall, which owns the
 * `TELEGRAM_BOT_TOKEN` and the `channel_connections` collection mapping a
 * platform user to their chat. There is nothing here to own.
 */

import { api, type RequestOptions } from '@/services/api';
import type { SendTelegramBody, SendTelegramResult } from '@/types/messaging.types';

/**
 * `POST /messaging/telegram` · `messaging.telegram.send` · delegated ·
 * **audited**.
 *
 * ⚠ **Not a broadcast.** One message, one person, no scheduling, no delivery
 * record. See `types/messaging.types.ts` for what the old `broadcast.send` name
 * got wrong.
 *
 * ⚠ **The audit row records the recipient and the full message body** (Phase 5
 * O-2) — unusually, and for a reason: every other payload on this service
 * records the fields that changed on a record that still exists, so the row is a
 * pointer and the record is the evidence. There is **no record here**, because
 * jovi-mall keeps none, so this row *is* the evidence. A row saying only "an
 * administrator messaged this customer" cannot answer the one question a
 * complaint about a send ever asks.
 *
 * Surface `result.chatId`: when the message was addressed to a `userId`, it is
 * the only evidence of *where* it actually went.
 *
 * Two failures that must not be shown alike:
 * `404` / `MESSAGING_CONNECTION_NOT_FOUND` — nobody to send to, retrying will
 * not help. `502` / `MESSAGING_DELIVERY_FAILED` — Telegram refused; try again.
 */
export function sendTelegramMessage(
    body: SendTelegramBody,
    options?: RequestOptions,
): Promise<SendTelegramResult> {
    return api.post<SendTelegramResult>('/messaging/telegram', body, options);
}
