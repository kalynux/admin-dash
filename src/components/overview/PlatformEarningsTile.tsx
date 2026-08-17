import { Banknote } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatMoney } from '@/lib/format';
import { getPlatformEarnings } from '@/services/money.service';
import { isPlatformEarnings } from '@/types/money.types';

/**
 * `GET /money/earnings/platform` — the marketplace's own commission account.
 *
 * **Oversight only.** The platform never pays itself out, so `requested` is
 * structurally `0` and there is no payout pipeline behind these numbers. It is
 * still rendered: a field the service sends and the dashboard silently drops is
 * how a later non-zero goes unnoticed.
 *
 * Unlike the COD position, this payload **does** carry a `currency`, so amounts
 * are formatted with it. Money here is a plain number in that currency —
 * **never divided by 100**, even though the docs also call it "the minor unit"
 * (XAF has no subdivision, so it is the same number).
 *
 * Delegated, so it can answer `502`/`503` while every direct tile is fine.
 */
export function PlatformEarningsTile({ refreshToken }: { refreshToken: number }) {
    const query = useAsyncData(`/money/earnings/platform#${refreshToken}`, (signal) =>
        getPlatformEarnings({ signal }),
    );

    return (
        <TileCard
            title="Platform earnings"
            icon={Banknote}
            to="/dashboard/money/earnings"
            query={query}
        >
            {(payload) =>
                isPlatformEarnings(payload) ? (
                    <dl className="space-y-1.5">
                        {(
                            [
                                ['Available', payload.available],
                                ['Pending', payload.pending],
                                ['Reserved', payload.reserve],
                                ['Requested', payload.requested],
                            ] as const
                        ).map(([label, amount]) => (
                            <div key={label} className="flex items-baseline justify-between gap-3">
                                <dt className="text-muted-foreground text-xs">{label}</dt>
                                <dd className="text-sm font-medium tabular-nums">
                                    {formatMoney(amount, payload.currency ?? null)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                ) : (
                    <p className="text-muted-foreground text-sm">
                        The platform answered in a shape this dashboard does not recognise. No
                        figures are shown rather than wrong ones.
                    </p>
                )
            }
        </TileCard>
    );
}
