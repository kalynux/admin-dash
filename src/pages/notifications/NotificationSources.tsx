import { BellOff, BellRing, HelpCircle, Radio } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { hasPermission } from '@/lib/authorization';
import { useNotificationSources } from '@/hooks/use-notification-sources';
import { usePermissions } from '@/store';
import { PERMISSION_NAMES } from '@/types/permissions.types';
import type { NotificationSource } from '@/types/notifications.types';

/**
 * `GET /notifications/sources` — what this inbox can **ever** say.
 *
 * ── The one question this screen exists to answer ─────────────────────────────
 * An empty inbox has two completely different meanings and no way to tell them
 * apart from the inbox itself: *"none of these have happened"* and *"these are
 * happening and I am not entitled to see them"*. Holding `notifications.read`
 * gets you the inbox; **which rows are in it is decided per row**, from the
 * permission each source declares, re-checked on every request — so two
 * administrators at the same level legitimately see different things, and a
 * demotion changes the whole existing inbox rather than only new arrivals.
 *
 * `requiredPermission` is the field that settles it, and the contract says so:
 * *"This is the field that answers 'why do I never see these'."* It is returned
 * here and deliberately **never on a notification row**, where it would describe
 * the authorization model to whoever holds a session.
 *
 * ── Why an unrecognised permission gets no verdict ────────────────────────────
 * `requiredPermission` is a raw string from the server, not a
 * `RoutedPermissionName`, and the catalog can gain a name on a routine deploy.
 * Reporting a name this build has never heard of as "you do not hold this" would
 * tell an operator they are excluded when the truth is that this dashboard cannot
 * say. So there are four verdicts, not two, and the fourth is an honest shrug.
 */

type Verdict = 'ungated' | 'held' | 'withheld' | 'unknown';

interface SourceVerdict {
    kind: Verdict;
    label: string;
    explanation: string;
}

function verdictFor(source: NotificationSource, held: ReadonlySet<string>): SourceVerdict {
    const required = source.requiredPermission;

    if (required === null) {
        return {
            kind: 'ungated',
            label: 'You receive these',
            explanation: 'This source is ungated — it reaches every administrator.',
        };
    }

    if (hasPermission(held, required)) {
        return {
            kind: 'held',
            label: 'You receive these',
            explanation: `You hold ${required}.`,
        };
    }

    // `PERMISSION_NAMES` is this build's transcription of the catalog. A name
    // outside it is not evidence of anything about the caller.
    if (!(PERMISSION_NAMES as readonly string[]).includes(required)) {
        return {
            kind: 'unknown',
            label: 'Gated on a permission this dashboard does not know',
            explanation: `The service gates this on ${required}, which is not in this build's catalog. Whether you receive it cannot be answered here.`,
        };
    }

    return {
        kind: 'withheld',
        label: 'You do not receive these',
        explanation: `They are gated on ${required}, which your level does not hold.`,
    };
}

const VERDICT_ICON = {
    ungated: BellRing,
    held: BellRing,
    withheld: BellOff,
    unknown: HelpCircle,
} as const;

const VERDICT_VARIANT = {
    ungated: 'secondary',
    held: 'secondary',
    withheld: 'outline',
    unknown: 'outline',
} as const;

export function NotificationSources() {
    const registry = useNotificationSources();
    const { held } = usePermissions();

    // `held` is `null` until `/permissions/me` has answered. This route is
    // reached from inside the shell, so that has happened — but an empty set is
    // the safe reading either way: it yields "withheld", never a false "held".
    const grants: ReadonlySet<string> = held ?? new Set<string>();

    return (
        <PageContainer
            title="Notification sources"
            description="Every kind of notification this inbox can raise, what each is derived from, and which of them reach you."
        >
            <DataState
                isLoading={registry.isLoading}
                error={registry.error}
                isEmpty={registry.sources.length === 0}
                loading={<ListSkeleton rows={4} />}
                empty={
                    <EmptyState
                        icon={Radio}
                        title="No sources declared"
                        description="The service reports no notification sources, which means nothing can reach this inbox at all."
                    />
                }
            >
                <p className="text-muted-foreground max-w-3xl text-sm">
                    Holding <code className="font-mono text-xs">notifications.read</code> gets you
                    the inbox. Which rows are in it is decided per source, and re-checked on every
                    request — so a change to your level applies to notifications already delivered,
                    not just to new ones.
                </p>

                <div className="space-y-3">
                    {registry.sources.map((source) => {
                        const verdict = verdictFor(source, grants);
                        const Icon = VERDICT_ICON[verdict.kind];

                        return (
                            <div
                                key={source.id}
                                className="space-y-3 rounded-lg border p-4"
                                data-verdict={verdict.kind}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                        {/*
                                          ⚠ Left as plain text, and the same goes
                                          for `collection` and the `produces`
                                          badges below. Nothing on this screen is
                                          a *record's* identifier — they are the
                                          registry's own vocabulary, the same
                                          strings the inbox offers as filter
                                          options, and this one is this card's
                                          heading. An operator reads them to
                                          decide which sources reach them; they do
                                          not paste one anywhere. A copy button
                                          per row would put twenty-odd of them on
                                          a page that has no values on it.
                                        */}
                                        <p className="font-mono text-sm font-medium">{source.id}</p>
                                        <p className="text-muted-foreground text-sm">
                                            {source.describe}
                                        </p>
                                    </div>

                                    <Badge
                                        variant={VERDICT_VARIANT[verdict.kind]}
                                        className="gap-1.5 whitespace-nowrap"
                                    >
                                        <Icon className="size-3.5" />
                                        {verdict.label}
                                    </Badge>
                                </div>

                                <p className="text-muted-foreground text-xs">
                                    {verdict.explanation}
                                </p>

                                <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                                    <div className="space-y-1">
                                        <dt className="text-muted-foreground">Derived from</dt>
                                        <dd className="font-mono">{source.collection}</dd>
                                    </div>

                                    <div className="space-y-1">
                                        <dt className="text-muted-foreground">Raises</dt>
                                        <dd className="flex flex-wrap gap-1">
                                            {source.produces.map((type) => (
                                                <Badge
                                                    key={type}
                                                    variant="outline"
                                                    className="font-mono text-[10px] font-normal"
                                                >
                                                    {type}
                                                </Badge>
                                            ))}
                                        </dd>
                                    </div>

                                    <div className="space-y-1">
                                        <dt className="text-muted-foreground">Severity</dt>
                                        <dd className="flex flex-wrap gap-1">
                                            {/* Rendered raw, never switched on —
                                                adding a severity is an additive
                                                backend change. */}
                                            {source.severity.map((value) => (
                                                <Badge
                                                    key={value}
                                                    variant="outline"
                                                    className="text-[10px] font-normal"
                                                >
                                                    {value}
                                                </Badge>
                                            ))}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        );
                    })}
                </div>

                <p className="text-muted-foreground max-w-3xl text-xs">
                    Nothing on this platform creates a notification directly. Each source is a
                    background projection of rows another part of the platform already committed,
                    and a source added later starts from the moment it was added — there is no
                    backfill.
                </p>
            </DataState>
        </PageContainer>
    );
}
