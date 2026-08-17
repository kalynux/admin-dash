/**
 * A second net over the free text the operations screens render.
 *
 * ── Why this exists beside `audit-redaction.ts` ───────────────────────────────
 * That file asks *"is this **key** credential-shaped?"* and is the right answer
 * for a recorded-state object. Four of the five things this surface renders have
 * no keys at all: a stack trace, a platform log line, a config **value**, a cache
 * **key name**. A key-name rule cannot see a token sitting in the middle of a
 * sentence, so this is a different mechanism with a different false-positive
 * profile, and it gets its own suite.
 *
 * ── What it is, stated as plainly as the service states it ────────────────────
 * ADR-015 D-1 calls the platform's own scrubber **"a net, not a boundary"**, and
 * that is exactly what this is too — a *second* net. The boundary for
 * `/system/config` is the server's allowlist and its boot assertion; the boundary
 * for a log line is that nobody logged a credential. Neither is something this
 * dashboard can enforce, so when one of them fails, the screen that reads the
 * output does not print the secret.
 *
 * ── What it deliberately does NOT match ──────────────────────────────────────
 * This half is as load-bearing as the patterns, and each omission is a decision:
 *
 * - **Bare hex, at any length.** 24 characters is an ObjectId and 64 is an upload
 *   fingerprint. Both are logged legitimately and both are how an operator finds
 *   the record they came looking for. ADR-015 D-1 makes the same call for the
 *   same reason: *a scrubber that mangles ordinary output is one an author works
 *   around.*
 * - **UUIDs.** Request, session, challenge and approval ids are all UUIDs, and
 *   `X-Request-Id` is the single most useful correlation handle on this surface.
 *   Blanking it would break the one workflow the error journal exists for.
 * - **Emails and phone numbers.** ADR-015 D-3 is explicit that log lines carry
 *   personal data *on purpose* — an address in a geocoding warning, a number in a
 *   WhatsApp send error — and that redacting it "would destroy the endpoint's
 *   reason to exist". This layer targets credential **shapes** only.
 * - **Long base64 with no `eyJ` anchor.** Too many false positives on ordinary
 *   payload dumps to be worth the one real catch.
 * - **Stripe publishable keys (`pk_live_`, `pk_test_`).** Publishable by design.
 *   Hiding one costs a diagnostic and protects nothing.
 *
 * ── Two properties are pinned by tests, not by care ──────────────────────────
 * Both because the platform's first implementation violated them (ADR-015 D-1):
 *
 * 1. **Idempotence.** Scrubbing twice equals scrubbing once. Every rule either
 *    re-matches `SCRUBBED` and replaces it with itself, or cannot match it at
 *    all. Getting there took two corrections worth recording, because both are
 *    the kind of bug that only shows up on a re-render:
 *      - the sentinel must contain **no whitespace**, or `Bearer \S+` eats only
 *        the first word of its own output and the string grows every pass;
 *      - `kv-secret`'s value class must **admit `]`**, or it matches
 *        `[secret-removed` without the closing bracket and appends a second one.
 * 2. **The scheme survives.** `Bearer [secret-removed]`, never
 *    `[secret-removed] [secret-removed]`. Which scheme was used is diagnosis; the
 *    value after it is not.
 *
 * ── One thing this is not ────────────────────────────────────────────────────
 * It is **not** HTML escaping. Everything here lands in a React text node, which
 * escapes on its own. If any of this output is ever put in an attribute, a URL or
 * `dangerouslySetInnerHTML`, this layer is not the control for that.
 */

import { redactMetadata } from '@/lib/audit-redaction';

/**
 * What replaces a matched secret.
 *
 * Deliberately one whitespace-free token — see property 1 above. Also
 * deliberately distinct from `audit-redaction.ts`'s `REDACTED`, so an operator
 * reading a screen that uses both can tell a hidden **field** from a scrubbed
 * **value**.
 */
export const SCRUBBED = '[secret-removed]';

/** A rule's name, as reported in `ScrubResult.matched`. */
export type ScrubRuleName =
    | 'pem'
    | 'auth-scheme'
    | 'jwt'
    | 'provider-key'
    | 'uri-userinfo'
    | 'kv-secret';

export interface ScrubResult {
    /** The same text with credential-shaped runs replaced. Safe to render. */
    text: string;
    /**
     * The rules that actually changed something, in application order.
     *
     * **Empty if and only if `text` is unchanged.** A rule that matched its own
     * previous output is not reported, because nothing was hidden on that pass —
     * which is what keeps a re-render from claiming a secret was found.
     */
    matched: ScrubRuleName[];
}

/**
 * A plain English word, lower-case or Capitalised.
 *
 * The guard on `auth-scheme`. Without it, `Basic authentication failed` — an
 * ordinary sentence in an ordinary log line — renders as
 * `Basic [secret-removed] failed`, which is exactly the "mangles ordinary output"
 * failure the module header warns about.
 *
 * It has to be a *shape* test rather than a length test, because a real
 * `Basic` credential is base64 and can be shorter than the English words that
 * follow the same keyword: `dXNlcjpwYXNz` is twelve characters and is
 * `user:pass`, while `authentication` is fourteen and is prose. Irregular case is
 * what separates them.
 */
const PLAIN_WORD = /^[A-Z]?[a-z]+$/;

/** Digits only — a count that cleared the length floor is not a credential. */
const ALL_DIGITS = /^\d+$/;

/**
 * Values that describe the absence or state of a credential rather than being
 * one, and are long enough to clear `kv-secret`'s six-character floor.
 *
 * `apiKey: undefined` is the case that forced this list. Masking it would make
 * the configuration screen stop answering the one question it exists to answer —
 * *is this configured* — which ADR-015 D-4 draws a whole decision around (`set:
 * false` is deliberately not `value: null`). A screen that hides "not set" is
 * worse than one with no scrubber at all, because it converts a fact into an
 * apparent secret.
 */
const STATUS_WORDS = new Set([
    'undefined',
    'notset',
    'not-set',
    'not_set',
    'missing',
    'absent',
    'unset',
    'disabled',
    'enabled',
    'default',
    'redacted',
    'masked',
    'removed',
]);

interface ScrubRule {
    name: ScrubRuleName;
    apply: (text: string) => string;
}

/**
 * Order matters, and one pair in particular.
 *
 * `auth-scheme` runs **before** `jwt` so that `Authorization: Bearer eyJ…`
 * reports as `auth-scheme` — the more informative of the two — rather than having
 * `jwt` consume the value first and leave `auth-scheme` matching a sentinel.
 *
 * `pem` runs first because it is the only multi-line structure: a rule that ate
 * part of a key block would leave a fragment that reads as a value.
 */
const RULES: readonly ScrubRule[] = [
    {
        /**
         * A whole **private key** block, keeping both delimiter lines.
         *
         * The `\1` back-reference makes the END line match the BEGIN line's label,
         * so two adjacent keys are two matches rather than one that swallows
         * whatever sat between them. The delimiters survive because "a private key
         * was here" is the fact an operator needs.
         *
         * **`PRIVATE KEY` is required in both delimiters, and that is the whole
         * point of the label group.** A `-----BEGIN CERTIFICATE-----` block is a
         * *public* certificate and is exactly what somebody reads while debugging
         * a TLS handshake — masking it would hide the only thing worth looking at
         * on that screen while protecting nothing.
         */
        name: 'pem',
        apply: (text) =>
            text.replace(
                /-----BEGIN ((?:[A-Z][A-Z0-9 ]*)?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
                `-----BEGIN $1-----${SCRUBBED}-----END $1-----`,
            ),
    },
    {
        /**
         * `Bearer` / `Basic` and the value after it — see `PLAIN_WORD` for the
         * guard, and property 2 for why the scheme is captured and re-emitted.
         *
         * The value class excludes `[` and `]`, so the rule simply does not fire
         * on its own output. That is idempotence by non-match rather than by
         * fixed point, which is the easier of the two to keep true.
         */
        name: 'auth-scheme',
        apply: (text) =>
            text.replace(
                /\b(Bearer|Basic)\s+([A-Za-z0-9+/=._~-]{12,})/gi,
                (whole, scheme: string, value: string) =>
                    PLAIN_WORD.test(value) ? whole : `${scheme} ${SCRUBBED}`,
            ),
    },
    {
        /**
         * A JSON Web Token, anchored on `eyJ`.
         *
         * That anchor is the whole precision of this rule: `eyJ` is base64 of
         * `{"`, so it starts a JSON header and essentially nothing else. Matching
         * "three dot-separated base64 runs" without it would eat a semantic
         * version (`1.2.3`), a dotted module path (`a.b.c`) and every namespaced
         * metric name on the metrics screen.
         *
         * The signature segment is allowed to be empty: `alg: none` produces a
         * trailing dot with nothing after it, and that is precisely a token worth
         * hiding rather than one worth skipping.
         */
        name: 'jwt',
        apply: (text) =>
            text.replace(/\beyJ[A-Za-z0-9_=-]{4,}\.[A-Za-z0-9_=-]{4,}\.[A-Za-z0-9_=-]*/g, SCRUBBED),
    },
    {
        /**
         * Provider keys that carry their own prefix, **keeping the prefix**.
         *
         * ADR-014 D-2 established the rule this follows: `sk_live_` versus
         * `sk_test_` is the fact an operator actually needs — is this instance
         * pointed at a live merchant account — and it is leak-free on its own. So
         * the mode survives and the secret does not.
         *
         * The list is tied to the integrations ADR-014 D-2 actually catalogues —
         * Stripe, Google (geocoding), SendGrid — rather than to every prefix that
         * exists. A rule for a service this platform does not have is surface
         * without a catch.
         *
         * AWS's `AKIA…` is deliberately absent: that is the access key *id*, not
         * the secret, and hiding it would remove a lookup handle for nothing —
         * the same call as `pk_*` above.
         */
        name: 'provider-key',
        apply: (text) =>
            text.replace(
                /\b(sk_live_|sk_test_|rk_live_|rk_test_|whsec_|AIza|SG\.|ghp_|gho_|github_pat_|xoxb-|xoxp-)[A-Za-z0-9_.-]{8,}/g,
                `$1${SCRUBBED}`,
            ),
    },
    {
        /**
         * The password half of a URI's userinfo, and only that half.
         *
         * `mongodb://svc:p4ssw0rd@host:27017/db` keeps its scheme, its user and
         * its host, because "which host is this pointed at" is the question the
         * line was logged to answer. Requiring `://` before and `@` after is what
         * keeps this off an ordinary email address and off `host:port` pairs —
         * the value class cannot cross a `/`, so `http://localhost:8022/api`
         * never reaches the `@` the pattern needs.
         */
        name: 'uri-userinfo',
        apply: (text) =>
            text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s@/]+)@/gi, `$1:${SCRUBBED}@`),
    },
    {
        /**
         * A named `key=value` or `key: value` pair whose key names a credential.
         *
         * The separator is **captured and re-emitted** rather than normalised: an
         * `=` that came back as a `:` is a small lie about what the line said, and
         * this rule runs over config values and cache key names where the
         * punctuation is part of the identifier.
         *
         * Three guards keep it off ordinary output, and each has a real victim:
         *
         * - **`\b` after the word**, so `tokenCount` and `tokenVersion` do not
         *   match — the same distinction `audit-redaction.ts` draws between a
         *   credential and a field that counts them.
         * - **Six characters minimum**, so `secret: true`, `token: 4` and
         *   `password: null` survive. A short value describes a credential rather
         *   than being one.
         * - **Not all digits**, so a bare count that clears the length floor
         *   (`tokens: 123456`) is still readable.
         *
         * `authorization` is deliberately **not** in the word list: it is what
         * `auth-scheme` handles, and matching it here would replace the word
         * `Bearer` and leave the token standing.
         *
         * This is also the rule that earns its place on the cache inspector,
         * where a key **name** like `download:token:<value>` is a disclosure the
         * contract's "values are never returned" promise does not cover.
         */
        name: 'kv-secret',
        apply: (text) =>
            text.replace(
                /\b(passwords?|passwd|passphrase|secrets?|tokens?|api[_\- ]?keys?|access[_\- ]?keys?|private[_\- ]?keys?|signing[_\- ]?keys?|credentials?)\b(\s*[=:]\s*)"?([^\s"',;&}]{6,})"?/gi,
                (whole, key: string, separator: string, value: string) =>
                    ALL_DIGITS.test(value) || STATUS_WORDS.has(value.toLowerCase())
                        ? whole
                        : `${key}${separator}${SCRUBBED}`,
            ),
    },
];

/**
 * Replace credential-shaped runs in a piece of free text.
 *
 * Returns the input unchanged with `matched: []` for an empty string, so a call
 * site can pass a `?? ''` without branching first.
 */
export function scrubText(input: string): ScrubResult {
    if (input.length === 0) return { text: input, matched: [] };

    let text = input;
    const matched: ScrubRuleName[] = [];

    for (const rule of RULES) {
        const next = rule.apply(text);
        // Compared rather than assumed: a rule that re-matched its own sentinel
        // changed nothing, and reporting it would tell an operator a secret was
        // found on a re-render when none was.
        if (next !== text) matched.push(rule.name);
        text = next;
    }

    return { text, matched };
}

/**
 * The text alone, for a render site with nowhere to put the disclosure.
 *
 * Prefer `scrubText` wherever the screen *can* say something was hidden — a
 * silent omission is the failure mode this whole layer exists to avoid.
 */
export function scrubbedText(input: string): string {
    return scrubText(input).text;
}

export interface ScrubJsonResult extends ScrubResult {
    /** From the key-name net — what `redactMetadata` withheld, by name. */
    redactedKeys: string[];
    /** A depth, size or cycle limit was hit while walking the object. */
    truncated: boolean;
}

/**
 * Both nets over one arbitrary object: key names first, then value shapes.
 *
 * ── Why one net is not enough here ────────────────────────────────────────────
 * `GET /system/errors` returns `details` **unmasked** by contract, and it is an
 * arbitrary object from a third-party failure. The two nets miss opposite things
 * and the error journal can produce both:
 *
 * - `{ "authorization": "Bearer eyJ…" }` — the **key** gives it away, and
 *   `redactMetadata` catches it.
 * - `{ "note": "retrying with Bearer eyJ…" }` — the key is innocent and the
 *   credential is a substring. Only the text pass catches that one.
 *
 * The traversal is `redactMetadata`'s, unchanged, so the depth cap, cycle
 * marking, array cap and `Date` handling are the ones already written and tested
 * rather than a second implementation that drifts — the same reasoning ADR-015
 * D-1 gives for deriving `REDACTED_PATHS` instead of copying it.
 *
 * Order matters: the key net runs first so its `REDACTED` sentinel is already in
 * place when the text pass runs, and `REDACTED` contains no shape the text rules
 * match. The two sentinels stay distinct on screen, which is what lets a reader
 * tell *"we did not trust this field's name"* from *"this value looked like a
 * secret"*.
 */
export function scrubJson(value: unknown, space = 2): ScrubJsonResult {
    const redacted = redactMetadata(value);
    const serialised = JSON.stringify(redacted.value ?? null, null, space) ?? 'null';
    const scrubbed = scrubText(serialised);

    return {
        text: scrubbed.text,
        matched: scrubbed.matched,
        redactedKeys: redacted.redactedKeys,
        truncated: redacted.truncated,
    };
}
