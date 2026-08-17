import { RotateCw, TriangleAlert, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatInstantInZone } from '@/lib/format';
import { getMaintenanceWindow } from '@/services/system.service';

interface MaintenanceBannerProps {
    refreshToken: number;
    /** The operator's IANA zone, so the window's times read in their day. */
    timeZone: string;
}

/**
 * The platform's maintenance window, across the top of the overview.
 *
 * **Renders `effectiveMode`, never `storedMode`.** They differ exactly when a
 * window has passed its expiry: a read path must never write, so the expired
 * window stays *stored* until something clears it. Showing the stored value
 * would tell an operator the platform is in maintenance when it is not.
 *
 * `effectiveMode === 'off'` renders **nothing at all** — a permanent strip
 * saying "no maintenance" is noise on a page that already has sixteen things to
 * read. That test is safe because the vocabulary is genuinely closed here: the
 * platform's `effectiveMode()` fails open, returning `'off'` for any stored
 * value it does not recognise, so no fourth string can arrive. The mode itself is
 * still rendered as a raw string rather than switched on.
 *
 * The read is **delegated**, so it can answer `502`/`503` while the rest of the
 * page is fine. That failure gets one muted line: not knowing the maintenance
 * state is worth saying out loud — silence would be indistinguishable from
 * "nothing is wrong" — but it is not itself an incident, and a red banner over a
 * failed *read* would be a fabrication.
 */
export function MaintenanceBanner({ refreshToken, timeZone }: MaintenanceBannerProps) {
    const { data, error, isLoading, reload } = useAsyncData(
        `/system/maintenance#${refreshToken}`,
        (signal) => getMaintenanceWindow({ signal }),
    );

    if (isLoading) return null;

    if (error && data === null) {
        return (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <TriangleAlert className="size-3.5 shrink-0" />
                <span>Could not read the maintenance state. {resolveErrorMessage(error)}</span>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={reload}>
                    <RotateCw className="size-3" />
                    Retry
                </Button>
            </div>
        );
    }

    if (!data || data.effectiveMode === 'off') return null;

    const started = formatInstantInZone(data.startedAt, timeZone);
    const expires = formatInstantInZone(data.expiresAt, timeZone);
    const stale = data.storedMode !== data.effectiveMode;

    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <Wrench className="text-warning size-4 shrink-0" />
                <span className="text-sm font-medium">Platform maintenance</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                    {data.effectiveMode}
                </Badge>
                {data.blockWebhooks ? <Badge variant="secondary">Webhooks blocked</Badge> : null}
                {data.pauseWorkers ? <Badge variant="secondary">Workers paused</Badge> : null}
            </div>

            {data.reason ? <p className="text-sm">{data.reason}</p> : null}

            <p className="text-muted-foreground text-xs">
                {started ? `Started ${started}. ` : null}
                {expires ? `Expires ${expires}. ` : 'No expiry set. '}
                {data.setBy?.name ? `Set by ${data.setBy.name}.` : null}
            </p>

            {stale ? (
                <p className="text-muted-foreground text-xs">
                    The stored mode is <span className="font-mono">{data.storedMode}</span>. The
                    effective mode above is the one in force.
                </p>
            ) : null}
        </div>
    );
}
