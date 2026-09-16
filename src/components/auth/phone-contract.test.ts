/**
 * The transcription guard for the administrator phone schemas.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Because the three `/auth/me/phone*` routes were built from **backend source**
 * on 2026-09-14, at a time when the word "phone" appeared on no contract page at
 * all (BR-025 § 1). A reading of source is a transcription, and this repository
 * has shipped four of those — `/content` on the wire, `agencies.md`'s `kyc`
 * members, `files.md`'s quota clause, `support.md`'s expiring URLs. **A copy can
 * be diffed and a transcription cannot**, so the validator is now mirrored at
 * `api-doc/admin/auth-validator.ts` and this suite holds the client's two Zod
 * schemas to it.
 *
 * The backend said outright that taking the mirror is our call and gave the word
 * for this one; it also said the mirror **does not replace the page**, because a
 * validator carries the field rules and none of the four behaviours (a `PATCH`
 * always clears `phone_verified`, the confirm takes `code` alone, the `409`, the
 * `422`), which live in `admin-phone.service.ts` and on `auth.md`.
 *
 * ⚠ **What a failure here means.** Both schemas are `.strict()` on the service,
 * so a bound we get wrong is not cosmetic: too loose and the form accepts a value
 * the server refuses with a message the field cannot show; too tight and a legal
 * number is refused by us for a rule that does not exist.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { confirmSchema, setPhoneSchema } from '@/components/auth/phone-contract';

const mirror = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../api-doc/admin/auth-validator.ts'),
    'utf8',
);

/**
 * `phone: z.string().min(6).max(20),` — the schema body, read by name.
 *
 * Anchored to the field inside the named schema rather than to a line number, so
 * a re-copy that moves the block still matches and a re-copy that changes the
 * bounds does not.
 */
function boundsOf(schemaName: string, field: string): { min: number; max: number } {
    const block = new RegExp(
        `export const ${schemaName} = z\\.object\\(\\{([\\s\\S]*?)\\}\\)\\.strict\\(\\)`,
    ).exec(mirror);
    expect(block, `${schemaName} is not in the mirror — re-copy auth.validator.ts`).not.toBeNull();

    const bounds = new RegExp(
        `${field}:\\s*z\\.string\\(\\)\\.min\\((\\d+)\\)\\.max\\((\\d+)\\)`,
    ).exec(block![1]);
    expect(bounds, `${schemaName}.${field} is not a bounded string in the mirror`).not.toBeNull();

    return { min: Number(bounds![1]), max: Number(bounds![2]) };
}

/** The shortest and longest value a client schema accepts, found by probing it. */
function acceptedLengths(schema: typeof setPhoneSchema | typeof confirmSchema, key: string) {
    const accepts = (length: number) =>
        schema.safeParse({ [key]: 'x'.repeat(length) }).success;

    let min = 0;
    while (min <= 64 && !accepts(min)) min += 1;

    let max = min;
    while (max <= 256 && accepts(max + 1)) max += 1;

    return { min, max };
}

describe('the phone schemas match the backend validator', () => {
    it('bounds the number the way SetAdminPhoneSchema does', () => {
        expect(acceptedLengths(setPhoneSchema, 'phone')).toEqual(
            boundsOf('SetAdminPhoneSchema', 'phone'),
        );
    });

    it('bounds the code the way ConfirmAdminPhoneSchema does', () => {
        expect(acceptedLengths(confirmSchema, 'code')).toEqual(
            boundsOf('ConfirmAdminPhoneSchema', 'code'),
        );
    });

    /**
     * ⚠ **No format rule, on purpose, and the mirror is what proves it.**
     * wi-admin does not own the phone vocabulary — jovi-mall normalises to E.164
     * and is the service that refuses an unusable number when it tries to send.
     * A regex here would be a second definition of a rule that lives there, and
     * the two would drift in the worst direction: a number this door accepts
     * that no send can ever reach.
     */
    it('adds no format rule the service does not have', () => {
        expect(mirror).not.toMatch(/SetAdminPhoneSchema[\s\S]*?phone:\s*z\.string\(\)[\s\S]*?regex/);
        expect(setPhoneSchema.safeParse({ phone: 'not a number' }).success).toBe(true);
    });

    /**
     * The one behaviour of BR-025 § 1 that IS expressible as a schema rule, and
     * the reason it exists is worth keeping next to the assertion: a caller that
     * could name the number would be able to prove control of *one* number and
     * have *another* marked verified. The number is fixed when the code is minted.
     */
    it('refuses a phone beside the code, because the service is strict there', () => {
        expect(mirror).toMatch(/ConfirmAdminPhoneSchema[\s\S]*?\}\)\.strict\(\)/);
        expect(
            confirmSchema.strict().safeParse({ code: '483920', phone: '+237677001122' }).success,
        ).toBe(false);
    });
});
