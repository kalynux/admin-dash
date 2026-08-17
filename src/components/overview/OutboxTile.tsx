import { Radio } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getOutboxSummary } from '@/services/system.service';

/**
 * `GET /system/outbox` — the tracking-outbox depth.
 *
 * On the overview because it is the **one operational counter that survives a
 * platform incident**. It is a direct aggregation over the platform database
 * rather than a delegated question, so when jovi-mall is unreachable and
 * `/system/queues`, `/cod/overview`, `/money/earnings/platform` and the
 * maintenance banner are all answering `503`, this tile still says how deep the
 * backlog is — which is exactly the moment somebody wants to know.
 *
 * **`failed > 0` means events for geo-tracker were not delivered.** Replaying
 * them is `POST /dev-tools/outbox/replay`: a Phase 9 screen behind a
 * Developer-only permission, so this tile reports and does not offer to act.
 */
export function OutboxTile({ refreshToken }: { refreshToken: number }) {
    const query = useAsyncData(`/system/outbox#${refreshToken}`, (signal) =>
        getOutboxSummary({ signal }),
    );

    return (
        <TileCard title="Event outbox" icon={Radio} to="/dashboard/system/outbox" query={query}>
            {(data) => {
                const oldest = formatRelative(data.oldestPendingAt);

                return (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            {(
                                [
                                    ['Pending', data.depth.pending, 'warn'],
                                    ['Failed', data.depth.failed, 'bad'],
                                    ['Sent', data.depth.sent, 'plain'],
                                ] as const
                            ).map(([label, value, kind]) => (
                                <div key={label} className="space-y-0.5">
                                    <p
                                        className={cn(
                                            'text-lg font-semibold tabular-nums',
                                            value > 0 && kind === 'warn' && 'text-warning',
                                            value > 0 && kind === 'bad' && 'text-destructive',
                                        )}
                                    >
                                        {formatCount(value)}
                                    </p>
                                    <p className="text-muted-foreground text-xs">{label}</p>
                                </div>
                            ))}
                        </div>

                        <p className="text-muted-foreground border-t pt-2 text-xs">
                            {data.totalUnsent === 0
                                ? 'Nothing waiting to send.'
                                : `${formatCount(data.totalUnsent)} unsent${
                                      oldest ? `, oldest queued ${oldest}` : ''
                                  }. Up to ${formatCount(data.maxAttempts)} attempts each.`}
                        </p>
                    </div>
                );
            }}
        </TileCard>
    );
}
