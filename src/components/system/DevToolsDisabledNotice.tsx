import { Link } from 'react-router-dom';
import { PowerOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DEV_TOOLS_FLAG } from '@/types/dev-tools.types';

interface DevToolsDisabledNoticeProps {
    /** What the operator was trying to do, so the sentence names it. */
    subject?: string;
    /** Set when this is rendered in response to a refusal rather than as a standing warning. */
    refused?: boolean;
}

/**
 * The `dev_tools.enabled` gate, explained where it bites.
 *
 * ── Two gates, two different remedies ─────────────────────────────────────────
 * The **permission** asks *may this person?* and is answered by the sidebar and by
 * `RequirePermission`. This is the other one: *is the service accepting these right now?* — and
 * it defaults **off**.
 *
 * A refusal from it is **`409 DEV_TOOLS_DISABLED`, not `403`**, with the category deliberately
 * overridden to `business_rule` rather than `conflict`. Both choices exist to stop an
 * administrator looking in the wrong place: a 403 would send them to inspect their own grants,
 * and a `conflict` would send them hunting a race. Nothing changed underneath them; the service
 * is simply refusing, and the fix is one screen away.
 *
 * ── One component for the banner and the refusal, on purpose ──────────────────
 * The standing warning (the flag is off, these buttons will refuse) and the caught refusal (it
 * did) are the same fact at two moments. Two components would eventually say two different
 * things about one flag.
 */
export function DevToolsDisabledNotice({ subject, refused }: DevToolsDisabledNoticeProps) {
    return (
        <div className="border-warning/40 bg-warning/10 flex flex-col gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-2.5">
                <PowerOff className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="space-y-1">
                    <p className="font-medium">
                        {refused
                            ? `Developer tools are switched off, so ${subject ?? 'that'} did not run.`
                            : 'Developer tools are switched off.'}
                    </p>
                    <p className="text-muted-foreground">
                        This is the service refusing, not a permission problem — you hold the
                        grant. Turn on the <code>{DEV_TOOLS_FLAG}</code> feature flag to run
                        {subject ? ` ${subject}` : ' these tools'}, and turn it off again
                        afterwards: the safe resting state for a capability that re-runs side
                        effects against live data is off.
                    </p>
                </div>
            </div>

            <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to="/dashboard/dev-tools/feature-flags">Go to feature flags</Link>
            </Button>
        </div>
    );
}
