/**
 * How the overview gets a number when there is no endpoint that returns one.
 *
 * **wi-admin exposes no aggregate, summary, KPI or stats route** — verified
 * across all 24 route groups in `api-doc/admin/api/`, recorded as gap D1 in
 * `api-doc/admin/dashboard/BACKEND-INTEGRATION-MATRIX.md`, and confirmed against
 * `backend/admin`'s own route table. The instruction there is explicit: *"Do not
 * invent one; compose client-side."*
 *
 * So a count is `meta.total` on a filtered list, asked for with `limit=1`. That
 * number is computed by the database, not by this client — nothing here sums,
 * counts rows, or derives one figure from another. The alternative would be
 * fetching pages and counting them, which is both slower and a client-side
 * business metric, or inventing a stats endpoint, which is worse.
 *
 * `limit=1` is legal on every list: the shared schema is
 * `z.coerce.number().int().min(1).max(100)`. It costs exactly one row of payload.
 *
 * Each function below names its endpoint and the filter that defines it, once,
 * so a filter is never retyped at a call site and never drifts from the doc line
 * that justifies it.
 *
 * ── Known debt, for whoever opens Phase 6 ─────────────────────────────────────
 * The named wrappers live here because there is nowhere better *yet*. Phase 6
 * builds `users.service.ts`, `vendors.service.ts`, `agencies.service.ts`,
 * `agents.service.ts`, `orders.service.ts` and `shipments.service.ts` with real
 * filter panels — and `?unassigned=true` encoded both there and here is exactly
 * the two-lists-that-can-disagree failure `config/navigation.ts` spends four
 * paragraphs avoiding. **Move each `countX` onto its domain service as that
 * service is created**, and leave this file holding only `countMatching`, which
 * names no path and therefore cannot disagree with anything.
 */

import { env } from '@/config/env';
import { withQuery, type QueryParams } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';

/**
 * How many rows match — straight from `meta.total`.
 *
 * `limit` is forced rather than merged, so no caller can accidentally pull a
 * page of records to read a number off it.
 */
export async function countMatching(
    path: string,
    params: QueryParams = {},
    options?: RequestOptions,
): Promise<number> {
    const page = await api.list<unknown>(withQuery(path, { ...params, limit: 1 }), options);

    /**
     * `api.list` **synthesises** `meta` when the body is not the envelope — a
     * proxy error page, a dev-server misconfiguration, anything upstream
     * answering instead of wi-admin. With `limit=1` that synthesised `total` is
     * `0` or `1`, which is indistinguishable from a real answer and would report
     * a directory of eight thousand as one row. `pages` is only ever absent on a
     * synthesised meta, so it is the tell.
     */
    if (env.isDev && page.meta.pages === undefined) {
        console.warn(
            `[counts] ${path} answered without pagination meta — the total may be synthesised. ` +
                'Check what is actually serving this path.',
        );
    }

    return Number(page.meta.total ?? 0);
}

// ─── Directories ──────────────────────────────────────────────────────────────

/**
 * `GET /users` · `users.read`. Every sign-in identity, every role.
 *
 * **Moved to `services/users.service.ts`** when Phase 6 built that module, per the
 * note above. Re-exported here so the overview's import keeps working, and so
 * this file stops being a second place `/users` is spelled.
 */
export { countUsers } from '@/services/users.service';

/**
 * `GET /vendors` · `vendors.read`.
 *
 * **Moved to `services/vendors.service.ts`** when Phase 7 built that module, per
 * the note above and following `countUsers`. Re-exported here so the overview's
 * import keeps working, and so this file stops being a second place `/vendors` is
 * spelled.
 */
export { countVendors } from '@/services/vendors.service';

/**
 * `GET /agencies` · `agencies.read` — moved onto `agencies.service.ts` in Phase 8,
 * following the note above and `countUsers` / `countVendors` before it.
 *
 * Re-exported here so the overview's import keeps working, and so this file stops
 * being a second place `/agencies` is spelled.
 */
export { countAgencies } from '@/services/agencies.service';

/**
 * `GET /agents` · `agents.read` — moved onto `agents.service.ts` in Phase 8, for
 * the same reason.
 *
 * With this, every path this file used to name has a domain service that owns it
 * except the operations and finance ones, whose phases have not landed yet.
 */
export { countAgents } from '@/services/agents.service';

// ─── Today ────────────────────────────────────────────────────────────────────

/**
 * `GET /orders?from&to` · `orders.read`, and `GET /orders/disputes` ·
 * **`orders.disputes.read`** — the dispute queue is a literal path declared before
 * `/:orderId`, and a permission of its own.
 *
 * **Moved onto `services/orders.service.ts`** when Phase 9 built that module, per
 * the note above and following `countUsers` / `countVendors` / `countAgencies` /
 * `countAgents` before them. Re-exported here so the overview's imports keep
 * working, and so this file stops being a second place `/orders` is spelled.
 */
export { countOrdersCreated, countDisputedOrders } from '@/services/orders.service';

/**
 * The three `/shipments` counts — created in a window, unassigned, and held —
 * **moved onto `services/shipments.service.ts`** in Phase 9, for the same reason.
 *
 * With these, **every path this file used to name now has a domain service that
 * owns it.** What remains below is `countMatching`, which names no path and
 * therefore cannot disagree with anything.
 */
export {
    countShipmentsCreated,
    countUnassignedShipments,
    countHeldShipments,
} from '@/services/shipments.service';
