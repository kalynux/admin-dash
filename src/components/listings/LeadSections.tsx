import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Ban, ShieldCheck, Undo2, Users } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import {
    canRefundReveal,
    formatCredits,
    leadConsentLabel,
    listingActorLabel,
    listingContactFieldLabel,
    listingLeadPath,
    listingName,
    listingPath,
    type LeadAccountRole,
    type LeadBlock,
    type LeadCustomer,
    type LeadReveal,
    type OtherLeads,
} from '@/types/listings.types';

/**
 * The pieces a lead is read from — shared by the ticket's lead panel and the
 * lead page, so both say the same thing in the same words.
 *
 * Every figure is the server's: `cost`, `credits.charged`, `otherLeads.total`
 * are printed as sent, never summed here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2 days before this lead" / "the same day" — how fresh the account was when it unlocked. */
function ageAtLead(createdAt: string | null, leadAt: string | null): string | null {
    if (!createdAt || !leadAt) return null;
    const days = Math.floor((Date.parse(leadAt) - Date.parse(createdAt)) / DAY_MS);
    if (!Number.isFinite(days)) return null;
    if (days < 0) return 'after this lead';
    if (days === 0) return 'the same day as this lead';
    return `${days} ${days === 1 ? 'day' : 'days'} before this lead`;
}

export function LabelledRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <div className={cn('space-y-0.5', className)}>
            <p className="text-muted-foreground text-xs font-medium">{label}</p>
            <div className="text-sm break-words">{children}</div>
        </div>
    );
}

/**
 * The customer IN FULL — the name, login phone and e-mail the provider never
 * sees, and when the account and the customer role were made. A drain shows up
 * as several fresh accounts unlocking the same providers.
 */
export function LeadCustomerSection({
    customer,
    leadAt,
    accountRoles,
    timeZone,
}: {
    customer: LeadCustomer;
    leadAt: string | null;
    accountRoles?: readonly LeadAccountRole[];
    timeZone: string;
}) {
    const can = useCan();
    const accountAge = ageAtLead(customer.accountCreatedAt, leadAt);
    const profileAge = ageAtLead(customer.profileCreatedAt, leadAt);

    return (
        <div className="space-y-3">
            {customer.accountClosedAt ? (
                <p className="bg-muted/50 rounded-md border px-3 py-2 text-sm">
                    This account was closed {formatInstantInZone(customer.accountClosedAt, timeZone)}; its name, phone
                    and e-mail have been anonymised.
                </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
                <LabelledRow label="Name">{customer.name ?? <NotSet>No name</NotSet>}</LabelledRow>
                <LabelledRow label="Phone (full)">
                    <CopyableValue variant="phone" value={customer.phone} label="customer phone" />
                </LabelledRow>
                <LabelledRow label="E-mail">
                    <CopyableValue variant="email" value={customer.email} label="customer e-mail" />
                </LabelledRow>
                <LabelledRow label="Status">
                    <span className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">Account: {humaniseEnum(customer.accountStatus) ?? 'unknown'}</Badge>
                        <Badge variant="outline">Customer role: {humaniseEnum(customer.profileStatus) ?? 'unknown'}</Badge>
                    </span>
                </LabelledRow>
                <LabelledRow label="Account created">
                    {formatInstantInZone(customer.accountCreatedAt, timeZone) ?? <NotSet>Unknown</NotSet>}
                    {accountAge ? <span className="text-muted-foreground block text-xs">{accountAge}</span> : null}
                </LabelledRow>
                <LabelledRow label="Customer role created">
                    {formatInstantInZone(customer.profileCreatedAt, timeZone) ?? <NotSet>Unknown</NotSet>}
                    {profileAge ? <span className="text-muted-foreground block text-xs">{profileAge}</span> : null}
                </LabelledRow>
            </div>

            {accountRoles && accountRoles.length > 0 ? (
                <LabelledRow label="Every role on this account">
                    <ul className="flex flex-wrap gap-1.5">
                        {accountRoles.map((role) => (
                            <li key={`${role.role}-${role.profileId ?? 'none'}`}>
                                <Badge variant={role.missing ? 'outline' : 'secondary'} className={cn(role.missing && 'italic')}>
                                    {humaniseEnum(role.role) ?? role.role}
                                    {role.missing
                                        ? ' · no profile'
                                        : role.createdAt
                                          ? ` · since ${formatInstantInZone(role.createdAt, timeZone)}`
                                          : ''}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                </LabelledRow>
            ) : null}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground inline-flex items-center gap-1">
                    Customer id <CopyableValue value={customer.id} label="customer id" />
                </span>
                {customer.userId ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                        User
                        <CopyableValue
                            value={customer.userId}
                            label="user id"
                            to={can('users.read') ? `/dashboard/users/${customer.userId}` : undefined}
                        />
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/**
 * The unlocks — which field, what it cost, and whether it was refunded.
 *
 * ⛔ **Refund is rendered only for a holder of `catalog.listings.reveals.refund`**
 * — not disabled, absent. Support never sees the control. A refunded unlock
 * shows who refunded it, when, and why.
 */
export function LeadRevealList({
    reveals,
    timeZone,
    onRefund,
    empty = 'No unlocks.',
}: {
    reveals: readonly LeadReveal[];
    timeZone: string;
    onRefund?: (reveal: LeadReveal) => void;
    empty?: string;
}) {
    const can = useCan();
    const mayRefund = can('catalog.listings.reveals.refund') && onRefund !== undefined;

    if (reveals.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;

    return (
        <ul className="divide-y rounded-lg border">
            {reveals.map((reveal) => (
                <li key={reveal.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {listingContactFieldLabel(reveal.field)}
                            <span className="text-muted-foreground font-normal tabular-nums">{formatCredits(reveal.cost)}</span>
                            {reveal.chargedIntoDebt ? (
                                <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                                    Paid from debt
                                </Badge>
                            ) : null}
                            {reveal.refunded ? (
                                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                                    Refunded
                                </Badge>
                            ) : null}
                        </p>
                        <p className="text-muted-foreground text-xs">
                            Unlocked {formatInstantInZone(reveal.at, timeZone) ?? 'at an unknown time'}
                        </p>
                        {reveal.refund ? (
                            <p className="text-muted-foreground text-xs">
                                Refunded {formatInstantInZone(reveal.refund.at, timeZone) ?? ''} by{' '}
                                {listingActorLabel(reveal.refund.by)}
                                {reveal.refund.note ? (
                                    <span className="text-foreground mt-0.5 block whitespace-pre-line">“{reveal.refund.note}”</span>
                                ) : null}
                            </p>
                        ) : null}
                    </div>
                    {mayRefund && canRefundReveal(reveal) ? (
                        <Button variant="outline" size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => onRefund?.(reveal)}>
                            <Undo2 className="size-4" />
                            Refund {formatCredits(reveal.cost)}
                        </Button>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

/**
 * Whether this customer is blocked on this listing, with Block / Lift for a
 * holder of `catalog.listings.reveal-block` (every tier).
 */
export function LeadBlockSection({
    activeBlock,
    timeZone,
    onBlock,
    onLift,
}: {
    activeBlock: LeadBlock | null;
    timeZone: string;
    onBlock: () => void;
    onLift: () => void;
}) {
    const can = useCan();
    const may = can('catalog.listings.reveal-block');

    if (activeBlock) {
        return (
            <div className="border-destructive/30 bg-destructive/5 space-y-2 rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                    <Ban className="text-destructive size-4" aria-hidden />
                    Blocked on this listing
                </p>
                <p className="text-sm whitespace-pre-line">“{activeBlock.reason}”</p>
                <p className="text-muted-foreground text-xs">
                    By {listingActorLabel(activeBlock.blockedBy)}, {formatInstantInZone(activeBlock.blockedAt, timeZone) ?? 'at an unknown time'}
                </p>
                {may ? (
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onLift}>
                        <ShieldCheck className="size-4" />
                        Lift the block
                    </Button>
                ) : null}
            </div>
        );
    }
    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-sm">Not blocked. They can unlock this listing’s contacts.</p>
            {may ? (
                <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onBlock}>
                    <Ban className="size-4" />
                    Block this customer on this listing
                </Button>
            ) : null}
        </div>
    );
}

export function LeadConsentLine({ state }: { state: string }) {
    return <span className="text-sm">{leadConsentLabel(state)}</span>;
}

/**
 * The customer's OTHER leads, across every provider — the drain view. Several
 * providers unlocked within days by a fresh account is the pattern to spot.
 */
export function OtherLeadsSection({ otherLeads, timeZone }: { otherLeads: OtherLeads; timeZone: string }) {
    if (otherLeads.total === 0) {
        return <p className="text-muted-foreground text-sm">This customer has no other leads.</p>;
    }
    return (
        <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium">
                <Users className="size-4" aria-hidden />
                {otherLeads.total} other {otherLeads.total === 1 ? 'lead' : 'leads'} across {otherLeads.providerCount}{' '}
                {otherLeads.providerCount === 1 ? 'provider' : 'providers'}
            </p>

            <ul className="divide-y rounded-lg border">
                {otherLeads.byProvider.map((row) => (
                    <li key={row.provider.id} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm">{row.provider.displayName ?? <NotSet>Unnamed provider</NotSet>}</span>
                        <span className="text-muted-foreground text-xs">
                            {row.leads} {row.leads === 1 ? 'lead' : 'leads'}
                            {row.lastAt ? ` · last ${formatInstantInZone(row.lastAt, timeZone)}` : ''}
                        </span>
                    </li>
                ))}
            </ul>

            {otherLeads.recent.length > 0 ? (
                <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs font-medium">Most recent</p>
                    <ul className="space-y-1.5">
                        {otherLeads.recent.map((lead) => (
                            <li key={lead.id} className="text-sm">
                                <Link to={listingLeadPath(lead.id)} className="text-primary hover:underline">
                                    {listingName({ ...lead.listing })}
                                </Link>
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {lead.fieldsRevealed.map(listingContactFieldLabel).join(', ') || 'nothing unlocked'} ·{' '}
                                    {formatInstantInZone(lead.createdAt, timeZone)}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {otherLeads.truncated ? (
                        <p className="text-muted-foreground text-xs">
                            Showing the {otherLeads.recent.length} most recent of {otherLeads.total}.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** The listing a lead belongs to, as a link. */
export function LeadListingLink({ listing }: { listing: { id: string; title: string | null; companyName: string | null; slug: string | null } }) {
    return (
        <Link to={listingPath(listing.id)} className="text-primary font-medium hover:underline">
            {listingName(listing)}
        </Link>
    );
}
