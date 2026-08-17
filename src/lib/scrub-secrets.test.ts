import { describe, expect, it } from 'vitest';

import { REDACTED } from '@/lib/audit-redaction';
import { SCRUBBED, scrubJson, scrubText, scrubbedText } from '@/lib/scrub-secrets';

/**
 * Every string this suite scrubs, gathered so the two pinned properties can be
 * asserted over all of them rather than over whichever case somebody remembered.
 */
const ALL_SAMPLES: string[] = [];

/** Register a sample and return it, so a case reads as one expression. */
function sample(text: string): string {
    ALL_SAMPLES.push(text);
    return text;
}

describe('what it hides', () => {
    it('replaces a JSON Web Token, anchored on eyJ', () => {
        const result = scrubText(
            sample(
                'verify failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U at boot',
            ),
        );

        expect(result.text).toBe(`verify failed for ${SCRUBBED} at boot`);
        expect(result.matched).toEqual(['jwt']);
    });

    it('replaces a token with no signature segment — alg:none is worth hiding, not skipping', () => {
        const result = scrubText(sample('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.'));

        expect(result.text).toBe(SCRUBBED);
        expect(result.matched).toEqual(['jwt']);
    });

    it('replaces the value after Bearer and keeps the scheme', () => {
        const result = scrubText(sample('authorization: Bearer dXNlcjpwYXNzd29yZDEyMw=='));

        expect(result.text).toBe(`authorization: Bearer ${SCRUBBED}`);
        expect(result.matched).toEqual(['auth-scheme']);
    });

    it('keeps the provider key prefix, because the mode is the useful leak-free fact', () => {
        const result = scrubText(sample('stripe key sk_live_51H8xkjKLMNOPqrstUV rejected'));

        expect(result.text).toBe(`stripe key sk_live_${SCRUBBED} rejected`);
        expect(result.matched).toEqual(['provider-key']);
    });

    it('replaces only the password half of a URI, keeping scheme, user and host', () => {
        const result = scrubText(
            sample('connect mongodb://svc:p4ssw0rd@cluster0.example.net:27017/jovi_mall failed'),
        );

        expect(result.text).toBe(
            `connect mongodb://svc:${SCRUBBED}@cluster0.example.net:27017/jovi_mall failed`,
        );
        expect(result.matched).toEqual(['uri-userinfo']);
    });

    it('replaces a Google API key and a SendGrid key, keeping their prefixes', () => {
        expect(scrubText(sample('AIzaSyD-abcdefghijklmnopqrstuvwxyz012345')).text).toBe(
            `AIza${SCRUBBED}`,
        );
        expect(
            scrubText(sample('SG.abcdefghijklmnop.qrstuvwxyz0123456789abcd')).text,
        ).toBe(`SG.${SCRUBBED}`);
    });

    it('replaces a PEM body and keeps both delimiter lines', () => {
        const result = scrubText(
            sample(
                '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx7Vn\nQm9k\n-----END RSA PRIVATE KEY-----',
            ),
        );

        expect(result.text).toBe(
            `-----BEGIN RSA PRIVATE KEY-----${SCRUBBED}-----END RSA PRIVATE KEY-----`,
        );
        expect(result.matched).toEqual(['pem']);
    });

    it('replaces a named key=value pair and preserves the separator it was written with', () => {
        expect(scrubText(sample('password=hunter22ok')).text).toBe(`password=${SCRUBBED}`);
        expect(scrubText(sample('api_key: abcdef123456')).text).toBe(`api_key: ${SCRUBBED}`);
    });

    it('hides a secret embedded in a cache key NAME, which the contract does not cover', () => {
        // `/system/platform/cache/keys` promises never to return a *value* — but a
        // download token is part of the key, so the promise does not reach it.
        const result = scrubText(sample('download:token:9f2b1ce4aa7d'));

        expect(result.text).toBe(`download:token:${SCRUBBED}`);
        expect(result.matched).toEqual(['kv-secret']);
    });
});

describe('what it must never mangle', () => {
    /**
     * Each of these is an ordinary value this surface renders constantly. A
     * scrubber that eats them is one an operator learns to distrust, which is
     * worse than not having one — ADR-015 D-1 makes the same argument.
     */
    it.each([
        ['a 24-char ObjectId', '65d4f2a1b3c7e89012345678'],
        [
            'a 64-char upload fingerprint',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ],
        ['a UUID request id', 'requestId 8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d'],
        ['a semantic version', 'wi-admin 1.2.3 booted'],
        ['a dotted module path', 'modules.dev-tools.gateway raised'],
        ['an email address in an SMTP failure', 'send failed for ops@wimall.cm'],
        ['a phone number in a WhatsApp error', 'send failed for +237650000000'],
        ['a plain host and port', 'GET http://localhost:8022/api/health returned 200'],
        ['a Stripe publishable key', 'pk_test_51H8xkjKLMNOPqrstUV'],
        ['an AWS access key id, which is not the secret', 'AKIAIOSFODNN7EXAMPLE'],
        ['a configured-state answer', 'apiKey: undefined'],
        ['the wiring block s Stripe mode', 'stripeKeyMode: test'],
        ['the sentence "Basic authentication failed"', 'Basic authentication failed for vendor'],
        ['a counter field', 'tokenCount: 4'],
        ['a count that clears the length floor', 'tokens: 123456'],
        ['a short boolean value', 'secret: true'],
        ['an absent value', 'password: null'],
    ])('leaves %s alone', (_label, text) => {
        const result = scrubText(sample(text));

        expect(result.text).toBe(text);
        expect(result.matched).toEqual([]);
    });
});

describe('a public certificate is not a private key', () => {
    /**
     * The false positive that matters most on this surface: a certificate block
     * is exactly what an operator reads while debugging a TLS handshake, and it
     * is public by definition.
     */
    it('leaves a CERTIFICATE block completely alone', () => {
        const text = sample(
            '-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIEAgAAuTAN\n-----END CERTIFICATE-----',
        );
        const result = scrubText(text);

        expect(result.text).toBe(text);
        expect(result.matched).toEqual([]);
    });

    it('still masks an ENCRYPTED PRIVATE KEY block', () => {
        const result = scrubText(
            sample('-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE6TAb\n-----END ENCRYPTED PRIVATE KEY-----'),
        );

        expect(result.text).toBe(
            `-----BEGIN ENCRYPTED PRIVATE KEY-----${SCRUBBED}-----END ENCRYPTED PRIVATE KEY-----`,
        );
    });
});

describe('scrubJson — both nets over one object', () => {
    it('catches a credential the key names AND one the key hides', () => {
        const result = scrubJson({
            authorization: 'Bearer dXNlcjpwYXNzd29yZDEyMw==',
            note: 'retrying with Bearer dXNlcjpwYXNzd29yZDEyMw==',
            attempt: 3,
        });

        // The key net took the first, by name.
        expect(result.redactedKeys).toEqual(['authorization']);
        expect(result.text).toContain(REDACTED);

        // The text net took the second, whose key is innocent.
        expect(result.matched).toEqual(['auth-scheme']);
        expect(result.text).toContain(`Bearer ${SCRUBBED}`);

        // Neither token survives anywhere.
        expect(result.text).not.toContain('dXNlcjpwYXNzd29yZDEyMw==');
        // And the benign field is untouched.
        expect(result.text).toContain('"attempt": 3');
    });

    it('keeps the two sentinels distinct, so the reader can tell them apart', () => {
        expect(REDACTED).not.toBe(SCRUBBED);
    });

    it('stays valid JSON after both passes', () => {
        const result = scrubJson({
            password: 'hunter22ok',
            note: 'token=abcdef123456 and Bearer dXNlcjpwYXNzd29yZDEyMw==',
        });

        expect(() => JSON.parse(result.text)).not.toThrow();
    });

    it('renders null as null rather than an empty object', () => {
        const result = scrubJson(null);

        expect(result.text).toBe('null');
        expect(result.redactedKeys).toEqual([]);
        expect(result.matched).toEqual([]);
    });

    it('survives a cycle and reports it as truncated', () => {
        const node: Record<string, unknown> = { name: 'root' };
        node.self = node;

        const result = scrubJson(node);

        expect(result.truncated).toBe(true);
        expect(() => JSON.parse(result.text)).not.toThrow();
    });
});

describe('the two properties the platform got wrong first time', () => {
    it('is idempotent over every sample in this suite', () => {
        for (const text of ALL_SAMPLES) {
            const once = scrubText(text).text;
            expect(scrubText(once).text).toBe(once);
        }
    });

    it('never collapses a scheme and its value into two sentinels', () => {
        const once = scrubText('Authorization: Bearer dXNlcjpwYXNzd29yZDEyMw==').text;
        const twice = scrubText(once).text;

        expect(twice).toContain(`Bearer ${SCRUBBED}`);
        expect(twice).not.toContain(`${SCRUBBED} ${SCRUBBED}`);
    });

    it('does not grow the string on repeated passes', () => {
        let text = scrubText('password=hunter22ok and download:token:9f2b1ce4aa7d').text;
        const first = text;

        for (let pass = 0; pass < 5; pass += 1) text = scrubText(text).text;

        expect(text).toBe(first);
    });
});

describe('the reported rule list', () => {
    it('is empty exactly when the text is unchanged', () => {
        expect(scrubText('nothing to see here').matched).toEqual([]);
        expect(scrubText('password=hunter22ok').matched).not.toEqual([]);
    });

    it('reports every rule that fired, in application order', () => {
        const result = scrubText(
            'Bearer dXNlcjpwYXNzd29yZDEyMw== then sk_live_51H8xkjKLMNOPqrstUV then password=hunter22ok',
        );

        expect(result.matched).toEqual(['auth-scheme', 'provider-key', 'kv-secret']);
    });

    it('does not report a rule that only re-matched a sentinel', () => {
        const once = scrubText('Bearer dXNlcjpwYXNzd29yZDEyMw==').text;

        expect(scrubText(once).matched).toEqual([]);
    });

    it('handles an empty string without claiming a match', () => {
        expect(scrubText('')).toEqual({ text: '', matched: [] });
    });
});

describe('scrubbedText', () => {
    it('returns the text alone', () => {
        expect(scrubbedText('password=hunter22ok')).toBe(`password=${SCRUBBED}`);
        expect(scrubbedText('ordinary output')).toBe('ordinary output');
    });
});
