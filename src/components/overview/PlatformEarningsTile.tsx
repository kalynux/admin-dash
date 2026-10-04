import { Banknote } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatMoney } from '@/lib/format';
import { getPlatformEarnings } from '@/services/money.service';
import {
    isPlatformEarnings,
    platformEarningsAccounts,
    platformEarningsTotal,
    type PlatformEarnings,
} from '@/types/money.types';

/**
 * `GET /money/earnings/platform` — what the marketplace has made.
 *
 * ── The headline is `total.earned`, and the top level is NOT the total ────────
 * Since 2026-10-04 the payload carries both platform accounts — commission and
 * the **bargain fee** — and the server's own `total`. The top-level four are
 * still the commission account alone, kept for older clients; this tile read
 * them as "platform earnings" until then and understated it by the whole
 * bargain fee. Nothing is summed here: an older wi-admin that sends no `total`
 * gets its commission balance labelled as exactly that.
 *
 * **Oversight only.** The platform never pays itself out, so there is no payout
 * pipeline behind these numbers. Money is a plain number in the currency —
 * **never divided by 100**.
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
                    <PlatformEarningsFigures payload={payload} />
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

function PlatformEarningsFigures({ payload }: { payload: PlatformEarnings }) {
    const accounts = platformEarningsAccounts(payload);
    const total = platformEarningsTotal(payload);

    const rows: (readonly [string, number, string | null])[] = accounts
        ? [
              ['Commission — available', accounts.commission.available, accounts.commission.currency],
              ['Commission — pending', accounts.commission.pending, accounts.commission.currency],
              ['Bargain fee — available', accounts.bargainFee.available, accounts.bargainFee.currency],
              ['Bargain fee — pending', accounts.bargainFee.pending, accounts.bargainFee.currency],
          ]
        : [
              ['Commission — available', payload.available, payload.currency ?? null],
              ['Commission — pending', payload.pending, payload.currency ?? null],
              ['Commission — reserved', payload.reserve, payload.currency ?? null],
              ['Commission — requested', payload.requested, payload.currency ?? null],
          ];

    return (
        <div className="space-y-2">
            {total ? (
                <div>
                    <p className="text-muted-foreground text-xs">Earned to date</p>
                    <p className="text-lg font-semibold tabular-nums">
                        {formatMoney(total.earned, total.currency)}
                    </p>
                </div>
            ) : (
                <p className="text-muted-foreground text-xs">
                    {accounts
                        ? 'The two accounts hold different currencies, so no total is shown.'
                        : 'Commission only — this service does not report the bargain fee yet.'}
                </p>
            )}
            <dl className="space-y-1.5">
                {rows.map(([label, amount, currency]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground text-xs">{label}</dt>
                        <dd className="text-sm font-medium tabular-nums">
                            {formatMoney(amount, currency)}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
