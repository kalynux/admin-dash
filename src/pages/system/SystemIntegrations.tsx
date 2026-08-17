import { useMemo, useState } from 'react';
import { RotateCw, Zap } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatCount, formatRelative } from '@/lib/format';
import { scrubbedText } from '@/lib/scrub-secrets';
import { useAsyncData } from '@/hooks/use-async-data';
import { getIntegrations } from '@/services/system.service';
import { ON_DEMAND_PROBES, type Integration } from '@/types/system.types';

/**
 * What each reachability mode means, in the operator's terms.
 *
 * **The mode travels with every verdict, and rendering it is the point.** "WhatsApp: unknown"
 * reads as "WhatsApp is broken" when it means "we chose not to ask" — which is the single
 * misreading this whole endpoint is shaped to prevent.
 */
const MODE_COPY: Record<string, { label: string; detail: string }> = {
    probed: {
        label: 'Checked just now',
        detail: 'Against a real health path — cheap and with no side effect.',
    },
    on_demand: {
        label: 'Not checked',
        detail: 'Safe but not free. Tick it above to check it on the next load.',
    },
    passive: {
        label: 'From real traffic',
        detail:
            'Never probed. This is what ordinary requests last learned, at no cost and with no ' +
            'side effect.',
    },
    never: {
        label: 'Cannot be checked',
        detail: 'No safe probe exists — asking would cost money, a quota, or a message to a person.',
    },
};

function reachabilityOf(integration: Integration) {
    const mode = String(integration.reachability?.mode ?? '');
    return { mode, meta: MODE_COPY[mode], status: integration.reachability?.status ?? null };
}

/**
 * Configured versus reachable — two columns, never conflated.
 *
 * ── The one read on this service that can cost something ──────────────────────
 * `?probe=` opts into checks that are safe but not free: an SMTP `verify()` is a TCP+TLS
 * handshake that some providers rate-limit, and Telegram's `getMe` authenticates the bot. So the
 * probes are **checkboxes that start unticked**, and the ordinary page load touches no third
 * party at all. Running them on mount would make opening an operations page a side effect.
 */
export function SystemIntegrations() {
    const [probes, setProbes] = useState<string[]>([]);

    const report = useAsyncData(
        `/system/integrations?probe=${probes.join(',')}`,
        (signal) => getIntegrations(probes, { signal }),
    );

    const rows = report.data?.integrations ?? [];

    const columns = useMemo<Column<Integration>[]>(
        () => [
            {
                id: 'provider',
                header: 'Provider',
                cell: (integration) => (
                    <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                            {integration.label ?? integration.key ?? 'Unnamed'}
                        </p>
                        {integration.impact ? (
                            <p className="text-muted-foreground text-xs">{integration.impact}</p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'configured',
                header: 'Configured',
                cell: (integration) =>
                    integration.configured ? (
                        <Badge variant="outline" className="border-success/40 text-success font-normal">
                            Yes
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-muted-foreground font-normal">
                            No
                        </Badge>
                    ),
                className: 'whitespace-nowrap',
            },
            {
                id: 'reachable',
                header: 'Reachable',
                cell: (integration) => {
                    const { mode, meta, status } = reachabilityOf(integration);
                    return (
                        <div className="min-w-0 space-y-0.5">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm">
                                {/* An unrecognised mode renders as itself — adding one is an
                                    additive backend change and must not blank the column. */}
                                <span className="font-medium">{meta?.label ?? mode}</span>
                                {status ? (
                                    <Badge
                                        variant="outline"
                                        className={
                                            status === 'ok'
                                                ? 'border-success/40 text-success font-normal'
                                                : 'border-destructive/40 text-destructive font-normal'
                                        }
                                    >
                                        {String(status)}
                                    </Badge>
                                ) : null}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {integration.reachability?.note ?? meta?.detail}
                            </p>
                            {integration.reachability?.error ? (
                                /*
                                 * A probe failure message comes straight from a third-party
                                 * client, and those routinely echo the connection they just
                                 * attempted — nodemailer's does. ADR-015 D-9 records that
                                 * `verify()` only became a real member of `IMailProvider` in
                                 * that phase, so this text is newly live rather than long
                                 * settled. It is the likeliest credential surface outside the
                                 * error journal.
                                 */
                                <p className="text-destructive text-xs">
                                    {scrubbedText(String(integration.reachability.error))}
                                </p>
                            ) : null}
                            {integration.reachability?.checkedAt ? (
                                <p className="text-muted-foreground/70 text-xs">
                                    {formatRelative(String(integration.reachability.checkedAt))}
                                </p>
                            ) : null}
                        </div>
                    );
                },
            },
        ],
        [],
    );

    return (
        <PageContainer
            title="Integrations"
            description="Every third-party the platform depends on, with configured and reachable kept apart."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={report.reload}
                    disabled={report.isLoading || report.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Zap className="text-muted-foreground size-4" aria-hidden />
                    <p className="text-sm font-medium">Run the optional checks</p>
                    <OperationBadge level="probe" />
                </div>

                <p className="text-muted-foreground text-sm">
                    These two are safe but not free, so they are off by default and this page
                    touches no third party until you ask it to. An SMTP check opens a real
                    connection and authenticates; some providers rate-limit that. The Telegram
                    check authenticates the bot.
                </p>

                <div className="flex flex-wrap gap-4">
                    {ON_DEMAND_PROBES.map((probe) => (
                        <div key={probe} className="flex items-center gap-2">
                            <Checkbox
                                id={`probe-${probe}`}
                                checked={probes.includes(probe)}
                                onCheckedChange={(checked) =>
                                    setProbes((current) =>
                                        checked
                                            ? [...current, probe]
                                            : current.filter((name) => name !== probe),
                                    )
                                }
                            />
                            <Label htmlFor={`probe-${probe}`} className="font-normal">
                                Check {probe}
                            </Label>
                        </div>
                    ))}
                </div>
            </div>

            <DataTable
                caption="Third-party integrations"
                columns={columns}
                rows={rows}
                rowKey={(integration) => String(integration.key ?? integration.label)}
                isLoading={report.isLoading}
                isRefreshing={report.isRefreshing}
                error={report.error}
                onRetry={report.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        title="No integrations reported"
                        description="The platform returned an empty inventory."
                    />
                }
            />

            {report.data ? (
                <div className="text-muted-foreground space-y-1 text-xs">
                    <p>{report.data.rule}</p>
                    <p>
                        Google Calendar has no service-level probe — authorisation is per vendor —
                        so it reports two free counts instead:{' '}
                        <strong>{formatCount(report.data.googleCalendar.connectedVendors)}</strong>{' '}
                        vendors connected,{' '}
                        <strong>{formatCount(report.data.googleCalendar.failingRefresh)}</strong>{' '}
                        whose token last failed to refresh.
                    </p>
                    <p>
                        <strong>
                            The two mobile-money gateways report “not configured” even with an API
                            key set, and that is deliberate.
                        </strong>{' '}
                        Both are placeholders that complete no payment: unkeyed they return a mock
                        success and hand the customer a fake code while no money moves. Configured
                        has to mean “this payment path works”.
                    </p>
                </div>
            ) : null}
        </PageContainer>
    );
}
