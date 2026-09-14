import { useState } from 'react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { FormField } from '@/components/common/FormField';
import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { Input } from '@/components/ui/input';
import { humaniseEnum } from '@/lib/format';
import { notify } from '@/lib/notify';
import { reviewAgentKyc } from '@/services/agents.service';
import { agentDisplayName, type AgentDetail, type AgentKycStatus } from '@/types/agents.types';
import type { PartyVerification, VerdictOption } from '@/types/verification.types';

import { VerificationReviewDialog } from './VerificationReviewDialog';

/** `agents.md`: `reference` is `string, ≤ 200`, optional. */
const REFERENCE_MAX = 200;

/**
 * `PUT /agents/:agentId/kyc` — **the write that lets an agent work.**
 *
 * ── ⚠ This is the one verdict of the three with teeth ────────────────────────
 * A vendor's verification gates nothing and an agency's rejection changes no
 * status. An agent's does: eligibility passes only on `verified`, so moving them
 * off it makes them **undispatchable immediately**. It does not touch their
 * contracts and shipments already in hand are unaffected, but the next
 * assignment will not reach them. The dialog says so before the choice, not
 * after it.
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
        await reviewAgentKyc(agent.id, {
            status,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            ...(status === 'rejected' ? { rejectionReason: text } : {}),
        });
        notify.success('Identity documents reviewed');
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
            description="Check what the agent supplied, then record a verdict. Eligibility passes only on verified — moving them off it makes them undispatchable immediately, though shipments already in hand are unaffected."
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
        >
            <AgentRecordContext agent={agent} />
        </VerificationReviewDialog>
    );
}

const VERDICTS: VerdictOption[] = [
    {
        value: 'verified',
        label: 'Mark verified',
        description: 'The agent becomes dispatchable. Eligibility passes only on this value.',
        textMode: 'none',
        estimates: 'approve',
    },
    {
        value: 'rejected',
        label: 'Mark rejected',
        description:
            'Refuses the document set and makes the agent undispatchable immediately. The agent is shown your reason.',
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
            'Records that a review is in progress rather than a refusal. The agent is undispatchable while it stands, and is told nothing — use "rejected" when they need to act.',
        textMode: 'none',
    },
    {
        value: 'unverified',
        label: 'Mark unverified',
        description:
            'Resets the record to "never reviewed". Undispatchable, and it erases the fact that anybody looked — prefer "pending" unless the previous verdict was reached in error.',
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
function AgentRecordContext({ agent }: { agent: AgentDetail }) {
    const vehicle = agent.vehicle;

    return (
        <section className="space-y-2" aria-label="What the record carries">
            <h3 className="text-sm font-medium">What the record already carries</h3>

            <DefinitionList className="rounded-lg border p-3 text-xs sm:grid-cols-[10rem_1fr]">
                <Definition label="Name">{agent.name ?? <NotSet />}</Definition>
                <Definition label="Off-platform reference">
                    {agent.kyc.reference ? (
                        <CopyableValue
                            value={agent.kyc.reference}
                            variant="plain"
                            label="KYC reference"
                        />
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Email">
                    {agent.email ? (
                        <span className="flex flex-wrap items-center gap-2">
                            <CopyableValue value={agent.email} variant="email" label="email" />
                            <VerifiedFlag verified={agent.emailVerified} />
                        </span>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Phone">
                    {agent.phone ? (
                        <span className="flex flex-wrap items-center gap-2">
                            <CopyableValue value={agent.phone} variant="phone" label="phone" />
                            <VerifiedFlag verified={agent.phoneVerified} />
                        </span>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition
                    label="Home base"
                    hint={undefined}
                >
                    {agent.homeBase.label ?? <NotSet>No label</NotSet>}
                    {agent.homeBase.serviceRadiusKm !== null
                        ? ` · works within ${agent.homeBase.serviceRadiusKm} km`
                        : ''}
                </Definition>
                <Definition label="Vehicle">
                    {vehicle ? (
                        [humaniseEnum(vehicle.type), vehicle.color, vehicle.plateNumber]
                            .filter(Boolean)
                            .join(' · ') || <NotSet>Recorded, no detail</NotSet>
                    ) : (
                        <NotSet>None recorded</NotSet>
                    )}
                </Definition>
                <Definition label="Onboarding">
                    {agent.onboardingComplete ? 'Complete' : 'Incomplete'}
                </Definition>
            </DefinitionList>

            {vehicle?.photoFileId ? (
                <div className="space-y-1">
                    <p className="text-muted-foreground text-xs">
                        The vehicle photograph already on the record. It shows the vehicle; the
                        checklist above asks for one with the agent in the frame, which is a
                        different claim.
                    </p>
                    <ResolvedImageBox
                        fileId={vehicle.photoFileId}
                        alt="Vehicle photograph on the agent record"
                        className="max-w-[16rem]"
                        caption="Vehicle photograph"
                    />
                </div>
            ) : null}

            <p className="text-muted-foreground text-xs leading-relaxed">
                The home base is a label and a radius. wi-admin projects no coordinates for it, so
                it cannot be checked against a map here — which is why the geocode row above reads{' '}
                <em>not reported</em> rather than <em>not supplied</em>.
            </p>
        </section>
    );
}

function VerifiedFlag({ verified }: { verified: boolean }) {
    return (
        <span className={verified ? 'text-success' : 'text-muted-foreground'}>
            {verified ? 'verified' : 'unverified'}
        </span>
    );
}
