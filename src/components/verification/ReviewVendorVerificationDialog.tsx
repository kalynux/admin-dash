import { notify } from '@/lib/notify';
import { PLATFORM_CODE_KYC_STATUS_CONFLICT, approveVendorKyc, rejectVendorKyc } from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import type { PartyVerification, VerdictOption } from '@/types/verification.types';
import { vendorDisplayName, type VendorDetail } from '@/types/vendors.types';

import { VerificationReviewDialog } from './VerificationReviewDialog';

/**
 * The two verification verdicts on `/vendors`, behind one review.
 *
 * ── Why one asks for a reason and the other does not ──────────────────────────
 * `reason` is required on a rejection (3–500) and `note` is optional on an
 * approval, and the asymmetry is the contract's rather than a UI choice: **a
 * rejection the vendor cannot see the cause of is one they can only answer by
 * re-submitting blind.** The reason is stored in jovi-mall rather than only in
 * our audit row for the same reason — jovi-mall cannot read this database, so a
 * reason held only here could never reach the vendor it is about.
 *
 * ── What neither verdict does ─────────────────────────────────────────────────
 * **Verification gates nothing.** It is visible to delivery agencies, and no
 * vendor behaviour depends on it — gating selling on it would have locked out
 * the entire existing roster until each vendor was reviewed, which was an
 * explicit product decision ([ADR-008 D-5](../../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)).
 * Both options say so, because "reject" reads like a stop and is not one.
 *
 * ── Both can lose a race ──────────────────────────────────────────────────────
 * `409 VENDOR_KYC_STATUS_CONFLICT` when the verdict already is the one being
 * asked for. Only the verdicts that would change something are offered, so this
 * fires when two administrators act at once — close and reload rather than
 * showing a form error over a decision that has already been made.
 */
export function ReviewVendorVerificationDialog({
    vendor,
    record,
    open,
    onOpenChange,
    onDecided,
    timeZone,
}: {
    vendor: VendorDetail;
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
    onDecided: () => void;
    timeZone: string;
}) {
    const options = VERDICTS.filter((option) =>
        option.value === 'approve'
            ? vendor.kycStatus !== 'verified'
            : vendor.kycStatus !== 'rejected',
    );

    async function submit(verdict: string, text: string) {
        try {
            if (verdict === 'approve') {
                // The body is strict, so an empty note is omitted rather than
                // sent as `''` — a blank string would be stored as the reviewer's
                // remark.
                await approveVendorKyc(vendor.id, text ? { note: text } : {});
                notify.success('Business verification approved');
            } else {
                await rejectVendorKyc(vendor.id, { reason: text });
                notify.success('Business verification rejected');
            }
            onOpenChange(false);
            onDecided();
        } catch (error) {
            if (error instanceof ApiError && error.platformCode === PLATFORM_CODE_KYC_STATUS_CONFLICT) {
                notify.warning('This verdict has already been recorded', {
                    description: 'Another administrator decided it first. Reloading.',
                });
                onOpenChange(false);
                onDecided();
                return;
            }
            throw error;
        }
    }

    return (
        <VerificationReviewDialog
            open={open}
            onOpenChange={onOpenChange}
            party="vendor"
            subjectName={vendorDisplayName(vendor)}
            title={`Review verification for ${vendorDisplayName(vendor)}`}
            description="Check what the vendor supplied, then record a verdict. Verification changes what delivery agencies see; it does not stop or start anyone trading."
            record={record}
            current={{
                status: vendor.verification.status,
                reason: vendor.verification.rejectionReason,
                decidedAt: vendor.verification.verifiedAt,
                decidedBy: vendor.verification.reviewedBy,
            }}
            options={options}
            onSubmit={submit}
            timeZone={timeZone}
        />
    );
}

const VERDICTS: VerdictOption[] = [
    {
        value: 'approve',
        label: 'Approve verification',
        description:
            'Delivery agencies will see this business as verified. It unlocks nothing for the vendor — an unverified vendor trades normally.',
        textMode: 'optional-note',
        textLabel: 'Note (optional)',
        textHint: 'Kept in the activity trail. The vendor is not shown it.',
        textPlaceholder: 'Anything a later reviewer should know',
        estimates: 'approve',
    },
    {
        value: 'reject',
        label: 'Reject verification',
        description:
            'Records a refusal and shows the vendor your reason, which they can re-submit against. It does not stop them trading — suspend the shop if it needs to stop.',
        textMode: 'required-reason',
        textLabel: 'Reason',
        textHint: 'Stored on the platform and shown to the vendor. Write what they need to change — a rejection they cannot see the cause of is one they can only answer by re-submitting blind.',
        textPlaceholder: 'What was wrong with the documents, and what would fix it',
        destructive: true,
        estimates: 'reject',
    },
];

/**
 * What the record already carries that bears on the decision.
 *
 * ⚠ **None of this is the document set**, and the panel says so rather than
 * letting a full-looking block read as evidence. In particular the addresses:
 * `GET /vendors/:vendorId` projects `label`, two lines, city and state and
 * **drops `geo` entirely**, so an address here cannot be checked against a map
 * however complete it looks. jovi-mall stores the geocode
 * (`business_addresses[].geo`); wi-admin does not forward it. That is the first
 * ask in BR-024.
 */
