import { Definition, DefinitionList, NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { bytesToMegabytes, formatCount } from '@/lib/format';
import { AGENT_COD_POOL_DEFAULT } from '@/types/agents.types';
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
 * - ⚠ **`maxCodPool` is DORMANT since 2026-10-02** (ADR-A09). From 2026-09-21
 *   it was every verified agent's pool on the tier, and `null` meant *no cash on
 *   delivery*; now every verified agent gets the same 500 000 default and this
 *   value moves nobody. So it is shown as stored, marked unused, and neither
 *   `null` nor `0` is read as closing cash on delivery — that reading is now false.
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
                        Until 2026-10-02 this was the cash on delivery a verified agent on this
                        tier could carry. Every verified agent now gets the same{' '}
                        {formatCount(AGENT_COD_POOL_DEFAULT)} default whatever their plan, so this
                        value moves nobody&apos;s pool. An administrator can still pin a different
                        amount for one agent.
                    </InfoHint>
                }
            >
                {role !== 'agent' ? (
                    <NotApplicable>Not part of a {role} plan</NotApplicable>
                ) : (
                    <span className="flex flex-wrap items-center gap-2">
                        {limits.maxCodPool === null ? (
                            <NotSet>Not set</NotSet>
                        ) : (
                            <span className="text-muted-foreground tabular-nums">
                                {formatCount(limits.maxCodPool)}
                            </span>
                        )}
                        <Badge variant="outline">Not used since 2026-10-02</Badge>
                    </span>
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
