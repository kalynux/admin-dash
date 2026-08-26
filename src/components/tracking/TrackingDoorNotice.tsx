import { Radio } from 'lucide-react';

import { ErrorState } from '@/components/common/DataState';
import {
    isDoorRefused,
    isDoorUnavailable,
    isDoorUnconfigured,
    upstreamCodeOf,
} from '@/services/tracking.service';

/**
 * How a geo-tracker data-door failure is rendered.
 *
 * ── Three codes, three audiences, three messages ──────────────────────────────
 * `TRACKING-DOORS.md` § 5 is explicit that the split exists to prevent one
 * confusion: *"three codes because the remedies are three different people — an
 * operator's deployment, geo-tracker's scope configuration, and an on-call
 * engineer. A single 'tracking unavailable' makes all three look like an
 * outage."* So this never collapses them.
 *
 * ── `TRACKING_DOOR_UNCONFIGURED` is not an error ──────────────────────────────
 * The door is inert by default **on both sides**, and a deployment that has not
 * opened it is in a normal, supported state. It renders as a quiet notice rather
 * than a red banner, and the rest of the agent or shipment screen keeps working.
 *
 * Anything that is *not* one of the three falls through to the ordinary
 * `ErrorState` — a `404`, a `403` and a `500` are still what they always were.
 */
export function TrackingDoorNotice({
    error,
    onRetry,
    subject,
}: {
    error: unknown;
    onRetry?: () => void;
    /** What could not be read, for the refused case. e.g. "this agent's position". */
    subject: string;
}) {
    if (isDoorUnconfigured(error)) {
        return (
            <div className="text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
                <Radio className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                    <p className="text-foreground font-medium">
                        Live tracking is not enabled for this deployment
                    </p>
                    <p>
                        The tracking service has not been connected here. Everything else on this
                        screen still works — this is a deployment setting, not a fault.
                    </p>
                </div>
            </div>
        );
    }

    if (isDoorRefused(error)) {
        const upstream = upstreamCodeOf(error);
        return (
            <div className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-4 py-3 text-sm">
                <p className="font-medium">The tracking service declined this read</p>
                <p className="text-muted-foreground">
                    {/*
                      Usually a scope that was never granted: geo-tracker grants
                      `agent:presence` alone when its scope list is unset, so a
                      deployment can legitimately serve presence and refuse a
                      position. That is a configuration answer, not an incident.
                    */}
                    {upstream === 'SERVICE_SCOPE_FORBIDDEN'
                        ? `This deployment's tracking credential does not carry the permission for ${subject}. Presence and events may still work — the four reads are granted separately.`
                        : upstream === 'SERVICE_TOKEN_INVALID'
                          ? 'The two services’ shared secret does not match. If this fails on every record, it is a deployment problem rather than a data one.'
                          : upstream === 'SERVICE_DOOR_NOT_CONFIGURED'
                            ? 'The tracking service’s own half of the door is closed.'
                            : `The tracking service refused to answer for ${subject}.`}
                </p>
                {upstream ? (
                    <p className="text-muted-foreground text-xs">Reported as {upstream}.</p>
                ) : null}
            </div>
        );
    }

    if (isDoorUnavailable(error)) {
        return (
            <div className="border-destructive/30 bg-destructive/10 space-y-1 rounded-lg border px-4 py-3 text-sm">
                <p className="font-medium">The tracking service did not answer</p>
                <p className="text-muted-foreground">
                    Not fixable from here. Try again shortly; if it persists, escalate with the
                    request reference.
                </p>
                {onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="text-sm font-medium underline underline-offset-2"
                    >
                        Try again
                    </button>
                ) : null}
            </div>
        );
    }

    return <ErrorState error={error} onRetry={onRetry} />;
}
