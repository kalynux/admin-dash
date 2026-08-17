import type { LucideIcon } from 'lucide-react';

import { StatTile } from '@/components/overview/StatTile';
import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import type { RequestOptions } from '@/services/api';

interface CountTileProps {
    title: string;
    icon?: LucideIcon;
    /** The screen this figure came from. */
    to?: string;
    /** One line saying exactly what was counted. */
    hint?: string;
    tone?: 'default' | 'attention';
    /**
     * Identifies the read. **Must encode every filter**, because it is the
     * hook's only dependency — see `useAsyncData`. In practice: the request path
     * with its query string.
     */
    cacheKey: string;
    /** Bumped by the page's Refresh and by returning to the tab. */
    refreshToken: number;
    /** May be inline and unstable; the hook holds it behind a ref. */
    read: (options: RequestOptions) => Promise<number>;
}

/**
 * A single backend-computed count.
 *
 * Eight of the overview's tiles are this component with different arguments. The
 * number is always `meta.total` from a filtered list — see `services/counts.ts`
 * for why that is the only honest way to get one out of a service with no
 * aggregate endpoints, and why nothing here counts rows.
 *
 * **Zero is a result, not an empty state.** `isEmpty` is never passed: an empty
 * state over a successful `0` would tell an operator "we have nothing to show"
 * when the service actually said "there are none" — and on these tiles zero is
 * frequently the *good* answer. Empty states belong to the two list tiles.
 */
export function CountTile({
    title,
    icon,
    to,
    hint,
    tone,
    cacheKey,
    refreshToken,
    read,
}: CountTileProps) {
    const query = useAsyncData(`${cacheKey}#${refreshToken}`, (signal) => read({ signal }));

    return (
        <TileCard title={title} icon={icon} to={to} query={query}>
            {(value) => <StatTile value={value} hint={hint} tone={tone} />}
        </TileCard>
    );
}
