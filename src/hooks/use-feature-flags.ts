import { useMemo } from 'react';

import { useAsyncData } from '@/hooks/use-async-data';
import { getFeatureFlags } from '@/services/dev-tools.service';
import { DEV_TOOLS_FLAG, type FeatureFlag } from '@/types/dev-tools.types';

export interface FeatureFlagsState {
    flags: FeatureFlag[];
    byName: Map<string, FeatureFlag>;
    /**
     * Whether the five gated tools will run right now.
     *
     * **`null` while unknown** — loading, or the read failed. Deliberately not `false`: a screen
     * that cannot tell "off" from "we could not ask" would show a confident "developer tools are
     * switched off" banner over a working service, and send an operator to flip a flag that is
     * already on.
     */
    devToolsEnabled: boolean | null;
    isLoading: boolean;
    error: unknown;
    reload: () => void;
}

/**
 * `GET /dev-tools/feature-flags`, for the screens that need to know whether the gate is open.
 *
 * ── Why this is not a memoised module-scoped promise ──────────────────────────
 * `use-notification-sources` and the audit action catalog both are, and for good reasons — they
 * cache immutable reference data that every screen wants and nobody changes. **This value is the
 * opposite**: an operator flips it from inside this very module, and a stale cache would leave
 * five screens insisting the tools are off immediately after somebody turned them on. So it is a
 * plain per-screen read of a three-row payload that already sits behind a 5-second server cache.
 *
 * ── The caveat this hook cannot fix ───────────────────────────────────────────
 * The flag cache on the service is **in-process**, and a write clears only the answering
 * instance's. So a freshly-flipped flag may still read the old value from another instance for
 * up to the cache TTL. The write's own response says so in as many words, which is why
 * `FeatureFlags` shows that message verbatim rather than paraphrasing it.
 */
export function useFeatureFlags(reloadToken: number | string = 0): FeatureFlagsState {
    const query = useAsyncData(`/dev-tools/feature-flags#${reloadToken}`, (signal) =>
        getFeatureFlags({ signal }),
    );

    const flags = useMemo(() => query.data ?? [], [query.data]);
    const byName = useMemo(
        () => new Map(flags.map((flag) => [flag.name, flag])),
        [flags],
    );

    return {
        flags,
        byName,
        devToolsEnabled: query.data ? (byName.get(DEV_TOOLS_FLAG)?.enabled ?? false) : null,
        isLoading: query.isLoading,
        error: query.error,
        reload: query.reload,
    };
}
