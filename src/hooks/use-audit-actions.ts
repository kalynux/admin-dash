import { useMemo } from 'react';

import { useAsyncData } from '@/hooks/use-async-data';
import { getAuditActionCatalog } from '@/services/audit.service';
import type { AuditActionCatalog, AuditActionCatalogEntry } from '@/types/audit.types';

/**
 * The audit action vocabulary, from `GET /audit/actions`.
 *
 * ── Why the catalog rather than a hand-written list ───────────────────────────
 * Ten screens offer an `?action=` filter, and until now each carried its own
 * `as const` array transcribed from the docs. Every one of those was a list
 * somebody had to keep complete forever: wi-admin builds its own filter enums by
 * *deriving* them from the catalog precisely so that adding an action widens the
 * filter automatically, and a client that hard-codes the same set stops offering
 * an action the day one is added — while still displaying rows that carry it.
 *
 * ── The one rule that decides which helper to use ─────────────────────────────
 * Two vocabularies exist, and they are not interchangeable:
 *
 * - The six per-record feeds (`/users/:id/activity`, `/vendors/:id/activity`,
 *   `/agencies/…`, `/agents/…`, `/orders/…`, `/shipments/…`, plus
 *   `/money/payouts/:id/activity`) validate `?action=` against an enum built by
 *   **name prefix** — verified in each module's validator, e.g.
 *   `AUDIT_ACTION_NAMES.filter(a => a.startsWith('vendors.'))`. Offering anything
 *   outside that prefix is a guaranteed `400`, even when the row is on screen:
 *   `billing.subscriptions.assign_vendor` carries `target: 'vendor'` and appears
 *   on the vendor feed, but that feed's filter cannot select it. Use `prefix`.
 * - `GET /audit` and the three administrator feeds validate against the **whole**
 *   catalog (`ListAuditQuerySchema`, confirmed in `administrator.routes.ts`), so
 *   any narrowing there is a usability choice rather than a constraint, and
 *   `target` is the useful axis. Use `target`.
 *
 * ── Failure degrades, it does not block ───────────────────────────────────────
 * A failed catalog yields an empty vocabulary, and `AuditActivityPanel` renders
 * no action `<Select>` at all for an empty list. That is the behaviour the
 * administrator activity panel already shipped with, so the degraded path is the
 * proven one — a feed with one filter missing beats a feed that will not render.
 */

/**
 * The catalog read, memoised across mounts by the service.
 *
 * `enabled: false` issues **no request at all** and resolves to `null`. That is
 * what lets the shared activity panel take the catalog as an opt-in: the nine
 * screens that have not asked for it fire nothing, and their tests need no new
 * stub.
 */
export function useAuditActionCatalog(enabled = true) {
    // No signal is passed on: the underlying promise is shared between every
    // caller, so one unmounting panel must not be able to cancel it for the rest.
    // See `getAuditActionCatalog`.
    return useAsyncData<AuditActionCatalog | null>(enabled ? '/audit/actions' : '', () =>
        enabled ? getAuditActionCatalog() : Promise.resolve(null),
    );
}

export interface AuditActionVocabulary {
    /** Action names for a `?action=` filter, in catalog order. */
    actions: readonly string[];
    /** `name` → the catalog's one-line summary, so a feed reads without a lookup table. */
    labels: Readonly<Record<string, string>>;
    /** Still loading, or the catalog failed — either way, offer no action filter yet. */
    isLoading: boolean;
}

/**
 * Narrow the catalog to one feed's `?action=` vocabulary.
 *
 * Pass **exactly one** of `prefix` or `target`; passing neither yields the whole
 * catalog, which is what `GET /audit` itself wants. Read the rule above before
 * choosing — the two are not interchangeable and the wrong one is a `400`.
 *
 * `enabled: false` makes this inert: no request, an empty vocabulary, and a
 * caller that renders no action filter.
 */
export function useAuditActionVocabulary(filter?: {
    prefix?: string;
    target?: string;
    enabled?: boolean;
}): AuditActionVocabulary {
    const catalog = useAuditActionCatalog(filter?.enabled ?? true);

    const prefix = filter?.prefix;
    const target = filter?.target;
    const entries = catalog.data?.actions;

    return useMemo(() => {
        const all: AuditActionCatalogEntry[] = entries ?? [];

        const matching = all.filter((entry) => {
            if (prefix !== undefined && !entry.name.startsWith(prefix)) return false;
            if (target !== undefined && entry.target !== target) return false;
            return true;
        });

        const labels: Record<string, string> = {};
        // Labelled from the *whole* catalog, not the narrowed set: a feed can
        // legitimately show a row whose action its own filter cannot select, and
        // that row should still read as a sentence rather than a dotted name.
        for (const entry of all) labels[entry.name] = entry.summary;

        return {
            actions: matching.map((entry) => entry.name),
            labels,
            isLoading: catalog.isLoading,
        };
    }, [entries, prefix, target, catalog.isLoading]);
}
