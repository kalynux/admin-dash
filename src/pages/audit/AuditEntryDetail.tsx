import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, TriangleAlert } from 'lucide-react';

import { AuditMetadataView } from '@/components/audit/AuditMetadataView';
import { AuditStatusBadge } from '@/components/audit/AuditStatusBadge';
import { AuditTargetLink } from '@/components/audit/AuditTargetLink';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { getAuditEntry } from '@/services/audit.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import type { AuditEntryDetail as AuditEntryDetailRow } from '@/types/audit.types';

/**
 * One audit entry, in full.
 *
 * ── The brief this screen answers ─────────────────────────────────────────────
 * ADR-012 states what a row must identify: **actor · action · resource ·
 * resource id · timestamp · result · safe metadata · request context, with no
 * secrets in metadata**. Each of those is a block below, in that order, so the
 * screen can be read against the requirement rather than against the DTO.
 *
 * ── A 404 here is a denial, not a fault ───────────────────────────────────────
 * `AUDIT_ENTRY_NOT_FOUND` means "no such row **or** the row is outside your read
 * scope" — a 403 on an id would confirm the id exists, which is an existence
 * oracle over exactly the rows the scope hides. So it renders as a calm "not
 * available to you", which `ErrorState` already does for `isAccessDenial`.
 *
 * ── Two things that are easy to render wrongly ────────────────────────────────
 * `actor.tier` is **the level held at the time**, not the level now, and saying
 * so is the difference between a trail and a directory lookup. And `payload` /
 * `before` / `after` are **changed fields only, never whole documents** — a
 * two-key `after` does not mean the record now has two fields.
 *
 * ── Which mono renders are values, and which are vocabulary ───────────────────
 * This screen is mostly `font-mono`, and most of it is **not** copyable. Five
 * fields are values an operator pastes into a query, a ticket or a colleague's
 * chat window — the session id, the resource id, the actor's email, the request
 * id and the calling address — and those carry the copy affordance. The action
 * name, the error code, `denialKind` and the permission badges are vocabulary:
 * you read them and you filter on them, you do not paste them. The three
 * metadata blocks are a **dump, not a value**. Neither gets one.
 *
 * ⚠ Nothing here shortens. Every one of the five renders whole today, there is
 * room in a definition list for all of them, and `break-words` on the `<dd>`
 * inherits into the value — so shortening would cost information and buy no
 * space.
 */

/** The ids are 24-hex; a malformed one is a `400` worth not spending. */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export function AuditEntryDetail() {
    const { auditId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();

    const timeZone = resolveTimeZone(admin.timezone);
    const isValidId = OBJECT_ID.test(auditId);

    const entry = useAsyncData(isValidId ? `/audit/${auditId}` : '', (signal) =>
        // The key is `''` for a malformed id and this never runs — `useAsyncData`
        // still calls the fetcher, so the guard is here rather than only above.
        isValidId
            ? getAuditEntry(auditId, { signal })
            : Promise.reject(new Error('invalid audit id')),
    );

    if (!isValidId) {
        return (
            <PageContainer title="Audit entry">
                <BackLink />
                <ErrorState
                    error={
                        new ApiError({
                            status: 400,
                            code: CODE_CLIENT_INVALID_ID,
                            message: 'That is not a valid audit entry id.',
                            category: 'validation',
                        })
                    }
                />
            </PageContainer>
        );
    }

    const row = entry.data;

    return (
        <PageContainer
            title={row ? (row.actionSummary ?? row.action) : 'Audit entry'}
            description={row ? row.action : undefined}
            actions={<BackLink />}
        >
            <DataState
                isLoading={entry.isLoading}
                error={entry.error}
                onRetry={entry.reload}
                loading={<DetailSkeleton />}
            >
                {row ? <EntryBody row={row} timeZone={timeZone} can={can} /> : null}
            </DataState>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/audit">
                <ArrowLeft className="size-4" />
                Back to the trail
            </Link>
        </Button>
    );
}

function EntryBody({
    row,
    timeZone,
    can,
}: {
    row: AuditEntryDetailRow;
    timeZone: string;
    can: ReturnType<typeof useCan>;
}) {
    const neverLanded = row.status === 'attempted' && row.completedAt === null;

    return (
        <div className="space-y-6">
            {/*
              Leads, because it is the one thing on the screen that changes what
              the reader should do: the intent was recorded and the outcome never
              came back, so on a delegated or external transport the change may or
              may not have happened on the other side.
            */}
            {neverLanded ? (
                <div className="border-warning/30 bg-warning/5 flex items-start gap-2 rounded-lg border p-3">
                    <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1 text-sm">
                        <p className="font-medium">The outcome never landed.</p>
                        <p className="text-muted-foreground">
                            The intent was recorded and nothing came back to close it. If this
                            action was carried out by another service, it may or may not have
                            taken effect there — the trail cannot say which.
                        </p>
                    </div>
                </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">What happened</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Action">
                                <span className="font-mono text-xs">{row.action}</span>
                            </Definition>
                            <Definition label="Description">
                                {row.actionSummary ?? (
                                    <NotSet>No longer in the action catalog</NotSet>
                                )}
                            </Definition>
                            <Definition label="Family">{row.actionFamily}</Definition>
                            <Definition label="Result">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <AuditStatusBadge status={row.status} />
                                    {row.sensitive ? (
                                        <Badge variant="outline" className="gap-1">
                                            <ShieldAlert className="size-3" />
                                            Sensitive
                                        </Badge>
                                    ) : null}
                                    {row.delegated ? (
                                        <Badge variant="outline">Carried out by jovi-mall</Badge>
                                    ) : null}
                                </div>
                            </Definition>
                            <Definition label="Status code">
                                {row.outcome.statusCode ?? <NotSet />}
                            </Definition>
                            <Definition
                                label="Error code"
                                hint={
                                    row.outcome.platformCode ? (
                                        <span className="sr-only">
                                            The platform&rsquo;s own code, which is the only
                                            handle on why a delegated write was refused.
                                        </span>
                                    ) : undefined
                                }
                            >
                                {/* On a delegated refusal every row reads
                                    `PLATFORM_OPERATION_REJECTED`; the platform's own
                                    code is the only thing that says *why*. */}
                                {row.outcome.platformCode ?? row.outcome.code ? (
                                    <span className="font-mono text-xs">
                                        {row.outcome.platformCode ?? row.outcome.code}
                                    </span>
                                ) : (
                                    <NotSet>None — it succeeded</NotSet>
                                )}
                            </Definition>
                            {row.outcome.message ? (
                                <Definition label="Message">{row.outcome.message}</Definition>
                            ) : null}
                            {row.outcome.denialKind ? (
                                <Definition label="Refused by">
                                    <span className="font-mono text-xs">
                                        {row.outcome.denialKind}
                                    </span>
                                </Definition>
                            ) : null}
                            {row.outcome.requiredPermissions.length > 0 ? (
                                <Definition label="Would have needed">
                                    <div className="flex flex-wrap gap-1">
                                        {row.outcome.requiredPermissions.map((name) => (
                                            <Badge
                                                key={name}
                                                variant="outline"
                                                className="font-mono text-[11px]"
                                            >
                                                {name}
                                            </Badge>
                                        ))}
                                    </div>
                                </Definition>
                            ) : null}
                            {row.viaApprovalId ? (
                                <Definition
                                    label="Approval"
                                    hint={
                                        <span className="sr-only">
                                            This action was committed through four eyes.
                                        </span>
                                    }
                                >
                                    {can('approvals.read') ? (
                                        <Link
                                            to={`/dashboard/approvals/${row.viaApprovalId}`}
                                            className="hover:underline"
                                        >
                                            Committed through four eyes
                                        </Link>
                                    ) : (
                                        'Committed through four eyes'
                                    )}
                                </Definition>
                            ) : null}
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Who did it</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Actor">
                                {row.actor.displayName ?? row.actor.email ?? (
                                    <span className="capitalize">{row.actor.kind}</span>
                                )}
                            </Definition>
                            {row.actor.email && row.actor.displayName ? (
                                <Definition label="Email">
                                    <CopyableValue
                                        variant="email"
                                        value={row.actor.email}
                                        label="actor email"
                                    />
                                </Definition>
                            ) : null}
                            <Definition label="Kind">
                                <span className="capitalize">{row.actor.kind}</span>
                                <p className="text-muted-foreground text-xs">
                                    {describeActorKind(row.actor.kind)}
                                </p>
                            </Definition>
                            <Definition label="Level">
                                {row.actor.tier !== null ? (
                                    <>
                                        Tier {row.actor.tier}
                                        <p className="text-muted-foreground text-xs">
                                            The level they held <strong>at the time</strong>, not
                                            necessarily the level they hold now.
                                        </p>
                                    </>
                                ) : (
                                    <NotSet>Not an administrator</NotSet>
                                )}
                            </Definition>
                            <Definition label="Session">
                                {/* A UUID, not a 24-hex id — and `CopyableValue`
                                    renders the same `NotSet` the branch here used
                                    to, so the ternary would have been a second
                                    fallback saying the same thing. */}
                                <CopyableValue
                                    value={row.actor.sessionId}
                                    label="session ID"
                                    truncate={false}
                                />
                            </Definition>
                            {row.actor.id && row.actor.kind === 'administrator' ? (
                                <Definition label="Everything they did">
                                    <Link
                                        to={`/dashboard/audit?actorId=${encodeURIComponent(row.actor.id)}`}
                                        className="hover:underline"
                                    >
                                        Other rows by this administrator
                                    </Link>
                                    {can('administrators.read') ? (
                                        <>
                                            {' · '}
                                            <Link
                                                to={`/dashboard/administrators/${row.actor.id}`}
                                                className="hover:underline"
                                            >
                                                Their account
                                            </Link>
                                        </>
                                    ) : null}
                                </Definition>
                            ) : null}
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">What it was done to</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Resource">
                                <AuditTargetLink
                                    type={row.target.type}
                                    id={row.target.id}
                                    label={row.target.label}
                                    showId
                                />
                            </Definition>
                            <Definition label="Resource id">
                                {/* The ternary stays: "No specific record" is a
                                    statement about the action, and `NotSet`'s
                                    default would flatten it into "Not set". */}
                                {row.target.id ? (
                                    <CopyableValue
                                        value={row.target.id}
                                        label="resource ID"
                                        truncate={false}
                                    />
                                ) : (
                                    <NotSet>No specific record</NotSet>
                                )}
                            </Definition>
                            <Definition
                                label="Subject class"
                                hint={
                                    <span className="sr-only">
                                        The axis the Support read scope keys on.
                                    </span>
                                }
                            >
                                {row.target.subjectClass ? (
                                    <>
                                        {row.target.subjectClass.replace(/_/g, ' ')}
                                        <p className="text-muted-foreground text-xs">
                                            {row.target.subjectClass === 'internal'
                                                ? 'A row about this service’s own machinery — not visible to Support administrators.'
                                                : 'Platform activity — visible at every level.'}
                                        </p>
                                    </>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            {row.relatedTarget ? (
                                <Definition
                                    label="Also concerned"
                                    hint={
                                        <span className="sr-only">
                                            A second record the action also concerned.
                                        </span>
                                    }
                                >
                                    <AuditTargetLink
                                        type={row.relatedTarget.type}
                                        id={row.relatedTarget.id}
                                    />
                                </Definition>
                            ) : null}
                            {row.target.id && row.target.type !== 'none' ? (
                                <Definition label="This record’s history">
                                    <Link
                                        to={`/dashboard/audit?targetType=${encodeURIComponent(row.target.type)}&targetId=${encodeURIComponent(row.target.id)}`}
                                        className="hover:underline"
                                    >
                                        Other rows about this record
                                    </Link>
                                </Definition>
                            ) : null}
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">When</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Recorded">
                                {formatInstantInZone(row.occurredAt, timeZone) ?? '—'}
                            </Definition>
                            <Definition label="Completed">
                                {row.completedAt ? (
                                    formatInstantInZone(row.completedAt, timeZone)
                                ) : (
                                    <NotSet>Never landed</NotSet>
                                )}
                            </Definition>
                            <Definition label="Exported">
                                {row.exportedAt ? (
                                    formatInstantInZone(row.exportedAt, timeZone)
                                ) : (
                                    <NotSet>Not yet exported</NotSet>
                                )}
                            </Definition>
                            <Definition label="Eligible for deletion">
                                {row.purgeAfter ? (
                                    formatInstantInZone(row.purgeAfter, timeZone)
                                ) : (
                                    <>
                                        <NotSet>Not eligible</NotSet>
                                        <p className="text-muted-foreground text-xs">
                                            Retention is exported <strong>and</strong> aged, never
                                            aged alone — this stays empty until an export has
                                            stamped the row.
                                        </p>
                                    </>
                                )}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">The request</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        {/* Not a value: a verb and a route, two things joined for
                            reading. Neither half is pasted anywhere, and copying
                            the pair would hand over a string that is not either. */}
                        <Definition label="Call">
                            <span className="font-mono text-xs break-all">
                                {row.request.method} {row.request.path}
                            </span>
                        </Definition>
                        <Definition
                            label="Request id"
                            hint={
                                <span className="sr-only">
                                    Join on this to follow one action across rows.
                                </span>
                            }
                        >
                            <CopyableValue
                                value={row.correlationId}
                                label="request ID"
                                truncate={false}
                            />
                            <p className="mt-1">
                                <Link
                                    to={`/dashboard/audit?correlationId=${encodeURIComponent(row.correlationId)}`}
                                    className="text-sm hover:underline"
                                >
                                    Other rows recorded for this request
                                </Link>
                            </p>
                        </Definition>
                        <Definition label="From">
                            {/* `plain`, not `id`: an address that has lost four
                                characters out of its middle is not an address,
                                and the variant is what refuses rather than a
                                prop somebody can forget. */}
                            <CopyableValue
                                variant="plain"
                                mono
                                value={row.request.ip}
                                label="request IP"
                            />
                        </Definition>
                        <Definition label="Client">
                            {/* A user-agent string is prose a browser wrote about
                                itself, not a handle on a record. Left as text. */}
                            {row.request.userAgent ? (
                                <span className="text-xs break-all">{row.request.userAgent}</span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">What changed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <p className="text-muted-foreground text-sm">
                        A row records what <strong>moved</strong>, never a whole document — so a
                        two-field <span className="font-mono text-xs">after</span> does not mean
                        the record now has two fields. Credential-shaped fields are stripped by
                        the service before they are stored, and again here before they are shown.
                    </p>

                    <AuditMetadataView
                        label="Request payload"
                        value={row.payload}
                        emptyHint="This action carried no request body."
                    />
                    <AuditMetadataView
                        label="Before"
                        value={row.before}
                        emptyHint="Nothing existed to change — or the action changed no stored state."
                    />
                    <AuditMetadataView
                        label="After"
                        value={row.after}
                        emptyHint="No resulting state was recorded."
                    />
                </CardContent>
            </Card>
        </div>
    );
}

/** The three actor kinds, spelled out — two of them are easy to misread. */
function describeActorKind(kind: string): string {
    if (kind === 'system') {
        return 'This service acting on its own: the approval-expiry sweep, the retention purge, or the bootstrap CLI.';
    }
    if (kind === 'anonymous') {
        return 'A sign-in attempt against an address matching no account.';
    }
    if (kind === 'administrator') return 'An administrator of this service.';
    return 'An actor kind this dashboard has not seen before.';
}
