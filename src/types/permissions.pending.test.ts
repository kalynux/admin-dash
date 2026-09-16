/**
 * The guard that empties the waiting room.
 *
 * `permissions.pending.ts` exists because two permissions the service grants are
 * missing from `permissions.md`. The risk of such a file is not that it is wrong
 * today — it is that it is still here in a year, quietly holding names the
 * catalogue caught up with months ago, while `can()` sits unused beside it.
 *
 * So this asserts the **only** condition under which it should exist: that the
 * contract still does not publish these names. The day it does, this fails and
 * says what to do — which is the hand-off a comment could not make.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PENDING_PERMISSION_NAMES } from '@/types/permissions.pending';
import { PERMISSION_NAMES } from '@/types/permissions.types';

const DOC_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../api-doc/admin/api/permissions.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

describe('the pending-permission waiting room', () => {
    /**
     * The failure this exists for.
     *
     * ⚠ **When this goes red, nothing is broken** — the backend documented the
     * permission. Move the name into `PERMISSION_NAMES` in `permissions.types.ts`
     * (which will also want its count assertions re-derived by
     * `npm run authz:matrix`), switch the call sites from
     * `usePendingPermission()` to `can()`, and delete the entry here.
     */
    it.each(PENDING_PERMISSION_NAMES)(
        'is still absent from permissions.md: %s',
        (name) => {
            expect(
                doc.includes(`\`${name}\``),
                `permissions.md now publishes \`${name}\`. The waiting room is no longer the ` +
                    `right home for it — move it into PERMISSION_NAMES and switch its call ` +
                    `sites to can(). See the docstring on permissions.pending.ts.`,
            ).toBe(false);
        },
    );

    /**
     * The converse trap: a name parked here that the catalogue *does* carry would
     * be reachable two ways, and the two could disagree the day one moved.
     */
    it('never duplicates a catalogued name', () => {
        const catalogued = new Set<string>(PERMISSION_NAMES);
        for (const name of PENDING_PERMISSION_NAMES) {
            expect(catalogued.has(name)).toBe(false);
        }
    });

    /** Both are real names in the service's own catalogue, so shape them like it. */
    it('names permissions in family.resource.action shape', () => {
        for (const name of PENDING_PERMISSION_NAMES) {
            expect(name.split('.').length).toBeGreaterThanOrEqual(2);
            expect(name).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
        }
    });
});
