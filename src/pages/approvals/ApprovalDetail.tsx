import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, RotateCw, Undo2, X } from 'lucide-react';

import {
    ApproveApprovalDialog,
    RejectApprovalDialog,
    WithdrawApprovalDialog,
} from '@/components/approvals/ApprovalDecisionDialogs';
import { ApprovalStatusBadge } from '@/components/approvals/ApprovalStatusBadge';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { approvalAffordances } from '@/lib/approval-actions';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatRelative } from '@/lib/format';
import { getApproval } from '@/services/approvals.service';
import { useAdmin, usePermissions } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import { CopyableId } from '@/components/common/CopyableId';

/** An approval id is 24-hex — unlike session and challenge ids, which are UUIDs. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Fail closed while the permission set is still resolving.
 *
 * `held` is `null` until `PermissionsProvider` answers, and a decision button
 * drawn from an unknown set would be a guess.
 */
const NOTHING_HELD: ReadonlySet<string> = new Set();

/**
 * One queued action, and the decision on it.
 *
 * ── `approved` does not mean it worked ────────────────────────────────────────
 * The queued action's precondition is evaluated **again** at approval time, up
 * to 24 hours after it was requested. So a request can be `approved` and carry a
 * `failureReason` — the signature landed and the action was refused. That field
 * is rendered prominently rather than tucked into the payload block, because it
 * is the difference between "done" and "not done" on a screen whose whole
 * subject is whether something happened.
 *
 * ── Expiry warns; it never disables ───────────────────────────────────────────
 * `expiresAt` is shown, and the buttons stay live past it. A client clock is not
 * the authority — `409 AUTHZ_APPROVAL_EXPIRED` is, and the dialogs handle it as
 * a reload rather than a fault.
 */
export function ApprovalDetail() {
    const { approvalId = '' } = useParams();

    if (!OBJECT_ID.test(approvalId)) return <InvalidApprovalId />;

    return <ApprovalDetailScreen approvalId={approvalId} />;
}

function InvalidApprovalId() {
    return (
        <PageContainer title="Request not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message:
                            'That is not a valid approval id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function ApprovalDetailScreen({ approvalId }: { approvalId: string }) {
    const admin = useAdmin();
    const { held } = usePermissions();
    const timeZone = resolveTimeZone(admin.timezone);

    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);

    const request = useAsyncData(`/approvals/${approvalId}`, (signal) =>
        getApproval(approvalId, { signal }),
    );

    if (request.isLoading) {
        return (
            <PageContainer title="Request">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!request.data) {
        return (
            <PageContainer title="Request">
                <ErrorState
                    error={request.error}
                    onRetry={request.reload}
                    deniedTitle="No such request"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const approval = request.data;
    const can = approvalAffordances(approval, held ?? NOTHING_HELD, admin.id);
    const expires = formatRelative(approval.expiresAt);

    return (
        <PageContainer
            title="Approval request"
            description={approval.description}
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={request.reload}
                        disabled={request.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    {can.canApprove ? (
                        <Button size="sm" onClick={() => setApproving(true)}>
                            <Check className="size-4" />
                            Approve
                        </Button>
                    ) : null}

                    {can.canReject ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setRejecting(true)}
                        >
                            <X className="size-4" />
                            Reject
                        </Button>
                    ) : null}

                    {can.canWithdraw ? (
                        <Button variant="outline" size="sm" onClick={() => setWithdrawing(true)}>
                            <Undo2 className="size-4" />
                            Withdraw
                        </Button>
                    ) : null}
                </>
            }
        >
            <BackLink />

            {/*
              Approved and then refused on the re-check. The single most
              important thing this screen can say, so it leads.
            */}
            {approval.failureReason ? (
                <div className="border-destructive/40 bg-destructive/10 flex gap-2.5 rounded-lg border p-4 text-sm">
                    <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 space-y-1">
                        <p className="text-destructive font-medium">
                            Approved, but the action was refused
                        </p>
                        <p className="text-muted-foreground">{approval.failureReason}</p>
                        <p className="text-muted-foreground text-xs">
                            The precondition is checked again at approval time, so an action that is
                            no longer valid is refused rather than performed. Nothing changed.
                        </p>
                    </div>
                </div>
            ) : null}

            {/*
              Why Approve is absent, said rather than left as a gap — otherwise it
              reads as a missing permission.
            */}
            {can.isOwnRequest && approval.status === 'pending' ? (
                <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                    You requested this, so you cannot approve it — that is the entire point of a
                    second signature. You can still reject it, or withdraw it.
                </p>
            ) : !can.canApprove && approval.status === 'pending' ? (
                <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                    Approving this needs{' '}
                    <code className="font-mono">{approval.action}</code> — the permission the queued
                    action itself names. There is deliberately no general "may approve" permission,
                    so nobody can commit an action they could not have performed themselves.
                </p>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>Request</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Status">
                            <ApprovalStatusBadge status={approval.status} />
                        </Definition>
                        <Definition label="Action">
                            <span className="font-mono text-xs">{approval.action}</span>
                        </Definition>
                        <Definition label="Requested by">
                            {approval.requestedBy === admin.id ? (
                                'You'
                            ) : (
                                <span className="font-mono text-xs">{approval.requestedBy}</span>
                            )}
                            <span className="text-muted-foreground">
                                {' '}
                                ({approval.requestedByTierLabel})
                            </span>
                        </Definition>
                        <Definition label="Requested">
                            {formatInstantInZone(approval.createdAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Expires">
                            {formatInstantInZone(approval.expiresAt, timeZone) ?? '—'}
                            {expires ? (
                                <span className="text-muted-foreground"> ({expires})</span>
                            ) : null}
                        </Definition>
                        <Definition label="Target">
                            <span className="font-mono text-xs">
                                {approval.targetType} · {approval.targetId}
                            </span>
                        </Definition>
                        <Definition label="Decided by">
                            {approval.approverId ? (
                                <span className="font-mono text-xs">{approval.approverId}</span>
                            ) : (
                                <NotSet>Not decided</NotSet>
                            )}
                        </Definition>
                        <Definition label="Decided">
                            {formatInstantInZone(approval.decidedAt, timeZone) ?? (
                                <NotSet>Not decided</NotSet>
                            )}
                        </Definition>
                        <Definition label="Note">
                            {approval.decisionNote ?? <NotSet>No note recorded</NotSet>}
                        </Definition>
                        <Definition label="Request id">
                            <CopyableId value={approval.id} label="approval ID" />
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>What will be performed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        The validated payload the action runs with. It was fixed when the request was
                        made — approving does not re-read it from the screen that submitted it.
                    </p>
                    <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs">
                        {JSON.stringify(approval.payload, null, 2)}
                    </pre>
                </CardContent>
            </Card>

            <ApproveApprovalDialog
                approval={approval}
                open={approving}
                onOpenChange={setApproving}
                onDecided={request.reload}
                onStale={request.reload}
            />
            <RejectApprovalDialog
                approval={approval}
                open={rejecting}
                onOpenChange={setRejecting}
                onDecided={request.reload}
                onStale={request.reload}
            />
            <WithdrawApprovalDialog
                approval={approval}
                open={withdrawing}
                onOpenChange={setWithdrawing}
                onDecided={request.reload}
                onStale={request.reload}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/approvals"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
            <ArrowLeft className="size-4" />
            All requests
        </Link>
    );
}
