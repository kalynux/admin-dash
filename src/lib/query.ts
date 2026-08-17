/**
 * Query-string construction, with the contract's filter conventions baked in so
 * no call site has to remember them.
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
 * Three rules from `docs/admin/api/README.md`, each of which bites if a client
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
