/**
 * A second net over the recorded state an audit entry carries.
 *
 * ── What this is, and what it is not ──────────────────────────────────────────
 * `GET /audit/:auditId` is the only screen on this dashboard that renders data
 * the server captured from a request body: `payload`, `before` and `after`. Those
 * arrive **already sanitised** — ADR-006 D-5's `sanitiseState()` strips
 * credential-shaped fields at any depth, deriving its field set from the logger's
 * `REDACTED_PATHS` rather than maintaining a second list, and a password reset
 * audits `{ passwordRotated: true }` rather than the one-time password itself.
 *
 * **This is not a transcription of that list.** `REDACTED_PATHS` is not in
 * `api-doc/`, so it cannot be copied, and claiming parity with a list we cannot read
 * would be exactly the drift this codebase keeps recording. What follows is a
 * deliberately broad heuristic whose only job is to make a server-side regression
 * non-fatal: if a credential ever does reach a row, the screen that reads rows
 * does not print it.
 *
 * The cost of being broad is a false positive — a benign `tokenCount` or
 * `keyName` hidden for looking like a secret. That is why nothing is hidden
 * *silently*: `redactedKeys` names what was withheld, so an operator can see the
 * shape of what they are not being shown and ask for it another way. A blank
 * where a value should be is a rendering bug; a labelled omission is a decision.
 *
 * ── Why the traversal is defensive ────────────────────────────────────────────
 * `payload` and `before`/`after` are `Schema.Types.Mixed` server-side, so their
 * contents are whatever a request body held. Depth, cycles and size are all
 * attacker-adjacent, and the same three choices the server made are made here for
 * the same reasons: cap the depth, mark cycles rather than throwing, and never
 * let rendering one row take the screen down.
 */

/**
 * Long fragments, matched as **substrings** of the fully normalised key.
 *
 * `passwordHash`, `password_hash`, `PASSWORD-HASH` and `newPassword` all hit
 * `password`. Every entry is long enough that an accidental match on an ordinary
 * business field is not a realistic worry.
 */
const CREDENTIAL_STEMS: readonly string[] = [
    'password',
    'passwd',
    'passphrase',
    'secret',
    'token',
    'credential',
    'authorization',
    'signature',
    'apikey',
    'accesskey',
    'secretkey',
    'privatekey',
    'signingkey',
    'encryptionkey',
    'sessionid',
    'cookie',
    'cardnumber',
    'accountnumber',
    'routingnumber',
];

/**
 * Short tokens, matched only against a **whole word** of the key.
 *
 * ── Why these cannot be substrings ────────────────────────────────────────────
 * This is the distinction that keeps the redactor from eating ordinary fields,
 * and it is not hypothetical:
 *
 * - `pin` is a substring of **shi·ppin·g**, so a substring rule blanks
 *   `shippingAddress` on every order diff.
 * - `pan` is a substring of **com·pan·y**, so it blanks `companyName`.
 *
 * Splitting the key into words first — on punctuation *and* camelCase — makes
 * `pinCode` and `otpCode` match while `shippingAddress` and `companyName` do not.
 *
 * **`key` is deliberately absent.** A bare `key` word would blank the single most
 * informative field on every `feature_flag` audit row, and the compound forms
 * that actually matter (`apiKey`, `privateKey`, `signingKey`) are already covered
 * as stems above.
 */
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
    'pin',
    'pan',
    'cvv',
    'cvc',
    'ssn',
    'iban',
    'otp',
    'totp',
    'mfa',
    'csrf',
    'nonce',
    'salt',
    'hash',
]);

/**
 * Key names that contain a fragment above but are **not** secrets, and whose
 * values are worth reading.
 *
 * Checked before the fragment scan. Without this list an audit row for an MFA
 * enrolment renders as an empty object — `mfaEnabled`, `mfaEnrolledAt` and
 * `mfaRequired` all contain `mfa`, and every one of them is a boolean or a
 * timestamp that says what happened. Hiding those does not protect anything and
 * removes the only description of the change.
 *
 * Compared against the *whole* normalised key, never as a substring: an
 * allowance that matched loosely would re-open everything it was meant to narrow.
 */
const NOT_SECRET: ReadonlySet<string> = new Set([
    'passwordrotated',
    'passwordchangedat',
    'passwordupdatedat',
    'mfaenabled',
    'mfarequired',
    'mfaenrolledat',
    'mfaactivatedat',
    'mfaenrolmentrequired',
    'mfaenrollmentrequired',
    'tokencount',
    'tokenversion',
    'hashalgorithm',
    'sha256',
    'otpexpiresat',
    'sessioncount',
]);

/**
 * How deep to walk before summarising.
 *
 * Four, matching the cap the service applies to `details` in `errors.md`. Deeper
 * than that in an audit diff is a document rather than a change, and the trail
 * records what moved.
 */
const MAX_DEPTH = 4;

/** How many entries of one array or object to render before summarising the rest. */
const MAX_ENTRIES = 100;

export const REDACTED = '[redacted by dashboard]';
export const TRUNCATED = '[truncated]';
export const CIRCULAR = '[circular]';

export interface RedactionResult {
    /** The same shape, with credential-shaped values replaced. Safe to render. */
    value: unknown;
    /**
     * The keys this dashboard hid, in encounter order and de-duplicated.
     *
     * Names only — never the values. Surfacing the count and the names is what
     * makes the omission legible instead of looking like missing data.
     */
    redactedKeys: string[];
    /** A depth, size or cycle limit was hit and something was summarised. */
    truncated: boolean;
}

/** Lowercase and drop everything that is not a letter or a digit. */
function normaliseKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Split a key into its words, on punctuation **and** camelCase boundaries.
 *
 * `shippingAddress` → `['shipping', 'address']`, `pin_code` → `['pin', 'code']`,
 * `X-CSRF-Token` → `['x', 'csrf', 'token']`, `APIKey` → `['api', 'key']`.
 *
 * The second replace handles a run of capitals followed by a capitalised word,
 * which is what keeps `APIKey` from collapsing into one unsplittable token.
 */
function wordsOf(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .map((word) => word.toLowerCase())
        .filter(Boolean);
}

/**
 * Whether a key's **value** must not be rendered.
 *
 * Exported for the tests, which assert the classifier directly — the traversal
 * and the rule are separate concerns, and a bug in either should point at itself.
 */
export function isCredentialKey(key: string): boolean {
    const normalised = normaliseKey(key);
    if (normalised.length === 0) return false;

    // Checked before either rule: these contain a credential fragment and are
    // the field that describes the change rather than being one.
    if (NOT_SECRET.has(normalised)) return false;

    if (CREDENTIAL_STEMS.some((stem) => normalised.includes(stem))) return true;

    return wordsOf(key).some((word) => CREDENTIAL_WORDS.has(word));
}

/**
 * Walk a recorded-state object, replacing credential-shaped values.
 *
 * `null` in, `null` out — a field the server recorded as absent stays absent
 * rather than becoming an empty object, because on this service `null` is a fact
 * about the record and `{}` would be a different claim.
 */
export function redactMetadata(input: unknown): RedactionResult {
    const redactedKeys: string[] = [];
    const seenKeys = new Set<string>();
    /**
     * Identity-based, so a value legitimately repeated across siblings — the same
     * id in two fields — is rendered twice rather than the second being called a
     * cycle. Only ancestors are held, which is what makes that distinction.
     */
    const ancestors = new Set<object>();
    let truncated = false;

    function note(key: string): void {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        redactedKeys.push(key);
    }

    function walk(value: unknown, depth: number): unknown {
        if (value === null || typeof value !== 'object') return value;

        // A Date survives `typeof === 'object'` and would otherwise be walked into
        // an empty object. Mongo hands these back as ISO strings, but a value from
        // `Schema.Types.Mixed` is whatever was stored.
        if (value instanceof Date) return value.toISOString();

        if (ancestors.has(value)) {
            truncated = true;
            return CIRCULAR;
        }

        if (depth >= MAX_DEPTH) {
            truncated = true;
            return TRUNCATED;
        }

        ancestors.add(value);
        try {
            if (Array.isArray(value)) {
                const kept = value.slice(0, MAX_ENTRIES).map((entry) => walk(entry, depth + 1));
                if (value.length > MAX_ENTRIES) {
                    truncated = true;
                    kept.push(`${TRUNCATED} ${value.length - MAX_ENTRIES} more`);
                }
                return kept;
            }

            const out: Record<string, unknown> = {};
            const entries = Object.entries(value as Record<string, unknown>);

            for (const [key, entry] of entries.slice(0, MAX_ENTRIES)) {
                if (isCredentialKey(key)) {
                    note(key);
                    out[key] = REDACTED;
                    continue;
                }
                out[key] = walk(entry, depth + 1);
            }

            if (entries.length > MAX_ENTRIES) {
                truncated = true;
                out[TRUNCATED] = `${entries.length - MAX_ENTRIES} more field(s)`;
            }

            return out;
        } finally {
            // Removed on the way back up: a sibling is not a cycle.
            ancestors.delete(value);
        }
    }

    return { value: walk(input, 0), redactedKeys, truncated };
}
