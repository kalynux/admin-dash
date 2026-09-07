/**
 * The transcription guard for the error registry.
 *
 * `KNOWN_ERROR_CODES` copies 50 codes out of `api-doc/admin/api/errors.md` by
 * hand, and the English catalog writes copy for each. Both drift silently: a
 * mistyped code can never match, so its message never appears and the failure
 * quietly renders as its category instead — plausible, and wrong.
 *
 * So this suite does not test the code: it **diffs the code against the
 * contract**. `CLAUDE.md` records that `api-doc/admin/` is a verbatim copy of
 * `backend/admin/docs/`, re-copied when the backend changes, which makes the
 * markdown a moving target this file is pinned to.
 *
 * **A failure here is a to-do, not an outage.** ADR-005 D-1 makes adding an
 * error code additive and D-17 says a client treats an unknown value as
 * unknown — the runtime degrades a new code to its category and carries on.
 * This is what makes sure somebody notices and writes the copy.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en/errors';
import fr from '@/i18n/locales/fr/errors';
import {
    ERROR_CATEGORIES,
    KNOWN_ERROR_CODES,
    categoryFromStatus,
    type ErrorCategory,
} from '@/types/api.types';

const DOC_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../api-doc/admin/api/errors.md');
const doc = readFileSync(DOC_PATH, 'utf8');

/**
 * A registry row: `| \`CODE\` | 404 | \`not_found\` | Meaning. |`.
 *
 * Anchored to a row whose first cell is a backticked SCREAMING_SNAKE name, so
 * the override table (same shape, different columns) and the prose tables
 * cannot be confused for it. The status cell is deliberately loose — one row
 * reads `502 / 503` and another `jovi-mall's own 4xx`.
 */
const REGISTRY_ROW = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;

interface DocEntry {
    code: string;
    status: string;
    category: string;
    meaning: string;
    /**
     * The prose between this row's nearest heading and its section's first table
     * row. A section that makes a declaration once, for all its rows, is the doc
     * author writing well — and a parser that only reads cells punishes that.
     */
    sectionPreamble: string;
}

const HEADING = /^#{1,6}\s/;
/** A table row of any shape — including the header and the `|---|` separator. */
const TABLE_ROW = /^\s*\|/;

/**
 * Walk the document line by line rather than with `matchAll`, so each row can
 * carry the prose its section opened with.
 */
function parseRegistry(): DocEntry[] {
    const out: DocEntry[] = [];
    const seen = new Set<string>();

    let preamble = '';
    let inTable = false;

    for (const line of doc.split('\n')) {
        if (HEADING.test(line)) {
            preamble = '';
            inTable = false;
            continue;
        }

        if (TABLE_ROW.test(line)) {
            inTable = true;

            // Reset the regex: it is `g`-flagged and shared across iterations.
            REGISTRY_ROW.lastIndex = 0;
            const match = REGISTRY_ROW.exec(line);
            if (!match) continue;

            const [, code, status, category, meaning] = match;
            // The Overrides table repeats four codes with a "Category used"
            // column. First occurrence wins: the registry is above it.
            if (seen.has(code)) continue;
            seen.add(code);
            out.push({
                code,
                status: status.trim(),
                category: category.trim().replace(/`/g, ''),
                meaning: meaning.trim(),
                sectionPreamble: preamble,
            });
            continue;
        }

        // Prose only counts before the section's first table. Anything after it
        // is a footnote about the rows above, not a declaration over them.
        if (!inTable) preamble += `${line}\n`;
    }

    return out;
}

const registry = parseRegistry();

/** Never reaches a browser — the process exits before it listens. */
const isBootTime = (entry: DocEntry) => entry.meaning.includes('**Boot-time.**');

/**
 * Never appears as `error.code`. jovi-mall's verdicts arrive as
 * `details.platformCode` on a forwarded `PLATFORM_OPERATION_REJECTED`, which is
 * a different catalog with a different key space.
 *
 * **The section preamble counts as much as the cell.** `### Credential recovery`
 * makes the declaration once, in prose above its table — *"Every one of these
 * arrives as `details.platformCode`"* — and its rows do not repeat it. Reading
 * cells alone would classify three codes that can never be `error.code` as
 * client-reachable and demand `codes` copy for them.
 *
 * ── ⚠ It matches the CLAIM, not the mention ──────────────────────────────────
 * This tested `.includes('`details.platformCode`')` until the 2026-08-24
 * re-copy, and that was too loose in the one direction that matters: it read a
 * *mention* of the field as a *declaration about the row*. Two new sections
 * broke it, both by writing well —
 *
 * - `### Content — the blog editor` says outright *"every one arrives as
 *   `error.code` — **none of these is a `details.platformCode`**"*, and the
 *   substring test turned that denial into ten false positives;
 * - `FILE_CONTENT_NOT_SUPPORTED`'s own row says its `details.platformCode` **is**
 *   `STORAGE_DOWNLOAD_NOT_SUPPORTED` — a wi-admin code that *carries* a platform
 *   code inside its details, which is the opposite of *being* one.
 *
 * Those eleven would have been quietly excluded from the copy requirement, so a
 * real `error.code` could reach an operator with no message and the suite would
 * have called it correct. Anchoring to *"arrives (only) as `details.platformCode`"*
 * — the phrasing every genuine row and both genuine preambles use — reproduces
 * the same twelve and nothing else. `\s` spans newlines because both preambles
 * wrap the phrase across a line break.
 */
const ARRIVES_AS_PLATFORM_CODE = /arrives?\s+(?:only\s+)?as\s+`details\.platformCode`/i;

const isPlatformCodeOnly = (entry: DocEntry) =>
    ARRIVES_AS_PLATFORM_CODE.test(entry.meaning) ||
    ARRIVES_AS_PLATFORM_CODE.test(entry.sectionPreamble);

const clientReachable = registry.filter((e) => !isBootTime(e) && !isPlatformCodeOnly(e));

describe('the registry parses', () => {
    it('finds the whole published registry', () => {
        // 74 rows today. A wildly different number means the parser stopped
        // matching, not that the contract shrank — fail loudly rather than
        // silently asserting over three rows.
        expect(registry.length).toBeGreaterThanOrEqual(70);
    });

    it('finds exactly ten boot-time codes and twelve platform-code-only ones', () => {
        expect(registry.filter(isBootTime).map((e) => e.code).sort()).toEqual([
            'AUDIT_CATALOG_INVALID',
            'AUDIT_COVERAGE_INCOMPLETE',
            'AUDIT_STORE_NOT_TRANSACTIONAL',
            'AUTHZ_GRANT_TABLE_INVALID',
            'AUTHZ_ROUTE_UNDECLARED',
            'CONFIG_INVALID_ENV',
            'CONFIG_MISSING_SECRET',
            'CONFIG_NOTIFICATION_COVERAGE_INCOMPLETE',
            'SYSTEM_CONFIG_EXPOSURE_UNSAFE',
            'SYSTEM_FEATURE_FLAG_CATALOG_INVALID',
        ]);

        expect(registry.filter(isPlatformCodeOnly).map((e) => e.code).sort()).toEqual([
            'AUTH_ACCOUNT_SUSPENDED',
            'BILLING_PENDING_PLAN_EXISTS',
            'BILLING_PLAN_INACTIVE',
            'BILLING_PLAN_ROLE_MISMATCH',
            'CONTRACT_INVALID_TRANSITION',
            'CONTRACT_TRANSITION_NOT_PERMITTED',
            'DEV_TOOLS_WORKER_BUSY',
            'DEV_TOOLS_WORKER_UNKNOWN',
            'MESSAGING_DELIVERY_FAILED',
            'USER_CHANNEL_UNAVAILABLE',
            'USER_CREDENTIAL_LINK_THROTTLED',
            'USER_LOGIN_LINK_ROLE_UNSUPPORTED',
        ]);
    });

    it('reads a denial as a denial, and "carries" as not "arrives as"', () => {
        // The regression for the substring predicate this replaced. Both groups
        // sit next to the phrase `details.platformCode` in the document and are
        // emphatically NOT platform-only; a loosening of the predicate makes
        // them client-unreachable, drops their copy requirement, and lets a real
        // `error.code` reach an operator as a bare category.
        const content = registry.find((e) => e.code === 'BLOG_ARTICLE_NOT_FOUND');
        expect(content, 'BLOG_ARTICLE_NOT_FOUND is missing from the registry').toBeDefined();
        expect(content!.sectionPreamble, 'the denial moved out of the preamble').toContain(
            '`details.platformCode`',
        );
        expect(isPlatformCodeOnly(content!), 'a denial was read as a declaration').toBe(false);

        const carries = registry.find((e) => e.code === 'FILE_CONTENT_NOT_SUPPORTED');
        expect(carries, 'FILE_CONTENT_NOT_SUPPORTED is missing from the registry').toBeDefined();
        expect(carries!.meaning).toContain('`details.platformCode`');
        expect(isPlatformCodeOnly(carries!), 'carrying one was read as being one').toBe(false);

        // …and every BLOG_* with it, since the preamble covers the whole table.
        const blog = registry.filter((e) => e.code.startsWith('BLOG_'));
        expect(blog.length, 'the blog section shrank').toBe(10);
        expect(blog.filter(isPlatformCodeOnly).map((e) => e.code)).toEqual([]);
    });

    it('classifies a code declared only by its section preamble', () => {
        // The narrow test for the section-aware path. `USER_CHANNEL_UNAVAILABLE`
        // is platform-only *because of its section's prose* — its own row says
        // nothing about `details.platformCode`. If someone reverts the parser to
        // reading cells alone, this fails and the twelve-name list above fails
        // with it, which is the point: one of them names the mechanism.
        const entry = registry.find((e) => e.code === 'USER_CHANNEL_UNAVAILABLE');
        expect(entry, 'USER_CHANNEL_UNAVAILABLE is missing from the registry').toBeDefined();
        expect(entry!.meaning).not.toContain('`details.platformCode`');
        expect(entry!.sectionPreamble).toContain('`details.platformCode`');
        expect(isPlatformCodeOnly(entry!)).toBe(true);
    });
});

/**
 * Every key of `ERROR_CODES` in `api-doc/admin/error-codes.ts`.
 *
 * ── Why a second source, when `errors.md` is the contract ─────────────────────
 * Because `errors.md` is a **claim about** the registry and this file **is** the
 * registry — a verbatim copy of `backend/admin/src/core/errors/error-codes.ts`,
 * re-copied rather than re-typed. `VERIFICATION-2026-08-24.md` states the
 * governing rule outright: *"The implementation is the source of truth. A
 * document — including the backend's own — is a claim about it, and a claim is
 * not evidence."*
 *
 * ⚠ **The numbers here have moved twice and are worth restating.** The source
 * once declared 82 against `errors.md`'s 73; BR-012 documented the missing
 * sixteen, and BR-015 added `FILE_UPLOAD_NOT_MULTIPART` and
 * `FILE_UPLOAD_TOO_LARGE`. **85 are declared today.** Diffing against both still
 * matters: a code reaching an operator with no copy is a failing test whichever
 * document happens to be behind.
 *
 * ⚠ **The two are NOT the same set, and the remaining gap runs one way only.**
 * Five codes are declared in source with no row in `errors.md`'s registry
 * tables — `DEV_TOOLS_WORKER_UNKNOWN`, `DEV_TOOLS_WORKER_BUSY`,
 * `USER_CHANNEL_UNAVAILABLE`, `USER_CREDENTIAL_LINK_THROTTLED` and
 * `USER_LOGIN_LINK_ROLE_UNSUPPORTED`. Each is *mentioned* on its endpoint's own
 * page, so this is a registry-table omission rather than an undocumented code,
 * and all five carry copy. Reported to the backend rather than worked around.
 * The **other** direction is asserted below, and it is the one that has actually
 * bitten.
 */
function sourceRegistryCodes(): string[] {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../api-doc/admin/error-codes.ts');
    const source = readFileSync(path, 'utf8');
    // `    SOME_CODE: 'SOME_CODE',` — key and value are identical by discipline.
    return [...source.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):\s*'([A-Z][A-Z0-9_]+)'/gm)].map(
        (match) => match[1],
    );
}

/**
 * The assertion a stale mirror slips past everything else.
 *
 * ⚠ **This exact drift happened on 2026-08-26 and nothing caught it.** The
 * 2026-08-24 resync re-copied `errors.md` — which gained the two BR-015 upload
 * codes — but did **not** re-take `api-doc/admin/error-codes.ts`, which stayed at
 * 83. Every assertion in this file still passed, because the one that pins
 * `KNOWN_ERROR_CODES` against the registries is anchored to their **union**, and
 * a union cannot notice that one of its members has fallen behind.
 *
 * So this pins the direction that matters instead: **every wi-admin code
 * `errors.md` publishes must be declared by the mirror.** Under that rule the
 * stale copy fails immediately and names the two codes it is missing.
 *
 * ⚠ **Not the converse**, and deliberately — see `sourceRegistryCodes`. Five
 * codes are declared in source with no registry row, which is a documentation
 * gap on the backend's side; asserting symmetry would turn their omission into
 * this repository's failing build and pressure somebody into "fixing" it by
 * deleting a real code from the mirror. **The mirror is a copy. It is never
 * edited to make a test pass — it is re-copied, or the test is wrong.**
 *
 * Platform-only codes are excluded because they are **jovi-mall's**: they reach
 * a client as `details.platformCode`, this service never declares them, and
 * their copy lives in `error-platform.ts`.
 */
describe('the source mirror is in step with the contract', () => {
    it('declares every wi-admin code errors.md publishes', () => {
        const declared = new Set(sourceRegistryCodes());
        const undeclared = registry
            .filter((entry) => !isPlatformCodeOnly(entry))
            .map((entry) => entry.code)
            .filter((code) => !declared.has(code));

        expect(
            undeclared,
            'codes in errors.md that api-doc/admin/error-codes.ts does not declare — re-copy backend/admin/src/core/errors/error-codes.ts',
        ).toEqual([]);
    });
});

describe('KNOWN_ERROR_CODES matches the contract', () => {
    it('names every client-reachable code the doc publishes', () => {
        const missing = clientReachable
            .map((e) => e.code)
            .filter((code) => !(KNOWN_ERROR_CODES as readonly string[]).includes(code));

        expect(missing, 'codes in errors.md with no entry in KNOWN_ERROR_CODES').toEqual([]);
    });

    it('invents nothing either registry declares', () => {
        // Anchored to the union: `errors.md` omits sixteen codes the service
        // genuinely raises, so pinning to it alone would forbid the copy those
        // codes need. See `sourceRegistryCodes`.
        const declared = new Set([...registry.map((e) => e.code), ...sourceRegistryCodes()]);
        const invented = KNOWN_ERROR_CODES.filter((code) => !declared.has(code));

        expect(invented, 'codes in KNOWN_ERROR_CODES that neither registry declares').toEqual([]);
    });

    it('names every client-reachable code the backend SOURCE declares', () => {
        // The half `errors.md` cannot catch. A module that ships without a
        // documentation update still fails here, because this reads the registry
        // the service actually throws from.
        //
        // The two exclusions are read off `errors.md` rather than guessed: a
        // boot-time code exits the process before it listens, and a
        // platform-only code arrives as `details.platformCode` and belongs to
        // `error-platform.ts`. A source code with no row in `errors.md` is
        // neither by construction — every boot-time and platform-only code is
        // documented — so it is required.
        const unreachable = new Set(
            registry.filter((e) => isBootTime(e) || isPlatformCodeOnly(e)).map((e) => e.code),
        );

        const missing = sourceRegistryCodes().filter(
            (code) =>
                !unreachable.has(code) &&
                !(KNOWN_ERROR_CODES as readonly string[]).includes(code),
        );

        expect(missing, 'codes in error-codes.ts with no entry in KNOWN_ERROR_CODES').toEqual([]);
    });

    it('excludes the boot-time and platform-code-only codes', () => {
        const excluded = registry
            .filter((e) => isBootTime(e) || isPlatformCodeOnly(e))
            .map((e) => e.code)
            .filter((code) => (KNOWN_ERROR_CODES as readonly string[]).includes(code));

        expect(excluded, 'codes that can never be error.code').toEqual([]);
    });

    it('has no duplicates', () => {
        expect(new Set(KNOWN_ERROR_CODES).size).toBe(KNOWN_ERROR_CODES.length);
    });
});

describe('the English catalog is exhaustive', () => {
    // `codes` is typed `Record<KnownErrorCode, string>`, so a *missing* key is
    // already a compile error. This catches the other direction and the empties.
    it('has a message for every known code', () => {
        const missing = KNOWN_ERROR_CODES.filter((code) => !en.codes[code]?.trim());
        expect(missing, 'codes with no English copy').toEqual([]);
    });

    it('carries no copy for a code that is not in the registry', () => {
        const known = new Set<string>(KNOWN_ERROR_CODES);
        expect(Object.keys(en.codes).filter((code) => !known.has(code))).toEqual([]);
        expect(Object.keys(en.codeHints).filter((code) => !known.has(code))).toEqual([]);
    });

    it('covers all nine categories twice — label and support hint', () => {
        expect(Object.keys(en.category).sort()).toEqual([...ERROR_CATEGORIES].sort());
        expect(Object.keys(en.categoryHint).sort()).toEqual([...ERROR_CATEGORIES].sort());
    });

    it('quotes the per-category support hints verbatim from the contract', () => {
        // These are also what `GET /system/errors` hands a Support-level caller
        // in place of the internal message, so a divergence would have the
        // dashboard and the error journal telling one operator two stories.
        //
        // Apostrophes are folded before comparing: the doc is written with the
        // ASCII `'` and the dashboard's copy uses the typographic `’`
        // throughout. That is a presentation choice, not a difference in what
        // the sentence says — and the words are what this guards.
        const fold = (value: string) => value.replace(/[’‘]/g, "'");
        const foldedDoc = fold(doc);

        for (const category of ERROR_CATEGORIES) {
            expect(foldedDoc, category).toContain(fold(en.categoryHint[category]));
        }
    });
});

/**
 * Every `PLATFORM_CODE_* = 'VALUE'` the dashboard declares.
 *
 * Read out of the source rather than imported, because these live scattered
 * across ten modules and an import list would itself be a transcription that
 * drifts. Multi-line declarations are covered: three of them wrap.
 */
function declaredPlatformCodes(): string[] {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
        ...readdirSync(join(root, 'types')).map((f) => join(root, 'types', f)),
        ...readdirSync(join(root, 'services')).map((f) => join(root, 'services', f)),
    ].filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const found = new Set<string>();
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(
            /export const PLATFORM_CODE_[A-Z0-9_]+\s*=\s*\n?\s*'([A-Z0-9_]+)'/g,
        )) {
            found.add(match[1]);
        }
    }
    return [...found].sort();
}

/**
 * The names that legitimately live in **both** key spaces.
 *
 * `CONTRACT_NOT_FOUND` is the only one. wi-admin minted it as its own registry
 * code in the dashboard-request round — `errors.md` gives the reason:
 * `/contracts/:contractId` is addressable and "not found" has to say *what*,
 * because the neighbouring 404s on that screen are about agents and agencies.
 * jovi-mall has carried a code of the same name all along, and it reaches us as
 * `details.platformCode` on the agent-transfer write.
 *
 * The invariant this list relaxes is about **rung order**, and rung order is not
 * at risk here: `resolveErrorMessage` reaches `errors.platform.*` only when
 * `isPlatformRejection`, and skips `errors.codes.*` on the generic delegated
 * code. The two rungs read different fields, so neither can shadow the other and
 * the outcome is deterministic in both directions. What is left to protect is
 * that the two sentences are not interchangeable — asserted below.
 */
const SHARED_CODE_NAMES: readonly string[] = ['CONTRACT_NOT_FOUND'];

describe('the platform catalog', () => {
    const declared = declaredPlatformCodes();

    it('finds the declarations at all', () => {
        // A parser that silently matches nothing would make every assertion
        // below vacuously true.
        expect(declared.length).toBeGreaterThanOrEqual(55);
    });

    it('has copy for every platform code the dashboard branches on', () => {
        // A code the dashboard already keys behaviour off is one an operator
        // demonstrably reaches, so it is exactly the set worth translating.
        const missing = declared.filter((code) => !(en.platform as Record<string, string>)[code]);
        expect(missing, 'PLATFORM_CODE_* constants with no English copy').toEqual([]);
    });

    it('translates all of it', () => {
        const missing = Object.keys(en.platform).filter(
            (code) => !(fr.platform as Record<string, string>)[code]?.trim(),
        );
        expect(missing, 'platform codes with no French copy').toEqual([]);
    });

    it('invents no French key English does not have', () => {
        const english = new Set(Object.keys(en.platform));
        expect(Object.keys(fr.platform).filter((code) => !english.has(code))).toEqual([]);
    });

    it('never collides with a wi-admin registry code, bar the declared one', () => {
        // The two key spaces are separate on purpose: `platformCode` is
        // jovi-mall's vocabulary and `code` is wi-admin's. A name in both would
        // make the ladder's rung order decide which sentence wins, silently.
        const registryCodes = new Set<string>(KNOWN_ERROR_CODES);
        const collisions = Object.keys(en.platform).filter(
            (code) => registryCodes.has(code) && !SHARED_CODE_NAMES.includes(code),
        );
        expect(collisions).toEqual([]);
    });

    it('gives the shared name a different sentence in each key space', () => {
        // The relaxation above is safe only while the two sentences say
        // different things. If they converge, one of them is redundant and the
        // allowlist is hiding a mistake rather than recording a decision.
        for (const code of SHARED_CODE_NAMES) {
            const registry = (en.codes as Record<string, string>)[code];
            const platform = (en.platform as Record<string, string>)[code];
            expect(registry, `${code} is allowlisted but has no registry copy`).toBeTruthy();
            expect(platform, `${code} is allowlisted but has no platform copy`).toBeTruthy();
            expect(registry, `${code} reads identically in both catalogs`).not.toBe(platform);
        }
    });
});

describe('the French catalog', () => {
    it('translates every code the English catalog covers', () => {
        const missing = Object.keys(en.codes).filter(
            (code) => !(fr.codes as Record<string, string>)[code]?.trim(),
        );
        expect(missing, 'codes with no French copy').toEqual([]);
    });

    it('invents no key English does not have', () => {
        // A key French has and English does not can never resolve: the schema
        // and the fallback chain are both English.
        const english = new Set(Object.keys(en.codes));
        expect(Object.keys(fr.codes).filter((code) => !english.has(code))).toEqual([]);

        const englishHints = new Set(Object.keys(en.codeHints));
        expect(Object.keys(fr.codeHints).filter((code) => !englishHints.has(code))).toEqual([]);
    });

    it('translates the chrome, the categories and the statuses', () => {
        expect(Object.keys(fr.category).sort()).toEqual(Object.keys(en.category).sort());
        expect(Object.keys(fr.categoryHint).sort()).toEqual(Object.keys(en.categoryHint).sort());
        expect(Object.keys(fr.status).sort()).toEqual(Object.keys(en.status).sort());
        expect(Object.keys(fr.state).sort()).toEqual(Object.keys(en.state).sort());
        expect(Object.keys(fr.detail).sort()).toEqual(Object.keys(en.detail).sort());
    });

    it('keeps every interpolation placeholder the English message declares', () => {
        // A dropped `{{requestId}}` loses the one handle support asks for, and
        // renders as a sentence that looks fine.
        const placeholders = (value: string) => (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort();

        for (const [key, value] of Object.entries(en.detail)) {
            if (typeof value !== 'string') continue;
            const translated = (fr.detail as Record<string, unknown>)[key];
            if (typeof translated !== 'string') continue;
            expect(placeholders(translated), `errors.detail.${key}`).toEqual(placeholders(value));
        }
    });
});

describe('categoryFromStatus matches the doc status table', () => {
    it('agrees with every row', () => {
        const table: [number, ErrorCategory][] = [
            [400, 'validation'],
            [413, 'validation'],
            [415, 'validation'],
            [401, 'authentication'],
            [403, 'authorization'],
            [404, 'not_found'],
            [410, 'not_found'],
            [409, 'conflict'],
            [422, 'business_rule'],
            [423, 'business_rule'],
            [429, 'rate_limit'],
            [502, 'external_service'],
            [503, 'external_service'],
            [504, 'external_service'],
        ];

        for (const [status, category] of table) {
            expect(categoryFromStatus(status), String(status)).toBe(category);
        }
    });

    it('is total: any other 4xx is a business rule, anything else is internal', () => {
        expect(categoryFromStatus(418)).toBe('business_rule');
        expect(categoryFromStatus(500)).toBe('internal');
        expect(categoryFromStatus(200)).toBe('internal');
        expect(categoryFromStatus(0)).toBe('internal');
    });
});

describe('the category overrides', () => {
    /**
     * The rows where the status alone gives the wrong client behaviour, so the
     * client must not re-derive the category from the status for them.
     *
     * ⚠ **Derived from the whole registry, not read off the doc's Overrides
     * table** — the second test below recomputes the set — so a code that
     * overrides without being listed there still lands here. Two have moved
     * since this was written: `AUDIT_LEGACY_FEED_DISABLED` left with its route
     * at Phase 5 Part D, and `FILE_CONTENT_NOT_SUPPORTED` arrived at BR-011.
     *
     * `FILE_CONTENT_NOT_SUPPORTED` is the interesting one: 409 would derive
     * `conflict`, which reads as "something changed underneath you, reload" —
     * exactly the wrong instruction for a storage provider that will refuse
     * every file forever. `business_rule` is the honest category, and the 409
     * was chosen over a 5xx so the boundary filter keeps the message and the
     * `details` that name the provider.
     */
    const OVERRIDES: [string, number, ErrorCategory][] = [
        ['ADMIN_AUTH_ACCOUNT_SUSPENDED', 403, 'authentication'],
        ['ADMIN_AUTH_MFA_REQUIRED', 403, 'authentication'],
        ['ADMIN_AUTH_CSRF_INVALID', 403, 'authentication'],
        ['ADMIN_AUTH_ACCOUNT_LOCKED', 423, 'authentication'],
        ['DEV_TOOLS_DISABLED', 409, 'business_rule'],
        ['FILE_CONTENT_NOT_SUPPORTED', 409, 'business_rule'],
    ];

    it('are all published, and all disagree with the status table', () => {
        for (const [code, status, category] of OVERRIDES) {
            const entry = registry.find((e) => e.code === code);
            expect(entry, code).toBeDefined();
            expect(entry?.category, code).toBe(category);
            // An override that agrees with the derivation is dead policy.
            expect(categoryFromStatus(status), code).not.toBe(category);
        }
    });

    it('is the complete set — no further row appeared', () => {
        const overridden = registry.filter(
            (e) =>
                ERROR_CATEGORIES.includes(e.category as ErrorCategory) &&
                /^\d{3}$/.test(e.status) &&
                categoryFromStatus(Number(e.status)) !== e.category,
        );

        expect(overridden.map((e) => e.code).sort()).toEqual(OVERRIDES.map(([c]) => c).sort());
    });
});
