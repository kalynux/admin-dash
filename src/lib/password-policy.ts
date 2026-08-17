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

const CANDIDATE_KEYS = ['problems', 'failures', 'rules', 'violations'] as const;

let warnedAboutMissingDetails = false;

/**
 * What the server said was wrong with the new password.
 *
 * `auth.md` promises only that `details` "names the problems" and never states the
 * key — and this build sends nothing at all: the service throws
 * `details.problems`, and `problems` sits on the error boundary's always-drop list
 * (it is also the payload of the internal boot assertions), so the projection
 * empties and `details` is omitted entirely.
 *
 * Rather than inventing a field name and rendering `undefined`, this reads every
 * plausible one and returns `[]` when there is nothing — the caller then falls
 * back to `PASSWORD_POLICY_RULES`. In development it says so once, so the gap gets
 * noticed and fixed upstream instead of being quietly absorbed here.
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
                'the service throws `details.problems`, which the boundary scrub drops. ' +
                'Falling back to the documented rules. Fix belongs in backend/admin.',
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
