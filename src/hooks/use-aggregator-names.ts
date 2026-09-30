import { useAsyncData } from '@/hooks/use-async-data';
import { getPaymentRouting } from '@/services/dev-tools.service';
import { useCan } from '@/store';

/**
 * The aggregator names the platform knows, from `GET /dev-tools/payments` → `aggregators[]` —
 * **never from a constant**, so Campay shows up in a filter the day jovi-mall ships it.
 *
 * `null` means *no list is available to this caller*, and the filter falls back to free text.
 * That is the ordinary case for tiers 2 and 3: the read is `developer_tools.payments.read`,
 * tier 1 only, while the lists that filter by gateway reach Admin and Support. It is also the
 * answer while loading and on a failed read — a filter must never block its list.
 *
 * ⚠ **The read is not free** — it computes outcome stats, two of them as collection scans — so a
 * caller without the permission never sends it, and the names are kept for the page's life
 * rather than refetched on every list render. The aggregator catalogue changes with a jovi-mall
 * deploy, not between two clicks.
 */
let cached: string[] | null = null;

export function useAggregatorNames(): string[] | null {
    const can = useCan();
    const allowed = can('developer_tools.payments.read');
    const names = useAsyncData(allowed ? '/dev-tools/payments#aggregator-names' : 'aggregator-names:none', async (signal) => {
        if (!allowed) return null;
        if (cached) return cached;
        const routing = await getPaymentRouting('24h', { signal });
        const list = routing.aggregators.map((aggregator) => aggregator.name);
        // An empty list (a platform too old for routing) says nothing about which gateways the
        // stored rows carry, so it is not kept and the filter stays free text.
        if (list.length > 0) cached = list;
        return list.length > 0 ? list : null;
    });
    return names.data ?? null;
}

/** For tests: forget the page-lifetime list. */
export function __resetAggregatorNames(): void {
    cached = null;
}
