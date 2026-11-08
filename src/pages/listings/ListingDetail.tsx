import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, RotateCcw, ScrollText, XCircle } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableId } from '@/components/common/CopyableId';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { HiddenContactsCard } from '@/components/listings/HiddenContactsCard';
import { ListingActionDialog, type ListingActionRequest } from '@/components/listings/ListingActionDialog';
import { ListingReviewBadge, ListingStatusBadge, RevisionBadge } from '@/components/listings/ListingBits';
import { ListingContentView } from '@/components/listings/ListingContentView';
import { ListingLeadsPanel } from '@/components/listings/ListingLeadsPanel';
import { LabelledRow } from '@/components/listings/LeadSections';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatRelative, humaniseEnum } from '@/lib/format';
import { getListing } from '@/services/listings.service';
import { useAdmin, useCan } from '@/store';
import {
    LISTINGS_PATH,
    changedListingFields,
    copyUnderReview,
    listingActorLabel,
    listingDecisionLabel,
    listingName,
    listingOffers,
    listingSuspensionLabel,
    listingSuspensionRemedy,
    preflagFieldLabel,
    preflagKindLabel,
    type ListingAction,
    type ListingDetail as ListingDetailRecord,
} from '@/types/listings.types';

/**
 * One listing — `GET /listings/:listingId` · `catalog.listings.read`.
 *
 * What a reviewer needs, in the order they need it: where it stands and why,
 * what the automatic check found, the public content (on a change to a live
 * listing, the change first with every touched field marked, the live copy
 * beside it), and the hidden contacts behind their own recorded button.
 *
 * ── Actions need the state AND the permission ────────────────────────────────
 * Approve / Reject on `catalog.listings.review`, Take offline / Put back on
 * `catalog.listings.suspend` — every tier holds all four today, and the gate is
 * the permission, never the tier. The state half is the server's
 * `availableActions` (Put back only for a listing staff took offline: the other
 * two reasons are lifted by a top-up and by the plan).
 *
 * Every write answers the listing read back fresh; it is held over the read it
 * answered, so the next load — Refresh, a tab return — drops it.
 */
export function ListingDetail() {
    const { listingId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get('tab') === 'leads' ? 'leads' : 'listing';

    const listing = useAsyncData(`/listings/${listingId}`, (signal) => getListing(listingId, { signal }));
    const [written, setWritten] = useState<{ over: ListingDetailRecord | null; next: ListingDetailRecord } | null>(null);
    const [request, setRequest] = useState<ListingActionRequest | null>(null);

    if (listing.isLoading) {
        return (
            <PageContainer title="Listing">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const record = written && written.over === listing.data ? written.next : listing.data;

    if (!record) {
        return (
            <PageContainer title="Listing">
                <div className="space-y-4">
                    <ErrorState error={listing.error} onRetry={listing.reload} deniedTitle="No such listing" />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const copy = copyUnderReview(record);
    const name = listingName({ ...record, title: copy?.title ?? null, companyName: copy?.companyName ?? null });
    const preflags = record.review?.preflags ?? [];
    const excerpts = preflags.map((flag) => flag.excerpt ?? '').filter(Boolean);
    const underReview = record.review?.state === 'pending_review';
    const revisionUnderReview = record.isRevision && underReview && record.pending && record.published;

    const setTab = (next: string) =>
        setSearchParams(
            (current) => {
                const params = new URLSearchParams(current);
                if (next === 'leads') params.set('tab', 'leads');
                else params.delete('tab');
                return params;
            },
            { replace: true },
        );

    return (
        <PageContainer
            title={name}
            description={<CopyableId value={record.id} label="listing ID" truncate={false} />}
            actions={<ActionButtons listing={record} onAction={(kind) => setRequest({ kind, listing: record })} />}
        >
            <div className="space-y-4">
                <BackLink />

                <StandingCard listing={record} timeZone={timeZone} />

                {preflags.length > 0 ? (
                    <Card className="border-warning/40">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="text-warning size-4" aria-hidden />
                                {preflags.length === 1
                                    ? 'The automatic check found 1 contact in the public text'
                                    : `The automatic check found ${preflags.length} contacts in the public text`}
                            </CardTitle>
                            <CardDescription>
                                A help, not a decision: each is marked in the text below. Contacts belong in the hidden
                                fields, where customers pay to unlock them.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul className="divide-y rounded-lg border">
                                {preflags.map((flag, index) => (
                                    <li key={index} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-baseline sm:gap-3">
                                        <span className="text-sm font-medium sm:w-56 sm:shrink-0">
                                            {preflagKindLabel(flag.kind)} in {preflagFieldLabel(flag.field).toLowerCase()}
                                        </span>
                                        <code className="bg-muted rounded px-1.5 py-0.5 text-sm break-all">{flag.excerpt ?? '—'}</code>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>
                ) : null}

                <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="listing">Listing</TabsTrigger>
                        <TabsTrigger value="leads">Leads ({formatCount(record.counts.leads)})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="listing" className="space-y-4">
                        {revisionUnderReview ? (
                            <div className="grid gap-4 lg:grid-cols-2">
                                <ContentCard
                                    title="The change under review"
                                    description="What the provider wants to publish. Fields that differ from the live copy are marked."
                                >
                                    <ListingContentView
                                        content={record.pending!}
                                        changed={changedListingFields(record.published, record.pending)}
                                        excerpts={excerpts}
                                    />
                                </ContentCard>
                                <ContentCard
                                    title="Live now"
                                    description="What customers see until the change is decided."
                                >
                                    <ListingContentView content={record.published!} />
                                </ContentCard>
                            </div>
                        ) : copy ? (
                            <ContentCard
                                title={underReview ? 'What the provider submitted' : 'Public content'}
                                description="What customers see before they unlock anything."
                            >
                                <ListingContentView content={copy} excerpts={excerpts} />
                            </ContentCard>
                        ) : (
                            <p className="text-muted-foreground text-sm">The provider has written nothing yet.</p>
                        )}

                        <HiddenContactsCard
                            key={record.id}
                            listingId={record.id}
                            availableFields={record.availableFields}
                            timeZone={timeZone}
                        />

                        <Can permission="audit.read">
                            <Link
                                to={`/dashboard/audit?targetType=listing&targetId=${encodeURIComponent(record.id)}`}
                                className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
                            >
                                <ScrollText className="size-4" />
                                Full history in the audit trail, including every view of the hidden contacts
                            </Link>
                        </Can>
                    </TabsContent>

                    <TabsContent value="leads">
                        {tab === 'leads' ? <ListingLeadsPanel listingId={record.id} timeZone={timeZone} /> : null}
                    </TabsContent>
                </Tabs>
            </div>

            <ListingActionDialog
                request={request}
                onClose={() => setRequest(null)}
                onDone={(next) => setWritten({ over: listing.data, next })}
                onMoved={() => {
                    setWritten(null);
                    listing.reload();
                }}
            />
        </PageContainer>
    );
}

/** The buttons that both the listing's state and the administrator's permissions allow. */
function ActionButtons({
    listing,
    onAction,
}: {
    listing: ListingDetailRecord;
    onAction: (kind: ListingAction) => void;
}) {
    const can = useCan();
    const buttons: ReactNode[] = [];
    if (can('catalog.listings.review') && listingOffers(listing, 'approve')) {
        buttons.push(
            <Button key="approve" size="sm" onClick={() => onAction('approve')}>
                <CheckCircle2 className="size-4" />
                Approve
            </Button>,
        );
    }
    if (can('catalog.listings.review') && listingOffers(listing, 'reject')) {
        buttons.push(
            <Button key="reject" size="sm" variant="outline" onClick={() => onAction('reject')}>
                <XCircle className="size-4" />
                Reject
            </Button>,
        );
    }
    if (can('catalog.listings.suspend') && listingOffers(listing, 'suspend')) {
        buttons.push(
            <Button key="suspend" size="sm" variant="outline" onClick={() => onAction('suspend')}>
                <Ban className="size-4" />
                Take offline
            </Button>,
        );
    }
    if (can('catalog.listings.suspend') && listingOffers(listing, 'unsuspend')) {
        buttons.push(
            <Button key="unsuspend" size="sm" variant="outline" onClick={() => onAction('unsuspend')}>
                <RotateCcw className="size-4" />
                Put back
            </Button>,
        );
    }
    if (buttons.length === 0) return null;
    return <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{buttons}</div>;
}

/** Where the listing stands and why — status, the provider, the last decision, an offline reason. */
function StandingCard({ listing, timeZone }: { listing: ListingDetailRecord; timeZone: string }) {
    const can = useCan();
    const { review, suspension, lastDecision, vendor } = listing;
    return (
        <Card>
            <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap gap-1.5">
                    <ListingStatusBadge status={listing.status} suspensionReason={suspension?.reason} />
                    <ListingReviewBadge status={listing.status} reviewState={review?.state ?? null} />
                    {listing.isRevision && review?.state === 'pending_review' ? <RevisionBadge /> : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <LabelledRow label="Provider">
                        {can('vendors.read') ? (
                            <Link to={`/dashboard/vendors/${vendor.id}`} className="text-primary hover:underline">
                                {vendor.displayName ?? vendor.id}
                            </Link>
                        ) : (
                            (vendor.displayName ?? vendor.id)
                        )}
                        <span className="text-muted-foreground block text-xs">
                            {vendor.verified ? 'Identity verified' : `Identity ${humaniseEnum(vendor.kycStatus) ?? 'unknown'}`}
                            {vendor.status && vendor.status !== 'active' ? ` · account ${humaniseEnum(vendor.status)}` : ''}
                        </span>
                    </LabelledRow>
                    {review?.submittedAt ? (
                        <LabelledRow label="Submitted">
                            {formatRelative(review.submittedAt)}
                            <span className="text-muted-foreground block text-xs">
                                {formatInstantInZone(review.submittedAt, timeZone)}
                            </span>
                        </LabelledRow>
                    ) : null}
                    <LabelledRow label="Leads · unlocks">
                        {formatCount(listing.counts.leads)} · {formatCount(listing.counts.reveals)}
                    </LabelledRow>
                    {listing.publishedAt ? (
                        <LabelledRow label="First published">{formatInstantInZone(listing.publishedAt, timeZone)}</LabelledRow>
                    ) : null}
                </div>

                {suspension ? (
                    <div className="border-destructive/30 bg-destructive/5 space-y-1 rounded-lg border p-3 text-sm">
                        <p className="font-medium">Offline — {listingSuspensionLabel(suspension.reason).toLowerCase()}</p>
                        {listingSuspensionRemedy(suspension.reason) ? (
                            <p className="text-muted-foreground">{listingSuspensionRemedy(suspension.reason)}</p>
                        ) : null}
                        {suspension.note ? (
                            <p className="whitespace-pre-line">
                                <span className="text-muted-foreground">Note the provider sees: </span>“{suspension.note}”
                            </p>
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                            {listingActorLabel(suspension.by)}, {formatInstantInZone(suspension.at, timeZone) ?? 'at an unknown time'}
                        </p>
                    </div>
                ) : null}

                {lastDecision ? (
                    <div className="space-y-1 text-sm">
                        <p>
                            <span className="text-muted-foreground">Last decision: </span>
                            <Badge variant="outline">{listingDecisionLabel(lastDecision.decision)}</Badge>{' '}
                            by {listingActorLabel(lastDecision.by)}, {formatInstantInZone(lastDecision.at, timeZone) ?? 'at an unknown time'}
                        </p>
                        {lastDecision.reasons.length > 0 ? (
                            <ul className="text-muted-foreground list-disc space-y-0.5 pl-5">
                                {lastDecision.reasons.map((reason, index) => (
                                    <li key={index} className="whitespace-pre-line">
                                        {reason}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}

function ContentCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

function BackLink() {
    return (
        <Link to={LISTINGS_PATH} className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
            <ArrowLeft className="size-4" />
            Back to listings
        </Link>
    );
}
