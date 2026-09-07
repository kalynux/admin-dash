/**
 * The transcription guard for jovi-mall's ticket vocabularies.
 *
 * `support.types.ts` hard-codes five lists that **wi-admin does not own and does
 * not validate** — it checks them for shape (a 1–60 character token) and passes
 * them through. jovi-mall owns them and grows them with the product.
 *
 * ── Why they are hard-coded rather than fetched ───────────────────────────────
 * The decision is recorded because it looks wrong at first glance:
 *
 * > **No endpoint should expose these vocabularies. Not now, not later.**
 *
 * A route on wi-admin publishing them would be wi-admin taking ownership of a
 * list it does not own, and a second place for that list to live. So they are
 * mirrored from `api-doc/jovi-mall/ticket-vocabularies.ts` — byte-identical to
 * `modules/tickets/types/ticket.types.ts` — and this suite is what makes the
 * copy safe, exactly as `permissions.types.test.ts` does for the permission
 * vocabulary.
 *
 * ⚠ **A failure here means jovi-mall moved.** The remedy is to re-copy the
 * mirror and reconcile, never to loosen the assertion.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    ACTOR_ROLES,
    ENTITY_TYPE_WITHOUT_ID,
    FOLLOWER_ROLES,
    TERMINAL_TICKET_STATUSES,
    TICKET_ENTITY_TYPES,
    TICKET_IMPORTANCES,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
    TICKET_TYPES,
} from '@/types/support.types';

const MIRROR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../api-doc/jovi-mall/ticket-vocabularies.ts',
);

const mirror = readFileSync(MIRROR, 'utf8');

/** The string values of `export enum Name { KEY = 'value', … }`. */
function documented(name: string): string[] {
    const match = new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(mirror);
    expect(match, `${name} is no longer an enum in the mirror`).not.toBeNull();
    return [...match![1].matchAll(/=\s*'([^']+)'/g)].map((entry) => entry[1]);
}

/**
 * Both directions **and the order**, unlike the permission guard's set diff.
 *
 * These lists are rendered as pickers, so their order is what an operator reads
 * down. jovi-mall groups its ticket types by subject — account, order, payment,
 * payout — and losing that grouping turns a 39-item menu into an unscannable
 * wall. So the order is part of what is pinned.
 */
function expectSameList(ours: readonly string[], theirs: string[], what: string) {
    const oursSet = new Set(ours);
    const theirsSet = new Set(theirs);

    expect(
        theirs.filter((v) => !oursSet.has(v)),
        `${what}: in the mirror, missing from support.types.ts`,
    ).toEqual([]);
    expect(
        ours.filter((v) => !theirsSet.has(v)),
        `${what}: in support.types.ts, not in the mirror`,
    ).toEqual([]);
    expect([...ours], `${what}: same members, different order`).toEqual(theirs);
}

describe('the mirror parses at all', () => {
    it('finds the enums', () => {
        // If the mirror is restructured the regexes go quiet rather than wrong,
        // and every assertion below would pass against nothing.
        expect(documented('TicketType').length).toBeGreaterThan(30);
        expect(mirror).toContain('export enum TicketStatus');
    });
});

describe('the five vocabularies match jovi-mall', () => {
    it('declares every ticket type, in the mirror’s grouping', () => {
        expectSameList(TICKET_TYPES, documented('TicketType'), 'ticket types');
    });

    it('declares every status', () => {
        expectSameList(TICKET_STATUSES, documented('TicketStatus'), 'statuses');
    });

    it('declares every priority', () => {
        expectSameList(TICKET_PRIORITIES, documented('TicketPriority'), 'priorities');
    });

    it('declares every importance', () => {
        expectSameList(TICKET_IMPORTANCES, documented('TicketImportance'), 'importances');
    });

    it('declares every entity type', () => {
        expectSameList(TICKET_ENTITY_TYPES, documented('EntityType'), 'entity types');
    });

    it('declares every actor role', () => {
        expectSameList(ACTOR_ROLES, documented('ActorRole'), 'actor roles');
    });
});

describe('the counts, which the gap-closure plan got wrong', () => {
    it('has 39 ticket types, not 43', () => {
        // `GAP-CLOSURE-PLAN.md` § A2 tabulates 43; `CLAUDE.md` says 39. Counted
        // off the mirror, 39 is right — recorded here so the number has one
        // source rather than two prose claims that disagree.
        expect(TICKET_TYPES.length).toBe(39);
        expect(documented('TicketType')).toHaveLength(39);
    });

    it('holds the other four counts the plan states', () => {
        expect(TICKET_STATUSES.length).toBe(9);
        expect(TICKET_PRIORITIES.length).toBe(4);
        expect(TICKET_IMPORTANCES.length).toBe(4);
        expect(TICKET_ENTITY_TYPES.length).toBe(11);
    });
});

describe('the distinctions that are easy to collapse', () => {
    it('keeps priority and importance apart, values included', () => {
        /**
         * ⚠ Not interchangeable, and not merely different scales: `priority` is
         * what the desk decided and is mutable; `importance` is what the person
         * opening the ticket thought and is **immutable**. Their values differ
         * too — `normal`/`urgent` against `medium`/`critical` — so a component
         * that renders one with the other's list shows options the API refuses.
         */
        expect(TICKET_PRIORITIES).not.toEqual(TICKET_IMPORTANCES);
        expect(TICKET_PRIORITIES).toContain('normal');
        expect(TICKET_PRIORITIES).not.toContain('medium');
        expect(TICKET_IMPORTANCES).toContain('medium');
        expect(TICKET_IMPORTANCES).not.toContain('normal');
    });

    it('excludes `admin` from the follower roles, and only `admin`', () => {
        /**
         * ⚠ **`admin` must not be expressible as a follower.** Followers are
         * platform actors; an administrator's relationship to a ticket is the
         * *assignment*. A private note's visibility list is computed from the
         * follower rows, so an administrator appearing there would put staff
         * commentary in front of them through the wrong door.
         *
         * Asserted as a derivation rather than a second literal list, so the two
         * cannot drift: if jovi-mall adds a sixth actor role, this fails and asks
         * whether it may follow a ticket.
         */
        expect([...FOLLOWER_ROLES]).toEqual(ACTOR_ROLES.filter((role) => role !== 'admin'));
    });

    it('names the two terminal statuses, both of which are real statuses', () => {
        const documentedTerminal = /TERMINAL_TICKET_STATUSES[^=]*=\s*\[([\s\S]*?)\]/.exec(mirror);
        expect(documentedTerminal, 'the terminal list moved').not.toBeNull();

        // The mirror names them as enum members (`TicketStatus.RESOLVED`), so
        // resolve through the enum rather than expecting bare strings.
        const keys = [...documentedTerminal![1].matchAll(/TicketStatus\.(\w+)/g)].map((m) => m[1]);
        expect(keys).toEqual(['RESOLVED', 'CLOSED']);
        expect([...TERMINAL_TICKET_STATUSES]).toEqual(['resolved', 'closed']);

        for (const status of TERMINAL_TICKET_STATUSES) {
            expect(TICKET_STATUSES, `${status} is not a status`).toContain(status);
        }
    });

    it('names an entity type that genuinely exists as the id-free one', () => {
        // `entityId` is required unless `entityType` is this. wi-admin does not
        // enforce that, so the dialog must — and it must key off a real value.
        expect(TICKET_ENTITY_TYPES).toContain(ENTITY_TYPE_WITHOUT_ID);
        expect(ENTITY_TYPE_WITHOUT_ID).toBe('OTHER');
    });
});
