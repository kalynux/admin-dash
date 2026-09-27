import { useState } from 'react';

import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/ui/input';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { reviewAgentKyc } from '@/services/agents.service';
import {
    agentDisplayName,
    type AgentDetail,
    type AgentKycStatus,
    type KycCodPoolView,
} from '@/types/agents.types';
import type { PartyVerification, VerdictOption } from '@/types/verification.types';

import { VerificationReviewDialog } from './VerificationReviewDialog';

/** `agents.md`: `reference` is `string, ≤ 200`, optional. */
const REFERENCE_MAX = 200;

/**
 * `PUT /agents/:agentId/kyc` — **the write that lets an agent carry cash on delivery.**
 *
 * ── ⚠ It gates COD, and only COD — since 2026-09-27 ──────────────────────────
 * Until that date eligibility passed only on `verified`, so this verdict decided
 * whether an agent could work at all. The owner reversed that: verification is a
 * trust badge, not a licence to work. An unverified agent contracts, is listed
 * and takes **prepaid** shipments; what `verified` unlocks is the COD pool and
 * COD dispatch (`AGENT_KYC_NOT_VERIFIED` otherwise). Moving an agent off it
 * closes the pool to 0 and refuses them new COD shipments; prepaid work
 * continues, contracts are untouched and shipments in hand are unaffected.
 * ⛔ **Do not bring back "cannot be dispatched" / "cannot work" copy here.**
 *
 * ── ⚠ Four statuses, not two, and all four are offered ───────────────────────
 * `unverified` · `pending` · `verified` · `rejected`. The other two surfaces are
 * binary; this one can also send an agent *back* to pending — which is the right
 * record when a document is being re-checked rather than refused, and the
 * difference matters because only `rejected` requires a reason the agent is
 * shown. Unlike `/vendors` and `/agencies` this route publishes no conflict
 * code, so no option is filtered out.
 *
 * ── `reference` is the field this whole flow exists to replace ───────────────
 * It is kept, because it is real and the contract carries it — *"a free-form
 * pointer to whatever document set was checked, off-platform"*. It is also, on
 * its own, the entire evidence base an administrator has had until now, which is
 * the complaint BR-024 records. It sits under the verdict rather than above the
 * checklist for that reason: a pointer to evidence held elsewhere is not
 * evidence.
 */
export function ReviewAgentVerificationDialog({
    agent,
    record,
    open,
    onOpenChange,
    onDone,
    timeZone,
}: {
    agent: AgentDetail;
    /**
     * The loaded verification record, handed down by the Verification panel the
     * operator opened this from.
     *
     * ⚠ Passed rather than re-fetched: the reviewer has just been reading those
     * documents, and a second request could build the verdict form on a
     * different snapshot from the one they looked at.
     */
    record: PartyVerification | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
    timeZone: string;
}) {
    const [reference, setReference] = useState(agent.kyc.reference ?? '');

    async function submit(verdict: string, text: string) {
        const status = verdict as AgentKycStatus;
        const result = await reviewAgentKyc(agent.id, {
            status,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            ...(status === 'rejected' ? { rejectionReason: text } : {}),
        });
        notify.success('Identity documents reviewed', {
            description: codPoolConsequence(result.codPool),
        });
        onOpenChange(false);
        onDone();
    }

    return (
        <VerificationReviewDialog
            open={open}
            onOpenChange={onOpenChange}
            party="agent"
            subjectName={agentDisplayName(agent)}
            title={`Review documents for ${agentDisplayName(agent)}`}
            description="Check what the agent supplied, then record a verdict. Verifying their identity allows cash-on-delivery orders. Unverified agents still take prepaid work, and shipments already in hand are unaffected either way."
            record={record}
            current={{
                status: agent.kyc.status ?? 'unverified',
                reason: agent.kyc.rejectionReason,
                decidedAt: agent.kyc.verifiedAt,
                decidedBy: agent.kyc.verifiedBy,
            }}
            options={VERDICTS}
            onSubmit={submit}
            timeZone={timeZone}
            extraFields={
                <FormField
                    id="agent-kyc-reference"
                    label="Reference (optional)"
                    hint="A free-form pointer to whatever document set was checked off-platform. This service stores no documents of its own — which is the gap the checklist above reports."
                >
                    {(field) => (
                        <Input
                            maxLength={REFERENCE_MAX}
                            placeholder="Where the documents were checked"
                            value={reference}
                            onChange={(event) => setReference(event.target.value)}
                            {...field}
                        />
                    )}
                </FormField>
            }
        />
    );
}

/**
 * What the verdict just did to the agent's cash — `codPool` on the answer
 * (2026-09-21). `verified` opens the pool from the plan (or a standing pin), any
 * other verdict closes it to 0, and the reviewer should see that consequence of
 * the decision they just made rather than discover it on the Cash tab.
 *
 * `undefined` when the block is absent — an older build, or a forwarded payload
 * that arrived short — so the toast simply carries no second line.
 */
function codPoolConsequence(pool: KycCodPoolView | null | undefined): string | undefined {
    if (typeof pool?.maxThreshold !== 'number') return undefined;
    return `COD pool now ${formatCount(pool.maxThreshold)}`;
}

const VERDICTS: VerdictOption[] = [
    {
        value: 'verified',
        label: 'Verify identity',
        description:
            'Allows cash-on-delivery orders: their COD pool opens at their plan’s amount (or a standing pin). Prepaid work does not depend on this.',
        textMode: 'none',
        estimates: 'approve',
    },
    {
        value: 'rejected',
        label: 'Mark rejected',
        description:
            'Refuses the document set and closes their COD pool to 0, so they take no new cash-on-delivery orders. Prepaid work continues. The agent is shown your reason.',
        textMode: 'required-reason',
        textLabel: 'Rejection reason',
        textHint: 'The agent is shown this. "Your documents were rejected" with no cause is an unactionable message that generates a support ticket by construction.',
        textPlaceholder: 'The ID photo is illegible — re-upload a clear scan',
        destructive: true,
        estimates: 'reject',
    },
    {
        value: 'pending',
        label: 'Send back to pending',
        description:
            'Records that a review is in progress rather than a refusal. While it stands their COD pool is 0 and they take no cash-on-delivery orders (prepaid work continues), and they are told nothing — use "rejected" when they need to act.',
        textMode: 'none',
    },
    {
        value: 'unverified',
        label: 'Mark unverified',
        description:
            'Resets the record to "never reviewed". No cash-on-delivery orders and a COD pool of 0 (prepaid work continues), and it erases the fact that anybody looked — prefer "pending" unless the previous verdict was reached in error.',
        textMode: 'none',
    },
];

/**
 * What the record already carries.
 *
 * ⚠ **`vehicle.photoFileId` is shown, and it is NOT the vehicle check above.**
 * The contract documents it only as *"photo of the vehicle"*; the checklist row
 * asks for a photograph with the agent standing beside it, which is a different
 * assertion — one proves a van exists, the other proves this agent has that van.
 * They are rendered in different sections on purpose, so nobody ticks the second
 * by looking at the first.
 */
