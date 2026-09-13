/**
 * Query-string construction, with the contract's filter conventions baked in so
 * no call site has to remember them.
 *
 * ── ⚠ Unknown parameters: two axes, and only one of them varies ───────────────
 * This repository said, in six places, that **`listQuery` is not `.strict()`
 * service-wide** and therefore that *every* list endpoint silently drops an
 * unrecognised parameter. The first half is true; the second does not follow.
 * [BR-022](../../api-doc/admin/dashboard/backend-requests/BR-022-list-query-strictness-is-not-uniform.md),
 * answered 2026-09-12: **eleven query schemas are hand-rolled and strict**, on
 * twelve routes. We found two of them by probing a running service; the backend
 * found the other ten by loading every exported schema, because a grep both
 * over-reports (schemas bound to no route) and under-reports (a `.strict()`
 * several lines from the name it closes).
 *
 * | Axis | Behaviour |
 * |---|---|
 * | unrecognised **key** — `categoryKey` for `category` | usually dropped, `200`, unfiltered — **a `400` on the twelve strict routes** |
 * | recognised key, out-of-range **value** — `?category=__nope__` | **always `400`, everywhere**, and the message names the permitted set |
 *
 * So the guidance is narrower than it was, and more useful: **check a filter's
 * *name* against the endpoint's page; you do not need to check its *values*.**
 * And **do not assume a list request cannot `400`** — that is the inference the
 * old sentence licensed, and it was wrong on ten endpoints we had no way to know
 * about.
 *
 * The strict set is the table in
 * [`api/README.md` § Filtering](../../api-doc/admin/api/README.md), pinned on the
 * backend by `test:list-strictness`. **Read it there rather than copying it
 * here** — a list kept by hand in two repositories is how this recurs.
 *
 * ✅ Every call this dashboard makes to one of the twelve sends only that
 * route's documented parameters — checked endpoint by endpoint on 2026-09-12,
 * when the set arrived. `tracking-presence` is the one worth knowing: it refuses
 * `reason` as well, unlike the other two audited tracking reads.
 */

export type QueryValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly (string | number)[];

export type QueryParams = Record<string, QueryValue>;

/**
 * Serialise query parameters.
 *
 * Three rules from `api-doc/admin/api/README.md`, each of which bites if a client
 * naively stringifies an object:
 *
 * - **An empty `?search=` is rejected, not treated as "no filter".** Sending
 *   `''` is a `400`; the correct move is to send no parameter at all. Empty
 *   strings are therefore dropped, which makes `{ search: input }` safe as the
 *   user clears the box.
 * - **`false` means false.** It is a real filter value, so booleans are
 *   serialised rather than dropped for being falsy.
 * - `null` / `undefined` mean "no filter" and are dropped.
 *
 * Arrays repeat the key, which is how `?collection=` on
 * `GET /system/platform/database` is documented to take more than one value.
 */
export function buildQuery(params?: QueryParams): string {
    if (!params) return '';

    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;

        if (Array.isArray(value)) {
            for (const entry of value) {
                if (entry === null || entry === undefined) continue;
                const serialised = String(entry);
                if (serialised.length === 0) continue;
                search.append(key, serialised);
            }
            continue;
        }

        // `false` is meaningful; `''` is not.
        if (typeof value === 'boolean') {
            search.append(key, value ? 'true' : 'false');
            continue;
        }

        const serialised = String(value);
        if (serialised.length === 0) continue;
        search.append(key, serialised);
    }

    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : '';
}

/** Join a path and its query parameters. */
export function withQuery(path: string, params?: QueryParams): string {
    return `${path}${buildQuery(params)}`;
}

/**
 * The pagination bounds the service enforces everywhere: `limit=100` is a hard
 * ceiling on every list, not a per-endpoint one, and there is no `?limit=all`.
 */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** Clamp a requested page size into the documented range. */
export function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) return PAGE_SIZE_DEFAULT;
    return Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(limit)));
}

/**
 * Total pages for a list, honouring the contract's empty-list rule.
 *
 * **An empty list reports `pages: 0`**, not `1`. Read it from `meta` rather than
 * recomputing; this exists for the cases where a count is derived locally, so
 * the two agree.
 */
export function pageCount(total: number, limit: number): number {
    if (total <= 0 || limit <= 0) return 0;
    return Math.ceil(total / limit);
}
