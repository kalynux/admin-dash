import { z } from 'zod';

import { ApiError } from '@/types/api.types';

/**
 * The wire rules of the administrator's own phone flow, kept out of the card.
 *
 * ── Why a separate module ────────────────────────────────────────────────────
 * `react-refresh/only-export-components` is on, so a component file may export
 * components and constant literals and nothing else — the two Zod schemas are
 * neither. The same split the stores use (`X.store.tsx` / `X-context.ts`), for
 * the same reason.
 *
 * It also gives `phone-contract.test.ts` something to diff: these schemas are
 * pinned against [`api-doc/admin/auth-validator.ts`](../../../api-doc/admin/auth-validator.ts),
 * the mirror of `admin-identity/validators/auth.validator.ts` taken on
 * 2026-09-15 at the backend's word (BR-025 § 1). ⚠ **The mirror carries the
 * field rules and none of the behaviours** — a `PATCH` always clearing
 * `phone_verified`, the confirm taking `code` alone, the `409`, the `422` — which
 * live in `admin-phone.service.ts` and on [`auth.md`](../../../api-doc/admin/api/auth.md).
 */

/**
 * Length only, 6–20, matching `SetAdminPhoneSchema`.
 *
 * **No format rule**, the same division `EditIdentifiersDialog` draws and for the
 * same reason: jovi-mall owns E.164 and judges it when the code is sent. A second
 * definition here would drift silently in the worst direction — a number accepted
 * at this door that no send can ever reach.
 */
export const setPhoneSchema = z.object({
    phone: z
        .string()
        .trim()
        .min(6, 'Use at least 6 characters')
        .max(20, 'Use at most 20 characters'),
});

export type SetPhoneValues = z.infer<typeof setPhoneSchema>;

/**
 * The confirm body, 4–12, matching `ConfirmAdminPhoneSchema`.
 *
 * ⚠ **`code` alone.** The service schema is `.strict()`, and the reason is worth
 * keeping in front of whoever edits this: a caller that could name the number
 * would be able to prove control of *one* number and have *another* marked
 * verified. The number is fixed when the code is minted.
 */
export const confirmSchema = z.object({
    code: z
        .string()
        .trim()
        .min(4, 'Enter the code from the message')
        .max(12, 'Use at most 12 characters'),
});

export type ConfirmValues = z.infer<typeof confirmSchema>;

/**
 * The four delegated verdicts this flow branches on.
 *
 * All four are **jovi-mall's**, and arrive as `details.platformCode` on a
 * forwarded refusal — never as `error.code`. The remaining two of the six
 * (`NO_TARGET`, `CODE_EXPIRED`) need no branch: the catalogued sentence in
 * `error-platform.ts` is the whole remedy.
 *
 * ⚠ **The two wi-admin codes beside them are NOT here** —
 * `ADMIN_PHONE_NOT_SET` and `ADMIN_PHONE_VERIFICATION_MISMATCH` are `error.code`
 * values in `KNOWN_ERROR_CODES`, because they are refused here before the call to
 * jovi-mall is made. The split is *where the refusal happens*.
 */
export const PLATFORM_CODE_DELIVERY_FAILED = 'PHONE_VERIFICATION_DELIVERY_FAILED';
/** 429 · the cooldown. **The code already in their hand still works.** */
export const PLATFORM_CODE_RESEND_TOO_SOON = 'PHONE_VERIFICATION_RESEND_TOO_SOON';
/** 429 · **the code has been destroyed.** The opposite remedy to the cooldown. */
export const PLATFORM_CODE_TOO_MANY_ATTEMPTS = 'PHONE_VERIFICATION_TOO_MANY_ATTEMPTS';
/** 422 · wrong digits, and it carries `details.attemptsLeft`. */
export const PLATFORM_CODE_CODE_INVALID = 'PHONE_VERIFICATION_CODE_INVALID';

/** wi-admin's own 409: the proved number is no longer the account's. */
export const CODE_PHONE_VERIFICATION_MISMATCH = 'ADMIN_PHONE_VERIFICATION_MISMATCH';

/**
 * How many tries are left on the code in the operator's hand.
 *
 * ⚠ **Disclosed deliberately, and only on `CODE_INVALID`.** `errors.md` says why
 * it survives the boundary scrub: it tells the holder of the real code that they
 * mistyped and how much room is left, and it tells an attacker something they
 * could count themselves. **The secret is the code, not the counter.**
 *
 * Read defensively rather than trusted: it is one optional key inside a `details`
 * object, and a missing one must degrade to the plain sentence.
 */
export function attemptsLeftOf(error: unknown): number | undefined {
    if (!(error instanceof ApiError)) return undefined;
    if (error.platformCode !== PLATFORM_CODE_CODE_INVALID) return undefined;
    const value = error.details?.attemptsLeft;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
