import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { CopyableId } from '@/components/common/CopyableId';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { LeadActionDialog, type LeadActionRequest } from '@/components/listings/LeadActionDialogs';
import {
    LabelledRow,
    LeadBlockSection,
    LeadConsentLine,
    LeadCustomerSection,
    LeadListingLink,
    LeadRevealList,
    OtherLeadsSection,
} from '@/components/listings/LeadSections';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { getListingLead } from '@/services/listings.service';
import { useAdmin, useCan } from '@/store';
import {
    LISTINGS_PATH,
    formatCredits,
    leadChannelLabel,
    listingContactFieldLabel,
} from '@/types/listings.types';

/**
 * One lead in full — `GET /listings/leads/:leadId` · `catalog.listings.read`.
 *
 * The drain-detection view: who the customer really is (full phone and e-mail,
 * when the account and each role were made), every unlock on this lead with its
 * cost and refund state, their block on this listing, and their **other leads
 * across providers** — several fresh numbers belonging to one person is the
 * pattern to spot.
 *
 * Refund (tiers 1–2 only; absent for Support) and Block / Lift (every tier) are
 * here too. Opened outside a ticket, so no ticket id is recorded on them; from
 * a report, use the ticket's lead panel instead.
 */
export function ListingLeadDetail() {
    const { leadId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const navigate = useNavigate();
    const timeZone = resolveTimeZone(admin.timezone);
    const [request, setRequest] = useState<LeadActionRequest | null>(null);

    const lead = useAsyncData(`/listings/leads/${leadId}`, (signal) => getListingLead(leadId, { signal }));

    if (lead.isLoading) {
        return (
            <PageContainer title="Lead">
                <DetailSkeleton />
            </PageContainer>
        );
    }
    if (!lead.data) {
        return (
            <PageContainer title="Lead">
                <div className="space-y-4">
                    <ErrorState error={lead.error} onRetry={lead.reload} deniedTitle="No such lead" />
                    <BackLink onBack={() => navigate(-1)} />
                </div>
            </PageContainer>
        );
    }

    const record = lead.data;
    const customerName = record.customer.name ?? 'This customer';

    return (
        <PageContainer
            title={`Lead — ${customerName}`}
            description={<CopyableId value={record.id} label="lead ID" truncate={false} />}
        >
            <div className="space-y-4">
                <BackLink onBack={() => navigate(-1)} />

                <Section title="The lead">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <LabelledRow label="Listing">
                            <LeadListingLink listing={record.listing} />
                        </LabelledRow>
                        <LabelledRow label="Provider">
                            {can('vendors.read') ? (
                                <Link to={`/dashboard/vendors/${record.provider.id}`} className="text-primary hover:underline">
                                    {record.provider.displayName ?? record.provider.id}
                                </Link>
                            ) : (
                                (record.provider.displayName ?? record.provider.id)
                            )}
                        </LabelledRow>
                        <LabelledRow label="First unlock">
                            {formatInstantInZone(record.createdAt, timeZone) ?? 'Unknown'}
                            <span className="text-muted-foreground block text-xs">via {leadChannelLabel(record.channel)}</span>
                        </LabelledRow>
                        <LabelledRow label="Served until">
                            {formatInstantInZone(record.windowEnd, timeZone) ?? 'Unknown'}
                            <span className="text-muted-foreground block text-xs">
                                {record.windowOpen ? 'Still running' : 'Ended'}
                                {record.engagedWhileLive ? '' : ' · unlocked while the listing was not live'}
                            </span>
                        </LabelledRow>
                        <LabelledRow label="Unlocked">
                            {record.fieldsRevealed.map(listingContactFieldLabel).join(', ') || 'Nothing'}
                        </LabelledRow>
                        <LabelledRow label="Cost to the provider">
                            {formatCredits(record.credits.charged)}
                            {record.credits.refunded > 0 ? (
                                <span className="text-muted-foreground block text-xs">
                                    {formatCredits(record.credits.refunded)} refunded
                                </span>
                            ) : null}
                        </LabelledRow>
                    </div>
                </Section>

                <Section title="The customer" description="In full. The provider sees only a first name and initial, and the last two digits of the phone.">
                    <LeadCustomerSection
                        customer={record.customer}
                        leadAt={record.createdAt}
                        accountRoles={record.accountRoles}
                        timeZone={timeZone}
                    />
                    <LabelledRow label="Contact by this provider">
                        <LeadConsentLine state={record.consent.state} />
                    </LabelledRow>
                </Section>

                <Section title="Unlocks on this lead">
                    <LeadRevealList
                        reveals={record.reveals}
                        timeZone={timeZone}
                        onRefund={(reveal) => setRequest({ kind: 'refund', reveal })}
                    />
                </Section>

                <Section title="On this listing">
                    <LeadBlockSection
                        activeBlock={record.activeBlock}
                        timeZone={timeZone}
                        onBlock={() => setRequest({ kind: 'block' })}
                        onLift={() => setRequest({ kind: 'lift' })}
                    />
                </Section>

                <Section
                    title="Their other leads"
                    description="Across every provider. Several fresh accounts unlocking the same providers is how a drain shows."
                >
                    <OtherLeadsSection otherLeads={record.otherLeads} timeZone={timeZone} />
                </Section>
            </div>

            <LeadActionDialog
                request={request}
                listingId={record.listingId}
                customerId={record.customer.id}
                customerName={customerName}
                onClose={() => setRequest(null)}
                onDone={lead.reload}
            />
        </PageContainer>
    );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <CardContent className="space-y-4">{children}</CardContent>
        </Card>
    );
}

function BackLink({ onBack }: { onBack: () => void }) {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button
                type="button"
                onClick={onBack}
                className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
            >
                <ArrowLeft className="size-4" />
                Back
            </button>
            <Link to={LISTINGS_PATH} className="text-muted-foreground text-sm hover:underline">
                All listings
            </Link>
        </div>
    );
}
