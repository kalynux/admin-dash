import { useState, type ReactNode } from 'react';
import { EyeOff, ExternalLink, LockKeyhole, Video } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { ContactFieldChips } from '@/components/listings/ListingBits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getListingContacts } from '@/services/listings.service';
import { useCan } from '@/store';
import type { ListingContactSet, ListingContacts } from '@/types/listings.types';

/**
 * The listing's hidden contacts — WhatsApp, phone, email, links, the pin and the
 * location video — behind an explicit click.
 *
 * ── ⚠ The click is the disclosure, and the button says so BEFORE it ──────────
 * `GET /listings/:id/contacts` writes `catalog.listings.contacts.read` against
 * this administrator, and the row commits before the contacts are read. So
 * nothing here fetches on mount, the button's own label says the view is
 * recorded, and the values live in this component's state only: they go when
 * the card is hidden again or the page is left, and no list ever loads them.
 *
 * ── Both copies, on a change to a live listing ────────────────────────────────
 * The bait-and-switch the review exists for is a live listing swapping its
 * WhatsApp number. So when both copies come back they sit side by side — stacked
 * on a phone — and a value that differs is marked.
 *
 * ── The video is opened from here ─────────────────────────────────────────────
 * The reviewer checks it plays, shows the way, and is appropriate. It opens in a
 * new tab — the one outbound link on this card besides the provider's own
 * website and social pages, which a reviewer may also need to look at.
 */
export function HiddenContactsCard({
    listingId,
    availableFields,
    timeZone,
}: {
    listingId: string;
    availableFields: readonly string[];
    timeZone: string;
}) {
    const can = useCan();
    const [contacts, setContacts] = useState<ListingContacts | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<unknown>(null);

    async function reveal() {
        setLoading(true);
        setError(null);
        try {
            setContacts(await getListingContacts(listingId));
        } catch (caught) {
            setError(caught);
        } finally {
            setLoading(false);
        }
    }

    const allowed = can('catalog.listings.contacts.read');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <LockKeyhole className="size-4" aria-hidden />
                    Hidden contacts
                </CardTitle>
                <CardDescription>
                    What customers pay the provider&rsquo;s credits to unlock. Check that none of it also appears
                    in the public text or photos, and open the location video.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1">
                    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        Fields on the live listing
                    </p>
                    <ContactFieldChips fields={availableFields} empty="None yet — the listing is not live." />
                </div>

                {!allowed ? (
                    <p className="text-muted-foreground text-sm">Your level cannot see a listing&rsquo;s hidden contacts.</p>
                ) : contacts ? (
                    <>
                        <ContactCopies contacts={contacts} timeZone={timeZone} />
                        <Button variant="outline" size="sm" onClick={() => setContacts(null)}>
                            <EyeOff className="size-4" />
                            Hide the contacts again
                        </Button>
                    </>
                ) : (
                    <div className="space-y-2">
                        <Button onClick={reveal} disabled={loading} className="h-auto w-full py-2 sm:w-auto">
                            {loading ? <InlineLoader /> : <LockKeyhole className="size-4" />}
                            <span className="flex flex-col items-start text-left leading-tight">
                                <span>Show hidden contacts</span>
                                <span className="text-xs font-normal opacity-90">Your view is recorded in the audit trail</span>
                            </span>
                        </Button>
                        {error ? <AuthFormError error={error} /> : null}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function ContactCopies({ contacts, timeZone }: { contacts: ListingContacts; timeZone: string }) {
    const { published, pending } = contacts;
    if (!published && !pending) {
        return <p className="text-muted-foreground text-sm">The provider has entered no contacts yet.</p>;
    }
    if (published && pending) {
        return (
            <div className="grid gap-4 lg:grid-cols-2">
                <ContactSetView title="Live now" set={published} timeZone={timeZone} />
                <ContactSetView title="In the change under review" set={pending} against={published} timeZone={timeZone} />
            </div>
        );
    }
    return <ContactSetView set={(pending ?? published)!} timeZone={timeZone} />;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function ContactSetView({
    title,
    set,
    against,
    timeZone,
}: {
    title?: string;
    set: ListingContactSet;
    /** The live copy, when this is the change — a differing value is marked. */
    against?: ListingContactSet;
    timeZone: string;
}) {
    const differs = (pick: (s: ListingContactSet) => unknown) => (against ? !same(pick(set), pick(against)) : false);
    const coordinates =
        set.location && set.location.latitude !== null && set.location.longitude !== null
            ? `${set.location.latitude}, ${set.location.longitude}`
            : null;

    return (
        <section className="bg-muted/30 space-y-3 rounded-lg border p-3">
            {title ? <h4 className="text-sm font-semibold">{title}</h4> : null}
            <Row label="WhatsApp" changed={differs((s) => s.whatsapp)}>
                <CopyableValue variant="phone" value={set.whatsapp} label="WhatsApp number" />
            </Row>
            <Row label="Phone" changed={differs((s) => s.phone)}>
                <CopyableValue variant="phone" value={set.phone} label="phone number" />
            </Row>
            {/* The second number (2026-11-08) is part of the same `phone` field — unlocked and
                charged with it — so it sits under it rather than as a field of its own. Marked on a
                revision when it is added, changed or removed, like the first. */}
            <Row label="Second phone" changed={differs((s) => s.phone2 ?? null)}>
                {set.phone2 ? (
                    <CopyableValue variant="phone" value={set.phone2} label="second phone number" />
                ) : (
                    <NotSet>No second number</NotSet>
                )}
            </Row>
            <Row label="Email" changed={differs((s) => s.email)}>
                <CopyableValue variant="email" value={set.email} label="email address" />
            </Row>
            <Row label="Website" changed={differs((s) => s.website)}>
                {set.website ? <OutboundValue url={set.website} label="website" /> : <NotSet />}
            </Row>
            <Row label="Social links" changed={differs((s) => s.socials)}>
                {set.socials.length > 0 ? (
                    <ul className="space-y-1">
                        {set.socials.map((social, index) => (
                            <li key={`${social.url ?? 'social'}-${index}`} className="space-y-0.5">
                                <span className="text-muted-foreground text-xs capitalize">
                                    {humaniseEnum(social.network) ?? 'Network not given'}
                                </span>
                                {social.url ? <OutboundValue url={social.url} label={`${social.network ?? 'social'} link`} /> : <NotSet />}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <NotSet>None</NotSet>
                )}
            </Row>
            <Row label="Location" changed={differs((s) => s.location)}>
                {set.location ? (
                    <div className="space-y-1">
                        <CopyableValue variant="plain" value={set.location.address} label="address" />
                        {coordinates ? (
                            <CopyableValue variant="plain" mono value={coordinates} label="map coordinates" />
                        ) : (
                            <NotSet>No pin</NotSet>
                        )}
                    </div>
                ) : (
                    <NotSet>None</NotSet>
                )}
            </Row>
            <Row label="Location video" changed={differs((s) => s.video?.url)}>
                {set.video?.url ? (
                    <div className="space-y-1.5">
                        {/^https?:\/\//i.test(set.video.url) ? (
                            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                                <a href={set.video.url} target="_blank" rel="noopener noreferrer">
                                    <Video className="size-4" />
                                    Open the video
                                    <ExternalLink className="size-3.5" aria-hidden />
                                </a>
                            </Button>
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                            {humaniseEnum(set.video.host) ?? 'Unknown host'}
                            {set.video.checkedAt
                                ? ` · link checked ${formatInstantInZone(set.video.checkedAt, timeZone)}`
                                : ' · link not checked yet'}
                        </p>
                        <CopyableValue variant="plain" mono value={set.video.url} label="video link" />
                    </div>
                ) : (
                    <NotSet>None</NotSet>
                )}
            </Row>
        </section>
    );
}

function Row({ label, changed, children }: { label: string; changed: boolean; children: ReactNode }) {
    return (
        <div className={cn('space-y-0.5', changed && 'border-warning/60 -ml-3 border-l-2 pl-2.5')}>
            <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                {label}
                {changed ? (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                        Changed
                    </Badge>
                ) : null}
            </p>
            <div className="text-sm break-all">{children}</div>
        </div>
    );
}

/** A copyable address with an explicit "open" beside it — never a link on the value itself. */
function OutboundValue({ url, label }: { url: string; label: string }) {
    const safe = /^https?:\/\//i.test(url);
    return (
        <span className="flex flex-wrap items-center gap-2">
            <CopyableValue variant="plain" mono value={url} label={label} />
            {safe ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                >
                    Open
                    <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">{label} in a new tab</span>
                </a>
            ) : null}
        </span>
    );
}
