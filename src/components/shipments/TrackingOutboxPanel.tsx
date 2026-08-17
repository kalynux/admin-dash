import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OutboxHealth } from '@/types/shipments.types';

/**
 * `tracking.outbox` — **did this shipment's news actually reach geo-tracker?**
 *
 * ── Health, and deliberately not a trackability verdict ───────────────────────
 * Whether a shipment is *trackable* is jovi-mall's policy, and the platform's
 * governing rule is that visibility rules are never reimplemented outside it.
 * Recomputing one here would be a second definition of who may be watched. The
 * words "trackable" and "untrackable" therefore appear nowhere in this panel, and
 * a test pins that.
 *
 * ── Why it is worth a panel at all ────────────────────────────────────────────
 * The platform's outbox is **not transactional**: a crash between the commit and
 * the enqueue loses the event permanently. The consequence lands exactly here — a
 * reassignment whose `agent_released` event was lost leaves a live tracking
 * session open on an agent who is no longer delivering, and nothing else on any
 * screen would say so.
 *
 * So `failed > 0`, or a stale `lastEventAt` on a shipment that has just been
 * reassigned, is the signal an operator is looking for when they open this.
 */
export function TrackingOutboxPanel({
    outbox,
    timeZone,
}: {
    outbox: OutboxHealth;
    timeZone: string;
}) {
    const unhealthy = outbox.failed > 0;

    return (
        <Card className={cn(unhealthy && 'border-warning/40')}>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Delivery-event dispatch
                    <InfoHint label="About this panel">
                        Whether this shipment&apos;s events reached the tracking service — not
                        whether anyone may watch it. That question is the platform&apos;s and is
                        deliberately not answered here.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {unhealthy ? (
                    <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                        {formatCount(outbox.failed)}{' '}
                        {outbox.failed === 1 ? 'event has' : 'events have'} failed to send. If this
                        shipment was recently reassigned, the release event may be among them — in
                        which case a tracking session could still be open on the previous agent.
                    </p>
                ) : null}

                <DefinitionList>
                    <Definition label="Waiting to send">{formatCount(outbox.pending)}</Definition>
                    <Definition label="Failed">{formatCount(outbox.failed)}</Definition>
                    <Definition label="Last event">
                        {outbox.lastEventAt ? (
                            <>
                                {formatInstantInZone(outbox.lastEventAt, timeZone)}
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {formatRelative(outbox.lastEventAt)}
                                </span>
                            </>
                        ) : (
                            <NotSet>No event has ever been queued</NotSet>
                        )}
                    </Definition>
                    <Definition label="Last error">
                        {outbox.lastError ? (
                            <span className="font-mono text-xs">{outbox.lastError}</span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>
                </DefinitionList>

                <p className="text-muted-foreground text-xs">
                    The platform&apos;s outbox is not transactional — an event can be lost between
                    the database write and the queue — so this is the one place that failure becomes
                    visible.
                </p>
            </CardContent>
        </Card>
    );
}
