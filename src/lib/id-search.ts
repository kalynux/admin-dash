/**
 * Searching by id — the one rule every `?search=` on this service shares, and the
 * three ways an id pasted in good faith finds nothing.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A name, an email and a phone number match on a **part**. An id matches only
 * **whole**: the id branch of every list is `term.length === 24 &&
 * ObjectId.isValid(term)` followed by an equality on `_id`, because an ObjectId
 * is not a string in the database and cannot be regex-matched without a
 * collection scan. So `665f1c2a9b3e4a91c7d2e5f0` finds the record and every
 * near-miss falls through to the text branches, where it matches no email and
 * no phone, and the answer is an empty page with a `200`.
 *
 * ── Measured, not read ────────────────────────────────────────────────────────
 * 2026-10-12, wi-admin's own `SearchUsersQuerySchema` and `buildFilter` against a
 * throwaway mongod holding one user:
 *
 * | Pasted | Rows |
 * |---|---|
 * | the whole id — also upper-cased, also with spaces round it | **1** |
 * | `665f1c…e5f0`, the shortened form a table cell shows | 0 |
 * | the first 8 characters, the last 6 | 0 |
 * | `"665f…"` in quotes, `ObjectId("665f…")` | 0 |
 * | `https://…/dashboard/users/665f…` | 0 |
 * | the same person's **customer profile** id | 0 |
 *
 * The first row is why the search looks like it works in a test and the rest is
 * why it "does not work at all" at a desk. Three of them are ours to fix here:
 * a wrapper is stripped (`extractPastedId`), and a shortened or partial id is
 * *named* in the empty state (`idSearchMiss`) instead of answering with the same
 * sentence a misspelt email gets. The last row — a real id from the wrong
 * directory — is each list's own to word, because only the list knows which ids
 * it takes.
 *
 * ── What the service changed (BR-028, answered 2026-10-12) ────────────────────
 * The last row is no longer 0. `GET /users?search=<24hex>` now tries the term as
 * a user id **and** as a customer, vendor, agency or agent id, and answers with
 * the account that owns it; `/agencies` and `/agents` match the user id as
 * `/vendors` always did; `/audit` matches an id as target, related target or
 * actor. ⛔ **A part of an id still does not match, by decision** — a run of
 * digits is a phone fragment far more often than the start of an id — so every
 * other row in that table stands and so does everything in this file.
 *
 * Which ids each list takes is stated once for the service in
 * [`api/README.md` § Free-text search](../../api-doc/admin/api/README.md): users
 * resolve a profile id to its account; vendors, agencies and agents match their
 * own id and the user id; ⚠ **orders and shipments match profile ids and never a
 * user id**; a ticket matches its own id only (`entityId` is the filter for what
 * it is about).
 */

/** A whole id: 24 hexadecimal characters, either case. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** A 24-hex run that is not the middle of a longer word or number. */
const EMBEDDED_ID = /(^|[^0-9a-z])([0-9a-f]{24})(?![0-9a-z])/gi;

/** Head, an ellipsis (the character or three dots), tail — `CopyableValue`'s display form. */
const SHORTENED_ID = /^[0-9a-f]{2,}\s*(?:…|\.{3})\s*[0-9a-f]{2,}$/i;

/**
 * The id inside a pasted wrapper, or `null` when the text is not one.
 *
 * `"665f…"`, `ObjectId("665f…")`, `id: 665f…` and a dashboard or database link
 * all carry exactly one id and none of them is what the operator means to search
 * for. Returns `null` — *leave the text alone* — when:
 *
 * - the text is already a bare id, so there is nothing to strip;
 * - it carries an `@`: an email whose local part happens to be 24 hex characters
 *   is an email, and the email branch is a contains-match that needs the rest;
 * - it carries no id, or more than one, where choosing would be a guess.
 */
export function extractPastedId(text: string): string | null {
    const trimmed = text.trim();
    if (OBJECT_ID.test(trimmed) || trimmed.includes('@')) return null;

    const found = [...trimmed.matchAll(EMBEDDED_ID)];
    return found.length === 1 ? found[0][2] : null;
}

/**
 * Where the account behind an id is found: the user directory, **searched**.
 *
 * ⚠ **A search, never `/dashboard/users/:id`.** The detail route takes a
 * `users._id` and nothing else, so a customer, vendor, agency or agent id there
 * is a `404` on every record while looking like a working link. The search tries
 * the id as all five kinds, so the caller does not need to know which it holds —
 * which matters for a ticket's `CUSTOMER` entity, where nothing guarantees
 * whether the id stored is the customer's or the user's.
 *
 * The destination is a list of one row, or none. For a customer it is the only
 * route there is: no customer directory exists, and the id on an order is a
 * customer id.
 */
export function accountSearchPath(id: string): string {
    return `/dashboard/users?search=${encodeURIComponent(id)}`;
}

/**
 * Why an id-shaped term cannot have matched, or `null` when the term is not
 * id-shaped at all.
 *
 * - `shortened` — `665f1c…e5f0`. The middle is gone; nothing can recover it.
 * - `partial` — hexadecimal, but not 24 characters. ⚠ Requires **both a digit
 *   and a letter**: a run of digits is a phone fragment, which matches on a part
 *   and is the commonest thing typed into these boxes, and a run of a–f letters
 *   is a word (`decade`, `facade`). An id fragment of six or more characters has
 *   both almost always, so the cost is a missed hint, never a wrong one.
 * - `whole` — a real 24-character id. If it found nothing it is not one of the
 *   kinds this list takes, and which kinds those are is the calling list's to say.
 */
export type IdSearchMiss = 'shortened' | 'partial' | 'whole';

export function idSearchMiss(term: string): IdSearchMiss | null {
    const trimmed = term.trim();

    if (SHORTENED_ID.test(trimmed)) return 'shortened';
    if (OBJECT_ID.test(trimmed)) return 'whole';

    const hexOnly = /^[0-9a-f]+$/i.test(trimmed);
    if (hexOnly && trimmed.length >= 6 && /\d/.test(trimmed) && /[a-f]/i.test(trimmed)) {
        return 'partial';
    }

    return null;
}

const SHORTENED_COPY =
    'That is the shortened form of an id as a table shows it — the middle is missing, so nothing can match it. Copy the id with the button beside it, or select it: both take all 24 characters.';

const PARTIAL_COPY =
    'That looks like part of an id. An id only matches whole — all 24 characters — while a name, an email or a phone number matches on a part.';

/**
 * The empty-state sentence for a search that found nothing.
 *
 * @param fallback what the list says about a term that is not id-shaped — its
 *        existing copy, naming the fields it matches.
 * @param whole    what the list says about a real id that matched nothing: which
 *        ids this list takes, and where the other kind lives.
 */
export function describeSearchMiss(term: string, fallback: string, whole: string): string {
    const miss = idSearchMiss(term);

    if (miss === 'shortened') return SHORTENED_COPY;
    if (miss === 'partial') return PARTIAL_COPY;
    if (miss === 'whole') return whole;
    return fallback;
}

/**
 * What each kind in `GET /users`' `meta.idMatch.kinds` (BR-029) is the id of, as
 * it reads in a sentence: *"that id is a customer profile's id"*.
 *
 * ⚠ **The vocabulary is open** (`users.md` § `meta.idMatch`): a kind this build
 * has never heard of is printed raw rather than dropped, so a sixth profile kind
 * still produces a true sentence.
 */
const ID_KIND_OWNERS: Readonly<Record<string, string>> = {
    user: 'an account’s own',
    customer: 'a customer profile’s',
    vendor: 'a vendor profile’s',
    agency: 'an agency profile’s',
    agent: 'an agent profile’s',
};

export function idKindOwner(kind: string): string {
    return ID_KIND_OWNERS[kind] ?? `a “${kind}” record’s`;
}

/** `["customer"]` → *"a customer profile’s"*; two or more are joined with "and". */
export function describeIdKinds(kinds: readonly string[]): string {
    const owners = kinds.map(idKindOwner);
    if (owners.length <= 1) return owners[0] ?? '';
    return `${owners.slice(0, -1).join(', ')} and ${owners[owners.length - 1]}`;
}
