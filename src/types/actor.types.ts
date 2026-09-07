/**
 * Who performed a recorded act, and where their id resolves.
 *
 * ── Why this is one type and not one per surface ──────────────────────────────
 * Every actor stamp on the platform — a user suspension, a vendor suspension, a
 * KYC verdict, a plan assignment — is written by the **same** Mongoose helper,
 * `actorStampFields(prefix)` in
 * `backend/jovi-mall/src/core/types/actor-source.types.ts:48`, which spreads
 * `<prefix>_source` (enum `ACTOR_SOURCES`, default `'platform'`) and
 * `<prefix>_name` beside a `<prefix>_user_id`. One writer, one shape; declaring a
 * second copy per surface is how the two drift.
 *
 * ⚠ **`api-doc/admin/api/vendors.md` gets this wrong.** Its examples show
 * `"source": "wi-admin"` (lines 188 and 394). That value is never written. The
 * enum is exactly `['platform', 'admin']`
 * (`actor-source.types.ts:39`), and a screen that special-cased `"wi-admin"`
 * would silently render nothing for every real row. Reported upstream; build
 * against the enum.
 */

/**
 * Which identity space an actor id belongs to.
 *
 * The distinction is load-bearing rather than cosmetic: administrators live in a
 * **separate database**, so an `'admin'` id resolves to nothing in `jovi_mall`
 * and must not be rendered as a link to a platform user.
 *
 * `string`-widened like every enum on this client — adding a member is an
 * additive, non-breaking change on the platform, and the contract's instruction
 * is to treat an unknown value as unknown and render it raw.
 */
export type ActorSource = 'platform' | 'admin' | (string & {});

/** One actor stamp: who acted, and where their id resolves. */
export interface ActorStamp {
    /** `null` on a row written before the actor stamp existed. */
    id: string | null;
    source: ActorSource;
    /**
     * A snapshot taken at write time, not a live lookup.
     *
     * Only administrators get one: a platform id resolves in jovi-mall's own
     * database, so denormalising the name beside it would be a second copy that
     * goes stale. An admin id resolves nowhere there, so this is the only record
     * there will ever be.
     */
    name: string | null;
}

/**
 * Should this actor's id be offered as a link to a platform record?
 *
 * `'admin'` ids resolve only in the wi-admin database, which this dashboard can
 * read — but not through any of the platform directories — so they are rendered
 * as a name, never as a `/dashboard/users/:id` link.
 */
export function isPlatformActor(actor: Pick<ActorStamp, 'id' | 'source'>): boolean {
    return actor.id !== null && actor.source === 'platform';
}
