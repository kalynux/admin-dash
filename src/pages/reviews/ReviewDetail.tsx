import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScrollText } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableId } from '@/components/common/CopyableId';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    ReviewActionDialog,
    type ReviewActionRequest,
} from '@/components/reviews/ReviewActionDialog';
import {
    ReviewAuthor,
    ReviewShop,
    ReviewStars,
    ReviewStatusBadge,
    ReviewSubject,
    ReviewText,
} from '@/components/reviews/ReviewBits';
import { ReviewRowActions } from '@/components/reviews/ReviewsTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { getReview } from '@/services/reviews.service';
import { useAdmin, useCan } from '@/store';
import {
    reviewModerationActionLabel,
    reviewSubjectTypeLabel,
    type ReviewModeration,
} from '@/types/reviews.types';

/**
 * One review — `GET /reviews/:reviewId` · `reviews.read`.
 *
 * The list row's shape, plus the one thing the list does not show: the
 * **last** moderation (`lastModeration` — action, when, the note, and who).
 * Only the last one is kept on the record; the full history is the audit
 * trail, filtered to `targetType=review&targetId=<id>`, linked below for
 * holders of `audit.read` (every tier).
 *
 * A deleted review answers `404`. After a delete from here the screen returns
 * to the list.
 */
export function ReviewDetail() {
    const { reviewId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const navigate = useNavigate();
    const timeZone = resolveTimeZone(admin.timezone);
    const [request, setRequest] = useState<ReviewActionRequest | null>(null);

    const review = useAsyncData(`/reviews/${reviewId}`, (signal) => getReview(reviewId, { signal }));

    if (review.isLoading) {
        return (
            <PageContainer title="Review">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!review.data) {
        return (
            <PageContainer title="Review">
                <div className="space-y-4">
                    <ErrorState error={review.error} onRetry={review.reload} deniedTitle="No such review" />
                    <p className="text-muted-foreground text-sm">
                        A deleted review is gone for good and is no longer here.
                    </p>
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = review.data;
    const goBack = () => navigate('/dashboard/reviews');

    return (
        <PageContainer
            title="Review"
            description={<CopyableId value={record.id} label="review ID" truncate={false} />}
            actions={
                <ReviewRowActions
                    review={record}
                    size="default"
                    onAction={(kind, target) => setRequest({ kind, review: target })}
                />
            }
        >
            <div className="space-y-4">
                <BackLink />

                <Card>
                    <CardHeader className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <ReviewStars rating={record.rating} className="[&>svg]:size-5" />
                            <ReviewStatusBadge review={record} withNote />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ReviewText review={record} />
                    </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>About</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition label="Kind">
                                    {reviewSubjectTypeLabel(record.subjectType)}
                                </Definition>
                                <Definition label={record.subjectType === 'delivery' ? 'Agent · agency' : 'Product'}>
                                    <ReviewSubject review={record} />
                                </Definition>
                                <Definition label="Shop">
                                    <ReviewShop review={record} />
                                </Definition>
                                <Definition label="Order">
                                    {record.orderId ? (
                                        <CopyableId
                                            value={record.orderId}
                                            label="order id"
                                            to={can('orders.read') ? `/dashboard/orders/${record.orderId}` : undefined}
                                        />
                                    ) : (
                                        <NotSet>None</NotSet>
                                    )}
                                </Definition>
                                {record.shipmentId ? (
                                    <Definition label="Shipment">
                                        <CopyableId
                                            value={record.shipmentId}
                                            label="shipment id"
                                            to={
                                                can('shipments.read')
                                                    ? `/dashboard/shipments/${record.shipmentId}`
                                                    : undefined
                                            }
                                        />
                                    </Definition>
                                ) : null}
                            </DefinitionList>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Author</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition label="Written by">
                                    <ReviewAuthor review={record} />
                                </Definition>
                                <Definition label="User">
                                    <CopyableId
                                        value={record.author.userId}
                                        label="user id"
                                        to={can('users.read') ? `/dashboard/users/${record.author.userId}` : undefined}
                                    />
                                </Definition>
                                <Definition label="Written">
                                    {formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}
                                </Definition>
                                <Definition label="First public">
                                    {formatInstantInZone(record.publishedAt, timeZone) ?? <NotSet>Never</NotSet>}
                                </Definition>
                                <Definition label="Last changed">
                                    {formatInstantInZone(record.updatedAt, timeZone) ?? <NotSet />}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Last moderation</CardTitle>
                        <CardDescription>
                            Only the most recent action is kept on the review. The note is for
                            administrators and is never shown to the author.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {record.lastModeration ? (
                            <ModerationDetails moderation={record.lastModeration} timeZone={timeZone} />
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Nobody has hidden or shown this review again.
                            </p>
                        )}

                        <Can permission="audit.read">
                            <Link
                                to={`/dashboard/audit?targetType=review&targetId=${encodeURIComponent(record.id)}`}
                                className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
                            >
                                <ScrollText className="size-4" />
                                Full history in the audit trail
                            </Link>
                        </Can>
                    </CardContent>
                </Card>
            </div>

            <ReviewActionDialog
                request={request}
                onClose={() => setRequest(null)}
                onUpdated={review.reload}
                onDeleted={goBack}
                onGone={goBack}
                onConflict={review.reload}
            />
        </PageContainer>
    );
}

function ModerationDetails({
    moderation,
    timeZone,
}: {
    moderation: ReviewModeration;
    timeZone: string;
}) {
    return (
        <DefinitionList>
            <Definition label="Action">{reviewModerationActionLabel(moderation.action)}</Definition>
            <Definition label="When">
                {formatInstantInZone(moderation.at, timeZone) ?? <NotSet>Unknown</NotSet>}
            </Definition>
            <Definition label="Note">
                {moderation.reason ? (
                    <span className="whitespace-pre-line">{moderation.reason}</span>
                ) : (
                    <NotSet>No note</NotSet>
                )}
            </Definition>
            <Definition label="By">
                {moderation.bySource === 'admin' ? (
                    moderation.byAdministratorId ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                            An administrator
                            <CopyableId value={moderation.byAdministratorId} label="administrator id" />
                        </span>
                    ) : (
                        'An administrator'
                    )
                ) : moderation.bySource === 'platform' ? (
                    'The platform'
                ) : (
                    (moderation.bySource ?? <NotSet>Unknown</NotSet>)
                )}
            </Definition>
        </DefinitionList>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/reviews"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to reviews
        </Link>
    );
}
