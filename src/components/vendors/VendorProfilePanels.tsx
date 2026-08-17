import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { VendorKycBadge } from '@/components/vendors/VendorKycBadge';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import type { VendorDetail } from '@/types/vendors.types';
import { vendorOnboardingLabel } from '@/types/vendors.types';
import { CopyableId } from '@/components/common/CopyableId';

/**
 * The read-only blocks of the vendor Overview tab.
 *
 * Grouped in one module because each is a dozen lines of `<dl>` over one slice of
 * the same payload, and splitting them across nine files would bury the two things
 * worth reading — the null semantics and the fields that are deliberately absent —
 * in nine headers.
 */

interface PanelProps {
    vendor: VendorDetail;
    timeZone: string;
}

/** Identity, and the ids other screens are searched by. */
export function VendorIdentityPanel({ vendor, timeZone }: PanelProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Vendor</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition
                        label="Business name"
                        hint={
                            <InfoHint label="About the business name">
                                It lives on the vendor&apos;s store, not on the vendor record —
                                which is why the directory cannot sort by it, and why a vendor with
                                no store yet has none.
                            </InfoHint>
                        }
                    >
                        {vendor.businessName ?? <NotSet>No store yet</NotSet>}
                    </Definition>

                    <Definition label="Contact name">
                        {vendor.displayName ?? <NotSet />}
                    </Definition>

                    <Definition label="Email">{vendor.email ?? <NotSet />}</Definition>

                    <Definition label="Phone">{vendor.phone ?? <NotSet />}</Definition>

                    <Definition label="Country">{vendor.country ?? <NotSet />}</Definition>

                    <Definition
                        label="Onboarding"
                        hint={
                            <InfoHint label="About onboarding">
                                The platform counts <em>down</em> to done: step 0 is complete. This
                                reads the flag the service computes rather than the number, so the
                                inversion cannot be read backwards.
                            </InfoHint>
                        }
                    >
                        {vendorOnboardingLabel(vendor)}
                    </Definition>

                    <Definition label="Registered">
                        {formatInstantInZone(vendor.createdAt, timeZone) ?? '—'}
                    </Definition>

                    <Definition label="Last updated">
                        {formatInstantInZone(vendor.updatedAt, timeZone) ?? '—'}
                    </Definition>

                    <Definition label="Vendor id">
                        <CopyableId value={vendor.id} label="vendor ID" />
                    </Definition>

                    <Definition
                        label="User id"
                        hint={
                            <InfoHint label="About the user id">
                                The sign-in identity behind the shop. Most other admin screens
                                identify this person by it, and the vendor directory&apos;s search
                                box accepts it as well as the vendor id.
                            </InfoHint>
                        }
                    >
                        <CopyableId value={vendor.userId} label="user ID" />
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/**
 * The shop front.
 *
 * `store` is `null` until the vendor creates one, which is a real state rather
 * than a loading gap — a registered vendor part-way through onboarding has no
 * store, and so has no business name anywhere on the platform.
 */
export function VendorStorePanel({ vendor, timeZone }: PanelProps) {
    const store = vendor.store;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Store</CardTitle>
            </CardHeader>
            <CardContent>
                {store ? (
                    <DefinitionList>
                        <Definition label="Name">{store.name ?? <NotSet />}</Definition>
                        <Definition label="Slug">
                            {store.slug ? (
                                <span className="font-mono text-xs">{store.slug}</span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Description">
                            {store.description ?? <NotSet />}
                        </Definition>
                        <Definition label="Support email">
                            {store.supportEmail ?? <NotSet />}
                        </Definition>
                        <Definition label="Support phone">
                            {store.supportPhone ?? <NotSet />}
                        </Definition>
                        <Definition label="Support WhatsApp">
                            {store.supportWhatsapp ?? <NotSet />}
                        </Definition>
                        <Definition
                            label="Branding"
                            hint={
                                <InfoHint label="About branding">
                                    Only the file ids are on this surface. wi-admin serves no files
                                    and accepts no uploads, so there is nothing to render or replace
                                    here.
                                </InfoHint>
                            }
                        >
                            {[store.logoFileId ? 'logo' : null, store.bannerFileId ? 'banner' : null]
                                .filter(Boolean)
                                .join(' · ') || <NotSet>Neither set</NotSet>}
                        </Definition>
                        <Definition label="Created">
                            {formatInstantInZone(store.createdAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                ) : (
                    <p className="text-muted-foreground text-sm">
                        This vendor has not created a store yet. They have no business name and
                        nothing on the storefront until they do.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * The `users` row behind the shop.
 *
 * ── Why a missing one is an alert and not a dash ──────────────────────────────
 * `account: null` means the sign-in identity this vendor record points at does not
 * exist. jovi-mall's `requireAuth` answers `401 AUTH_ROLE_PROFILE_NOT_FOUND` for
 * the mirror of this on the user side — the person simply cannot sign in — and
 * nothing else on any screen says so. It is the same reasoning that makes
 * `missing: true` prominent on the user detail's role profiles.
 */
export function VendorSignInAccountPanel({ vendor }: { vendor: VendorDetail }) {
    const account = vendor.account;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sign-in account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {account ? (
                    <>
                        <DefinitionList>
                            <Definition label="Email">{account.email ?? <NotSet />}</Definition>
                            <Definition label="Phone">{account.phone ?? <NotSet />}</Definition>
                            <Definition label="Roles">
                                {account.roles.length > 0 ? (
                                    <span className="flex flex-wrap gap-1">
                                        {account.roles.map((role) => (
                                            <Badge
                                                key={role}
                                                variant="secondary"
                                                className="capitalize"
                                            >
                                                {role}
                                            </Badge>
                                        ))}
                                    </span>
                                ) : (
                                    <NotSet>None</NotSet>
                                )}
                            </Definition>
                        </DefinitionList>

                        <p className="text-muted-foreground text-xs leading-relaxed">
                            Suspending the account and suspending the vendor are different acts with
                            different permissions, and neither cascades to the other. The account is
                            changed on its own screen.
                        </p>

                        <Link
                            to={`/dashboard/users/${vendor.userId}`}
                            className="text-sm hover:underline"
                        >
                            Open this account in Users
                        </Link>
                    </>
                ) : (
                    <Alert variant="destructive">
                        <AlertTriangle />
                        <AlertTitle>This vendor has no sign-in account</AlertTitle>
                        <AlertDescription>
                            The user record this vendor points at does not exist, so nobody can sign
                            in to it — and nothing else on the platform reports that. Everything
                            else on this screen still reads normally, which is what makes it worth
                            saying here.
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
}

/** The verification verdict, and what it does and does not mean. */
export function VendorVerificationPanel({ vendor, timeZone }: PanelProps) {
    const verification = vendor.verification;
    const reviewer = verification.reviewedBy;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Business verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition label="Verdict">
                        <VendorKycBadge status={verification.status} />
                    </Definition>

                    {verification.status === 'rejected' ? (
                        <Definition
                            label="Reason"
                            hint={
                                <InfoHint label="About the rejection reason">
                                    Stored on the platform, not only in our audit trail — jovi-mall
                                    cannot read this database, so a reason held only here could
                                    never be shown to the vendor it is about.
                                </InfoHint>
                            }
                        >
                            {verification.rejectionReason ?? <NotSet>Not recorded</NotSet>}
                        </Definition>
                    ) : null}

                    <Definition label="Decided">
                        {formatInstantInZone(verification.verifiedAt, timeZone) ?? (
                            <NotSet>Not yet reviewed</NotSet>
                        )}
                    </Definition>

                    <Definition label="Reviewed by">
                        {reviewer ? (
                            <>
                                {reviewer.name ?? 'Not recorded'}
                                {reviewer.source === 'admin' ? (
                                    <span className="text-muted-foreground"> · administrator</span>
                                ) : null}
                            </>
                        ) : (
                            <NotSet>Nobody has reviewed this</NotSet>
                        )}
                    </Definition>
                </DefinitionList>

                <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                    Verification is visible to delivery agencies, and nothing else depends on it. A
                    rejected vendor still trades and still sells — approving or rejecting changes
                    what agencies see, not what the shop may do. Suspending is the action that stops
                    a vendor.
                </p>
            </CardContent>
        </Card>
    );
}

/** Contact verification, plus the vendor's own locale — not the operator's. */
export function VendorContactPanel({ vendor }: { vendor: VendorDetail }) {
    const contact = vendor.contact;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Email verified">
                        <VerifiedMark value={contact.emailVerified} />
                    </Definition>
                    <Definition label="Phone verified">
                        <VerifiedMark value={contact.phoneVerified} />
                    </Definition>
                    <Definition label="WhatsApp verified">
                        <VerifiedMark value={contact.whatsappVerified} />
                    </Definition>
                    <Definition
                        label="Timezone"
                        hint={
                            <InfoHint label="About this timezone">
                                The vendor&apos;s own, for their notifications and their storefront.
                                Every time on this screen is rendered in <em>your</em> timezone
                                instead, from your administrator profile.
                            </InfoHint>
                        }
                    >
                        {contact.timezone ?? <NotSet />}
                    </Definition>
                    <Definition label="Language">
                        {contact.preferredLanguage ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/** Business addresses — and a note about what is deliberately not here. */
export function VendorAddressesPanel({ vendor }: { vendor: VendorDetail }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Business addresses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {vendor.addresses.length > 0 ? (
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {vendor.addresses.map((address) => (
                            <li key={address.id} className="rounded-lg border p-3 text-sm">
                                <p className="font-medium">{address.label ?? 'Address'}</p>
                                <p className="text-muted-foreground">
                                    {[
                                        address.addressLine1,
                                        address.addressLine2,
                                        address.city,
                                        address.state,
                                    ]
                                        .filter(Boolean)
                                        .join(', ') || 'No detail recorded'}
                                </p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">No addresses on file.</p>
                )}

                <p className="text-muted-foreground text-xs leading-relaxed">
                    Trading addresses only. Payout destinations and the national id number are
                    excluded from this surface entirely — not hidden by this screen, but never read
                    out of the database on this path.
                </p>
            </CardContent>
        </Card>
    );
}

/**
 * Policies, as **presence rather than content**.
 *
 * About thirty fields of the vendor's own commercial terms exist; the question a
 * detail screen asks is *have they set this up*. Editing them is deliberately not
 * offered — writing `policies` bumps `policyVersion`, which pauses every agency
 * connection pending reapproval, and that cascade belongs to the vendor's own
 * policy path.
 */
export function VendorPoliciesPanel({ vendor }: { vendor: VendorDetail }) {
    const policies = vendor.policies;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Policies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition label="Return policy">
                        <VerifiedMark value={policies.hasReturnPolicy} trueLabel="Set" falseLabel="Not set" />
                    </Definition>
                    <Definition label="Cancellation policy">
                        <VerifiedMark value={policies.hasCancellationPolicy} trueLabel="Set" falseLabel="Not set" />
                    </Definition>
                    <Definition label="Support policy">
                        <VerifiedMark value={policies.hasSupportPolicy} trueLabel="Set" falseLabel="Not set" />
                    </Definition>
                    <Definition
                        label="Policy version"
                        hint={
                            <InfoHint label="About the policy version">
                                Every edit to a vendor&apos;s policies bumps this, and the bump
                                pauses every one of their agency connections pending reapproval.
                                That is why policies are not editable from here.
                            </InfoHint>
                        }
                    >
                        {formatCount(policies.policyVersion)}
                    </Definition>
                </DefinitionList>

                <p className="text-muted-foreground text-xs leading-relaxed">
                    Whether each is configured, not what it says. The terms themselves are the
                    vendor&apos;s and are edited by them.
                </p>
            </CardContent>
        </Card>
    );
}

/**
 * The operational tally.
 *
 * ⚠ Every key is rendered, zeros included. `vendors.md:241` claims only non-zero
 * statuses appear; the service always emits all six product counts and all seven
 * connection counts (see `types/vendors.types.ts`). Hiding a zero would make
 * *"nothing is suspended"* and *"we did not look"* the same screen.
 *
 * `orders` is a **tally and never a sum** — the projection behind it carries no
 * amount field at all. Revenue lives behind `money.*`, not behind `vendors.read`.
 */
export function VendorCountsPanel({ vendor, timeZone }: PanelProps) {
    const { products, orders, agencyConnections } = vendor.counts;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Activity at a glance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* "Listings", not "Catalogue" — the Catalogue tab is a click away
                    and two controls sharing a word is a worse ambiguity here than a
                    slightly different noun. */}
                <section className="space-y-2">
                    <h3 className="text-sm font-medium">Listings</h3>
                    <CountGrid
                        entries={[
                            ['Total', products.total],
                            ['Active', products.active],
                            ['Draft', products.draft],
                            ['Pending review', products.pendingReview],
                            ['Suspended', products.suspended],
                            ['Archived', products.archived],
                        ]}
                    />
                </section>

                <section className="space-y-2">
                    <h3 className="flex items-center gap-1 text-sm font-medium">
                        Orders
                        <InfoHint label="About the order tally">
                            A count, never a value. This surface deliberately carries no order
                            amounts — what the vendor has earned is behind its own permission, on
                            the Account tab.
                        </InfoHint>
                    </h3>
                    <CountGrid entries={[['Orders received', orders.total]]} />
                    <p className="text-muted-foreground text-xs">
                        Last order{' '}
                        {formatInstantInZone(orders.lastOrderAt, timeZone) ?? 'never received'}.
                    </p>
                </section>

                <section className="space-y-2">
                    <h3 className="text-sm font-medium">Delivery agency connections</h3>
                    <CountGrid
                        entries={[
                            ['Total', agencyConnections.total],
                            ['Active', agencyConnections.active],
                            ['Pending', agencyConnections.pending],
                            ['Paused for reapproval', agencyConnections.pausedReapproval],
                            ['Rejected', agencyConnections.rejected],
                            ['Withdrawn', agencyConnections.withdrawn],
                            ['Terminated', agencyConnections.terminated],
                        ]}
                    />
                    {vendor.defaultDeliveryAgencyId ? (
                        <p className="text-muted-foreground text-xs">
                            Default delivery agency:{' '}
                            <span className="font-mono">{vendor.defaultDeliveryAgencyId}</span>
                        </p>
                    ) : (
                        <p className="text-muted-foreground text-xs">
                            No default delivery agency set.
                        </p>
                    )}
                </section>
            </CardContent>
        </Card>
    );
}

function CountGrid({ entries }: { entries: readonly (readonly [string, number])[] }) {
    return (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {entries.map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{formatCount(value)}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * The platform-governed order settings, read.
 *
 * Four fields, three of them writable. `notifyDaysBeforeExpiry` is shown because
 * it is part of the picture and marked read-only because the PATCH body is strict
 * and rejects it **by name** — an operator who tried would get a `400`, so the
 * screen says why before they do.
 */
export function VendorSettingsPanel({ vendor }: { vendor: VendorDetail }) {
    const settings = vendor.settings;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Order settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition
                        label="Auto-redirect to agency"
                        hint={
                            <InfoHint label="About auto-redirect">
                                Whether shipments advance without the vendor confirming. The effect
                                lands on the agency and the customer, which is why it is an
                                administrator&apos;s setting and not the vendor&apos;s — and it is
                                the lever support needs when a vendor goes dark.
                            </InfoHint>
                        }
                    >
                        {settings.autoRedirectOrdersToAgency ? 'On' : 'Off'}
                    </Definition>

                    <Definition
                        label="Redirect cap"
                        hint={
                            <InfoHint label="About the redirect cap">
                                Orders above this value are not auto-redirected. No cap means every
                                order redirects while the setting above is on.
                            </InfoHint>
                        }
                    >
                        {settings.autoRedirectThresholdAmount === null ? (
                            <NotSet>No cap — every order redirects</NotSet>
                        ) : (
                            formatMoney(settings.autoRedirectThresholdAmount, 'XAF')
                        )}
                    </Definition>

                    <Definition
                        label="Cancel unpaid after"
                        hint={
                            <InfoHint label="About unpaid cancellation">
                                Drives a platform sweep worker. A vendor setting it to 90 days would
                                keep stock reserved against orders nobody will ever pay for, which
                                is why the platform owns it.
                            </InfoHint>
                        }
                    >
                        {settings.autoCancelUnpaidDays}{' '}
                        {settings.autoCancelUnpaidDays === 1 ? 'day' : 'days'}
                    </Definition>

                    <Definition
                        label="Expiry notice"
                        hint={
                            <InfoHint label="Why this is read-only">
                                A notification to the vendor, about the vendor. The settings request
                                rejects it by name — it is theirs to choose.
                            </InfoHint>
                        }
                    >
                        {settings.notifyDaysBeforeExpiry}{' '}
                        {settings.notifyDaysBeforeExpiry === 1 ? 'day' : 'days'}{' '}
                        <span className="text-muted-foreground">· read-only</span>
                    </Definition>
                </DefinitionList>

                <p className="text-muted-foreground text-xs leading-relaxed">
                    Commission is not one of these. It lives on the vendor&apos;s billing plan and
                    changes only by assigning a different plan — it is readable on the Account tab.
                </p>
            </CardContent>
        </Card>
    );
}

function VerifiedMark({
    value,
    trueLabel = 'Yes',
    falseLabel = 'No',
}: {
    value: boolean;
    trueLabel?: string;
    falseLabel?: string;
}) {
    return value ? (
        <span className="text-success">{trueLabel}</span>
    ) : (
        <span className="text-muted-foreground">{falseLabel}</span>
    );
}
