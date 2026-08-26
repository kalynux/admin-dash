/**
 * `/messaging` — one Telegram message, to one person.
 *
 * Source: `docs/admin/api/messaging.md`.
 *
 * ── ⚠ This is not a broadcast, and the old name said it was ───────────────────
 * The permission used to be `broadcast.send`, summarised *"Send a broadcast
 * message to platform users"*. That was wrong four times over, and the rename
 * (Phase 5 D-11) is the substance of this port rather than a tidy-up:
 *
 * | The old name implied | What is actually there |
 * |---|---|
 * | An audience | **One recipient.** No segmentation, no list, no "all vendors" |
 * | Scheduling | **None.** The call sends, or raises |
 * | A delivery record | **None.** jovi-mall's `sendMessage` returns a boolean and keeps nothing — **the audit row is the only record a send ever leaves** |
 * | "platform users" | Only accounts that linked Telegram through the bot's `/connect` flow |
 *
 * **If you need to reach many people, this is not the endpoint and there is no
 * endpoint.** Do not build a recipient picker around it.
 */

/**
 * `POST /messaging/telegram` · `messaging.telegram.send` (tiers 1–2) ·
 * delegated · **audited**.
 *
 * ⚠ **Exactly one of `userId` / `chatId` — never both.** A body naming both is
 * `400 VALIDATION_ERROR` on the `chatId` path.
 *
 * This is **stricter than jovi-mall's own schema, on purpose**. Its
 * `SendNotificationSchema` asks for *at least* one, and
 * `TelegramNotificationService` then prefers `chatId` and never resolves the
 * `userId`. So a body carrying both is accepted there, the message goes to the
 * chat, the response says `sent: true`, and the user id that was supposed to
 * identify the recipient is never read — with no error, no log line, and nothing
 * in the response that differs from a correct send. The refusal is at wi-admin
 * so it arrives **before** the hop.
 *
 * Modelled as a union rather than two optional fields so the impossible body
 * does not typecheck either.
 */
export type SendTelegramBody =
    | {
          /** A jovi-mall user id, 24-hex. Their Telegram chat is resolved from their connection. */
          userId: string;
          chatId?: never;
          message: string;
      }
    | {
          userId?: never;
          /** A raw Telegram chat id, 1–64 characters, passed through opaquely. */
          chatId: string;
          message: string;
      };

/** Telegram's own limit, enforced by wi-admin before the hop. */
export const TELEGRAM_MESSAGE_MAX = 4096;

export interface SendTelegramResult {
    /** **Always `true` on a 200** — a failed send raises rather than answering `false`. */
    sent: boolean;
    /**
     * ⚠ **The chat jovi-mall actually resolved.**
     *
     * When the message was addressed to a `userId`, this is the **only** evidence
     * of *where* it went — a client that ignores it cannot tell a correct send
     * from one to a stale connection. Surface it.
     */
    chatId: string;
}

/**
 * 404 — the recipient has no Telegram connection.
 *
 * ⚠ **Different from the 502 below and shown differently.** This one is *there
 * is nobody to send to*: actionable, and retrying will not help. The legacy
 * handler flattened both into `INTERNAL_SERVER_ERROR` at 400, which is why
 * nobody could tell them apart.
 */
export const PLATFORM_CODE_MESSAGING_CONNECTION_NOT_FOUND = 'MESSAGING_CONNECTION_NOT_FOUND';

/** 502 — the chat resolved and Telegram refused the message. *Try again.* */
export const PLATFORM_CODE_TELEGRAM_DELIVERY_FAILED = 'MESSAGING_DELIVERY_FAILED';
