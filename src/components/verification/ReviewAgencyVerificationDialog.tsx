import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_AGENCY_VERIFICATION_CONFLICT,
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
 * ── ⚠ NEITHER verdict changes the agency's status any more ───────────────────
 * Rejecting never did; **approving stopped on 2026-09-15**, when jovi-mall split
 * *may this account operate* from *has a human vetted it*. Both writes now touch
 * only `kyc_details`.
 *
 * ⚠ **So do not tell the operator either verdict unblocks or blocks anybody**, and
 * do not lean on the old reasoning that a refused agency is "already refused by
 * product activation, pickup resolution, COD eligibility and vendor
 * default-agency selection" — **three of those four gate on `active`**, and a
 * refused agency that proved its phone *is* `active`. What a refusal actually
 * costs is **cash**: COD eligibility now tests the KYC flag explicitly, and the
 * payout allowance reads the verdict.
 *
 * ✅ **Re-review works**: `POST /verify` accepts a refused agency once they fix
 * what the reason named. That was briefly untrue — see BR-026 § 2, raised here
 * and fixed upstream the same day.
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
                // ⚠ NOT "it may now operate" — that was true only while `verify`
                // also wrote `status`, which jovi-mall stopped doing on 2026-09-15.
                // Whether the agency may operate is its own axis and its own act.
                notify.success('Agency verified', {
                    description: 'The verdict is recorded on the agency file.',
                });
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
                error.platformCode === PLATFORM_CODE_AGENCY_VERIFICATION_CONFLICT
            ) {
                /*
                  ⚠ **`currentVerification`, NOT `currentStatus`** — BR-026 § 3.
                  Both ride along and both are true, but only the verdict decided
                  this refusal. Reporting the status instead told the operator
                  "this agency is active" when the answer was "a colleague already
                  reached a verdict", which sends them looking in the wrong place.

                  The refusal also means something narrower than it used to: since
                  the predicate refuses only a repeat of the *same* verdict, this
                  is "that verdict is already recorded" — never a deactivation, and
                  no longer a re-review, which is the case BR-026 § 2 fixed.
                */
                const current = error.details?.currentVerification;
                notify.warning('This verdict is already recorded', {
                    description:
                        typeof current === 'string'
                            ? `Another administrator already marked this agency "${current}". Reloading what it says now.`
                            : 'Another administrator reached a verdict while this was open. Reloading what it says now.',
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
            /*
              ⚠ Said "Verifying is the exit from pending verification" until the
              2026-09-15 activation change. It no longer is — an agency promotes
              itself on a proved phone, and this dialog only records whether a
              human vetted the business. The sentence now claims nothing about
              `status` in either direction, which is the only phrasing that is
              true both before and after jovi-mall ships that change.
            */
            description="Check what the agency supplied, then record a verdict. Rejecting records a refusal, and the agency is shown the reason you give."
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
        />
    );
}

const VERDICTS: VerdictOption[] = [
    {
        value: 'verify',
        label: 'Verify agency',
        description:
            'Records that a human has vetted this business. It does not decide whether the agency may operate — that is its own axis, and the agency earns it by verifying a phone number. There is no un-verify afterwards; deactivating is the lever with teeth, and it is a separate action.',
        textMode: 'none',
        estimates: 'approve',
    },
    {
        value: 'reject',
        label: 'Reject verification',
        description:
            'Records a refusal and shows the agency your reason. It does not deactivate them and nothing cascades — and they can fix what you name and be verified afterwards.',
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
