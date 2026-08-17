import { useMemo } from 'react';

import { useAsyncData } from '@/hooks/use-async-data';
import { listNotificationSources } from '@/services/notifications.service';
import { NOTIFICATION_TYPES, type NotificationSource } from '@/types/notifications.types';

/**
 * The notification source registry, from `GET /notifications/sources`.
 *
 * ── Why two different rules for two filters built from one fetch ──────────────
 * The inbox offers a `?source=` filter and a `?type=` filter, and they are
 * validated differently by the service:
 *
 * - **`source` is a `z.enum` over the live registry ids.** Nothing else is
 *   acceptable, so the options must come from this fetch and only from it. Until
 *   it answers there is no source filter to offer.
 * - **`type` is a `z.enum` over the ten declared types**, which this build
 *   transcribes as `NOTIFICATION_TYPES`. So the type filter is populated from the
 *   constants *unioned with* whatever the registry says it produces: the select
 *   works on first paint, and a registry that has grown widens it rather than
 *   replacing it.
 *
 * That asymmetry is deliberate and follows the rule Phase 12 settled for the
 * audit action catalog — the hand-written constant is the union's first half, not
 * a thing to delete once the fetch exists. A dead `/sources` then degrades the
 * type filter to exactly today's behaviour instead of to no filter at all.
 */
export interface NotificationSourceRegistry {
    /** In registry order. Empty until the read answers, and after a failure. */
    sources: readonly NotificationSource[];
    /** `id` → the source, for a row that names one. */
    byId: Readonly<Record<string, NotificationSource>>;
    /**
     * Every type worth offering: the ten declared, then anything the registry
     * produces that this build has not heard of.
     */
    typeOptions: readonly string[];
    isLoading: boolean;
    error: unknown;
}

export function useNotificationSources(): NotificationSourceRegistry {
    // No signal is passed on: the underlying promise is shared between every
    // caller, so one unmounting filter must not be able to cancel it for the
    // rest. See `listNotificationSources`.
    const read = useAsyncData('/notifications/sources', () => listNotificationSources());

    const sources = read.data;

    return useMemo(() => {
        const rows = sources ?? [];

        const byId: Record<string, NotificationSource> = {};
        for (const source of rows) byId[source.id] = source;

        // Declared first so the select's order is stable and legible, then any
        // the registry produces that this build does not know about. A `Set`
        // rather than a filter so a type produced by two sources appears once.
        const seen = new Set<string>(NOTIFICATION_TYPES);
        const extra: string[] = [];
        for (const source of rows) {
            for (const type of source.produces ?? []) {
                if (seen.has(type)) continue;
                seen.add(type);
                extra.push(type);
            }
        }

        return {
            sources: rows,
            byId,
            typeOptions: [...NOTIFICATION_TYPES, ...extra],
            isLoading: read.isLoading,
            error: read.error,
        };
    }, [sources, read.isLoading, read.error]);
}
