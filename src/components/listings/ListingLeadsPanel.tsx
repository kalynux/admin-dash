import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Users } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT } from '@/lib/query';
import { listListingLeads } from '@/services/listings.service';
import {
    formatCredits,
    leadChannelLabel,
    listingContactFieldLabel,
    listingLeadPath,
    type ListingLead,
} from '@/types/listings.types';

/**
 * A listing's leads — `GET /listings/:listingId/leads` · `catalog.listings.read`,
 * newest first (the order a report is investigated in, and the provider's own).
 *
 * Each row shows what the provider CANNOT see: the customer's full name, phone
 * and e-mail. Credits are the server's sums, printed as sent. A row opens the
 * lead, which adds the customer's roles and their other leads.
 *
 * Paged in local state: the detail page owns `?tab=`.
 */
export function ListingLeadsPanel({ listingId, timeZone }: { listingId: string; timeZone: string }) {
    const [page, setPage] = useState(1);
    const leads = useAsyncData(`/listings/${listingId}/leads?page=${page}`, (signal) =>
        listListingLeads(listingId, { page, limit: PAGE_SIZE_DEFAULT }, { signal }),
    );

    if (leads.isLoading) return <ListSkeleton label="Loading leads…" rows={3} />;
    if (!leads.data) return <ErrorState error={leads.error} onRetry={leads.reload} />;
    if (leads.data.data.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title="No leads yet"
                description="A lead appears here when a customer unlocks one of this listing’s contacts."
            />
        );
    }

    return (
        <div className="space-y-3">
            <ul className="space-y-2" aria-label="Leads">
                {leads.data.data.map((lead) => (
                    <li key={lead.id}>
                        <LeadRow lead={lead} timeZone={timeZone} />
                    </li>
                ))}
            </ul>
            <Pager meta={leads.data.meta} noun="leads" isBusy={leads.isRefreshing} onPageChange={setPage} />
        </div>
    );
}

function LeadRow({ lead, timeZone }: { lead: ListingLead; timeZone: string }) {
    const { customer } = lead;
    return (
        <div className="space-y-2 rounded-lg border p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                    <Link to={listingLeadPath(lead.id)} className="text-primary font-medium hover:underline">
                        {customer.name ?? 'Unnamed customer'}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                        {formatInstantInZone(lead.createdAt, timeZone)} · via {leadChannelLabel(lead.channel)}
                    </p>
                </div>
                <Link
                    to={listingLeadPath(lead.id)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label={`Open the lead of ${customer.name ?? 'this customer'}`}
                >
                    <ChevronRight className="size-4" />
                </Link>
            </div>

            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
                <CopyableValue variant="phone" value={customer.phone} label="customer phone" />
                <CopyableValue variant="email" value={customer.email} label="customer e-mail" />
            </div>

            <div className="flex flex-wrap gap-1.5">
                {lead.fieldsRevealed.map((field) => (
                    <Badge key={field} variant="secondary">
                        {listingContactFieldLabel(field)}
                    </Badge>
                ))}
                <Badge variant="outline" className="tabular-nums">
                    {formatCredits(lead.credits.charged)}
                    {lead.credits.refunded > 0 ? ` · ${formatCredits(lead.credits.refunded)} refunded` : ''}
                </Badge>
                {lead.activeBlock ? (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                        Blocked on this listing
                    </Badge>
                ) : null}
                {lead.windowOpen ? <Badge variant="outline">Still being served</Badge> : null}
            </div>
        </div>
    );
}
