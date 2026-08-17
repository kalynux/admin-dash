import { describe, expect, it } from 'vitest';

import {
    CIRCULAR,
    REDACTED,
    TRUNCATED,
    isCredentialKey,
    redactMetadata,
} from '@/lib/audit-redaction';

describe('recognising a credential-shaped key', () => {
    it.each([
        'password',
        'passwordHash',
        'password_hash',
        'PASSWORD-HASH',
        'newPassword',
        'refreshToken',
        'access_token',
        'apiKey',
        'API_KEY',
        'api-key',
        'clientSecret',
        'authorization',
        'X-CSRF-Token',
        'sessionId',
        'otpCode',
        'totpSecret',
        'privateKey',
        'signature',
        'passphrase',
    ])('hides %s', (key) => {
        expect(isCredentialKey(key)).toBe(true);
    });

    it.each(['tier', 'status', 'email', 'displayName', 'reason', 'amount', 'id'])(
        'leaves %s alone',
        (key) => {
            expect(isCredentialKey(key)).toBe(false);
        },
    );

    /**
     * The reason short tokens are matched per word rather than as substrings.
     * A naive `includes('pin')` blanks `shippingAddress` — shi·PPIN·g — on every
     * order diff, and `includes('pan')` blanks `companyName` — com·PAN·y.
     */
    it.each([
        'shippingAddress',
        'shipping_address',
        'companyName',
        'company',
        'monkey',
        'keyName',
        'campaign',
    ])('does not mistake %s for a credential', (key) => {
        expect(isCredentialKey(key)).toBe(false);
    });

    it.each(['pin', 'pinCode', 'PIN_CODE', 'otpCode', 'cvv', 'iban'])(
        'still hides %s, where the short token is a whole word',
        (key) => {
            expect(isCredentialKey(key)).toBe(true);
        },
    );

    /**
     * `key` is deliberately not a short token: it would blank the one field that
     * identifies a feature flag, and audit rows carry `targetType: 'feature_flag'`.
     */
    it('leaves a feature flag key readable while still hiding compound key names', () => {
        expect(isCredentialKey('key')).toBe(false);
        expect(isCredentialKey('flagKey')).toBe(false);
        expect(isCredentialKey('apiKey')).toBe(true);
        expect(isCredentialKey('privateKey')).toBe(true);
        expect(isCredentialKey('signingKey')).toBe(true);
    });

    /**
     * The allowance list earns its keep here. Every one of these contains a
     * credential fragment and every one is the field that says what happened —
     * hiding them would render an MFA or password-reset audit as an empty object.
     */
    it.each([
        'passwordRotated',
        'mfaEnabled',
        'mfaRequired',
        'mfaEnrolledAt',
        'tokenCount',
        'sha256',
    ])('keeps %s, which describes the change rather than being one', (key) => {
        expect(isCredentialKey(key)).toBe(false);
    });

    it('matches the whole key against the allowance, never a fragment of it', () => {
        // Contains `mfaEnabled`, but is not it.
        expect(isCredentialKey('mfaEnabledSecret')).toBe(true);
    });

    it('ignores a key that normalises to nothing', () => {
        expect(isCredentialKey('---')).toBe(false);
        expect(isCredentialKey('')).toBe(false);
    });
});

describe('redacting recorded state', () => {
    it('passes a clean object through unchanged', () => {
        const before = { tier: 3, status: 'active' };
        const result = redactMetadata(before);

        expect(result.value).toEqual({ tier: 3, status: 'active' });
        expect(result.redactedKeys).toEqual([]);
        expect(result.truncated).toBe(false);
    });

    it('keeps null as null rather than turning it into an empty object', () => {
        // On this service `null` is a fact about the record; `{}` is a different claim.
        expect(redactMetadata(null).value).toBeNull();
    });

    it('replaces a credential value and names the key it hid', () => {
        const result = redactMetadata({ tier: 2, passwordHash: 'argon2id$v=19$...' });

        expect(result.value).toEqual({ tier: 2, passwordHash: REDACTED });
        expect(result.redactedKeys).toEqual(['passwordHash']);
    });

    it('reaches a credential nested below the top level', () => {
        const result = redactMetadata({
            profile: { email: 'ada@wimall.cm', credentials: { apiKey: 'sk-live-1' } },
        });

        expect(result.value).toEqual({
            profile: { email: 'ada@wimall.cm', credentials: REDACTED },
        });
        // `credentials` itself matches, so the walk stops there — the key named is
        // the one actually withheld, not one deeper that was never reached.
        expect(result.redactedKeys).toEqual(['credentials']);
    });

    it('redacts inside arrays of objects', () => {
        const result = redactMetadata({ sessions: [{ id: 'a', token: 't1' }, { id: 'b' }] });

        expect(result.value).toEqual({ sessions: [{ id: 'a', token: REDACTED }, { id: 'b' }] });
        expect(result.redactedKeys).toEqual(['token']);
    });

    it('reports each hidden key once, however often it occurs', () => {
        const result = redactMetadata({
            one: { token: 'x' },
            two: { token: 'y' },
            three: { token: 'z' },
        });

        expect(result.redactedKeys).toEqual(['token']);
    });

    it('does not throw on a cyclic object', () => {
        // ADR-006 D-5 makes the same choice server-side: a cycle yields a marker
        // rather than an exception, because throwing while rendering the trail
        // would take down the screen that reads it.
        const node: Record<string, unknown> = { name: 'root' };
        node.self = node;

        const result = redactMetadata(node);

        expect(result.value).toEqual({ name: 'root', self: CIRCULAR });
        expect(result.truncated).toBe(true);
    });

    it('renders a repeated sibling twice — that is not a cycle', () => {
        const shared = { id: '665f1c2a9b3e4a91c7d2e5f0' };
        const result = redactMetadata({ actor: shared, target: shared });

        expect(result.value).toEqual({
            actor: { id: '665f1c2a9b3e4a91c7d2e5f0' },
            target: { id: '665f1c2a9b3e4a91c7d2e5f0' },
        });
        expect(result.truncated).toBe(false);
    });

    it('summarises below the depth cap instead of walking forever', () => {
        const deep = { a: { b: { c: { d: { e: 'too far' } } } } };
        const result = redactMetadata(deep);

        expect(result.value).toEqual({ a: { b: { c: { d: TRUNCATED } } } });
        expect(result.truncated).toBe(true);
    });

    it('renders a Date as an instant rather than an empty object', () => {
        const result = redactMetadata({ at: new Date('2026-08-12T14:22:09.117Z') });

        expect(result.value).toEqual({ at: '2026-08-12T14:22:09.117Z' });
    });

    it('summarises an over-long array and says how much it dropped', () => {
        const result = redactMetadata({ ids: Array.from({ length: 105 }, (_, i) => i) });
        const ids = (result.value as { ids: unknown[] }).ids;

        expect(ids).toHaveLength(101);
        expect(ids.at(-1)).toBe(`${TRUNCATED} 5 more`);
        expect(result.truncated).toBe(true);
    });

    it('leaves a primitive alone', () => {
        expect(redactMetadata('a string').value).toBe('a string');
        expect(redactMetadata(42).value).toBe(42);
        expect(redactMetadata(false).value).toBe(false);
    });
});
