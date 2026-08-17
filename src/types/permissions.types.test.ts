/**
 * The transcription guard.
 *
 * `permissions.types.ts` copies 110 permission names out of
 * `docs/admin/api/permissions.md` by hand. A single typo there is invisible at
 * runtime — a permission that does not exist can never be held, so the screen it
 * gates simply never appears, for everybody, forever.
 *
 * So this suite does not test the code: it **diffs the code against the
 * contract**. `CLAUDE.md` records that `docs/admin/` is a verbatim copy of
 * `backend/admin/docs/`, re-copied when the backend changes, which makes the
 * markdown a moving target this file is pinned to. When the policy changes, this
 * fails first and names exactly what moved.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    PERMISSION_FAMILIES,
    PERMISSION_NAMES,
    UNROUTED_PERMISSION_NAMES,
} from '@/types/permissions.types';

const DOC_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../docs/admin/api/permissions.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

/**
 * A matrix row: `| \`agents.read\` | read | ● | ● | ● | — | View … |`, with an
 * optional ` †` after the name marking "no endpoint built yet".
 *
 * Anchored to the start of a table row and requiring at least one dot, so the
 * endpoint tables (`| \`GET /users/:userId/activity\` |`) and the flag table
 * (`| \`financial\` |`) cannot match.
 */
const ROW = /^\| `([a-z_]+(?:\.[a-z_]+)+)`( †)? \|/gm;

const FAMILY_HEADING = /^### `([a-z_]+)`/gm;

function documentedNames(): string[] {
    return [...doc.matchAll(ROW)].map((match) => match[1]);
}

function documentedUnrouted(): string[] {
    return [...doc.matchAll(ROW)].filter((match) => match[2]).map((match) => match[1]);
}

/** Both directions, reported as two readable lists rather than one boolean. */
function expectSameSet(actual: readonly string[], expected: readonly string[]) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);

    expect(
        [...expectedSet].filter((name) => !actualSet.has(name)),
        'documented but missing from permissions.types.ts',
    ).toEqual([]);
    expect(
        [...actualSet].filter((name) => !expectedSet.has(name)),
        'declared in permissions.types.ts but not in permissions.md',
    ).toEqual([]);
}

describe('the permission catalogue matches docs/admin/api/permissions.md', () => {
    it('finds the matrix at all', () => {
        // If the doc is restructured the regexes go quiet rather than wrong, and
        // every assertion below would pass against nothing. Fail loudly instead.
        expect(documentedNames().length).toBeGreaterThan(100);
        expect([...doc.matchAll(FAMILY_HEADING)].length).toBeGreaterThan(15);
    });

    it('declares every documented permission, and no others', () => {
        expectSameSet(PERMISSION_NAMES, documentedNames());
    });

    it('declares exactly the permissions the matrix marks †', () => {
        expectSameSet(UNROUTED_PERMISSION_NAMES, documentedUnrouted());
    });

    it('declares every documented family, and no others', () => {
        expectSameSet(
            PERMISSION_FAMILIES,
            [...doc.matchAll(FAMILY_HEADING)].map((match) => match[1]),
        );
    });

    it('holds the counts the document states in prose', () => {
        // permissions.md: "110 of 110", "28 of 110 permissions", 21 families.
        expect(PERMISSION_NAMES.length).toBe(110);
        expect(UNROUTED_PERMISSION_NAMES.length).toBe(28);
        expect(PERMISSION_FAMILIES.length).toBe(21);
        expect(PERMISSION_NAMES.length - UNROUTED_PERMISSION_NAMES.length).toBe(82);
    });
});

describe('the catalogue is internally consistent', () => {
    it('has no duplicate names', () => {
        expect(new Set(PERMISSION_NAMES).size).toBe(PERMISSION_NAMES.length);
        expect(new Set(UNROUTED_PERMISSION_NAMES).size).toBe(UNROUTED_PERMISSION_NAMES.length);
    });

    it('lists every unrouted permission in the full catalogue too', () => {
        const all = new Set<string>(PERMISSION_NAMES);
        for (const name of UNROUTED_PERMISSION_NAMES) {
            expect(all.has(name), `${name} is marked unrouted but is not in PERMISSION_NAMES`).toBe(
                true,
            );
        }
    });

    it('gives every permission a declared family and a family.resource.action shape', () => {
        const families = new Set<string>(PERMISSION_FAMILIES);
        for (const name of PERMISSION_NAMES) {
            const segments = name.split('.');
            expect(segments.length, `${name} is not family.resource.action`).toBeGreaterThanOrEqual(
                2,
            );
            expect(families.has(segments[0]), `${name} has an undeclared family`).toBe(true);
        }
    });

    it('uses every declared family at least once', () => {
        const used = new Set(PERMISSION_NAMES.map((name) => name.split('.')[0]));
        for (const family of PERMISSION_FAMILIES) {
            expect(used.has(family), `${family} is declared but has no permissions`).toBe(true);
        }
    });
});
