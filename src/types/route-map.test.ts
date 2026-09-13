/**
 * `api-doc/ROUTE-MAP.md`, parsed and checked against itself and against the
 * permission vocabulary.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The 2026-09-08 resync added a whole route group (`/automation`), a route
 * (`GET /agents/:agentId/assignability`), and **changed the guard on one that
 * was already built** — `GET /agents/:agentId/cod-allocation` went from
 * `agents.read` to `agents.read` + `agencies.read`. Two guards in this
 * repository parse `api-doc/` and both stayed silent, correctly: one covers the
 * permission *vocabulary* and the other the *error* registry, and neither has
 * anything to say about routes.
 *
 * So the arrival of a route group was invisible to the suite. This is the file
 * that makes it visible.
 *
 * ── What it does NOT claim ───────────────────────────────────────────────────
 * ⚠ **This proves the document is internally consistent, not that it matches
 * the service.** Only `routeManifest()` can say that, and it lives in
 * `backend/admin`. `ROUTE-MAP.md` is generated from that manifest, so a stale
 * *file* still passes every assertion here — which is why the file's own
 * "Reproducing this table" recipe stays the authority. What this catches is the
 * cheaper and commoner failure: the document being re-copied and **nobody in
 * `src/` noticing**.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PERMISSION_NAMES } from './permissions.types';

const doc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../api-doc/ROUTE-MAP.md'),
    'utf8',
);

/** `### \`/support\` — 19 routes` — the singular "route" is real (`/messaging`). */
const NAMESPACE = /^### `(\/[a-z-]+)` — (\d+) routes?$/gm;

/** A table row: `| GET | \`/path\` | \`perm\` | … |`. */
const ROW = /^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|([^|]*)\|/gm;

interface Namespace {
    name: string;
    declared: number;
    rows: { method: string; path: string; permissionCell: string }[];
}

/**
 * Split the document at its `###` namespace headings and read each table.
 *
 * Sliced by heading offset rather than by a single sweep, so a row can be
 * attributed to the section it is under — the whole point is to report *which*
 * namespace disagrees.
 */
function parseNamespaces(): Namespace[] {
    const headings = [...doc.matchAll(NAMESPACE)];

    return headings.map((heading, index) => {
        const start = heading.index + heading[0].length;
        const end = index + 1 < headings.length ? headings[index + 1].index : doc.length;
        const body = doc.slice(start, end);

        return {
            name: heading[1],
            declared: Number(heading[2]),
            rows: [...body.matchAll(ROW)].map((row) => ({
                method: row[1],
                path: row[2],
                permissionCell: row[3].trim(),
            })),
        };
    });
}

const namespaces = parseNamespaces();
const totalDeclared = namespaces.reduce((sum, ns) => sum + ns.declared, 0);

describe('ROUTE-MAP.md parses', () => {
    it('finds the namespace sections at all', () => {
        // Anti-vacuity: every assertion below compares against these, and a
        // parser that matched nothing would make all of them trivially true.
        expect(namespaces.length).toBeGreaterThan(20);
        expect(namespaces.map((ns) => ns.name)).toContain('/support');
    });

    it('counts the rows each section says it holds', () => {
        const disagreements = namespaces
            .filter((ns) => ns.rows.length !== ns.declared)
            .map((ns) => `${ns.name}: heading says ${ns.declared}, table holds ${ns.rows.length}`);

        expect(disagreements, 'namespace headings that disagree with their own tables').toEqual([]);
    });
});

describe('the route total is the sum of its parts', () => {
    it('agrees with both headings that state it', () => {
        // The title and the "by namespace" heading are written by hand and have
        // disagreed with the table before — the file records the total reading
        // 233 here and 236 in the index while the real figure was 239.
        expect(doc, 'the document title').toContain(
            `# Route map — all ${totalDeclared} wi-admin routes`,
        );
        expect(doc, 'the "by namespace" heading').toContain(
            `## The ${totalDeclared} routes, by namespace`,
        );
    });

    it('holds the 239 routes the 2026-09-08 verification counted', () => {
        // Pinned deliberately, and it is the assertion that fires when the
        // backend ships a route group. A change here is not a failure to fix by
        // editing this number: it means a route arrived, and something in `src/`
        // may now need a service function, a nav entry or a wider guard.
        expect(totalDeclared).toBe(239);
    });
});

describe('every permission the route map names is one we declare', () => {
    /**
     * Permission cells are either backticked names, or an italic access kind
     * (`*self*`, `*public*`, `*mfa-enrolment*`, `*unversioned*`), or `—`.
     * A composite reads `` `a.b.c` + `d.e.f` `` or `` `a` **or** `b` ``.
     */
    const named = new Set(
        namespaces.flatMap((ns) =>
            ns.rows.flatMap((row) =>
                [...row.permissionCell.matchAll(/`([a-z_]+(?:\.[a-z_]+)+)`/g)].map((m) => m[1]),
            ),
        ),
    );

    it('finds permissions at all', () => {
        expect(named.size).toBeGreaterThan(50);
    });

    it('names nothing absent from PERMISSION_NAMES', () => {
        const declared = new Set<string>(PERMISSION_NAMES);
        const unknown = [...named].filter((name) => !declared.has(name)).sort();

        expect(
            unknown,
            'permissions the route map gates a route on that permissions.types.ts does not declare',
        ).toEqual([]);
    });
});

describe('the composite guards, as the route map declares them', () => {
    /**
     * A row whose permission cell names two or more permissions.
     *
     * ⚠ **This is the check that would have caught the `cod-allocation`
     * defect.** That route was gated on `agents.read` alone in the document and
     * in this dashboard, and needs `agents.read` + `agencies.read`; the resync
     * called it *"a real gate defect"* and noted that a nav item built on the
     * documented value renders a link that 403s. Pinning the set means the next
     * one arrives as a named failure rather than as a support ticket.
     */
    const composite = namespaces
        .flatMap((ns) => ns.rows)
        .filter(
            (row) => [...row.permissionCell.matchAll(/`[a-z_]+(?:\.[a-z_]+)+`/g)].length > 1,
        )
        .map((row) => `${row.method} ${row.path}`)
        .sort();

    it('is exactly the twenty the contract enumerates', () => {
        // Seventeen `all`-mode plus three `any`-mode, per permissions.md's own
        // § "Composite guards". That count has been stale three separate times —
        // "Thirteen", then "fourteen plus the any-mode one", then "fifteen …
        // sixteen in all" — which is why the document says to derive it.
        expect(composite).toEqual([
            'GET /accounts/:ownerType/:ownerId',
            'GET /accounts/:ownerType/:ownerId/activity',
            'GET /agencies/:agencyId/activity',
            'GET /agencies/:agencyId/agents',
            'GET /agents/:agentId/activity',
            'GET /agents/:agentId/assignability',
            'GET /agents/:agentId/cod-allocation',
            'GET /agents/:agentId/contracts',
            'GET /automation/failures',
            'GET /automation/summary',
            'GET /cod/agents/:agentId/trust-events',
            'GET /contracts/:contractId',
            'GET /money/payouts/:payoutId/activity',
            'GET /orders/:orderId/activity',
            'GET /shipments/:shipmentId/activity',
            'GET /shipments/:shipmentId/offers',
            'GET /system/errors',
            'GET /users/:userId/activity',
            'GET /vendors/:vendorId/activity',
            'GET /vendors/:vendorId/agencies',
        ]);
    });
});
