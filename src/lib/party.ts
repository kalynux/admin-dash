/**
 * What to call a party on screen — one fallback rule, stated once.
 *
 * **Business name → the party's own name → a contact → an identifier.** Five
 * domain helpers render that rule (`vendorDisplayName`, `agencyDisplayName`,
 * `agentDisplayName`, `userDisplayName`, `administratorDisplayName`) and until
 * now each carried its own copy of it, four of which disagreed in some detail.
 * They still exist and still take their own records; they are re-expressed over
 * the reducer below so the rule is implemented and tested in one place.
 *
 * **No React, no fetching, and no dependency on `types/`.** This takes
 * *candidates*, not records, which is what keeps `lib/` from learning what a
 * `Vendor` is and lets each helper keep its own `Pick<…>` signature.
 *
 * ── ⚠ Why the source travels with the value ───────────────────────────────────
 * `businessName` is the **business**. `contactName` is a **person** — the
 * agency's contact, not the agency. A column headed *"Agency"* that fell
 * through to `contactName` has been showing a human's name where a company was
 * meant, which is the confusion
 * [BR-006](../../docs/dashboard/backend-requests/BR-006-agency-name-on-contract-rows.md)
 * was granted to fix and which § B6 of
 * [UX-REMEDIATION-2026-08-25](../../docs/dashboard/UX-REMEDIATION-2026-08-25.md)
 * records the roster panel still committing.
 *
 * A bare `string` return cannot carry *"this is a person's name standing in for
 * a company's"*, so a caller that renders it under a business-shaped heading has
 * no way to say so and no way to know it should. `resolvePartyName` therefore
 * returns the value **together with the field it came from**, and `partyName` is
 * a one-line wrapper over it for the many sites that only want a label. The
 * fallback must never silently substitute one kind of name for another: where
 * the answer is a contact, the caller can — and on a business-shaped column
 * must — say so.
 */

// ─── What a label can come from ───────────────────────────────────────────────

/**
 * Every field any of the five helpers falls through, and nothing else.
 *
 * Closed on purpose. A sixth helper wanting a seventh field adds it here and
 * gets a compile error at both records below until it has said what *kind* of
 * thing it is and what to call it — which is the whole safeguard.
 */
export type PartyNameSource =
    | 'businessName'
    | 'displayName'
    | 'name'
    | 'contactName'
    | 'email'
    | 'phone'
    | 'id';

/**
 * What the label actually is, which is the question a caller has to answer
 * before deciding how to render it.
 *
 * - `own` — the party's own name. Safe under any heading.
 * - `contact` — ⚠ **somebody else's** name standing in for the party. Safe only
 *   where the rendering says so.
 * - `identifier` — no name existed at all; this is an email, a phone or the id.
 *   Worth rendering as a value (mono, copyable) rather than as prose.
 */
export type PartyNameKind = 'own' | 'contact' | 'identifier';

const SOURCE_KINDS: Record<PartyNameSource, PartyNameKind> = {
    businessName: 'own',
    displayName: 'own',
    name: 'own',
    contactName: 'contact',
    email: 'identifier',
    phone: 'identifier',
    id: 'identifier',
};

/**
 * What to call the source when the rendering has to name it.
 *
 * *"Contact person"* is the wording BR-006 settled on for the demoted sub-line,
 * and it is the only one of these that is load-bearing — the rest exist so a
 * caller never has to hand-write a label for a source it did not expect. Plain
 * English literals, like every other non-error string in this repository.
 */
export const PARTY_NAME_SOURCE_LABELS: Record<PartyNameSource, string> = {
    businessName: 'Business name',
    displayName: 'Display name',
    name: 'Name',
    contactName: 'Contact person',
    email: 'Email',
    phone: 'Phone',
    id: 'Id',
};

// ─── The reducer ──────────────────────────────────────────────────────────────

/**
 * One thing that might name the party, and where it came from.
 *
 * `value` is `string | null | undefined` because that is what the wire gives:
 * a field that exists is always present and absent data is `null`, but a
 * `Pick<…>` taken over an optional field can still be `undefined`, and neither
 * should be the caller's problem.
 */
export interface PartyNameCandidate {
    readonly source: PartyNameSource;
    readonly value: string | null | undefined;
}

/**
 * The last resort, which is why its `value` is a plain `string`.
 *
 * Separated from the candidate list rather than typed as the tuple's final
 * element so that *"there is always an answer"* is enforced by the signature
 * instead of by a `??` at five call sites. In four of the five helpers this is
 * the id; on an administrator it is the email, because `Administrator` carries
 * no id on that projection's `Pick`.
 */
export interface PartyNameFallback {
    readonly source: PartyNameSource;
    readonly value: string;
}

/** A label, and enough about it to render it honestly. */
export interface ResolvedPartyName {
    /** Trimmed, never blank unless the fallback itself was blank. */
    readonly value: string;
    /** The field it came from. ⚠ `contactName` is a person — see the file note. */
    readonly source: PartyNameSource;
    /** `SOURCE_KINDS[source]`, carried so a caller need not look it up. */
    readonly kind: PartyNameKind;
}

/**
 * The first candidate that actually says something, else the fallback.
 *
 * ⚠ **A whitespace-only value is not a name.** Four of the five helpers used
 * `??`, which accepts `""` and `"   "` and renders a blank cell where an id was
 * wanted; `administratorDisplayName` already guarded with `.trim() ||`. This
 * unifies on the stricter reading — **a behaviour change for the other four** —
 * because a blank cell is strictly worse than an ugly id: the id is at least
 * what an administrator pastes into the search box.
 *
 * Values come back **trimmed**, which is what should be rendered anyway and
 * what `administratorDisplayName` already did.
 *
 * The fallback is returned even if it too is blank, because at that point there
 * is nothing else to return; its trimmed form wins when trimming leaves
 * anything at all.
 */
export function resolvePartyName(
    candidates: readonly PartyNameCandidate[],
    fallback: PartyNameFallback,
): ResolvedPartyName {
    for (const candidate of candidates) {
        const value = candidate.value?.trim();
        if (value) {
            return { value, source: candidate.source, kind: SOURCE_KINDS[candidate.source] };
        }
    }
    return {
        value: fallback.value.trim() || fallback.value,
        source: fallback.source,
        kind: SOURCE_KINDS[fallback.source],
    };
}

/**
 * The same answer, as a bare string, for the many places that only want a label.
 *
 * ⚠ Use `resolvePartyName` instead wherever the *heading* asserts what kind of
 * name it is — an "Agency" column, a "Business" field — because this form
 * cannot tell a business name from the contact person's, and rendering the
 * second under the first is the BR-006 confusion all over again.
 */
export function partyName(
    candidates: readonly PartyNameCandidate[],
    fallback: PartyNameFallback,
): string {
    return resolvePartyName(candidates, fallback).value;
}

// ─── When a "name" is not a name at all ───────────────────────────────────────

/**
 * Is this "name" just the role, capitalised — i.e. did nothing resolve?
 *
 * ── ⚠ Why a client has to ask this ───────────────────────────────────────────
 * jovi-mall resolves an actor by looking their id up in its own collections and
 * **falls back to the capitalised role when it matches nothing**. It does not
 * signal that it fell back. So `{ role: "admin", name: "Admin" }` is not an
 * administrator called Admin; it is jovi-mall saying it could not find them —
 * and for `role: "admin"` it *never* can, because an administrator has no row
 * in that database at all (ADR-004 D-1, the synthetic actor). The same
 * placeholder appears as `"Customer"` / `"Vendor"` / `"Agency"` / `"Agent"`
 * when a profile has been deleted.
 *
 * **This equality is the only signal there is.** Rendering `name` raw prints
 * "Admin" where a person's name belongs, on every administrator action — which
 * reads as a name and is not one.
 *
 * ── ⚠ It compares shapes, not spellings ──────────────────────────────────────
 * Case and word separators are normalised on both sides, so a future
 * `delivery_agent` still matches a `"Delivery Agent"` placeholder. Anchoring on
 * the exact capitalisation would make the guard silently stop working the day
 * upstream changes how it capitalises.
 *
 * ── ⚠ It can say yes to a real name, and that is the right trade ─────────────
 * A vendor whose business is genuinely called "Vendor" is misread as
 * unresolved. The failure is a party rendered as its role — mildly wrong, and
 * honest. The other direction hands an operator a placeholder to act on as
 * though it identified somebody, which is the failure worth preventing.
 */
export function isRolePlaceholderName(
    value: string | null | undefined,
    role: string | null | undefined,
): boolean {
    const name = normaliseForRoleCompare(value);
    const roleToken = normaliseForRoleCompare(role);
    if (!name || !roleToken) return false;
    return name === roleToken;
}

/** Lowercased, with `_`, `-` and runs of whitespace flattened to one space. */
function normaliseForRoleCompare(value: string | null | undefined): string {
    return (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, ' ');
}
