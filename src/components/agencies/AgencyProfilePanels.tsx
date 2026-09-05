import { BadgeCheck, ExternalLink } from 'lucide-react';

import { AgencyStatusBadge } from '@/components/agencies/AgencyStatusBadge';
import { AgencyVerificationBadge } from '@/components/agencies/AgencyVerificationBadge';
import {
    Definition,
    DefinitionList,
    NotSet,
} from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { isPlatformActor } from '@/types/actor.types';
import type { AgencyDetail, AgencyPolicies } from '@/types/agencies.types';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';

/**
 * Identity, status and contact — everything an administrator reads before deciding
 * anything.
 *
 * The two axes are drawn side by side rather than merged, because they are
 * genuinely independent: `status` says whether the agency may operate, `verified`
 * says whether its business paperwork was approved, and nothing enforces the
 * second today. An `active` unverified agency is a real state.
 */
export function AgencyOverviewPanel({
    agency,
    timeZone,
}: {
    agency: AgencyDetail;
    timeZone: string;
}) {
    return (
        <DefinitionList>
            <Definition label="Status">
                <AgencyStatusBadge status={agency.status} />
            </Definition>

            <Definition
                label="Verification"
                hint={
                    <InfoHint label="About verification">
                        Whether the agency's business paperwork was approved. Separate from its status — nothing on the platform currently blocks an unverified agency from operating, so the two can disagree.
                    </InfoHint>
                }
            >
                <AgencyVerificationBadge agency={agency} />
            </Definition>

            <Definition label="Business name">
                {agency.businessName ?? <NotSet>Not provided yet</NotSet>}
            </Definition>

            <Definition label="Contact person">
                {agency.contactName ?? <NotSet />}
            </Definition>

            {/*
              The presence test stays outside: the verification mark only means
              something beside an address that exists, so `CopyableValue`'s own
              `NotSet` branch is unreachable here rather than duplicated.
            */}
            <Definition label="Email">
                {agency.email ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                        <CopyableValue variant="email" value={agency.email} label="agency email" />
                        {agency.emailVerified ? (
                            <BadgeCheck className="text-success size-4 shrink-0" aria-label="Verified" />
                        ) : (
                            <Badge variant="outline" className="text-xs">
                                Unverified
                            </Badge>
                        )}
                    </span>
                ) : (
                    <NotSet />
                )}
            </Definition>

            <Definition label="Phone">
                {agency.phone ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                        <CopyableValue variant="phone" value={agency.phone} label="agency phone" />
                        {agency.phoneVerified ? (
                            <BadgeCheck className="text-success size-4 shrink-0" aria-label="Verified" />
                        ) : (
                            <Badge variant="outline" className="text-xs">
                                Unverified
                            </Badge>
                        )}
                    </span>
                ) : (
                    <NotSet />
                )}
            </Definition>

            <Definition label="Country">{agency.country ?? <NotSet />}</Definition>

            <Definition
                label="Coverage areas"
                hint={
                    <InfoHint label="About coverage areas">
                        The regions this agency serves, declared on its business record. Not the same as a contract's coverage, which narrows an individual agent to part of it.
                    </InfoHint>
                }
            >
                {agency.coverageAreas.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {agency.coverageAreas.map((area) => (
                            <Badge key={area} variant="outline" className="text-xs">
                                {area}
                            </Badge>
                        ))}
                    </div>
                ) : (
                    <NotSet>None declared</NotSet>
                )}
            </Definition>

            <Definition
                label="Auto-assignment"
                hint={
                    <InfoHint label="About auto-assignment">
                        When on, a shipment handed to this agency is auto-offered to the best-ranked eligible agent instead of waiting for a manual pick. Agencies opt in; it is off by default.
                    </InfoHint>
                }
            >
                {agency.autoAssignEnabled ? 'On' : 'Off'}
            </Definition>

            <Definition label="Onboarding">
                {agency.onboardingComplete ? 'Complete' : 'In progress'}
            </Definition>

            <Definition label="Timezone">{agency.timezone ?? <NotSet />}</Definition>

            <Definition label="Preferred language">
                {agency.preferredLanguage ?? <NotSet />}
            </Definition>

            <Definition label="Registered">
                {formatInstantInZone(agency.createdAt, timeZone) ?? <NotSet />}
            </Definition>

            <Definition label="Last updated">
                {formatInstantInZone(agency.updatedAt, timeZone) ?? <NotSet />}
            </Definition>

            <Definition label="Agency id">
                <CopyableId value={agency.id} label="agency ID" />
            </Definition>

            <Definition
                label="User id"
                hint={
                    <InfoHint label="About the user id">
                        The platform account behind this agency. A different identity space from the agency record itself.
                    </InfoHint>
                }
            >
                <CopyableId value={agency.userId} label="user ID" />
            </Definition>
        </DefinitionList>
    );
}

/**
 * The business-verification record.
 *
 * `verifiedBy` is present **only while verified** — an unverified agency carrying
 * a stale approver would read as approved on any screen that rendered the block
 * without checking the flag first. So the whole approver block is keyed on it
 * rather than on the presence of a name.
 *
 * An `admin` actor is rendered as a name and never as a link: administrators live
 * in a separate database, so their id resolves to nothing among platform users.
 */
export function AgencyKycPanel({
    agency,
    timeZone,
}: {
    agency: AgencyDetail;
    timeZone: string;
}) {
    const { kyc } = agency;

    return (
        <DefinitionList>
            <Definition label="Registration number">
                {kyc.registrationNumber ?? <NotSet />}
            </Definition>

            <Definition label="Transport licence">
                {kyc.transportLicenseId ?? <NotSet />}
            </Definition>

            <Definition label="Verified">
                <AgencyVerificationBadge agency={agency} />
            </Definition>

            <Definition label="Verified at">
                {formatInstantInZone(kyc.verifiedAt, timeZone) ?? <NotSet>Not verified</NotSet>}
            </Definition>

            <Definition
                label="Verified by"
                hint={
                    <InfoHint label="About who verified this">
                        A snapshot taken when the approval was recorded, not a live lookup. For an administrator it is the only readable record of who acted.
                    </InfoHint>
                }
            >
                {kyc.verifiedBy ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                        {kyc.verifiedBy.name ?? <NotSet>Name not recorded</NotSet>}
                        <Badge variant="outline" className="text-xs">
                            {isPlatformActor(kyc.verifiedBy) ? 'Platform' : 'Administrator'}
                        </Badge>
                    </span>
                ) : (
                    <NotSet>Not verified</NotSet>
                )}
            </Definition>
        </DefinitionList>
    );
}

/**
 * The agency's own commercial terms — pricing, returns, damage and COD.
 *
 * ── Read-only here, and that is a decision rather than a gap ──────────────────
 * There is no endpoint to edit these and there should not be. They are negotiated
 * with the vendors connected to the agency, and every edit bumps `policyVersion`,
 * which **pauses every one of those connections for re-approval**. An
 * administrator changing a price on the agency's behalf would silently re-open
 * every relationship it has.
 *
 * ── Why the field names look like this ────────────────────────────────────────
 * The block passes through wi-admin unmapped, so it arrives in the platform
 * database's own `snake_case` rather than the `camelCase` the rest of the API
 * promises. The labels below are written out by hand rather than derived, so the
 * screen reads properly regardless — but the shape is pinned to what actually
 * ships, and it is on the exposure register for the backend team.
 */
export function AgencyPoliciesPanel({ agency }: { agency: AgencyDetail }) {
    const { policies } = agency;

    if (!policies) {
        return (
            <div className="text-muted-foreground space-y-2 text-sm">
                <p>This agency has not set its commercial terms yet.</p>
                <p>
                    Pricing, returns, damage handling and cash-on-delivery limits are declared by
                    the agency during onboarding. Until then, vendors connecting to it have nothing
                    to agree to.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-muted-foreground text-sm">
                The agency&apos;s own terms, shown read-only.{' '}
                <InfoHint label="Why these cannot be edited here">
                    These are commercial terms negotiated with the vendors connected to this
                    agency. Changing any of them raises the policy version, which pauses every one
                    of those vendor connections until each vendor re-approves. Editing on the
                    agency&apos;s behalf would silently re-open every relationship it has, so no
                    endpoint offers it.
                </InfoHint>
            </p>

            <PricingBlock pricing={policies.pricing} />
            <ReturnsBlock returns={policies.returns} />
            <DamageBlock damage={policies.damage} />
            <CodBlock
                cod={policies.cod}
                version={agency.policyVersion}
                pausedConnections={agency.policyVersionPausedConnections}
            />

            {policies.documents && policies.documents.length > 0 ? (
                <section className="space-y-2">
                    <h3 className="text-sm font-medium">Supporting documents</h3>
                    {/*
                      ⚠ **This one stays inline, and deliberately.** Every field
                      description on this screen moved behind an `InfoHint` in the
                      remediation round; this did not, because it is not a
                      description of a field — it is a warning about what a click
                      does. These links leave the platform, and nothing here
                      fetches or previews what is behind them. A consequence
                      somebody has to click an icon to discover is a consequence
                      they will not discover.
                    */}
                    <p className="text-muted-foreground text-xs">
                        Terms the blocks above do not cover. These are links to files held outside
                        the platform — this dashboard does not fetch or preview them.
                    </p>
                    <ul className="space-y-1">
                        {policies.documents.map((url) => (
                            <li key={url}>
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1.5 text-sm hover:underline"
                                >
                                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                                    <span className="break-all">{url}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}

/**
 * Money in these blocks is printed without a currency symbol, deliberately.
 *
 * No field in the policies payload states a currency, and the account endpoints
 * that do state one are a different mount. Printing "XAF" here would be this
 * client asserting something the API never said.
 */
function Amount({ value }: { value: number | null | undefined }) {
    if (value === null || value === undefined) return <NotSet />;
    return <>{formatCount(value)}</>;
}

/**
 * ⚠ **Each inner block is independently `null`** when the agency has stored
 * none, so each of the four renders an absence rather than assuming a shape.
 * That is new with the camelCase mapper — the raw sub-document was always
 * present, if empty.
 */
function PricingBlock({ pricing }: { pricing: AgencyPolicies['pricing'] }) {
    if (!pricing) return <BlockAbsent title="Pricing" />;

    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Pricing</h3>
            <DefinitionList>
                <Definition
                    label="Storage-based"
                    hint={
                        <InfoHint label="About storage-based pricing">
                            Whether the agency warehouses stock at all — not a rate of zero.
                        </InfoHint>
                    }
                >
                    {pricing.storageBased?.enabled ? 'Offered' : 'Not offered'}
                </Definition>
                {pricing.storageBased?.enabled ? (
                    <>
                        <Definition label="Monthly storage, per SKU">
                            <Amount value={pricing.storageBased.monthlyStorageFeePerSku} />
                        </Definition>
                        <Definition label="Pick and pack, per order">
                            <Amount value={pricing.storageBased.pickPackFeePerOrder} />
                        </Definition>
                        <Definition label="Local delivery">
                            <Amount value={pricing.storageBased.localDeliveryFee} />
                        </Definition>
                        <Definition label="Out-of-region delivery">
                            <Amount value={pricing.storageBased.outOfRegionDeliveryFee} />
                        </Definition>
                    </>
                ) : null}

                <Definition label="Pickup-based">
                    {pricing.pickupBased?.enabled ? 'Offered' : 'Not offered'}
                </Definition>
                {pricing.pickupBased?.enabled ? (
                    <>
                        <Definition label="Base rate, first kg">
                            <Amount value={pricing.pickupBased.baseRateFirstKg} />
                        </Definition>
                        <Definition label="Each additional kg">
                            <Amount value={pricing.pickupBased.additionalPerKg} />
                        </Definition>
                        <Definition label="Out-of-region surcharge">
                            <Amount value={pricing.pickupBased.outOfRegionSurcharge} />
                        </Definition>
                    </>
                ) : null}

                <Definition label="Cash-on-delivery handling">
                    {pricing.additionalFees?.codHandlingFee ? (
                        <>
                            {formatCount(pricing.additionalFees.codHandlingFee.value)}
                            {/* `type` decides how `value` reads. */}
                            {pricing.additionalFees.codHandlingFee.type === 'percentage'
                                ? '%'
                                : ' flat'}
                        </>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Failed delivery">
                    <Amount value={pricing.additionalFees?.failedDeliveryFee} />
                </Definition>
                <Definition label="Return to origin">
                    <Amount value={pricing.additionalFees?.rtoFee} />
                </Definition>
                {pricing.additionalFees?.peakSeasonSurcharge !== undefined &&
                pricing.additionalFees?.peakSeasonSurcharge !== null ? (
                    <Definition label="Peak-season surcharge">
                        <Amount value={pricing.additionalFees.peakSeasonSurcharge} />
                    </Definition>
                ) : null}

                {pricing.notes ? <Definition label="Notes">{pricing.notes}</Definition> : null}
            </DefinitionList>
        </section>
    );
}

function ReturnsBlock({ returns }: { returns: AgencyPolicies['returns'] }) {
    if (!returns) return <BlockAbsent title="Returns" />;

    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Returns</h3>
            <DefinitionList>
                <Definition
                    label="Paid by"
                    hint={
                        <InfoHint label="About who pays for a return">
                            Who bears the cost of a returned order.
                        </InfoHint>
                    }
                >
                    <span className="capitalize">{returns.payer}</span>
                </Definition>
                <Definition label="Handling fee">
                    <Amount value={returns.handlingFee} />
                </Definition>
                <Definition label="Return window">
                    {returns.returnWindowDays} day{returns.returnWindowDays === 1 ? '' : 's'}
                </Definition>
                {returns.notes ? <Definition label="Notes">{returns.notes}</Definition> : null}
            </DefinitionList>
        </section>
    );
}

function DamageBlock({ damage }: { damage: AgencyPolicies['damage'] }) {
    if (!damage) return <BlockAbsent title="Damage claims" />;

    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Damage claims</h3>
            <DefinitionList>
                <Definition label="Claim deadline">
                    {damage.claimDeadlineDays} day{damage.claimDeadlineDays === 1 ? '' : 's'}
                </Definition>
                <Definition label="Maximum refund, per item">
                    <Amount value={damage.maxRefundPerItem} />
                </Definition>
                <Definition
                    label="Inspected by"
                    hint={
                        <InfoHint label="About the inspector">
                            An administrator-controlled preset — the agency does not set this.
                        </InfoHint>
                    }
                >
                    <span className="capitalize">{damage.inspector ?? 'agency'}</span>
                </Definition>
                <Definition
                    label="Investigation fee"
                    hint={
                        <InfoHint label="About the investigation fee">
                            Also an administrator-controlled preset.
                        </InfoHint>
                    }
                >
                    <Amount value={damage.investigationFee} />
                </Definition>
                {damage.notes ? <Definition label="Notes">{damage.notes}</Definition> : null}
            </DefinitionList>
        </section>
    );
}

function CodBlock({
    cod,
    version,
    pausedConnections,
}: {
    cod: AgencyPolicies['cod'];
    version: number;
    pausedConnections: number;
}) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Cash on delivery</h3>
            <DefinitionList>
                {cod ? (
                    <>
                        <Definition label="Accepted">{cod.enabled ? 'Yes' : 'No'}</Definition>
                        <Definition
                            label="Maximum order value"
                            hint={
                                <InfoHint label="About the cash-on-delivery ceiling">
                                    The ceiling for a single cash-on-delivery order. Not the same as an agent's COD pool, which limits how much cash one person may be holding at once.
                                </InfoHint>
                            }
                        >
                            {/* `null` is NO ceiling. Zero would block every COD order. */}
                            {cod.maxOrderAmount === null ? (
                                <NotSet>No limit</NotSet>
                            ) : (
                                <Amount value={cod.maxOrderAmount} />
                            )}
                        </Definition>
                    </>
                ) : (
                    <Definition label="Accepted">
                        <NotSet>The agency has stored no cash-on-delivery terms</NotSet>
                    </Definition>
                )}
                <Definition
                    label="Policy version"
                    hint={
                        <InfoHint label="About the policy version">
                            Raised every time the agency edits any of these terms. Each raise pauses every connected vendor until they re-approve.
                        </InfoHint>
                    }
                >
                    {version}
                </Definition>
                <Definition
                    label="Connections awaiting re-approval"
                    hint={
                        <InfoHint label="About paused connections">
                            Vendor connections sitting in paused_reapproval right now, because a policy edit raised the version. The vendor side counts the same collection from the other end.
                        </InfoHint>
                    }
                >
                    {/*
                      The consequence of the field above, which previously had no
                      reading anywhere on this screen. Zero is the healthy state
                      and says so, rather than rendering a bare 0.
                    */}
                    {pausedConnections === 0 ? (
                        <span className="text-muted-foreground text-sm">
                            None — every connection is on the current version
                        </span>
                    ) : (
                        <span className="text-warning text-sm font-medium">
                            {formatCount(pausedConnections)} paused until the vendor re-approves
                        </span>
                    )}
                </Definition>
            </DefinitionList>
        </section>
    );
}

/**
 * One of the four policy blocks the agency has stored nothing for.
 *
 * Rendered rather than omitted: "this agency has agreed no return terms" is a
 * commercially meaningful answer, and a silently missing heading reads as a
 * screen that failed to load.
 */
function BlockAbsent({ title }: { title: string }) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-muted-foreground text-sm">
                The agency has stored no {title.toLowerCase()} terms.
            </p>
        </section>
    );
}
