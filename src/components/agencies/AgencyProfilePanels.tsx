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
                hint="Whether the agency's business paperwork was approved. Separate from its status — nothing on the platform currently blocks an unverified agency from operating, so the two can disagree."
            >
                <AgencyVerificationBadge agency={agency} />
            </Definition>

            <Definition label="Business name">
                {agency.businessName ?? <NotSet>Not provided yet</NotSet>}
            </Definition>

            <Definition label="Contact person">
                {agency.contactName ?? <NotSet />}
            </Definition>

            <Definition label="Email">
                {agency.email ? (
                    <span className="inline-flex items-center gap-1.5">
                        {agency.email}
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
                    <span className="inline-flex items-center gap-1.5">
                        {agency.phone}
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
                hint="The regions this agency serves, declared on its business record. Not the same as a contract's coverage, which narrows an individual agent to part of it."
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
                hint="When on, a shipment handed to this agency is auto-offered to the best-ranked eligible agent instead of waiting for a manual pick. Agencies opt in; it is off by default."
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
                hint="The platform account behind this agency. A different identity space from the agency record itself."
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
                hint="A snapshot taken when the approval was recorded, not a live lookup. For an administrator it is the only readable record of who acted."
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
            <CodBlock cod={policies.cod} version={agency.policyVersion} />

            {policies.documents && policies.documents.length > 0 ? (
                <section className="space-y-2">
                    <h3 className="text-sm font-medium">Supporting documents</h3>
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

function PricingBlock({ pricing }: { pricing: AgencyPolicies['pricing'] }) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Pricing</h3>
            <DefinitionList>
                <Definition label="Storage-based">
                    {pricing.storage_based?.enabled ? 'Offered' : 'Not offered'}
                </Definition>
                {pricing.storage_based?.enabled ? (
                    <>
                        <Definition label="Monthly storage, per SKU">
                            <Amount value={pricing.storage_based.monthly_storage_fee_per_sku} />
                        </Definition>
                        <Definition label="Pick and pack, per order">
                            <Amount value={pricing.storage_based.pick_pack_fee_per_order} />
                        </Definition>
                        <Definition label="Local delivery">
                            <Amount value={pricing.storage_based.local_delivery_fee} />
                        </Definition>
                        <Definition label="Out-of-region delivery">
                            <Amount value={pricing.storage_based.out_of_region_delivery_fee} />
                        </Definition>
                    </>
                ) : null}

                <Definition label="Pickup-based">
                    {pricing.pickup_based?.enabled ? 'Offered' : 'Not offered'}
                </Definition>
                {pricing.pickup_based?.enabled ? (
                    <>
                        <Definition label="Base rate, first kg">
                            <Amount value={pricing.pickup_based.base_rate_first_kg} />
                        </Definition>
                        <Definition label="Each additional kg">
                            <Amount value={pricing.pickup_based.additional_per_kg} />
                        </Definition>
                        <Definition label="Out-of-region surcharge">
                            <Amount value={pricing.pickup_based.out_of_region_surcharge} />
                        </Definition>
                    </>
                ) : null}

                <Definition label="Cash-on-delivery handling">
                    {pricing.additional_fees?.cod_handling_fee ? (
                        <>
                            {formatCount(pricing.additional_fees.cod_handling_fee.value)}
                            {pricing.additional_fees.cod_handling_fee.type === 'percentage'
                                ? '%'
                                : ' flat'}
                        </>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Failed delivery">
                    <Amount value={pricing.additional_fees?.failed_delivery_fee} />
                </Definition>
                <Definition label="Return to origin">
                    <Amount value={pricing.additional_fees?.rto_fee} />
                </Definition>
                {pricing.additional_fees?.peak_season_surcharge !== undefined ? (
                    <Definition label="Peak-season surcharge">
                        <Amount value={pricing.additional_fees.peak_season_surcharge} />
                    </Definition>
                ) : null}

                {pricing.notes ? (
                    <Definition label="Notes">{pricing.notes}</Definition>
                ) : null}
            </DefinitionList>
        </section>
    );
}

function ReturnsBlock({ returns }: { returns: AgencyPolicies['returns'] }) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Returns</h3>
            <DefinitionList>
                <Definition label="Paid by" hint="Who bears the cost of a returned order.">
                    <span className="capitalize">{returns.payer}</span>
                </Definition>
                <Definition label="Handling fee">
                    <Amount value={returns.handling_fee} />
                </Definition>
                <Definition label="Return window">
                    {returns.return_window_days} day{returns.return_window_days === 1 ? '' : 's'}
                </Definition>
                {returns.notes ? <Definition label="Notes">{returns.notes}</Definition> : null}
            </DefinitionList>
        </section>
    );
}

function DamageBlock({ damage }: { damage: AgencyPolicies['damage'] }) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Damage claims</h3>
            <DefinitionList>
                <Definition label="Claim deadline">
                    {damage.claim_deadline_days} day{damage.claim_deadline_days === 1 ? '' : 's'}
                </Definition>
                <Definition label="Maximum refund, per item">
                    <Amount value={damage.max_refund_per_item} />
                </Definition>
                <Definition
                    label="Inspected by"
                    hint="An administrator-controlled preset — the agency does not set this."
                >
                    <span className="capitalize">{damage.inspector ?? 'agency'}</span>
                </Definition>
                <Definition
                    label="Investigation fee"
                    hint="Also an administrator-controlled preset."
                >
                    <Amount value={damage.investigation_fee} />
                </Definition>
                {damage.notes ? <Definition label="Notes">{damage.notes}</Definition> : null}
            </DefinitionList>
        </section>
    );
}

function CodBlock({
    cod,
    version,
}: {
    cod: AgencyPolicies['cod'];
    version: number;
}) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Cash on delivery</h3>
            <DefinitionList>
                <Definition label="Accepted">{cod.enabled ? 'Yes' : 'No'}</Definition>
                <Definition
                    label="Maximum order value"
                    hint="The ceiling for a single cash-on-delivery order. Not the same as an agent's COD pool, which limits how much cash one person may be holding at once."
                >
                    {cod.max_order_amount === null ? (
                        <NotSet>No limit</NotSet>
                    ) : (
                        <Amount value={cod.max_order_amount} />
                    )}
                </Definition>
                <Definition
                    label="Policy version"
                    hint="Raised every time the agency edits any of these terms. Each raise pauses every connected vendor until they re-approve."
                >
                    {version}
                </Definition>
            </DefinitionList>
        </section>
    );
}
