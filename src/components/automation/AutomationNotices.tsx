import { Info, PlugZap, ShieldQuestion } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The standing copy both `/automation` screens carry.
 *
 * Three separate claims, kept as three components rather than one banner, because they answer
 * three different questions and any of them can be true without the others:
 *
 * - `ProjectionNotice` — *am I seeing everything there is?*
 * - `ReporterStatusNotice` — *is this board empty because nothing failed, or because nothing
 *   reports here?*
 * - `CoverageNote` — *does an absent workflow mean a healthy workflow?*
 *
 * They live here rather than inside one screen because the summary needs the second and third
 * and not the first: `GET /automation/summary` is **not** tier-projected, so there is no
 * projection to disclose. Two copies of the same paragraph would have drifted.
 */

/**
 * What each rung of `GET /automation/failures` includes, said on screen.
 *
 * Copied in shape from `SystemErrors.tsx`, and for the contract's own stated reason rather
 * than for consistency: without it a Support agent reading a three-field row cannot tell
 * *"there is nothing more to know"* from *"I am not being shown it"*, and escalates an
 * incident that is already understood.
 */
const VIEW_COPY: Record<string, string> = {
    support:
        'You are seeing the support view: which channel was affected, what kind of failure it was, and when. The workflow, the node and the error text are not included — this is everything at this level, not a truncated version of more. The summary beside this page is not graded, so it will show you more.',
    admin: 'You are seeing the admin view: the workflow, the node, the error message and both timestamps. The stack trace is not included.',
    developer:
        'You are seeing the developer view: the complete record, including the stack and the report’s own request reference.',
};

export function ProjectionNotice({ view }: { view: string }) {
    if (!view) return null;

    return (
        <div className="bg-muted/40 flex gap-2.5 rounded-lg border p-3 text-sm">
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-muted-foreground">{VIEW_COPY[view] ?? `Projection: ${view}.`}</p>
        </div>
    );
}

interface ReporterStatusProps {
    /** `data.configured` — whether this deployment accepts reports at all. */
    configured: boolean;
    /** Whether the answer came back with nothing in it. */
    isEmpty: boolean;
}

/**
 * ⚠ **`configured: false` is not "all healthy"**, and an empty board is ambiguous without it.
 *
 * When `AUTOMATION_REPORT_TOKEN` is unset this deployment accepts no reports, and both routes
 * answer with nothing in them. So an empty result means one of two opposite things — *nothing
 * failed*, or *no reporter is pointed at this deployment* — and only this flag separates them.
 *
 * The failure mode is silent by construction: ADR-022's Consequences record that a token
 * mismatch is never compared and surfaces only as reports that **stop arriving**, which looks
 * exactly like a quiet week. That is why the unconfigured case is a warning rather than a note.
 */
export function ReporterStatusNotice({ configured, isEmpty }: ReporterStatusProps) {
    if (!configured) {
        return (
            <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3 text-sm">
                <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                    <p className="font-medium">
                        This deployment accepts no failure reports. An empty board here means
                        nothing.
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                        The reporting token is not set, so the automation layer has nowhere to
                        send anything and nothing has been stored. This is not a statement about
                        the customer bot — it may be failing right now and there would be no
                        difference on this screen.
                    </p>
                </div>
            </div>
        );
    }

    if (!isEmpty) return null;

    return (
        <div className="text-muted-foreground flex gap-2.5 rounded-lg border p-3 text-sm">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
                <p className="text-foreground font-medium">
                    Nothing was reported in this window.
                </p>
                <p className="mt-1 text-xs">
                    Reporting is switched on, so this is a real quiet period rather than a
                    deployment with no reporter — but read it with the coverage note below.
                </p>
            </div>
        </div>
    );
}

/**
 * ⚠ **Coverage is an allowlist, and this note states NO count.**
 *
 * Only workflows with the failure reporter set as their `errorWorkflow` report at all. The
 * contract page says nine; ADR-022's re-measure against the instance says ten, one day later —
 * D-8 predicted its own drift in writing and then drifted. A figure on this screen would be
 * wrong on a schedule nobody controls, so what is said is the *shape* of the rule instead.
 */
export function CoverageNote({ className }: { className?: string }) {
    return (
        <p className={cn('text-muted-foreground text-xs', className)}>
            Coverage is an allowlist: a workflow reports here only once somebody has wired the
            failure reporter to it. A workflow you expected and cannot find may never have been
            wired rather than be healthy — check that before concluding anything from its
            absence.
        </p>
    );
}

interface KindBalanceProps {
    executionFailed: number;
    degradedTurn: number;
}

/**
 * The diagnosis the two kinds exist to give — **and the reason they must never be merged.**
 *
 * A wall of `degraded_turn` with no `execution_failed` is the signature of *something else*
 * being down, usually jovi-mall: the workflows are built never to fail (fifteen
 * error-swallowing nodes, deliberately), so they absorbed an outage and answered anyway. A
 * wall of `execution_failed` is the automation layer itself.
 *
 * Rendered only when the window is one-sided. A mixed window has no single reading and a
 * confident sentence over it would be worse than silence.
 */
export function KindBalanceHint({ executionFailed, degradedTurn }: KindBalanceProps) {
    if (degradedTurn > 0 && executionFailed === 0) {
        return (
            <Diagnosis>
                Everything in this window is a <strong>degraded turn</strong> and nothing died.
                The bot ran, absorbed a failure and still answered — which points at something
                behind it rather than at the automation layer. jovi-mall being unreachable is the
                usual cause.
            </Diagnosis>
        );
    }

    if (executionFailed > 0 && degradedTurn === 0) {
        return (
            <Diagnosis>
                Everything in this window is a workflow that <strong>died outright</strong>, with
                no degraded answers beside it. That points at the automation layer itself — a
                send refused, or a node throwing — rather than at a service behind it.
            </Diagnosis>
        );
    }

    return null;
}

function Diagnosis({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-muted/40 flex gap-2.5 rounded-lg border p-3 text-sm">
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-muted-foreground">{children}</p>
        </div>
    );
}
