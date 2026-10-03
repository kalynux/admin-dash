import { useState } from 'react';
import { AlertTriangle, Pin, PinOff } from 'lucide-react';

import {
    PinAgencyCodLimitDialog,
    ReleaseAgencyCodLimitDialog,
} from '@/components/agencies/AgencyWriteDialogs';
import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Progress } from '@/components/ui/progress';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { getAgencyCodLimit } from '@/services/agencies.service';
import {
    agencyCodLimitSourceLabel,
    type AgencyCodLimit,
    type AgencyCodLimitOverride,
    type AgencyDetail,
} from '@/types/agencies.types';

/**
 * `GET /agencies/:agencyId/cod-limit` — the most cash on delivery this agency may
 * hold that has not reached the platform (2026-10-02, ADR-A09).
 *
 * ── Read by everyone who reads the agency, written by tiers 1–2 ───────────────
 * The read needs only `agencies.read`, which Support holds — "why was my
 * dispatch refused" arrives as a ticket. Pin and Release need
 * `agencies.cod_limit.set`, a `financial` permission Support never holds, so the
 * buttons are **hidden** from Support rather than left to answer `403`.
 *
 * ── Every figure is jovi-mall's ───────────────────────────────────────────────
 * The exposure, the headroom and `overLimit` are computed by jovi-mall and
 * forwarded. Nothing here re-derives them — the gauge only *draws* `total / limit`
 * — because a second definition of a limit we do not own is how a screen and a
 * refused dispatch end up disagreeing.
 *
 * ── `overLimit` is not hypothetical ───────────────────────────────────────────
 * A vendor's forced dispatch, a pin below current holdings, or two dispatches
 * racing (the limit is check-then-act, G-1) all leave an agency over. It is shown
 * prominently, because what it means is operational: the next vendor dispatch to
 * this agency is refused until cash comes back.
 *
 * ── No currency ───────────────────────────────────────────────────────────────
 * None of these figures carries one, so they are formatted as plain numbers — the
 * rule the agent pool and `/cod/overview` follow.
 */
export function AgencyCodLimitPanel({
    agency,
    timeZone,
}: {
    agency: AgencyDetail;
    timeZone: string;
}) {
    const [reloadToken, setReloadToken] = useState(0);
    const [pinning, setPinning] = useState(false);
    const [releasing, setReleasing] = useState(false);
    // The write answers the same shape as the read, so its result is shown at once
    // and the read is refreshed behind it rather than flashing a skeleton.
    const [written, setWritten] = useState<AgencyCodLimit | null>(null);

    const limit = useAsyncData(`/agencies/${agency.id}/cod-limit#${reloadToken}`, (signal) =>
        getAgencyCodLimit(agency.id, { signal }),
    );

    function onWritten(result: AgencyCodLimit) {
        setWritten(result);
        setReloadToken((current) => current + 1);
    }

    // While the refresh is in flight the hook still holds the PRE-write value;
    // the write's own answer is newer, so it wins until the read settles.
    const data = (limit.isRefreshing ? written : null) ?? limit.data ?? written;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-1">
                    Cash on delivery limit
                    <InfoHint label="About the COD limit">
                        The most cash on delivery this agency may hold that has not reached the
                        platform — in-flight COD shipments plus cash collected and not yet
                        remitted. A vendor dispatch that would take it over is refused.
                        Administrator-ordered dispatches are not subject to it.
                    </InfoHint>
                </CardTitle>
                {data ? (
                    <Can permission="agencies.cod_limit.set">
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => setPinning(true)}>
                                <Pin className="size-4" />
                                {data.override ? 'Change pin' : 'Pin a limit'}
                            </Button>
                            {/* Only a pin can be released. */}
                            {data.source === 'override' ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setReleasing(true)}
                                >
                                    <PinOff className="size-4" />
                                    Release
                                </Button>
                            ) : null}
                        </div>
                    </Can>
                ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
                {limit.isLoading && !data ? (
                    <InlineLoader label="Reading the COD limit…" />
                ) : data ? (
                    <LimitBody data={data} timeZone={timeZone} />
                ) : (
                    <ErrorState
                        error={limit.error}
                        onRetry={limit.reload}
                        deniedTitle="No COD limit for this agency"
                    />
                )}
            </CardContent>

            {data ? (
                <>
                    <PinAgencyCodLimitDialog
                        agency={agency}
                        current={data}
                        open={pinning}
                        onOpenChange={setPinning}
                        onDone={onWritten}
                    />
                    <ReleaseAgencyCodLimitDialog
                        agency={agency}
                        current={data}
                        open={releasing}
                        onOpenChange={setReleasing}
                        onDone={onWritten}
                    />
                </>
            ) : null}
        </Card>
    );
}

function LimitBody({ data, timeZone }: { data: AgencyCodLimit; timeZone: string }) {
    const { exposure } = data;
    // Drawn, never decided on: a limit of 0 with nothing held is an empty bar,
    // and anything held against 0 is a full one.
    const percent =
        data.limit > 0
            ? Math.min(100, (exposure.total / data.limit) * 100)
            : exposure.total > 0
              ? 100
              : 0;

    return (
        <>
            {data.overLimit ? (
                <p
                    role="alert"
                    className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
                >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                        Holds more than its limit — the next vendor dispatch to this agency will be
                        refused until cash comes back.
                    </span>
                </p>
            ) : null}

            <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm">
                        <strong className="text-lg tabular-nums">
                            {formatCount(exposure.total)}
                        </strong>{' '}
                        held of{' '}
                        <strong className="tabular-nums">{formatCount(data.limit)}</strong>
                    </p>
                    <Badge variant={data.source === 'override' ? 'default' : 'outline'}>
                        {agencyCodLimitSourceLabel(data.source)}
                    </Badge>
                </div>
                <Progress
                    value={percent}
                    aria-label="Cash held against the COD limit"
                    indicatorClassName={data.overLimit ? 'bg-destructive' : undefined}
                />
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Figure
                    label={`In deliveries (${formatCount(exposure.inFlightCount)})`}
                    value={exposure.inFlight}
                />
                <Figure
                    label={`Collected, not remitted (${formatCount(exposure.collectedCount)})`}
                    value={exposure.collectedUnremitted}
                />
                <Figure label="Headroom" value={data.headroom} />
            </dl>

            {data.override ? (
                <PinSummary
                    pin={data.override}
                    defaultLimit={data.defaultLimit}
                    timeZone={timeZone}
                />
            ) : (
                <p className="text-muted-foreground text-xs">
                    The platform default of {formatCount(data.defaultLimit)} applies. No
                    administrator has pinned another amount.
                </p>
            )}
        </>
    );
}

/**
 * Who pinned it, when and why — in full, because a release clears all of it off
 * the agency and the audit trail becomes the only place the reason survives.
 */
function PinSummary({
    pin,
    defaultLimit,
    timeZone,
}: {
    pin: AgencyCodLimitOverride;
    defaultLimit: number;
    timeZone: string;
}) {
    return (
        <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
            <p>
                Pinned at <strong className="tabular-nums">{formatCount(pin.amount)}</strong> by{' '}
                {pin.setByName ?? pin.setBySource}, {formatInstantInZone(pin.setAt, timeZone) ?? pin.setAt}
            </p>
            {pin.reason ? <p className="text-muted-foreground">“{pin.reason}”</p> : null}
            <p className="text-muted-foreground text-xs">
                It replaces the {formatCount(defaultLimit)} default until released.
            </p>
        </div>
    );
}

function Figure({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatCount(value)}</dd>
        </div>
    );
}
