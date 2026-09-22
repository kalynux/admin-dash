import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatCount, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getAgentAssignability } from '@/services/agents.service';
import {
    readCodExposure,
    type AssignabilityGate,
    type AssignabilityRemedy,
    type CodExposureObserved,
} from '@/types/agents.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /agents/:agentId/assignability` — **why can this agent not take this
 * work?**, every gate from both families, with the numbers behind each.
 *
 * ── Why this replaced the eligibility check on the row ────────────────────────
 * The row used to ask `/eligibility`, which answers the **platform** half only:
 * banned · KYC · active · available · tracking · device · capacity. The
 * **contract** half — an active contract, coverage, the per-shipment value
 * ceiling and COD exposure — was diagnosable nowhere, and it is where the numbers
 * are: an agency refused with `COD_AGENT_EXPOSURE_EXCEEDED` could see its own
 * threshold and neither the agent's actual exposure nor the trust multiplier
 * that had halved it. This answer carries the platform gates too (and the raw
 * `/eligibility` payload inside it), so one question on the row now gets the
 * whole answer. Both routes need what the Roster tab already requires.
 *
 * ── A shipment id is optional, on purpose ─────────────────────────────────────
 * Support arrives holding an agency and an agent and no shipment id. Without one
 * the two shipment gates report `skipped` and the cash gate answers "is this
 * agent already at their limit for this agency?" — which is the first question.
 *
 * ── Three things the screen must not get backwards ────────────────────────────
 * 1. **Exposure is agent-wide; the limit is this agency's.** The cash is one
 *    physical pot across every agency the agent serves.
 * 2. **The slice is not the limit.** `effectiveLimit` is — the slice, capped by
 *    the agent's pool, scaled by trust.
 * 3. **When `poolBinds`, the agent's own pool set the limit** — and the server's
 *    English line still says *"the contract threshold of {base}"*. So the screen
 *    says it plainly, above that line, rather than letting it blame the contract.
 */
export function AssignabilityCheck({ agentId, agencyId }: { agentId: string; agencyId: string }) {
    const [draft, setDraft] = useState('');
    const [shipmentId, setShipmentId] = useState<string | undefined>(undefined);
    const draftIsId = OBJECT_ID.test(draft.trim());

    const check = useAsyncData(
        withQuery(`/agents/${agentId}/assignability`, { agencyId, shipmentId }),
        (signal) => getAgentAssignability(agentId, { agencyId, shipmentId }, { signal }),
    );

    const shipmentPicker = (
        <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                if (draftIsId) setShipmentId(draft.trim());
            }}
        >
            <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`assignability-shipment-${agencyId}`} className="text-xs">
                    Ask about one shipment (optional)
                </Label>
                <Input
                    id={`assignability-shipment-${agencyId}`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Shipment id — 24 hexadecimal characters"
                    className="h-8 font-mono text-xs"
                />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={!draftIsId}>
                Check this shipment
            </Button>
            {shipmentId ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setShipmentId(undefined);
                        setDraft('');
                    }}
                >
                    Without a shipment
                </Button>
            ) : null}
        </form>
    );

    if (check.isLoading) {
        return (
            <div className="space-y-3 rounded-lg border p-3">
                {shipmentPicker}
                <p className="text-muted-foreground text-sm">Asking the platform…</p>
            </div>
        );
    }

    if (!check.data) {
        return (
            <div className="space-y-3 rounded-lg border p-3">
                {shipmentPicker}
                <p className="text-warning text-sm">
                    Could not get a verdict — {resolveErrorMessage(check.error)}. This is not a
                    refusal.
                </p>
                <Button variant="outline" size="sm" onClick={check.reload}>
                    Ask again
                </Button>
            </div>
        );
    }

    const verdict = check.data;
    const families = groupByFamily(verdict.gates);

    return (
        <div className="space-y-3 rounded-lg border p-3">
            {shipmentPicker}

            <div className="flex flex-wrap items-center gap-2">
                <Badge
                    variant="outline"
                    className={
                        verdict.assignable
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-destructive/30 bg-destructive/10 text-destructive'
                    }
                >
                    {verdict.assignable ? 'Can be dispatched to' : 'Cannot be dispatched to'}
                </Badge>
                <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                    {/*
                      A verdict is pairwise, so the agency it was asked about is
                      part of the answer rather than decoration.
                    */}
                    by agency
                    <CopyableValue value={verdict.agencyId} label="agency ID" truncate={false} />
                    {verdict.shipmentId ? (
                        <>
                            · for shipment
                            <CopyableValue value={verdict.shipmentId} label="shipment ID" />
                        </>
                    ) : (
                        <span>· no shipment given, so the two shipment gates were skipped</span>
                    )}
                    {verdict.eligibility ? (
                        <span>
                            · {formatCount(verdict.eligibility.activeShipmentCount)} of{' '}
                            {formatCount(verdict.eligibility.maxConcurrentShipments)} shipments in
                            hand
                        </span>
                    ) : null}
                </span>
            </div>

            {families.map(({ family, gates }) => (
                <section key={family} className="space-y-1.5">
                    <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {FAMILY_LABELS[family] ?? humaniseEnum(family) ?? family}
                    </h4>
                    <ul className="space-y-2 text-sm">
                        {gates.map((gate) => (
                            <GateRow key={`${gate.family}:${gate.gate}`} gate={gate} />
                        ))}
                    </ul>
                </section>
            ))}

            <p className="text-muted-foreground text-xs">
                A verdict is a moment in time — availability, capacity and cash move without an
                administrator touching anything.
            </p>
        </div>
    );
}

const FAMILY_LABELS: Record<string, string> = {
    platform: 'Platform rules',
    contract: 'Contract terms',
};

/** Platform first, then contract, then anything this build has not heard of. */
function groupByFamily(gates: AssignabilityGate[]) {
    const order = ['platform', 'contract'];
    const families = new Map<string, AssignabilityGate[]>();
    for (const gate of gates) {
        const list = families.get(gate.family) ?? [];
        list.push(gate);
        families.set(gate.family, list);
    }
    return [...families.entries()]
        .sort(([a], [b]) => rank(order, a) - rank(order, b))
        .map(([family, list]) => ({ family, gates: list }));
}

function rank(order: string[], value: string): number {
    const index = order.indexOf(value);
    return index === -1 ? order.length : index;
}

/**
 * `skipped` and `not_applicable` are neither a pass nor a refusal, and are drawn
 * as neither — a grey dot and the word, so "never ran" cannot read as "passed".
 */
const STATUS_DOT: Record<string, string> = {
    passed: 'bg-success',
    failed: 'bg-destructive',
};

const STATUS_WORD: Record<string, string> = {
    skipped: 'skipped',
    not_applicable: 'not applicable',
};

function GateRow({ gate }: { gate: AssignabilityGate }) {
    const cod = readCodExposure(gate);
    const observedKeys = Object.keys(gate.observed ?? {});

    return (
        <li className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
                <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${
                        STATUS_DOT[gate.status] ?? 'bg-muted-foreground/40'
                    }`}
                />
                <span className="capitalize">{humaniseEnum(gate.gate) ?? gate.gate}</span>
                {gate.status === 'passed' || gate.status === 'failed' ? (
                    <span className="sr-only">{gate.status}</span>
                ) : (
                    <span className="text-muted-foreground text-xs">
                        {STATUS_WORD[gate.status] ?? gate.status}
                    </span>
                )}
                {/*
                  The platform's own token, mono — a reason, not a value, so no
                  copy button. Same call as the eligibility rows before it.
                */}
                {gate.reason ? (
                    <span className="text-muted-foreground font-mono text-xs">{gate.reason}</span>
                ) : null}
            </div>

            {cod?.limit.poolBinds ? <PoolBindsNote cod={cod} /> : null}

            {gate.summary ? <p className="text-muted-foreground pl-3.5 text-xs">{gate.summary}</p> : null}

            {cod ? (
                <CodExposureFigures cod={cod} />
            ) : observedKeys.length > 0 ? (
                // What the rule actually saw — a refusal explainable without a re-run.
                <p className="text-muted-foreground pl-3.5 font-mono text-xs break-all">
                    saw {JSON.stringify(gate.observed)}
                </p>
            ) : null}

            {gate.remedies.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-8 text-xs">
                    {gate.remedies.map((remedy, index) => (
                        <li key={`${remedy.action}-${index}`}>
                            {remedyText(remedy)}
                            {remedy.action === 'raise_contract_threshold' && cod?.limit.poolBinds ? (
                                <span className="text-warning">
                                    {' '}
                                    — will not help while the agent&apos;s own pool is the limit
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

/**
 * The changelog's one instruction for this read: when the pool binds, say
 * "limited by the agent's COD pool" rather than blaming the contract — because
 * the platform's own summary line beneath still says *"the contract threshold"*.
 */
function PoolBindsNote({ cod }: { cod: CodExposureObserved }) {
    return (
        <p className="border-warning/30 bg-warning/10 ml-3.5 flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs">
            <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" />
            <span>
                Limited by the <strong>agent&apos;s own COD pool</strong>
                {cod.limit.agentPool === null ? null : ` (${formatCount(cod.limit.agentPool)})`},
                not by this agency&apos;s slice
                {cod.limit.contractThreshold === null
                    ? null
                    : ` (${formatCount(cod.limit.contractThreshold)})`}
                . The pool comes from the agent&apos;s plan or an administrator&apos;s pin — see the
                Cash tab — so raising the slice will not change this answer.
            </span>
        </p>
    );
}

/** The cash gate's numbers, in the order the gate reached them. */
function CodExposureFigures({ cod }: { cod: CodExposureObserved }) {
    const { limit, exposure } = cod;

    return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pl-3.5 text-xs sm:grid-cols-3">
            <Figure
                label="Exposure, all agencies"
                value={
                    exposure
                        ? `${formatCount(exposure.total)} (${formatCount(exposure.cashHeld)} held + ${formatCount(exposure.pendingCollections.total)} due)`
                        : null
                }
            />
            <Figure label="Limit" value={formatCount(limit.effectiveLimit)} strong />
            <Figure label="Headroom" value={cod.headroom === null ? null : formatCount(cod.headroom)} />
            <Figure
                label="This agency's slice"
                value={
                    limit.contractThreshold === null
                        ? 'platform default'
                        : formatCount(limit.contractThreshold)
                }
            />
            <Figure
                label="Agent's pool"
                value={limit.agentPool === null ? null : formatCount(limit.agentPool)}
            />
            <Figure
                label="Trust"
                value={`${limit.trustScore} · ${humaniseEnum(limit.tier) ?? limit.tier} ×${limit.multiplier}`}
            />
            {cod.additionalAmount > 0 ? (
                <Figure label="This shipment adds" value={formatCount(cod.additionalAmount)} />
            ) : null}
        </dl>
    );
}

function Figure({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
    return (
        <div>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value ?? '—'}</dd>
        </div>
    );
}

/**
 * A remedy in words. The vocabulary is open — an action this build has not
 * heard of is humanised and its numbers shown raw, never dropped.
 */
function remedyText(remedy: AssignabilityRemedy): string {
    const p = remedy.params ?? {};
    const n = (value: unknown) => (typeof value === 'number' ? formatCount(value) : '—');

    switch (remedy.action) {
        case 'deposit_cash':
            return `Deposit ${n(p.amount)} of the cash they hold`;
        case 'raise_trust_score':
            return `Raise the trust score from ${n(p.from)} to ${n(p.to)} — the limit would become ${n(p.wouldRaiseLimitTo)}${
                p.sufficientOnItsOwn === true ? ', enough on its own' : ', not enough on its own'
            }`;
        case 'raise_contract_threshold':
            return typeof p.requiredForCurrentExposure === 'number'
                ? `Raise this agency's slice from ${n(p.current)} to at least ${n(p.requiredForCurrentExposure)}`
                : `Raise this agency's slice from ${n(p.current)}`;
        case 'resolve_cash_shortfall':
            return 'Resolve the open cash-shortfall discrepancy first';
        case 'add_coverage_region':
            return `Add ${typeof p.region === 'string' ? p.region : 'the delivery region'} to the contract's coverage`;
        case 'raise_shipment_value_ceiling':
            return `Raise the per-shipment value ceiling to at least ${n(p.required)}`;
        case 'activate_contract':
            return 'Activate a contract with this agency';
        case 'wait_for_deliveries':
            return 'Wait for deliveries — delivered packages become cash to deposit';
        default: {
            const label = humaniseEnum(remedy.action) ?? remedy.action;
            return Object.keys(p).length > 0 ? `${label} ${JSON.stringify(p)}` : label;
        }
    }
}
