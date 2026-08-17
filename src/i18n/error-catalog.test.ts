/**
 * The transcription guard for the error registry.
 *
 * `KNOWN_ERROR_CODES` copies 50 codes out of `docs/admin/api/errors.md` by
 * hand, and the English catalog writes copy for each. Both drift silently: a
 * mistyped code can never match, so its message never appears and the failure
 * quietly renders as its category instead — plausible, and wrong.
 *
 * So this suite does not test the code: it **diffs the code against the
 * contract**. `CLAUDE.md` records that `docs/admin/` is a verbatim copy of
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

const DOC_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/admin/api/errors.md');
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
}

function parseRegistry(): DocEntry[] {
    const out: DocEntry[] = [];
    const seen = new Set<string>();

    for (const match of doc.matchAll(REGISTRY_ROW)) {
        const [, code, status, category, meaning] = match;
        // The Overrides table repeats four codes with a "Category used" column.
        // First occurrence wins: the registry is above it in the document.
        if (seen.has(code)) continue;
        seen.add(code);
        out.push({
            code,
            status: status.trim(),
            category: category.trim().replace(/`/g, ''),
            meaning: meaning.trim(),
        });
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
 */
const isPlatformCodeOnly = (entry: DocEntry) => entry.meaning.includes('`details.platformCode`');

const clientReachable = registry.filter((e) => !isBootTime(e) && !isPlatformCodeOnly(e));

describe('the registry parses', () => {
    it('finds the whole published registry', () => {
        // 62 rows today. A wildly different number means the parser stopped
        // matching, not that the contract shrank — fail loudly rather than
        // silently asserting over three rows.
        expect(registry.length).toBeGreaterThanOrEqual(60);
    });

    it('finds exactly ten boot-time codes and two platform-code-only ones', () => {
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
            'DEV_TOOLS_WORKER_BUSY',
            'DEV_TOOLS_WORKER_UNKNOWN',
        ]);
    });
});

describe('KNOWN_ERROR_CODES matches the contract', () => {
    it('names every client-reachable code the doc publishes', () => {
        const missing = clientReachable
            .map((e) => e.code)
            .filter((code) => !(KNOWN_ERROR_CODES as readonly string[]).includes(code));

        expect(missing, 'codes in errors.md with no entry in KNOWN_ERROR_CODES').toEqual([]);
    });

    it('invents nothing the doc does not', () => {
        const documented = new Set(registry.map((e) => e.code));
        const invented = KNOWN_ERROR_CODES.filter((code) => !documented.has(code));

        expect(invented, 'codes in KNOWN_ERROR_CODES that errors.md does not publish').toEqual([]);
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

    it('never collides with a wi-admin registry code', () => {
        // The two key spaces are separate on purpose: `platformCode` is
        // jovi-mall's vocabulary and `code` is wi-admin's. A name in both would
        // make the ladder's rung order decide which sentence wins, silently.
        const registryCodes = new Set<string>(KNOWN_ERROR_CODES);
        const collisions = Object.keys(en.platform).filter((code) => registryCodes.has(code));
        expect(collisions).toEqual([]);
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

describe('the six category overrides', () => {
    /**
     * The doc's prose says "Four codes" and its own table lists six. The table
     * is right — recorded as a doc bug in the phase summary. These are the rows
     * where the status alone gives the wrong client behaviour, and the client
     * must not re-derive the category from the status for them.
     */
    const OVERRIDES: [string, number, ErrorCategory][] = [
        ['ADMIN_AUTH_ACCOUNT_SUSPENDED', 403, 'authentication'],
        ['ADMIN_AUTH_MFA_REQUIRED', 403, 'authentication'],
        ['ADMIN_AUTH_CSRF_INVALID', 403, 'authentication'],
        ['ADMIN_AUTH_ACCOUNT_LOCKED', 423, 'authentication'],
        ['DEV_TOOLS_DISABLED', 409, 'business_rule'],
        ['AUDIT_LEGACY_FEED_DISABLED', 404, 'business_rule'],
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

    it('is the complete set — no seventh row appeared', () => {
        const overridden = registry.filter(
            (e) =>
                ERROR_CATEGORIES.includes(e.category as ErrorCategory) &&
                /^\d{3}$/.test(e.status) &&
                categoryFromStatus(Number(e.status)) !== e.category,
        );

        expect(overridden.map((e) => e.code).sort()).toEqual(OVERRIDES.map(([c]) => c).sort());
    });
});
