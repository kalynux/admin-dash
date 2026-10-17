/**
 * An administrator's **cash-on-delivery restriction** on one customer or one
 * delivery agency (2026-10-10).
 *
 * Contract: `api-doc/admin/FRONTEND-CHANGELOG-cod-restrictions.md`,
 * `users.md` § The customer's COD restriction, `agencies.md` § The agency's COD
 * restriction. The shapes follow `backend/admin/src/modules/cod/read-models/
 * cod-restriction.dto.ts`, which both mounts answer through.
 *
 * ── It is a switch, and it decides nothing here ───────────────────────────────
 * jovi-mall owns the data and the enforcement. Whether a given basket or
 * shipment may use cash on delivery is a verdict it reaches at checkout and at
 * every hand-off — the seller's terms, the agency's own setting and the amount
 * limits all still apply. ⛔ **Nothing on this dashboard predicts that outcome**;
 * these types carry the switch and who set it, for a badge and one button.
 *
 * ── Two subjects, and only two ────────────────────────────────────────────────
 * A customer (the restriction lives on the *customer profile*) and a delivery
 * agency. There is none for vendors or agents, no bulk write, no list of
 * restricted accounts and no history read — lifting **erases** the stored
 * restriction, so the Activity tab is the only history there is.
 *
 * ⛔ **`reason` is the administrator's.** jovi-mall never shows it to the
 * restricted party, and nothing built on these types may render or forward it
 * anywhere a customer or an agency can see it.
 */

/** The stored restriction — on the wire only while cash on delivery is off. */
export interface CodRestriction {
    /** Internal. See this file's header. */
    reason: string;
    /** ISO-8601. */
    restrictedAt: string;
    /**
     * ⚠ A **wi-admin administrator** id, not a platform user: it resolves only
     * in the admin database and must not be linked as a `/users` row.
     */
    restrictedByUserId: string | null;
    /** `admin` for a restriction set through this service. Open — render raw. */
    restrictedBySource: string;
    /** A write-time snapshot; the only readable record of who acted. */
    restrictedByName: string | null;
}

/**
 * What all six routes answer — the read and both writes, on both mounts.
 *
 * ⚠ On the **customer** mount `subjectId` is the customer *profile's* id (the
 * customer entry's `id` in `profiles`), **not** the `:userId` in the path;
 * `userId` is the account. On the agency mount `subjectId` is the `:agencyId`
 * and `userId` is the owning account, which may be `null`.
 */
export interface CodRestrictionReport {
    /** `customer` on `/users`, `agency` on `/agencies`. */
    subject: 'customer' | 'agency' | (string & {});
    subjectId: string;
    userId: string | null;
    restricted: boolean;
    /** `null` when not restricted — and always `null` after a `/lift`. */
    restriction: CodRestriction | null;
}

/**
 * The body of **both** writes on both mounts. **Strict** — `reason` is the only
 * key, and any other is a `400`.
 *
 * ⛔ There is no `restricted` field: the direction is the route (`PUT`
 * restricts, `POST …/lift` lifts). ⚠ The reason is required to lift as well as
 * to restrict — unlike Restore on a user and Reactivate on an agency — because
 * lifting clears the stored record and the reason then survives only in the
 * audit row.
 */
export interface CodRestrictionBody {
    /** Required both ways. Trimmed, 3–500 characters. */
    reason: string;
}

export const COD_RESTRICTION_REASON_MIN = 3;
export const COD_RESTRICTION_REASON_MAX = 500;

/**
 * `409` — the account is **already in the state asked for**: already restricted
 * on the `PUT`, not restricted on `/lift`. jovi-mall's write is a
 * compare-and-set, so two administrators on one page cannot each believe their
 * reason is the one on record.
 *
 * jovi-mall's code, so it arrives as `details.platformCode` under
 * `PLATFORM_OPERATION_REJECTED`. ⚠ **Not a failure to retry**: re-read and show
 * what is stored, including the other administrator's reason. After a
 * `502`/`503`, a retry answering this means the first attempt did land.
 */
export const PLATFORM_CODE_COD_RESTRICTION_UNCHANGED = 'COD_RESTRICTION_UNCHANGED';

/**
 * Who set a restriction, as words: the name snapshot when there is one, the
 * source otherwise (`admin` · `platform`).
 */
export function codRestrictionAuthor(
    restriction: Pick<CodRestriction, 'restrictedByName' | 'restrictedBySource'>,
): string {
    return restriction.restrictedByName?.trim() || restriction.restrictedBySource;
}
