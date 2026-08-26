import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { ErrorState } from '@/components/common/DataState';
import { CopyableId } from '@/components/common/CopyableId';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { getSubscription } from '@/services/billing.service';
import { useAdmin } from '@/store';
import { isPlatformActor } from '@/types/actor.types';

/**
 * `GET /billing/subscriptions/:subscriptionId` · `billing.plans.read`.
 *
 * One term by its own id. It exists so an operator can link a colleague to a
 * single term, and so a `paymentReference` quoted in a support ticket has
 * somewhere to point — both of which the two list endpoints can only answer by
 * making somebody scroll.
 *
 * ── No collision with the owner-scoped read ───────────────────────────────────
 * `GET /billing/subscriptions/:ownerType/:ownerId` takes **two** path segments
 * and this takes one, so Express separates them structurally rather than by
 * declaration order. Nothing here has to disambiguate.
 *
 * ── Read-only, and that is the whole surface ──────────────────────────────────
 * There is no write on a single term. Changing what an owner is billed is
 * `POST /billing/subscriptions/:ownerType/:ownerId`, which creates a new row
 * rather than editing this one — terms are a history, not a mutable record. So
 * this page offers no actions, and the owner link is the way back to the screen
 * that does.
 */
export function SubscriptionDetail() {
    const { subscriptionId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const subscription = useAsyncData(`/billing/subscriptions/${subscriptionId}`, (signal) =>
        getSubscription(subscriptionId, { signal }),
    );

    if (subscription.isLoading) {
        return (
            <PageContainer title="Subscription">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!subscription.data) {
        return (
            <PageContainer title="Subscription">
                <div className="space-y-4">
                    <ErrorState
                        error={subscription.error}
                        onRetry={subscription.reload}
                        deniedTitle="No such subscription"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = subscription.data;
    const planLabel = record.plan.name ?? record.plan.code ?? 'Unknown plan';

    return (
        <PageContainer
            title={planLabel}
            description={<CopyableId value={record.id} label="subscription ID" truncate={false} />}
        >
            <BackLink />

            <Card>
                <CardHeader>
                    <CardTitle>Term</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Status">
                            <Badge variant={record.status === 'active' ? 'default' : 'outline'}>
                                {humaniseEnum(record.status) ?? record.status}
                            </Badge>
                        </Definition>

                        <Definition label="Owner">
                            <Link
                                to={`/dashboard/accounts/${record.owner.type}/${record.owner.id}`}
                                className="font-medium hover:underline"
                            >
                                {record.owner.name ?? record.owner.id}
                            </Link>
                            <span className="text-muted-foreground ml-2 text-xs">
                                {humaniseEnum(record.owner.type) ?? record.owner.type}
                            </span>
                        </Definition>

                        <Definition label="Plan">
                            <Link
                                to={`/dashboard/billing/${record.plan.id}`}
                                className="font-medium hover:underline"
                            >
                                {planLabel}
                            </Link>
                            {record.plan.name === null && record.plan.code ? (
                                <p className="text-muted-foreground text-xs">
                                    The tier itself is missing — only its code survives on this
                                    term.
                                </p>
                            ) : null}
                        </Definition>

                        <Definition label="Started">
                            {/*
                              Null while `pending_activation` — the term exists and
                              has not begun. Distinct from "unknown".
                            */}
                            {record.startedAt ? (
                                formatInstantInZone(record.startedAt, timeZone)
                            ) : (
                                <span className="text-muted-foreground text-sm">
                                    Not started — queued behind the current term
                                </span>
                            )}
                        </Definition>

                        <Definition label="Expires">
                            {/*
                              `null` here is the never-expiring free tier, NOT
                              "unknown" — saying so is the difference between a
                              reassuring answer and a worrying one.
                            */}
                            {record.expiresAt ? (
                                formatInstantInZone(record.expiresAt, timeZone)
                            ) : (
                                <span className="text-muted-foreground text-sm">
                                    Never — this tier does not expire
                                </span>
                            )}
                        </Definition>

                        <Definition label="Assigned by">
                            {record.assignedBy === null ? (
                                /*
                                  Nobody did: a self-service purchase, or the lazy
                                  free default. Not a missing record.
                                */
                                <span className="text-muted-foreground text-sm">
                                    Not assigned by an administrator — a self-service purchase or
                                    the default tier
                                </span>
                            ) : (
                                <span className="text-sm">
                                    {/*
                                      `name` is a snapshot taken at write time, and
                                      only administrators get one — a platform id
                                      resolves in jovi-mall's database, where a
                                      denormalised copy would go stale.
                                    */}
                                    {record.assignedBy.name ?? 'Not recorded'}
                                    {!isPlatformActor(record.assignedBy) ? (
                                        <span className="text-muted-foreground">
                                            {' '}
                                            · administrator
                                        </span>
                                    ) : null}
                                </span>
                            )}
                        </Definition>

                        <Definition label="Payment reference">
                            {record.paymentReference ? (
                                <CopyableId
                                    value={record.paymentReference}
                                    label="payment reference"
                                    truncate={false}
                                />
                            ) : (
                                <NotSet />
                            )}
                        </Definition>

                        <Definition label="Credit allowance">
                            {/*
                              Guards a double grant: the allowance is granted once,
                              inside the same transaction that activates the term.
                            */}
                            {record.allowanceGranted ? 'Granted' : 'Not granted yet'}
                        </Definition>

                        <Definition label="Created">
                            {record.createdAt ? (
                                formatInstantInZone(record.createdAt, timeZone)
                            ) : (
                                <NotSet />
                            )}
                        </Definition>

                        <Definition label="Updated">
                            {record.updatedAt ? (
                                formatInstantInZone(record.updatedAt, timeZone)
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/billing/subscriptions"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
            <ArrowLeft className="size-4" />
            All subscriptions
        </Link>
    );
}
