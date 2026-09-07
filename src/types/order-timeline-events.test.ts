/**
 * The transcription guard for jovi-mall's order-timeline vocabulary.
 *
 * `orders.types.ts` hard-codes the nine `eventType` values so the timeline's
 * filter can be a `<Select>` rather than the free-text box the rest of this
 * dashboard uses for a filter. That is a deliberate exception to the standing
 * rule — *filters stay free-text, only create forms get pickers* — and the
 * exception is only safe while this file passes.
 *
 * ── Why an exception is defensible here at all ────────────────────────────────
 * The rule exists because **`listQuery` is not `.strict()` service-wide**: an
 * unrecognised query parameter is dropped silently and the unfiltered list comes
 * back `200`, looking filtered. A picker built from a vocabulary that has moved
 * therefore matches nothing *while looking correct* — the worst failure a filter
 * has.
 *
 * What makes the timeline different is that the vocabulary is closed **at the
 * model**, not by convention: `order-timeline.model.ts` declares a Mongoose
 * `enum` on an append-only collection whose `pre` hooks throw on update and
 * delete. A tenth value cannot be written without a code change in the file
 * mirrored at `api-doc/jovi-mall/order-timeline-events.ts`. That is the same
 * standard `ticket-vocabularies.ts` met, and this suite is the same arrangement.
 *
 * ⚠ **A failure here means jovi-mall moved.** Re-copy the mirror and reconcile
 * `orders.types.ts` against it. **Do not weaken the assertion** — a red mirror
 * guard is exactly the event it exists to catch, and the filter is wrong until
 * somebody looks.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    ORDER_TIMELINE_ACTOR_TYPES,
    ORDER_TIMELINE_EVENT_TYPES,
} from '@/types/orders.types';

const MIRROR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../api-doc/jovi-mall/order-timeline-events.ts',
);

const mirror = readFileSync(MIRROR, 'utf8');

/**
 * The members of `export type Name = | 'a' | 'b';`.
 *
 * Stops at the first `;`, so the two unions in the mirror cannot bleed into one
 * another — `TimelineEventType` is immediately followed by `TimelineActorType`.
 */
function union(name: string): string[] {
    const match = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(mirror);
    expect(match, `${name} is no longer a union in the mirror`).not.toBeNull();
    return [...match![1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/**
 * The string literals of a schema field's `enum: [ … ]`.
 *
 * The union above is what TypeScript sees; **this** is what Mongoose actually
 * refuses a write against. They are two declarations of one vocabulary sitting
 * forty lines apart in the same file, which is precisely the arrangement that
 * drifts — so both are read and both are compared.
 */
function schemaEnum(field: string): string[] {
    const match = new RegExp(`${field}: \\{[\\s\\S]*?enum: \\[([\\s\\S]*?)\\]`).exec(mirror);
    expect(match, `${field} no longer declares an enum in the mirror's schema`).not.toBeNull();
    return [...match![1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/** Both directions **and the order** — the list is rendered as a menu. */
function expectSameList(ours: readonly string[], theirs: readonly string[], what: string) {
    const oursSet = new Set(ours);
    const theirsSet = new Set(theirs);

    expect(
        theirs.filter((value) => !oursSet.has(value)),
        `${what}: in the mirror, missing from orders.types.ts`,
    ).toEqual([]);
    expect(
        ours.filter((value) => !theirsSet.has(value)),
        `${what}: in orders.types.ts, not in the mirror`,
    ).toEqual([]);
    expect([...ours], `${what}: same members, different order`).toEqual([...theirs]);
}

describe('the mirror parses at all', () => {
    /*
      Without this the regexes above go quiet rather than wrong on a
      restructured mirror, and every assertion below would pass against an empty
      list. The `error-codes.ts` drift of 2026-08-24 is the precedent: an
      assertion anchored to the wrong thing stayed green for two days.
    */
    it('finds both declarations of the event vocabulary', () => {
        expect(union('TimelineEventType').length).toBeGreaterThan(5);
        expect(schemaEnum('event_type').length).toBeGreaterThan(5);
    });

    it('finds the actor vocabulary', () => {
        expect(union('TimelineActorType').length).toBeGreaterThan(2);
    });
});

describe('the event vocabulary matches jovi-mall', () => {
    it('declares every event type, in the model’s order', () => {
        expectSameList(ORDER_TIMELINE_EVENT_TYPES, union('TimelineEventType'), 'event types');
    });

    /**
     * ⚠ The union is what the compiler sees; the schema `enum` is what the
     * database refuses a write against. A value present in one and not the other
     * is a jovi-mall bug worth reporting rather than mirroring, and either way
     * the picker must not offer it.
     */
    it('agrees with the schema enum the database actually enforces', () => {
        expectSameList(ORDER_TIMELINE_EVENT_TYPES, schemaEnum('event_type'), 'event types');
    });

    it('has nine of them', () => {
        expect(ORDER_TIMELINE_EVENT_TYPES).toHaveLength(9);
    });
});

describe('the actor vocabulary matches jovi-mall', () => {
    it('declares every actor type, in the model’s order', () => {
        expectSameList(ORDER_TIMELINE_ACTOR_TYPES, union('TimelineActorType'), 'actor types');
    });

    it('agrees with the schema enum', () => {
        expectSameList(ORDER_TIMELINE_ACTOR_TYPES, schemaEnum('actor_type'), 'actor types');
    });
});

describe('the immutability the closed vocabulary rests on', () => {
    /**
     * ⚠ **This is the load-bearing premise, not decoration.** Pinning a
     * vocabulary is only safe because the collection is append-only: no
     * migration can rewrite `event_type` on existing rows into something this
     * list has never heard of. If those hooks are ever removed, the picker's
     * justification goes with them and this repository should hear about it
     * here rather than from an operator whose filter matched nothing.
     */
    it('still refuses updates and deletes on the timeline', () => {
        for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
            expect(mirror, `${hook} no longer throws`).toContain(
                `OrderTimelineSchema.pre('${hook}'`,
            );
        }
        expect(mirror).toContain('Timeline entries cannot be updated');
        expect(mirror).toContain('Timeline entries cannot be deleted');
    });
});
