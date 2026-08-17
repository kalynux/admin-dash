import { Coins } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { getCodOverview } from '@/services/cod.service';
import { isCodOverview } from '@/types/cod.types';

/**
 * `GET /cod/overview` — the platform-wide cash position.
 *
 * **Two layers of one liability model**, which is why this is three figures and
 * not a total: an agent owes their agency, an agency owes the platform. There is
 * no `platform` holder and no grand total, and adding the two layers together
 * would double-count cash that is on its way up.
 *
 * **No currency symbol.** The platform's aggregation groups on `$balance` alone
 * and drops the currency field, so there is nothing to render one from — and
 * painting `XAF` on by assumption is exactly the kind of guess this dashboard
 * does not make.
 *
 * Delegated, so it can answer `502`/`503` while every direct tile is fine.
 */
export function CodPositionTile({ refreshToken }: { refreshToken: number }) {
    const query = useAsyncData(`/cod/overview#${refreshToken}`, (signal) =>
        getCodOverview({ signal }),
    );

    return (
        <TileCard title="Cash position" icon={Coins} to="/dashboard/cod" query={query}>
            {(payload) =>
                isCodOverview(payload) ? (
                    <dl className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground text-xs">Held by agents</dt>
                            <dd className="text-sm font-medium tabular-nums">
                                {formatCount(payload.cashHeldByAgents.total)}
                                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                                    ({formatCount(payload.cashHeldByAgents.agentsHoldingCash)}{' '}
                                    holding)
                                </span>
                            </dd>
                        </div>

                        <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground text-xs">Owed by agencies</dt>
                            <dd className="text-sm font-medium tabular-nums">
                                {formatCount(payload.agencyLiabilities.total)}
                                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                                    ({formatCount(payload.agencyLiabilities.agenciesOwing)} owing)
                                </span>
                            </dd>
                        </div>

                        <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
                            <dt className="text-muted-foreground text-xs">Unsettled collections</dt>
                            <dd className="text-sm font-medium tabular-nums">
                                {formatCount(payload.unsettledCollections.amount)}
                                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                                    ({formatCount(payload.unsettledCollections.count)})
                                </span>
                            </dd>
                        </div>
                    </dl>
                ) : (
                    /*
                     * The guard should never fire — three sources agree on these
                     * names. If it does, the platform changed a shape this
                     * service passes through without validating, and saying so is
                     * the only honest option. Rendering zeros would report that
                     * the platform holds no cash.
                     */
                    <p className="text-muted-foreground text-sm">
                        The platform answered in a shape this dashboard does not recognise. No
                        figures are shown rather than wrong ones.
                    </p>
                )
            }
        </TileCard>
    );
}
