/**
 * The password policy, and reading what the server said about it.
 */

import { env } from '@/config/env';
import { ApiError, CODE_PASSWORD_WEAK } from '@/types/api.types';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * The four documented rules, for when the server sends nothing renderable.
 *
 * Note what is *not* here: the common-password list. It stays server-side, because
 * shipping it to the browser would publish it.
 */
export const PASSWORD_POLICY_RULES: readonly string[] = [
    `At least ${PASSWORD_MIN_LENGTH} characters`,
    `At most ${PASSWORD_MAX_LENGTH} characters`,
    'Not a commonly used password',
    'Not a single repeated character',
];

/** A single repeated character — `aaaaaaaaaaaa`. Cheap to check, and a real rule. */
export function isSingleRepeatedCharacter(value: string): boolean {
    return value.length > 0 && /^(.)\1*$/.test(value);
}

/**
 * `failedRules` is the contract; the rest are the guesses that preceded it.
 *
 * ⚠ **`failedRules` must stay first.** It is the key the service actually
 * throws (`auth.md` § Password policy, pinned by the backend's `test:contract`
 * § 11), and the loop returns the first key that yields anything — so a stale
 * name ahead of it would win on a response that carries both.
 *
 * The others are kept as a cheap hedge, not as documentation: none of them has
 * ever been observed, and none should be added to.
 */
const CANDIDATE_KEYS = ['failedRules', 'problems', 'failures', 'rules', 'violations'] as const;

let warnedAboutMissingDetails = false;

/**
 * What the server said was wrong with the new password.
 *
 * ── The key is `details.failedRules`, and it arrives ─────────────────────────
 * An array of phrases completing *"your password …"* — `"must be at least 12
 * characters"`, `"is too common"` — one per rule that **failed**. So it is
 * never empty on a `422` and never lists all four; render it as a list.
 *
 * ⚠ **It did not always reach a client, and the difference is not cosmetic.**
 * Until 2026-09-08 the throw site used `details.problems`, which is on the
 * boundary's always-dropped internal-key list — it is the boot assertions'
 * diagnostic payload — and is dropped in **every** category. The object emptied,
 * `details` was omitted, and a client received the fixed message and nothing
 * else. That is why this reads a list of candidate keys rather than one: the
 * fallback path below is the behaviour every build before then had.
 *
 * When nothing renderable arrives this returns `[]` and the caller falls back to
 * `PASSWORD_POLICY_RULES`. In development it says so once, naming the gap, so a
 * regression upstream gets noticed instead of being quietly absorbed here.
 */
export function readPasswordPolicyFailures(error: unknown): string[] {
    if (!(error instanceof ApiError)) return [];

    const details = error.details;

    if (details) {
        for (const key of CANDIDATE_KEYS) {
            const found = asStringArray(details[key]);
            if (found.length > 0) return found;
        }
    }

    // A `422` is not a `VALIDATION_ERROR`, but if the shape ever changes to carry
    // `details.fields` this picks it up without another release.
    const fromFields = error.fieldErrors.map((field) => field.message).filter(Boolean);
    if (fromFields.length > 0) return fromFields;

    if (env.isDev && error.code === CODE_PASSWORD_WEAK && !warnedAboutMissingDetails) {
        warnedAboutMissingDetails = true;
        console.warn(
            '[password] ADMIN_AUTH_PASSWORD_WEAK arrived with no renderable `details` — ' +
                'expected `details.failedRules`, per auth.md § Password policy. ' +
                'A build throwing the old `details.problems` sends nothing at all: that key ' +
                'is on the boundary scrub\'s always-drop list. Falling back to the documented rules.',
        );
    }

    return [];
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** Test seam — the dev warning fires once per session, which would leak between cases. */
export function __resetPasswordPolicyWarning(): void {
    warnedAboutMissingDetails = false;
}
