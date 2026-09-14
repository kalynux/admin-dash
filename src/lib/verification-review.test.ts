import { describe, expect, it } from 'vitest';

import {
    buildAgencyChecks,
    buildAgentChecks,
    buildChecks,
    buildVendorChecks,
    draftApprovalNote,
    draftRejectionReason,
    draftVerdictText,
    estimateVerdict,
    preselectedVerdict,
} from '@/lib/verification-review';
import {
    agentVerificationFixture,
    draftVerificationFixture,
    geocodedAddressFixture,
    noPremisesVerificationFixture,
    typedAddressFixture,
    vendorVerificationFixture,
    verificationDocumentsFixture,
} from '@/test/verification-fixtures';
import { VERDICT_REASON_MAX, type VerdictOption } from '@/types/verification.types';

function stateOf(checks: ReturnType<typeof buildVendorChecks>, key: string) {
    const check = checks.find((candidate) => candidate.key === key);
    if (!check) throw new Error(`no check keyed ${key}`);
    return { state: check.state, requirement: check.requirement };
}

describe('what the checklist reports with no record', () => {
    /**
     * `null` is "this screen could not read it" — not loaded, refused, or the
     * request failed. It must never render as "the applicant did not send it":
     * the second is a refusal, and the reason drafted from it is forwarded to the
     * applicant under the operator's name.
     */
    it('marks every row unavailable, not missing', () => {
        for (const party of ['vendor', 'agency', 'agent'] as const) {
            const checks = buildChecks(party, null);
            expect(checks.length).toBeGreaterThan(0);
            expect(checks.every((check) => check.state === 'unavailable')).toBe(true);
            expect(checks.some((check) => check.state === 'missing')).toBe(false);
        }
    });

    it('refuses to estimate a verdict from rows it could not read', () => {
        const estimate = estimateVerdict(buildVendorChecks(null), null);

        expect(estimate.level).toBe('indeterminate');
        expect(estimate.missing).toHaveLength(0);
        expect(estimate.unavailable.length).toBeGreaterThan(0);
    });

    /** A dialog that opens on a suggestion it cannot support has already decided. */
    it('preselects no verdict on an indeterminate estimate', () => {
        const estimate = estimateVerdict(buildVendorChecks(null), null);
        expect(preselectedVerdict(estimate, OPTIONS)).toBeNull();
    });

    it('drafts no rejection reason it cannot substantiate', () => {
        const estimate = estimateVerdict(buildVendorChecks(null), null);
        expect(draftRejectionReason(estimate)).toBe('');
    });
});

describe('a draft is not a queue item', () => {
    /**
     * 🔴 The trap `verification.md` spends a callout on: `status: "pending"` is
     * also the schema default on a vendor and an agency, so it means *"never
     * touched verification"* as well as *"waiting for you"*. `submittedAt` is the
     * field that separates them — *"Filter your review queue on
     * `submittedAt !== null`, never on `status` alone."*
     */
    it('declines to grade a record the applicant has not submitted', () => {
        const record = draftVerificationFixture({
            documents: verificationDocumentsFixture({ selfieWithId: null, idCardBack: null }),
        });
        const estimate = estimateVerdict(buildVendorChecks(record), record);

        expect(record.status).toBe('pending');
        expect(estimate.level).toBe('indeterminate');
        expect(estimate.summary).toMatch(/draft/i);
    });

    /** The same contents, once submitted, are a finding. */
    it('grades the identical record once it has been submitted', () => {
        const documents = verificationDocumentsFixture({ selfieWithId: null, idCardBack: null });
        const submitted = vendorVerificationFixture({ documents });
        const estimate = estimateVerdict(buildVendorChecks(submitted), submitted);

        expect(estimate.level).toBe('reject');
        expect(estimate.missing.map((check) => check.key).sort()).toEqual([
            'id-card-back',
            'selfie-with-id',
        ]);
    });
});

describe('the conditional address requirements', () => {
    /**
     * Exactly one of the two address sets is ever required. Requiring both would
     * refuse every shopkeeper for withholding a home address nobody needs.
     */
    it('asks a party with premises for the store sketch and not for a home address', () => {
        const checks = buildVendorChecks(vendorVerificationFixture());

        expect(stateOf(checks, 'premises-sketch')).toEqual({
            requirement: 'required',
            state: 'provided',
        });
        expect(stateOf(checks, 'premises-geo').requirement).toBe('optional');
        expect(stateOf(checks, 'home-geo').state).toBe('not_applicable');
        expect(stateOf(checks, 'home-sketch').state).toBe('not_applicable');
    });

    it('asks a party with no premises for the home address and not for the store', () => {
        const checks = buildVendorChecks(noPremisesVerificationFixture());

        expect(stateOf(checks, 'home-geo')).toEqual({
            requirement: 'required',
            state: 'provided',
        });
        expect(stateOf(checks, 'home-sketch').requirement).toBe('required');
        expect(stateOf(checks, 'premises-geo').state).toBe('not_applicable');
        expect(stateOf(checks, 'premises-sketch').state).toBe('not_applicable');
    });

    /** The magazin is the agency's premises; the switch is the same one. */
    it('applies the same switch to an agency, naming the magazin', () => {
        const checks = buildAgencyChecks(vendorVerificationFixture({ role: 'agency' }));

        expect(checks.find((check) => check.key === 'premises-geo')?.label).toMatch(/magazin/i);
        expect(stateOf(checks, 'home-geo').state).toBe('not_applicable');
    });

    /**
     * ⚠ **An agent's `storeAddresses` key is ABSENT, not `[]`**, and the agent
     * checklist has no premises rows at all — so the home address is
     * unconditional rather than conditional on an empty array.
     */
    it('requires an agent home address with no condition on it', () => {
        const record = agentVerificationFixture();

        expect(record.storeAddresses).toBeUndefined();
        const checks = buildAgentChecks(record);
        expect(stateOf(checks, 'home-geo').requirement).toBe('required');
        expect(checks.some((check) => check.key.startsWith('premises-'))).toBe(false);
    });
});

describe('what counts as a valid address', () => {
    /**
     * ⚠ **Reads `geocoded`, never `coordinates !== null`.** The check is *"does
     * this resolve to a place"*, not *"did they give an address"* — text that was
     * never run through a geocoder answers no, and passing it would let an
     * unverifiable address read as a verified one.
     */
    it('treats a typed-in address as missing, and says which it is', () => {
        const record = noPremisesVerificationFixture({
            homeAddress: typedAddressFixture({ label: 'Home' }),
        });
        const check = buildVendorChecks(record).find((c) => c.key === 'home-geo');

        expect(check?.state).toBe('missing');
        expect(check?.detail).toMatch(/never geocoded/i);
        expect(check?.detail).toContain('12 Rue de la Joie');
    });

    it('distinguishes "no address at all" from "an address that does not resolve"', () => {
        const record = noPremisesVerificationFixture({ homeAddress: null });
        const check = buildVendorChecks(record).find((c) => c.key === 'home-geo');

        expect(check?.detail).toMatch(/no home address is recorded/i);
    });

    /** `storeAddresses` is a list, and one geocoded depot satisfies the row. */
    it('passes a store row when at least one address resolves, and says how many', () => {
        const record = vendorVerificationFixture({
            storeAddresses: [geocodedAddressFixture({ label: 'Main Shop' }), typedAddressFixture()],
        });
        const check = buildVendorChecks(record).find((c) => c.key === 'premises-geo');

        expect(check?.state).toBe('provided');
        expect(check?.detail).toMatch(/1 of 2 resolve to a place/i);
    });
});

describe('the estimate', () => {
    it('suggests approval when every required row is on file', () => {
        const record = vendorVerificationFixture();
        const estimate = estimateVerdict(buildVendorChecks(record), record);

        expect(estimate.level).toBe('approve');
        expect(estimate.requiredSatisfied).toBe(estimate.requiredTotal);
        expect(estimate.summary).toMatch(/completeness is not authenticity/i);
    });

    it('suggests rejection and names what is absent', () => {
        const record = vendorVerificationFixture({
            idNumber: null,
            documents: verificationDocumentsFixture({ selfieWithId: null }),
        });
        const estimate = estimateVerdict(buildVendorChecks(record), record);

        expect(estimate.level).toBe('reject');
        expect(estimate.missing.map((check) => check.key).sort()).toEqual([
            'id-number',
            'selfie-with-id',
        ]);
    });

    /** An optional row is information, never a verdict. */
    it('does not let a missing optional row change the verdict', () => {
        const record = agentVerificationFixture({ plateNumber: null });
        const estimate = estimateVerdict(buildAgentChecks(record), record);

        expect(estimate.level).toBe('approve');
        expect(estimate.optionalMissing.map((check) => check.key)).toEqual(['plate-number']);
        expect(estimate.summary).toMatch(/does not block approval/i);
    });

    /**
     * ⚠ **Anything unread outranks everything read.** An applicant who supplied
     * six of seven documents and a seventh this screen could not load is a review
     * that cannot be completed, not a rejection.
     */
    it('prefers indeterminate over reject when a row is both missing and unreadable', () => {
        const record = vendorVerificationFixture({
            documents: verificationDocumentsFixture({ selfieWithId: null }),
        });
        const readable = buildVendorChecks(record);
        const mixed = readable.map((check) =>
            check.key === 'id-number' ? { ...check, state: 'unavailable' as const } : check,
        );

        expect(estimateVerdict(readable, record).level).toBe('reject');
        expect(estimateVerdict(mixed, record).level).toBe('indeterminate');
    });

    /**
     * A row nobody was asked for cannot be the reason nobody is verified.
     *
     * ⚠ **The two totals are deliberately NOT equal, and the asymmetry is the
     * contract's.** With premises: four identity rows plus the store sketch — the
     * store *geocode* is optional. Without: the same four plus **both** home
     * rows, because the home geocode is required. Levelling them would mean
     * either demanding a geocode of every shopkeeper or accepting an ungeocoded
     * home address, and each is a different policy from the published one.
     */
    it('counts only the rows this role was actually asked for', () => {
        const withPremises = vendorVerificationFixture();
        const withHome = noPremisesVerificationFixture();

        expect(estimateVerdict(buildVendorChecks(withPremises), withPremises).requiredTotal).toBe(5);
        expect(estimateVerdict(buildVendorChecks(withHome), withHome).requiredTotal).toBe(6);
        expect(buildVendorChecks(withPremises)).toHaveLength(8);
    });
});

describe('the drafted text', () => {
    it('names the missing rows in words the applicant can act on', () => {
        const record = agentVerificationFixture({
            documents: verificationDocumentsFixture({
                idCardBack: null,
                vehicleWithAgent: null,
                storeAddressSketches: [],
            }),
        });
        const reason = draftRejectionReason(estimateVerdict(buildAgentChecks(record), record));

        expect(reason).toMatch(/BACK of your ID card/);
        expect(reason).toMatch(/submit again/i);
        // Not the operator's column heading — the applicant reads this one.
        expect(reason).not.toContain('id-card-back');
    });

    /**
     * `reason` is 3–500 trimmed on all three write routes, so a draft over it is
     * a `400` the operator would have to diagnose from a field error on text they
     * did not write.
     */
    it('stays inside the contract bounds when everything is missing', () => {
        const empty = {
            idNumber: null,
            plateNumber: null,
            homeAddress: null,
            storeAddresses: [],
            documents: verificationDocumentsFixture({
                idCardFront: null,
                idCardBack: null,
                selfieWithId: null,
                vehicleWithAgent: null,
                homeAddressSketches: [],
                storeAddressSketches: [],
            }),
        };

        for (const party of ['vendor', 'agency', 'agent'] as const) {
            const record = vendorVerificationFixture({ role: party, ...empty });
            const reason = draftRejectionReason(estimateVerdict(buildChecks(party, record), record));
            expect(reason.length).toBeLessThanOrEqual(VERDICT_REASON_MAX);
            expect(reason.length).toBeGreaterThan(3);
        }
    });

    it('drafts an internal note that says what was checked, not what was decided', () => {
        const record = vendorVerificationFixture();
        const note = draftApprovalNote(estimateVerdict(buildVendorChecks(record), record));

        expect(note).toMatch(/^Checked: all 5 required items are on file/);
    });

    /** Approving a short document set is legitimate; the note records that it was short. */
    it('records the shortfall when an incomplete set is approved anyway', () => {
        const record = vendorVerificationFixture({ idNumber: null });
        const note = draftApprovalNote(estimateVerdict(buildVendorChecks(record), record));

        expect(note).toMatch(/despite an incomplete document set/i);
        expect(note).toContain('ID number');
    });

    it('drafts nothing for a verdict that takes no text', () => {
        const record = vendorVerificationFixture({ role: 'agency' });
        const estimate = estimateVerdict(buildAgencyChecks(record), record);
        const verify = OPTIONS.find((option) => option.value === 'verify');
        expect(draftVerdictText(estimate, verify!)).toBe('');
    });
});

const OPTIONS: VerdictOption[] = [
    {
        value: 'approve',
        label: 'Approve',
        description: '',
        textMode: 'optional-note',
        estimates: 'approve',
    },
    {
        value: 'reject',
        label: 'Reject',
        description: '',
        textMode: 'required-reason',
        estimates: 'reject',
    },
    { value: 'verify', label: 'Verify', description: '', textMode: 'none', estimates: 'approve' },
];
