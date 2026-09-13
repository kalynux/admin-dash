/**
 * `/automation` — the customer bot's own failure feed. Two reads, neither audited.
 *
 * Contract: `api-doc/admin/api/automation.md`. Design: `api-doc/docs/ADR-022-AUTOMATION-FAILURE-AUDIT.md`.
 *
 * ── Both routes are `any`-mode over the same three permissions ────────────────
 * `developer_tools.logs.read` · `system.automation.read` · `support.automation.lookup`. The
 * *server* decides the projection and names it in `data.view`; the client never picks a shape
 * from the caller's tier. Same ladder as `GET /system/errors`, deliberately — ADR-022 D-7 says
 * it mirrors that route exactly.
 *
 * ── ⚠ The write half of this feature is NOT here, and must never be ──────────
 * `POST /api/internal/automation/failures` is the n8n reporting door. It sits outside
 * `/api/v1`, answers to a shared secret rather than to an administrator, and sets no
 * `req.admin` — ADR-022 D-3 keeps it off the versioned surface precisely so that *"nothing on
 * `/api/v1` is reachable without an administrator"* is true by construction. This dashboard
 * has no business calling it, which is also why its three error codes
 * (`AUTOMATION_DOOR_UNCONFIGURED`, `AUTOMATION_REPORT_TOKEN_INVALID`,
 * `AUTOMATION_REPORT_MALFORMED`) can never arrive on either read below.
 *
 * ── No cursor, no `meta`, no `page` ───────────────────────────────────────────
 * A monitoring surface rather than an export, over rows that are TTL'd. Both functions are
 * therefore plain `withQuery` + `api.get` and both are safe for `useAsyncData`; nothing here
 * needs the accumulating imperative fetch `/system/errors` requires for `nextBefore`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    AutomationFailuresPage,
    AutomationFailuresQuery,
    AutomationSummary,
    AutomationSummaryQuery,
} from '@/types/automation.types';

/**
 * `GET /automation/failures` · **any of** the three names above · direct read.
 *
 * ⚠ **`workflowId` takes the id, never the name.** `?workflowId=UP-wi-mall-core` matches
 * nothing and answers `200` with an empty feed, which reads as "that workflow is healthy".
 *
 * ⚠ **Out-of-range is a `400`, not a clamp** — `windowHours` outside 1–720 and `limit` outside
 * 1–200 are both `VALIDATION_ERROR`. Nothing is clamped here either: a silently corrected
 * window would mean the screen's own label and the data disagreed.
 *
 * ⚠ **An unrecognised query parameter is silently dropped HERE** — this endpoint uses
 * `listQuery`, which is not `.strict()`, so `?workflow=` instead of `?workflowId=` returns the
 * *unfiltered* feed with a `200`. Filter names come from the endpoint's page, not from the field
 * they filter on. ⚠ **Not service-wide, which this note used to say** — twelve routes refuse an
 * unknown key outright (BR-022, answered 2026-09-12); see [`lib/query.ts`](../lib/query.ts).
 */
export function listAutomationFailures(
    query: AutomationFailuresQuery = {},
    options?: RequestOptions,
): Promise<AutomationFailuresPage> {
    return api.get<AutomationFailuresPage>(withQuery('/automation/failures', { ...query }), options);
}

/**
 * `GET /automation/summary` · same three names · direct read · **not tier-projected**.
 *
 * One group per (workflow, kind, channel) with a count, a `distinctCustomers` and a last-seen.
 * There is no `view` on this response and there is nothing withheld from any rung — a count
 * carries no machine detail and no identifier.
 *
 * `distinctCustomers` is computed server-side from a salted digest the projection never emits
 * (ADR-022 D-5), so it is the only place *"one customer ten times, or ten customers once?"*
 * can be answered at all.
 */
export function getAutomationSummary(
    query: AutomationSummaryQuery = {},
    options?: RequestOptions,
): Promise<AutomationSummary> {
    return api.get<AutomationSummary>(withQuery('/automation/summary', { ...query }), options);
}
