import { CopyableValue } from '@/components/common/CopyableValue';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_AGENCY_STATUS_CONFLICT,
    rejectAgency,
    verifyAgency,
} from '@/services/agencies.service';
import { agencyDisplayName, type AgencyDetail } from '@/types/agencies.types';
import { ApiError } from '@/types/api.types';
import type { PartyVerification, VerdictOption } from '@/types/verification.types';

import { VerificationReviewDialog } from './VerificationReviewDialog';

/**
 * The two verdicts on `/agencies`, behind one review.
 *
 * ── Both hold `agencies.verify`, and only the audit action separates them ────
 * That permission is the *review capability*, named for its happy path, exactly
 * as `vendors.kyc.review` and `agents.kyc.review` each cover both of their
 * outcomes. ADR-005 D-4 attaches the permission and the audit row to the action;
 * here the two verdicts are one action with two results.
 *
 * ── ⚠ Approving takes NO body, and the schema is strict ──────────────────────
 * `POST /agencies/:agencyId/verify` is `{}` and any field is a `400`. A reason
 * there would be theatre: the act is an approval, the actor is already stamped
 * on the agency and on the audit row, and a free-text field nobody must fill
 * produces a column of empty strings. That is why the option declares
 * `textMode: 'none'` rather than an optional note — the dialog would otherwise
 * offer a field whose contents the route refuses.
 *
 * ── ⚠ Rejecting changes no status ────────────────────────────────────────────
 * jovi-mall leaves the agency at `pending_verification`; nothing is deactivated
 * and no cascade runs. A non-`active` agency is already refused by product
 * activation, pickup resolution, COD eligibility and vendor default-agency
 * selection, so this records a verdict rather than adding enforcement — and
 * `POST /verify` still accepts them once they fix what the reason named.
 */
export function ReviewAgencyVerificationDialog({
    agency,
    record,
    open,
    onOpenChange,
    onDone,
    timeZone,
}: {
    agency: AgencyDetail;
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
    async function submit(verdict: string, text: string) {
        try {
            if (verdict === 'verify') {
                await verifyAgency(agency.id);
                notify.success('Agency verified', { description: 'It may now operate.' });
            } else {
                await rejectAgency(agency.id, { reason: text });
                notify.success('Verification rejected', {
                    description:
                        'The agency can see your reason and reapply once they have fixed it.',
                });
            }
            onOpenChange(false);
            onDone();
        } catch (error) {
            if (
                error instanceof ApiError &&
                error.platformCode === PLATFORM_CODE_AGENCY_STATUS_CONFLICT
            ) {
                // `details.currentStatus` is undocumented but always present here,
                // and it is the only thing that distinguishes "a colleague already
                // decided" from "somebody deactivated it while you were reading".
                const current = error.details?.currentStatus;
                notify.warning('This agency is no longer pending verification', {
                    description:
                        typeof current === 'string'
                            ? `It is now "${current}". Another administrator changed it while this was open — reloading what it says now.`
                            : 'Another administrator changed it while this was open. Reloading what it says now.',
                });
                onOpenChange(false);
                onDone();
                return;
            }
            throw error;
        }
    }

    return (
        <VerificationReviewDialog
            open={open}
            onOpenChange={onOpenChange}
            party="agency"
            subjectName={agencyDisplayName(agency)}
            title={`Review verification for ${agencyDisplayName(agency)}`}
            description="Check what the agency supplied, then record a verdict. Verifying is the exit from pending verification; rejecting records a refusal and changes no status."
            record={record}
            current={{
                /*
                  ⚠ `kyc.status`, never derived from `agency.status`. wi-admin has
                  forwarded the verdict since Phase 6 Step 4 and this dashboard was
                  reading around it, because `agencies.md`'s worked JSON omits the
                  field — see `AgencyKyc`. Deriving it is wrong in the case that
                  matters: `pending_verification` is where an agency sits **both
                  before a review and after a refused one**, so a re-applying
                  agency read as one nobody had looked at.

                  `rejectionReason` is the sentence the agency was given, which is
                  the whole of the useful question here — did they fix what they
                  were told about.
                */
                status: agency.kyc.status,
                reason: agency.kyc.rejectionReason,
                decidedAt: agency.kyc.verifiedAt,
                /*
                  ⚠ `verifiedBy` is present only once verified, and is deliberately
                  NOT widened upstream to carry a rejecter: the field's name is a
                  claim. Who refused an application is the `agencies.reject` audit
                  row.
                */
                decidedBy: agency.kyc.verifiedBy,
            }}
            options={VERDICTS}
            onSubmit={submit}
            timeZone={timeZone}
        >
            <AgencyRecordContext agency={agency} />
        </VerificationReviewDialog>
    );
}

const VERDICTS: VerdictOption[] = [
    {
        value: 'verify',
        label: 'Verify agency',
        description:
            'Approves the business verification and moves the agency out of pending verification. There is no un-verify afterwards — deactivating is the lever with teeth, and it is a separate action.',
        textMode: 'none',
        estimates: 'approve',
    },
    {
        value: 'reject',
        label: 'Reject verification',
        description:
            'Records a refusal and shows the agency your reason. It does not deactivate them and nothing cascades — they stay pending verification and can reapply.',
        textMode: 'required-reason',
        textLabel: 'Reason',
        textHint: 'Forwarded to jovi-mall and stored on the agency, so the applicant reads it — unlike the deactivation reason, which stays in the audit trail. Name what is wrong and what would fix it.',
        textPlaceholder: 'Transport licence has expired — upload a current one and reapply.',
        estimates: 'reject',
    },
];

/**
 * What the record already carries.
 *
 * ⚠ **Two reference strings are the whole of the agency's verification data
 * today**, and neither can be checked from here: `registrationNumber` and
 * `transportLicenseId` are numbers a person typed, with no document behind
 * them and no registry this dashboard can query. They are shown because they
 * are what an operator has been deciding on, not because they settle anything.
 */
function AgencyRecordContext({ agency }: { agency: AgencyDetail }) {
    return (
        <section className="space-y-2" aria-label="What the record carries">
            <h3 className="text-sm font-medium">What the record already carries</h3>

            <DefinitionList className="rounded-lg border p-3 text-xs sm:grid-cols-[10rem_1fr]">
                <Definition label="Business name">{agency.businessName ?? <NotSet />}</Definition>
                <Definition label="Contact person">{agency.contactName ?? <NotSet />}</Definition>
                <Definition label="Registration number">
                    {agency.kyc.registrationNumber ? (
                        <CopyableValue
                            value={agency.kyc.registrationNumber}
                            variant="plain"
                            label="registration number"
                        />
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Transport licence">
                    {agency.kyc.transportLicenseId ? (
                        <CopyableValue
                            value={agency.kyc.transportLicenseId}
                            variant="plain"
                            label="transport licence id"
                        />
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Email">
                    {agency.email ? (
                        <span className="flex flex-wrap items-center gap-2">
                            <CopyableValue value={agency.email} variant="email" label="email" />
                            <VerifiedFlag verified={agency.emailVerified} />
                        </span>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Phone">
                    {agency.phone ? (
                        <span className="flex flex-wrap items-center gap-2">
                            <CopyableValue value={agency.phone} variant="phone" label="phone" />
                            <VerifiedFlag verified={agency.phoneVerified} />
                        </span>
                    ) : (
                        <NotSet />
                    )}
                </Definition>
                <Definition label="Coverage">
                    {agency.coverageAreas.length > 0 ? (
                        agency.coverageAreas.join(', ')
                    ) : (
                        <NotSet>None declared</NotSet>
                    )}
                </Definition>
                <Definition label="Onboarding">
                    {agency.onboardingComplete ? 'Complete' : 'Incomplete'}
                </Definition>
            </DefinitionList>

            <p className="text-muted-foreground text-xs leading-relaxed">
                The registration number and the transport licence are strings the agency typed.
                Nothing on this service holds a document behind either, and no registry is queried
                — so they identify a claim rather than corroborate one.
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
