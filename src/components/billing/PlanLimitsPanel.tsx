import { Definition, DefinitionList, NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { bytesToMegabytes, formatCount } from '@/lib/format';
import type { Plan } from '@/types/billing.types';

/**
 * What a plan allows.
 *
 * ── `null` means three different things here, and the panel says which ────────
 * `billing.md` flattens all five limits into "null means unlimited". Two of them
 * are something else:
 *
 * - `maxActiveProducts`, `commissionPercent`, `maxUnterminatedShipments` — `null`
 *   is genuinely **not limited by this plan**.
 * - **`maxStorageBytes: null` falls back to the platform's own default cap**,
 *   which is not unlimited and not this plan's decision.
 * - **`liveTrackingEnabled` is a flag, not a cap** — `null` means the plan's role
 *   does not define it at all.
 * - ⚠ **`maxCodPool: null` on an agent plan means NO cash on delivery** (since
 *   2026-09-21) — the one limit that fails closed. It shares no branch with the
 *   "not limited" rows above on purpose: one formatter for all of them is how a
 *   closed pool would read as an open one.
 *
 * ── Half of these are null on any given plan, by design ───────────────────────
 * One billing engine serves vendors, agencies and agents, and a plan's `role`
 * decides which limits it carries. A vendor tier leaves the delivery limits null;
 * a delivery tier leaves the catalogue limits null. That is not missing data.
 */
export function PlanLimitsPanel({ plan }: { plan: Plan }) {
    const { limits, role } = plan;

    const isDelivery = role === 'agency' || role === 'agent';

    return (
        <DefinitionList>
            <Definition
                label="Commission"
                hint={
                    <InfoHint label="About commission">
                        The rate the platform takes, and{' '}
                        <strong>the multiplier every future order&rsquo;s split uses</strong>. It
                        is a property of the plan rather than of the account — changing what
                        somebody is charged means assigning them a different tier.
                    </InfoHint>
                }
            >
                {limits.commissionPercent === null ? (
                    <NotSet>Not set by this plan</NotSet>
                ) : (
                    `${limits.commissionPercent}%`
                )}
            </Definition>

            <Definition label="Active listings">
                {limits.maxActiveProducts === null ? (
                    isDelivery ? (
                        <NotApplicable>A delivery plan sets no catalogue limit</NotApplicable>
                    ) : (
                        <NotSet>Not limited by this plan</NotSet>
                    )
                ) : (
                    formatCount(limits.maxActiveProducts)
                )}
            </Definition>

            <Definition
                label="Storage"
                hint={
                    <InfoHint label="About storage">
                        Unlike the other limits, an empty storage cap is{' '}
                        <strong>not unlimited</strong> — the platform applies its own default
                        instead. So a blank here means this tier declines to override that, not
                        that storage is unbounded.
                    </InfoHint>
                }
            >
                {limits.maxStorageBytes === null ? (
                    <NotSet>Platform default applies</NotSet>
                ) : (
                    `${formatCount(bytesToMegabytes(limits.maxStorageBytes))} MB`
                )}
            </Definition>

            <Definition label="Concurrent shipments">
                {limits.maxUnterminatedShipments === null ? (
                    isDelivery ? (
                        <NotSet>Not limited by this plan</NotSet>
                    ) : (
                        <NotApplicable>Not part of a {role} plan</NotApplicable>
                    )
                ) : (
                    formatCount(limits.maxUnterminatedShipments)
                )}
            </Definition>

            <Definition
                label="COD pool"
                hint={
                    <InfoHint label="About the COD pool">
                        The cash on delivery an agent on this tier may carry across every agency —
                        once their identity is verified; before that it is 0 whatever this says.
                        Unlike the other limits, an <strong>empty value means no cash on
                        delivery</strong>, not unlimited. An administrator can pin a different
                        amount for one agent.
                    </InfoHint>
                }
            >
                {role !== 'agent' ? (
                    <NotApplicable>Not part of a {role} plan</NotApplicable>
                ) : limits.maxCodPool === null || limits.maxCodPool === 0 ? (
                    // ⚠ Never "Not limited" here: jovi-mall reads `null` as 0.
                    <span>0 — no cash on delivery</span>
                ) : (
                    formatCount(limits.maxCodPool)
                )}
            </Definition>

            <Definition label="Live tracking">
                {limits.liveTrackingEnabled === null ? (
                    <NotApplicable>Not defined by a {role} plan</NotApplicable>
                ) : (
                    <Badge variant="outline">
                        {limits.liveTrackingEnabled ? 'Included' : 'Not included'}
                    </Badge>
                )}
            </Definition>

            <Definition
                label="Credit allowance"
                hint={
                    <InfoHint label="About the allowance">
                        Metered-action credits granted once when the term activates — not money,
                        and never payable out.
                    </InfoHint>
                }
            >
                {formatCount(plan.creditAllowance)} credits
            </Definition>
        </DefinitionList>
    );
}
