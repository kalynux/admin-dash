import { useState } from 'react';
import { Undo2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import {
    PLATFORM_CODE_ROLE_CLOSURE_REQUEST_NOT_FOUND,
    withdrawRoleClosure,
} from '@/services/users.service';
import { ApiError } from '@/types/api.types';
import {
    isClosableRole,
    ROLE_CLOSURE_STATUS_LABELS,
    ROLE_CLOSURE_WARNING_LABELS,
    type RoleClosureRequest,
    type RoleClosureWarning,
} from '@/types/users.types';

interface RoleClosureRequestsPanelProps {
    userId: string;
    requests: RoleClosureRequest[] | null;
    error: unknown;
    isLoading: boolean;
    onRetry: () => void;
    timeZone: string;
    /** A withdrawal happened, or the list was stale — reload it and the trail. */
    onChanged: () => void;
}

/**
 * `GET /users/:userId/closure-requests` · `users.read` — every request to close
 * one of this account's roles, newest first, and how the user answered.
 *
 * This is the **only** place an administrator sees the user's answer: the
 * confirm and decline happen in jovi-mall under the user's own session, so they
 * write no audit row here. `status` is already effective — a `pending` past its
 * `expiresAt` arrives as `expired` — so nothing here does expiry maths.
 *
 * Support reads it (the list is on `users.read`) and cannot act on it: Withdraw
 * is behind `users.close`, tiers 1–2.
 */
export function RoleClosureRequestsPanel({
    userId,
    requests,
    error,
    isLoading,
    onRetry,
    timeZone,
    onChanged,
}: RoleClosureRequestsPanelProps) {
    const [withdrawing, setWithdrawing] = useState<RoleClosureRequest | null>(null);

    return (
        <Card id="role-closure-requests">
            <CardHeader>
                <CardTitle>Closure requests</CardTitle>
                <CardDescription>
                    Requests asking this user to close one of their roles. Only the user can
                    confirm one, in their own app; a request expires unanswered after 7 days.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
                {isLoading ? <InlineLoader /> : null}
                {!isLoading && !requests && error ? (
                    <ErrorState error={error} onRetry={onRetry} />
                ) : null}
                {requests && requests.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No closure has ever been requested for this account.
                    </p>
                ) : null}

                {requests?.map((request) => (
                    <RequestRow
                        key={request.id}
                        request={request}
                        timeZone={timeZone}
                        onWithdraw={() => setWithdrawing(request)}
                    />
                ))}
            </CardContent>

            {withdrawing ? (
                <WithdrawRoleClosureDialog
                    userId={userId}
                    request={withdrawing}
                    onOpenChange={(open) => {
                        if (!open) setWithdrawing(null);
                    }}
                    onChanged={onChanged}
                />
            ) : null}
        </Card>
    );
}

function RequestRow({
    request,
    timeZone,
    onWithdraw,
}: {
    request: RoleClosureRequest;
    timeZone: string;
    onWithdraw: () => void;
}) {
    const at = (iso: string | null) => formatInstantInZone(iso, timeZone) ?? '—';
    const pending = request.status === 'pending';

    return (
        <div className="space-y-3 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="capitalize">
                        {request.role}
                    </Badge>
                    <ClosureStatusBadge status={request.status} />
                </div>
                {pending && isClosableRole(request.role) ? (
                    <Can permission="users.close">
                        <Button variant="outline" size="sm" onClick={onWithdraw}>
                            <Undo2 className="size-4" />
                            Withdraw
                        </Button>
                    </Can>
                ) : null}
            </div>

            {/* The administrator's words, exactly as the user was shown them. */}
            <blockquote className="border-l-2 pl-3 whitespace-pre-wrap">{request.reason}</blockquote>

            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted-foreground">Requested by</dt>
                <dd>
                    {request.requestedBy.name ?? (
                        <span className="text-muted-foreground font-mono text-xs">
                            {request.requestedBy.id}
                        </span>
                    )}{' '}
                    <span className="text-muted-foreground">· {at(request.requestedAt)}</span>
                </dd>

                <dt className="text-muted-foreground">{pending ? 'Expires' : 'Answer due by'}</dt>
                <dd>{at(request.expiresAt)}</dd>

                {request.resolvedAt ? (
                    <>
                        <dt className="text-muted-foreground">
                            {request.status === 'cancelled' ? 'Withdrawn' : 'Answered'}
                        </dt>
                        <dd>
                            {at(request.resolvedAt)}
                            {request.resolvedBy?.name ? (
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {request.resolvedBy.name}
                                </span>
                            ) : null}
                        </dd>
                    </>
                ) : null}

                {request.declineNote ? (
                    <>
                        <dt className="text-muted-foreground">User&rsquo;s note</dt>
                        <dd className="whitespace-pre-wrap">{request.declineNote}</dd>
                    </>
                ) : null}

                {request.outcome ? (
                    <>
                        <dt className="text-muted-foreground">Outcome</dt>
                        <dd>
                            Role closed {at(request.outcome.closedAt)}.{' '}
                            {request.outcome.accountClosed
                                ? 'It was their last role, so the whole account closed.'
                                : 'Their other roles were not affected.'}{' '}
                            {request.outcome.endedRelationships === 1
                                ? '1 contract or connection ended with it.'
                                : `${request.outcome.endedRelationships} contracts or connections ended with it.`}
                        </dd>
                    </>
                ) : null}
            </dl>

            {request.warnings.length > 0 ? (
                <div className="space-y-1">
                    <p className="text-muted-foreground text-xs">
                        Shown to the user before confirming — what they forfeit:
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5">
                        {request.warnings.map((warning, index) => (
                            <li key={`${warning.code}-${index}`}>
                                {describeWarning(warning, timeZone)}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

function describeWarning(warning: RoleClosureWarning, timeZone: string): string {
    const parts = [ROLE_CLOSURE_WARNING_LABELS[warning.code] ?? warning.code];
    if (warning.planCode) parts.push(`plan ${warning.planCode}`);
    if (warning.expiresAt) {
        parts.push(`paid until ${formatInstantInZone(warning.expiresAt, timeZone) ?? warning.expiresAt}`);
    }
    // Credits are a count, not money, on `credit_balance_forfeited`.
    if (warning.amount !== null) {
        parts.push(
            warning.code === 'credit_balance_forfeited'
                ? `${warning.amount} credits`
                : formatMoney(warning.amount, 'XAF'),
        );
    }
    return parts.join(' · ');
}

/**
 * `pending` is the only open state. `confirmed` is drawn destructive because the
 * role is gone for good; the three that left it intact are muted. An unknown
 * status renders raw.
 */
function ClosureStatusBadge({ status }: { status: string }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'font-normal',
                status === 'pending' && 'border-warning/40 bg-warning/10',
                status === 'confirmed' && 'border-destructive/30 bg-destructive/10 text-destructive',
                (status === 'declined' || status === 'cancelled' || status === 'expired') &&
                    'text-muted-foreground',
            )}
        >
            {ROLE_CLOSURE_STATUS_LABELS[status] ?? status}
        </Badge>
    );
}

/**
 * `DELETE /users/:userId/roles/:role/closure` · `users.close` — withdraw the
 * pending request. `ROLE_CLOSURE_REQUEST_NOT_FOUND` (404) means the user
 * answered, or it expired, first: not a failure, so the list is reloaded to
 * show what actually happened.
 */
function WithdrawRoleClosureDialog({
    userId,
    request,
    onOpenChange,
    onChanged,
}: {
    userId: string;
    request: RoleClosureRequest;
    onOpenChange: (open: boolean) => void;
    onChanged: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    async function withdraw() {
        if (!isClosableRole(request.role)) return;
        setSubmitting(true);
        setFormError(null);
        try {
            await withdrawRoleClosure(userId, request.role);
            notify.success('Closure request withdrawn', {
                description: 'The user can no longer confirm it. Nothing about the role changed.',
            });
            onOpenChange(false);
            onChanged();
        } catch (error) {
            if (
                error instanceof ApiError &&
                error.platformCode === PLATFORM_CODE_ROLE_CLOSURE_REQUEST_NOT_FOUND
            ) {
                notify.warning('Nothing is waiting to withdraw', {
                    description: 'The user may have answered first. The list has been refreshed.',
                });
                onOpenChange(false);
                onChanged();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Withdraw the {request.role} closure request?</DialogTitle>
                    <DialogDescription>
                        The user will no longer be able to confirm it, and nothing about the role
                        changes. The withdrawal is recorded in the activity trail.
                    </DialogDescription>
                </DialogHeader>

                {formError ? <AuthFormError error={formError} /> : null}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Keep it
                    </Button>
                    <Button type="button" onClick={withdraw} disabled={submitting}>
                        {submitting ? <InlineLoader /> : null}
                        Withdraw request
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
