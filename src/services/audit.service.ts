/**
 * `/audit` — the trail, the caller's own slice of it, and everything around it.
 *
 * The first two functions read the **same shape** from two endpoints with
 * opposite access rules, which is what lets the overview show an activity feed
 * to everyone:
 *
 * - `GET /audit` needs `audit.read` and is **row-scoped**: a Support
 *   administrator sees rows about platform actors and records, plus their own
 *   actions, and internal rows — administrators, sessions, approvals, exports,
 *   feature flags, workers, maintenance — are invisible. A row outside scope
 *   answers `404`, not `403`, because a 403 would confirm it exists.
 * - `GET /administrators/me/activity` needs **no permission at all**, because an
 *   audit trail people cannot see their own entry in is one they have no way to
 *   challenge. Its query, response, pagination and sorting are identical.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    AuditActionCatalog,
    AuditEntry,
    AuditEntryDetail,
    AuditExport,
    AuditExportListQuery,
    AuditListMeta,
    AuditListQuery,
    CreateAuditExportBody,
    LegacyAuditEntry,
    LegacyAuditListMeta,
    LegacyAuditListQuery,
} from '@/types/audit.types';

export interface AuditPage {
    data: AuditEntry[];
    meta: AuditListMeta;
}

/** The ids here are 24-hex, but encoding is the rule rather than the exception. */
const entryPath = (auditId: string) => `/audit/${encodeURIComponent(auditId)}`;
const exportPath = (exportId: string) => `/audit/exports/${encodeURIComponent(exportId)}`;

/**
 * Coerce an audit envelope's `meta` into the narrowed shape.
 *
 * Exported because `GET /users/:userId/activity` answers the **identical** shape —
 * it is the audit trail filtered to one user — and a second coercion helper beside
 * this one is a second set of fallbacks that can disagree with it.
 */
export function toAuditPage(page: Paginated<AuditEntry>): AuditPage {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            // `pages: 0` on an empty list is the contract's rule; the fallback
            // has to honour it or a "page 1 of 1" appears over nothing.
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
            retentionDays:
                typeof page.meta.retentionDays === 'number' ? page.meta.retentionDays : null,
            // Worth carrying all the way to the UI: it is why the feed stops
            // where it does, rather than the feed looking broken at the boundary.
            oldestRetainedAt:
                typeof page.meta.oldestRetainedAt === 'string' ? page.meta.oldestRetainedAt : null,
        },
    };
}

/**
 * `GET /audit` · `audit.read`.
 *
 * One sort key only, `occurredAt`, defaulting to `-occurredAt`. A trail is a
 * chronology; sorting it by actor or action would scan the largest collection in
 * the database for an ordering nobody reads a trail in.
 *
 * **`from`/`to` cap at 92 days here**, not the 366 that most lists allow.
 */
export async function listAuditEntries(
    query: AuditListQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(await api.list<AuditEntry>(withQuery('/audit', { ...query }), options));
}

/**
 * `GET /administrators/me/activity` — **no permission required**.
 *
 * The overview falls back to this for anyone who cannot read the full trail, so
 * the activity tile is never simply absent.
 */
export async function listOwnActivity(
    query: AuditListQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(withQuery('/administrators/me/activity', { ...query }), options),
    );
}

/**
 * `GET /audit/:auditId` · `audit.read` — one entry, with the state the list omits.
 *
 * **A `404` here is also the scope denial.** `AUDIT_ENTRY_NOT_FOUND` means "no
 * such row **or** it is outside your read scope", because a `403` on an id would
 * confirm the id exists — an existence oracle over exactly the rows the scope
 * hides. Render it as "not available to you", not as a fault; `isAccessDenial`
 * in `lib/errors.ts` already classifies it that way.
 */
export async function getAuditEntry(
    auditId: string,
    options?: RequestOptions,
): Promise<AuditEntryDetail> {
    return api.get<AuditEntryDetail>(entryPath(auditId), options);
}

// ─── The action catalog ───────────────────────────────────────────────────────

/**
 * The in-flight or resolved catalog.
 *
 * ── Why a module-scoped memo and not a store ──────────────────────────────────
 * `useAsyncData` is deliberately "no cache, no dedupe" and this repo has adopted
 * no query library. The catalog is eighty rows that change only on a deploy, and
 * ten screens want it — the trail plus the nine per-record activity panels. A
 * request per mount would be ten identical round trips for a constant.
 *
 * Memoising the **promise** rather than the value also makes concurrent callers
 * and StrictMode's double-effect share one request rather than racing two.
 */
let catalogPromise: Promise<AuditActionCatalog> | null = null;

/**
 * `GET /audit/actions` · `audit.read` — the vocabulary, so a dashboard builds its
 * filter from the catalog instead of discovering it by collecting 400s.
 *
 * **A rejection clears the memo.** Caching a rejected promise would make every
 * later call — including a deliberate `reload()` — replay the same failure
 * forever, which turns one flaky request into a permanently filterless screen.
 *
 * ── It takes no `AbortSignal`, deliberately ───────────────────────────────────
 * Every other read here accepts one. This cannot: the promise is shared, so the
 * *first* caller's signal would decide the fate of every later caller's copy —
 * one panel unmounting mid-flight would reject the catalog for the whole page,
 * and the memo would then be cleared by a cancellation nobody asked for. The
 * request is eighty rows of constant; there is nothing worth cancelling. Callers
 * that unmount simply ignore the result, which `useAsyncData` already does.
 */
export async function getAuditActionCatalog(): Promise<AuditActionCatalog> {
    catalogPromise ??= api.get<AuditActionCatalog>('/audit/actions').catch((error) => {
        catalogPromise = null;
        throw error;
    });

    return catalogPromise;
}

/**
 * Drop the memoised catalog.
 *
 * A test seam, in the shape `__resetApiClientState` already established: module
 * state that survives between tests is state one test can leak into the next.
 */
export function __resetAuditActionCache(): void {
    catalogPromise = null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * `POST /audit/exports` · `audit.export` — write an NDJSON file and stamp the
 * rows it covered as exported. **It deletes nothing.**
 *
 * `api.mutate` rather than `api.post`, because the server composes the sentence
 * *"Exported N row(s). Nothing was deleted — use the CLI with --purge for
 * that."* and that clarification is the whole point of saying it. Re-deriving it
 * client-side would be a second copy of a claim only the server can make.
 *
 * Both bounds are **required** here, unlike the feed's: an export with no range
 * means the whole collection, and this path is bounded by row count. Expect
 * `422 AUDIT_EXPORT_TOO_LARGE` on a wide range — that is a routine answer, not
 * an edge case.
 */
export async function createAuditExport(
    body: CreateAuditExportBody,
    options?: RequestOptions,
): Promise<{ data: AuditExport; message: string | undefined }> {
    const result = await api.mutate<AuditExport>('POST', '/audit/exports', body, options);
    return { data: result.data, message: result.message };
}

/**
 * `GET /audit/exports` · `audit.export`.
 *
 * Sorted on `startedAt` only, newest first, and it offers **no filters** — do
 * not add any to the screen that reads it.
 */
export async function listAuditExports(
    query: AuditExportListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<AuditExport>> {
    return api.list<AuditExport>(withQuery('/audit/exports', { ...query }), options);
}

/** `GET /audit/exports/:exportId` · `audit.export`. */
export async function getAuditExport(
    exportId: string,
    options?: RequestOptions,
): Promise<AuditExport> {
    return api.get<AuditExport>(exportPath(exportId), options);
}

/**
 * `GET /audit/exports/:exportId/download` · `audit.export`.
 *
 * The one endpoint on this service that does not answer with the JSON envelope,
 * because the payload is a file. **Its errors still do**, so they arrive as
 * ordinary `ApiError`s:
 *
 * - `409 AUDIT_EXPORT_INCOMPLETE` — the export did not finish; its file is not durable.
 * - `410 AUDIT_EXPORT_FILE_MISSING` — the record exists, the file is gone. Behind a
 *   load balancer with more than one instance this is the **normal** answer unless
 *   `ADMIN_AUDIT_EXPORT_DIR` points at shared storage, so it is a deployment fact
 *   rather than data loss, and the screen says so.
 *
 * `sha256` comes back from `X-Content-SHA256` when recorded — compare it against
 * the manifest's own before trusting the file.
 */
export async function downloadAuditExport(
    exportId: string,
    options?: RequestOptions,
): Promise<{ blob: Blob; fileName?: string; sha256?: string }> {
    return api.download(`${exportPath(exportId)}/download`, options);
}

// ─── The interim jovi-mall feed ───────────────────────────────────────────────

export interface LegacyAuditPage {
    data: LegacyAuditEntry[];
    meta: LegacyAuditListMeta;
}

/**
 * `GET /audit/legacy` · `audit.read` — administrative actions still performed on
 * jovi-mall, in jovi-mall's own vocabulary.
 *
 * The same Support narrowing is reproduced here; without it this endpoint would
 * be a side door onto exactly what the real feed withholds.
 *
 * **`404 AUDIT_LEGACY_FEED_DISABLED` is not a fault** — the `audit.legacy_feed`
 * flag is off and the route is pretending not to exist, so the feed can be
 * retired ahead of deleting the module. Render it as an explanation.
 */
export async function listLegacyAudit(
    query: LegacyAuditListQuery = {},
    options?: RequestOptions,
): Promise<LegacyAuditPage> {
    const page = await api.list<LegacyAuditEntry>(withQuery('/audit/legacy', { ...query }), options);

    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            // `pages: 0` on an empty list is the contract's rule; the fallback has
            // to honour it or a "page 1 of 1" appears over nothing.
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
            // These four are why the banner can state what this feed is rather
            // than the dashboard asserting it from its own knowledge.
            legacy: page.meta.legacy !== false,
            sourceService:
                typeof page.meta.sourceService === 'string' ? page.meta.sourceService : null,
            retiresAtCutover: page.meta.retiresAtCutover !== false,
            unportedEndpoints:
                typeof page.meta.unportedEndpoints === 'number'
                    ? page.meta.unportedEndpoints
                    : null,
        },
    };
}
