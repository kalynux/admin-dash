import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flag } from 'lucide-react';

import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { getListingLead } from '@/services/listings.service';
import {
    leadChannelLabel,
    listingContactFieldLabel,
    listingLeadPath,
    listingPath,
    listingReportWantLabel,
    type ListingLeadTicketContext,
} from '@/types/listings.types';

/**
 * The lead panel on a `LISTING_LEAD_REPORT` ticket — a provider's report on a
 * customer who unlocked their contacts.
 *
 * From the ticket's `listingLead`: what the provider asked for, the listing, and
 * the unlocks they named with their refund state. From `GET
 * /listings/leads/:leadId` (a direct read, not audited): the customer **in
 * full**, their block on this listing, and their other leads — loaded with the
 * panel, because a report cannot be judged without them.
 *
 * ── What can be done from here ───────────────────────────────────────────────
 * **Refund** a named unlock — `catalog.listings.reveals.refund`, tiers 1–2, and
 * ⛔ absent (not disabled) for Support. **Block / Lift** the customer on this
 * listing — every tier. Both carry this ticket's id. ⚠ **Neither closes the
 * ticket**; that stays the ticket's own Close.
 *
 * `readable: false` is a level without `catalog.listings.read`: only what the
 * provider asked for is shown, and the panel says why the rest is not.
 */
export function ListingLeadPanel({
    ticketId,
    context,
    timeZone,
    onChanged,
}: {
    ticketId: string;
    context: ListingLeadTicketContext;
    timeZone: string;
    /** After a write: the ticket re-reads, so the named unlocks show their new state. */
    onChanged: () => void;
}) {
    const wants = (
        <LabelledRow label="The provider asks for">
            {context.wants.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                    {context.wants.map((want) => (
                        <Badge key={want} variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                            {listingReportWantLabel(want)}
                        </Badge>
                    ))}
                </span>
            ) : (
                <span className="text-muted-foreground">Nothing specific — read their message above.</span>
            )}
        </LabelledRow>
    );

    if (!context.readable) {
        return (
            <PanelCard>
                {wants}
                <p className="text-muted-foreground text-sm">
                    Your level cannot read service listings, so the lead behind this report is not shown.
                </p>
            </PanelCard>
        );
    }

    if (!context.lead) {
        return (
            <PanelCard>
                {wants}
                <p className="text-muted-foreground text-sm">
                    The reported lead is no longer on the platform.
                    {context.listingId ? (
                        <>
                            {' '}
                            <Link to={listingPath(context.listingId)} className="text-primary hover:underline">
                                Open the listing
                            </Link>
                            .
                        </>
                    ) : null}
                </p>
            </PanelCard>
        );
    }

    return (
        <ReadableLeadPanel
            ticketId={ticketId}
            context={context}
            summary={context.lead}
            wants={wants}
            timeZone={timeZone}
            onChanged={onChanged}
        />
    );
}

function ReadableLeadPanel({
    ticketId,
    context,
    summary,
    wants,
    timeZone,
    onChanged,
}: {
    ticketId: string;
    context: ListingLeadTicketContext;
    summary: NonNullable<ListingLeadTicketContext['lead']>;
    wants: ReactNode;
    timeZone: string;
    onChanged: () => void;
}) {
    const [request, setRequest] = useState<LeadActionRequest | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const lead = useAsyncData(`/listings/leads/${context.leadId}#${reloadToken}`, (signal) =>
        getListingLead(context.leadId, { signal }),
    );

    const afterWrite = () => {
        setReloadToken((token) => token + 1);
        onChanged();
    };

    const detail = lead.data;
    const customerName = detail?.customer.name ?? 'This customer';

    return (
        <PanelCard
            action={
                <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                    <Link to={listingLeadPath(context.leadId)}>
                        Open the lead
                        <ArrowRight className="size-4" />
                    </Link>
                </Button>
            }
        >
            {wants}

            <div className="grid gap-3 sm:grid-cols-2">
                <LabelledRow label="Listing">
                    <LeadListingLink listing={summary.listing} />
                </LabelledRow>
                <LabelledRow label="Unlocked">
                    {formatInstantInZone(summary.createdAt, timeZone) ?? 'Unknown'}
                    <span className="text-muted-foreground block text-xs">
                        {summary.fieldsRevealed.map(listingContactFieldLabel).join(', ') || 'Nothing'} · via{' '}
                        {leadChannelLabel(summary.channel)}
                    </span>
                </LabelledRow>
            </div>

            <Section title="Unlocks the provider named">
                <LeadRevealList
                    reveals={context.namedReveals}
                    timeZone={timeZone}
                    onRefund={(reveal) => setRequest({ kind: 'refund', reveal })}
                    empty="The provider named no unlock on this lead."
                />
            </Section>

            {lead.isLoading ? (
                <DetailSkeleton />
            ) : !detail ? (
                <ErrorState error={lead.error} onRetry={lead.reload} deniedTitle="The lead could not be read" />
            ) : (
                <>
                    <Section title="The customer">
                        <LeadCustomerSection
                            customer={detail.customer}
                            leadAt={detail.createdAt}
                            accountRoles={detail.accountRoles}
                            timeZone={timeZone}
                        />
                        <LabelledRow label="Contact by this provider">
                            <LeadConsentLine state={detail.consent.state} />
                        </LabelledRow>
                    </Section>

                    <Section title="On this listing">
                        <LeadBlockSection
                            activeBlock={detail.activeBlock}
                            timeZone={timeZone}
                            onBlock={() => setRequest({ kind: 'block' })}
                            onLift={() => setRequest({ kind: 'lift' })}
                        />
                    </Section>

                    <Section title="Their other leads">
                        <OtherLeadsSection otherLeads={detail.otherLeads} timeZone={timeZone} />
                    </Section>
                </>
            )}

            <p className="text-muted-foreground border-t pt-3 text-xs">
                Refunding or blocking does not close this ticket. Close it from the top of the page when you are done.
            </p>

            <LeadActionDialog
                request={request}
                listingId={summary.listing.id}
                customerId={summary.customerId}
                customerName={customerName}
                ticketId={ticketId}
                onClose={() => setRequest(null)}
                onDone={afterWrite}
            />
        </PanelCard>
    );
}

function PanelCard({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2">
                        <Flag className="size-4" aria-hidden />
                        Reported lead
                    </CardTitle>
                    <CardDescription>A provider reported a customer who unlocked their contacts.</CardDescription>
                </div>
                {action}
            </CardHeader>
            <CardContent className="space-y-5">{children}</CardContent>
        </Card>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h4 className="text-sm font-semibold">{title}</h4>
            {children}
        </section>
    );
}
