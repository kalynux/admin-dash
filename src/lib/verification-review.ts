/**
 * The verification checklist, the verdict estimate, and the drafted reason.
 *
 * **Pure.** No React, no network, no clock — `(record) => rows`,
 * `(rows) => estimate`, `(estimate) => text`. That is deliberate: this is the
 * half of the review flow worth testing, and it is the half the backend
 * explicitly refused to own.
 *
 * ── 🔴 Why this lives here and not in jovi-mall ──────────────────────────────
 * [`verification.md`](../../api-doc/admin/api/verification.md) devotes a section
 * to it: *"There is no `estimatedVerdict` field. No `complete`. No `required`
 * column. Not on any role, not under any query parameter. The response is
 * **facts**; the badge is **yours**."* The reasoning is that required/optional
 * is a **review policy** — it changes when the reviewers change their minds, and
 * the people who change their minds own this dashboard. Encoding it in both
 * repositories would be one rule in two places that cannot both be edited by the
 * same person, *"and the failure mode is silent, because the two only disagree
 * later"*. `jovi-mall test:kyc` § 4 fails if a completeness check appears there.
 *
 * **So the tables below are the contract's own `## The checklist, per role`
 * tables, transcribed.** When the reviewing rule changes, it changes here.
 *
 * ── ⚠ Four states, and only one of them is the applicant's fault ─────────────
 * `missing` refuses, `unavailable` refuses to *estimate*, `not_applicable` is
 * silent. The middle one is why this is its own module with its own tests: a
 * checklist that rendered "not supplied" for a record it merely failed to load
 * would manufacture a rejection, and the reason drafted from it is forwarded to
 * the applicant and stored on their record under the operator's name.
 */

import type {
    CheckRequirement,
    EvidenceState,
    PartyVerification,
    VerdictEstimate,
    VerdictOption,
    VerificationAddress,
    VerificationCheck,
    VerificationParty,
} from '@/types/verification.types';
import { VERDICT_REASON_MAX } from '@/types/verification.types';
import type { FileDetail } from '@/types/files.types';

// ─── Row helpers ──────────────────────────────────────────────────────────────

/**
 * `null` is the sentinel for *"this screen has no record"* — not loaded, refused,
 * or the read failed. Every row then reports `unavailable` and the estimate
 * declines to guess.
 */
type Record_ = PartyVerification | null;

function fileState(record: Record_, file: FileDetail | null | undefined): EvidenceState {
    if (!record) return 'unavailable';
    return file ? 'provided' : 'missing';
}

function filesState(record: Record_, files: FileDetail[] | undefined): EvidenceState {
    if (!record) return 'unavailable';
    return files && files.length > 0 ? 'provided' : 'missing';
}

function textState(record: Record_, value: string | null | undefined): EvidenceState {
    if (!record) return 'unavailable';
    return value && value.trim().length > 0 ? 'provided' : 'missing';
}

/**
 * The state of "is this address valid".
 *
 * ⚠ **Reads `geocoded`, never `coordinates !== null`.** The flag is what the
 * service computes; re-deriving it would be a second definition that can drift
 * from the first. An address that exists only as typed text is `missing` here,
 * and the detail says which — the check is *"does this resolve to a place"*, not
 * *"did they give an address"*, and rendering the two alike would pass an
 * unverifiable address as a verified one.
 */
function addressState(record: Record_, addresses: VerificationAddress[]): EvidenceState {
    if (!record) return 'unavailable';
    if (addresses.length === 0) return 'missing';
    return addresses.some((address) => address.geocoded) ? 'provided' : 'missing';
}

function addressDetail(addresses: VerificationAddress[], noun: string): string {
    if (addresses.length === 0) return `No ${noun} is recorded.`;

    const geocoded = addresses.filter((address) => address.geocoded);
    if (geocoded.length === addresses.length) {
        return addresses.length === 1
            ? (geocoded[0]?.formattedAddress ?? 'Geocoded.')
            : `All ${addresses.length} resolve to a place.`;
    }
    if (geocoded.length === 0) {
        const typed = addresses[0]?.formattedAddress;
        return typed
            ? `Recorded as free text and never geocoded — "${typed}". It does not resolve to a point on a map.`
            : `Recorded, but never geocoded — it does not resolve to a point on a map.`;
    }
    return `${geocoded.length} of ${addresses.length} resolve to a place; the rest were typed and never geocoded.`;
}

/** One address as a list, so the four address rows share a shape. */
function asList(address: VerificationAddress | null | undefined): VerificationAddress[] {
    return address ? [address] : [];
}

// ─── The identity block — identical for all three roles ──────────────────────

/**
 * Four rows, required of every role.
 *
 * Nothing here varies by party, and that is not a coincidence: a vendor, an
 * agency contact and an agent are all one natural person holding one national ID
 * card, and the platform's whole claim about any of them is that the person
 * behind the account is who the card says.
 */
function identityChecks(record: Record_): VerificationCheck[] {
    const documents = record?.documents;

    return [
        {
            key: 'id-card-front',
            label: 'ID card — front',
            applicantLabel: 'a clear scan or photograph of the FRONT of your ID card',
            requirement: 'required',
            state: fileState(record, documents?.idCardFront),
            kind: 'file',
            file: documents?.idCardFront ?? null,
        },
        {
            key: 'id-card-back',
            label: 'ID card — back',
            applicantLabel: 'a clear scan or photograph of the BACK of your ID card',
            requirement: 'required',
            state: fileState(record, documents?.idCardBack),
            kind: 'file',
            file: documents?.idCardBack ?? null,
            detail: 'Both faces are asked for separately — the number is on one and the issuing detail on the other.',
        },
        {
            key: 'id-number',
            label: 'ID number',
            applicantLabel: 'the ID number, typed in, exactly as printed on the card',
            requirement: 'required',
            state: textState(record, record?.idNumber),
            kind: 'text',
            text: record?.idNumber ?? null,
            detail: 'Check it against the number visible on the scan above. They must agree.',
        },
        {
            key: 'selfie-with-id',
            label: 'Selfie holding the ID card',
            applicantLabel:
                'a photograph of yourself holding your ID card, with your face and the card both readable',
            requirement: 'required',
            state: fileState(record, documents?.selfieWithId),
            kind: 'file',
            file: documents?.selfieWithId ?? null,
            detail: 'This is the row that ties the document to the person. A scan on its own only proves somebody holds a copy of somebody’s card.',
        },
    ];
}

// ─── The address block — vendor and agency ────────────────────────────────────

/**
 * Four rows whose requirements switch on whether the applicant has premises.
 *
 * | Row | Has premises | No premises |
 * |---|---|---|
 * | premises geocoded | optional | n/a |
 * | premises sketch | **required** | n/a |
 * | home geocoded | n/a | **required** |
 * | home sketch | n/a | **required** |
 *
 * ⚠ **Exactly one of the two address sets is ever required**, which is the
 * contract's rule and also the only fair one: a party trading from premises has
 * told us where to find them, and a party who does not is asked where they live
 * instead. Requiring both would refuse every shopkeeper for withholding a home
 * address nobody needs — and *"an agency legitimately has no premises of its
 * own: it may work only for vendors who have their own physical store."*
 *
 * ⚠ **"Has premises" is `storeAddresses.length > 0`** and there is no flag for
 * it, so this is a derivation rather than a reading. It is the contract's own —
 * the rule is written *"required only if a store address is set up"*.
 */
function premisesChecks(
    record: Record_,
    labels: { premises: string; premisesLower: string },
): VerificationCheck[] {
    const store = record?.storeAddresses ?? [];
    const home = asList(record?.homeAddress);
    const hasPremises = record ? store.length > 0 : undefined;

    /** `not_applicable` wins over evidence: with no premises there is no sketch to be missing. */
    const premisesRow = (state: EvidenceState): EvidenceState =>
        hasPremises === false ? 'not_applicable' : state;
    const homeRow = (state: EvidenceState): EvidenceState =>
        hasPremises === true ? 'not_applicable' : state;

    const premisesRequirement = (when: CheckRequirement): CheckRequirement =>
        hasPremises === false ? 'optional' : when;
    const homeRequirement = (when: CheckRequirement): CheckRequirement =>
        hasPremises === true ? 'optional' : when;

    return [
        {
            key: 'premises-geo',
            label: `${labels.premises} address is geocoded`,
            applicantLabel: `a geocoded address for your ${labels.premisesLower} — pick it from the address search rather than typing it`,
            requirement: premisesRequirement('optional'),
            state: premisesRow(addressState(record, store)),
            condition: `Optional. Checked only where a ${labels.premisesLower} address is set up.`,
            detail: addressDetail(store, `${labels.premisesLower} address`),
            kind: 'address',
            addresses: store,
        },
        {
            key: 'premises-sketch',
            label: `Hand-drawn sketch of the ${labels.premisesLower} location`,
            applicantLabel: `a hand-drawn sketch showing how to reach your ${labels.premisesLower}`,
            requirement: premisesRequirement('required'),
            state: premisesRow(filesState(record, record?.documents.storeAddressSketches)),
            condition: `Required once a ${labels.premisesLower} address is set up.`,
            kind: 'files',
            files: record?.documents.storeAddressSketches ?? [],
        },
        {
            key: 'home-geo',
            label: 'Home address is geocoded',
            applicantLabel:
                'a geocoded home address — pick it from the address search rather than typing it',
            requirement: homeRequirement('required'),
            state: homeRow(addressState(record, home)),
            condition: `Required only when there is no ${labels.premisesLower}.`,
            detail: addressDetail(home, 'home address'),
            kind: 'address',
            addresses: home,
        },
        {
            key: 'home-sketch',
            label: 'Hand-drawn sketch of the home location',
            applicantLabel: 'a hand-drawn sketch showing how to reach your home',
            requirement: homeRequirement('required'),
            state: homeRow(filesState(record, record?.documents.homeAddressSketches)),
            condition: `Required only when there is no ${labels.premisesLower}.`,
            kind: 'files',
            files: record?.documents.homeAddressSketches ?? [],
        },
    ];
}

// ─── The three checklists ─────────────────────────────────────────────────────

/**
 * A vendor. Row order follows `verification.md`'s own table, which is the order
 * an operator reads them off rather than a grouping by kind.
 */
export function buildVendorChecks(record: Record_): VerificationCheck[] {
    const [premisesGeo, premisesSketch, homeGeo, homeSketch] = premisesChecks(record, {
        premises: 'Store',
        premisesLower: 'store',
    });

    return [premisesGeo, homeGeo, ...identityChecks(record), homeSketch, premisesSketch];
}

/** An agency — the same shape, with the magazin in place of the shop. */
export function buildAgencyChecks(record: Record_): VerificationCheck[] {
    const [premisesGeo, premisesSketch, homeGeo, homeSketch] = premisesChecks(record, {
        premises: 'Magazin / store',
        premisesLower: 'magazin',
    });

    return [premisesGeo, homeGeo, ...identityChecks(record), homeSketch, premisesSketch];
}

/**
 * An agent: no premises at all, so the home address is unconditionally required,
 * and the vehicle is what a delivery identity turns on.
 *
 * ⚠ **`plateNumber` is optional and the vehicle photograph is not**, which reads
 * backwards until you notice which one can be checked. A plate is a string an
 * agent types; a photograph of the agent standing beside the vehicle is
 * evidence. A bike in much of the delivery area carries no plate at all, so
 * requiring one would refuse the commonest vehicle on the platform.
 */
export function buildAgentChecks(record: Record_): VerificationCheck[] {
    const home = asList(record?.homeAddress);

    return [
        {
            key: 'home-geo',
            label: 'Home address is geocoded',
            applicantLabel:
                'a geocoded home address — pick it from the address search rather than typing it',
            requirement: 'required',
            state: addressState(record, home),
            detail: addressDetail(home, 'home address'),
            kind: 'address',
            addresses: home,
        },
        {
            key: 'home-sketch',
            label: 'Hand-drawn sketch of the home location',
            applicantLabel: 'a hand-drawn sketch showing how to reach your home',
            requirement: 'required',
            state: filesState(record, record?.documents.homeAddressSketches),
            kind: 'files',
            files: record?.documents.homeAddressSketches ?? [],
        },
        {
            key: 'plate-number',
            label: 'Plate number',
            applicantLabel: 'the vehicle’s plate number',
            requirement: 'optional',
            state: textState(record, record?.plateNumber),
            condition: 'Optional — a bike often carries no plate.',
            kind: 'text',
            text: record?.plateNumber ?? null,
        },
        {
            key: 'vehicle-with-agent',
            label: 'Vehicle photograph, with the agent beside it',
            applicantLabel: 'a photograph of your vehicle with you standing beside it',
            requirement: 'required',
            state: fileState(record, record?.documents.vehicleWithAgent),
            detail: 'The agent has to be in the frame. This is not the public vehicle photo on the directory — two pictures, two questions.',
            kind: 'file',
            file: record?.documents.vehicleWithAgent ?? null,
        },
        ...identityChecks(record),
    ];
}

/**
 * The builder for one party.
 *
 * ⚠ Takes the party explicitly rather than reading `record.role`, so a screen
 * renders the right checklist **before** the read resolves. The two agree once
 * it has.
 */
export function buildChecks(party: VerificationParty, record: Record_): VerificationCheck[] {
    if (party === 'vendor') return buildVendorChecks(record);
    if (party === 'agency') return buildAgencyChecks(record);
    return buildAgentChecks(record);
}

// ─── The estimate ─────────────────────────────────────────────────────────────

function countable(check: VerificationCheck): boolean {
    return check.requirement === 'required' && check.state !== 'not_applicable';
}

/**
 * Presence in, suggested verdict out.
 *
 * The precedence is `indeterminate` → `reject` → `approve`, in that order for
 * one reason: **anything unread outranks everything read.** An applicant who
 * supplied six of seven documents and a seventh this screen could not load is
 * not a rejection; they are a review that cannot be completed yet. Ordering it
 * the other way lets a failed request produce a refusal whose reason names a
 * document the applicant had actually sent.
 *
 * ⚠ **A draft is `indeterminate` whatever its contents.** `submittedAt === null`
 * means the applicant has not asked anybody to look — `verification.md`: *"Keep
 * it out of the queue."* Badging a half-filled draft *evidence incomplete* is
 * true and is not a finding, and it invites a rejection for not having finished
 * something nobody was asked to review.
 */
export function estimateVerdict(
    checks: VerificationCheck[],
    record?: Record_,
): VerdictEstimate {
    const required = checks.filter(countable);
    const requiredTotal = required.length;
    const requiredSatisfied = required.filter((check) => check.state === 'provided').length;

    const missing = required.filter((check) => check.state === 'missing');
    const unreadable = checks.filter((check) => check.state === 'unavailable');
    const optionalMissing = checks.filter(
        (check) => check.requirement === 'optional' && check.state === 'missing',
    );

    const base = { requiredTotal, requiredSatisfied, missing, unavailable: unreadable, optionalMissing };

    if (unreadable.length > 0) {
        return {
            ...base,
            level: 'indeterminate',
            summary:
                'No verdict is estimated: the verification record could not be read, so nothing here says whether the applicant supplied anything.',
        };
    }

    if (record && record.submittedAt === null) {
        return {
            ...base,
            level: 'indeterminate',
            summary:
                'This is a draft — the applicant has not submitted it, and nobody has asked you to look. Whatever is missing is not yet a finding.',
        };
    }

    if (missing.length > 0) {
        return {
            ...base,
            level: 'reject',
            summary: `${missing.length} of ${requiredTotal} required items ${missing.length === 1 ? 'is' : 'are'} not on file.`,
        };
    }

    return {
        ...base,
        level: 'approve',
        summary:
            optionalMissing.length > 0
                ? `All ${requiredTotal} required items are on file. ${optionalMissing.length} optional ${optionalMissing.length === 1 ? 'item is' : 'items are'} not, which does not block approval. Completeness is not authenticity — the documents still have to be read.`
                : `All ${requiredTotal} required items are on file. Completeness is not authenticity — the documents still have to be read.`,
    };
}

// ─── The drafted text ─────────────────────────────────────────────────────────

function applicantName(check: VerificationCheck): string {
    return check.applicantLabel ?? check.label;
}

/**
 * Join a list so it reads as a sentence, dropping whole items rather than
 * cutting one in half if the result would not fit.
 *
 * ⚠ **The ceiling is the contract's, not a style choice.** `reason` is 3–500
 * trimmed on all three write routes, so a draft over it is a `400` the operator
 * would have to diagnose from a field error on text they did not write.
 */
function fitList(items: string[], prefix: string, suffix: string): string {
    const budget = VERDICT_REASON_MAX - prefix.length - suffix.length;

    const kept: string[] = [];
    let length = 0;
    for (const item of items) {
        // `+ 2` for the ", " that will join it to the previous entry.
        const cost = item.length + (kept.length > 0 ? 2 : 0);
        if (length + cost > budget) break;
        kept.push(item);
        length += cost;
    }

    if (kept.length === 0) {
        return `${prefix}${items[0]?.slice(0, Math.max(budget, 0)) ?? ''}${suffix}`;
    }
    if (kept.length < items.length) {
        return `${prefix}${kept.join(', ')}, and ${items.length - kept.length} more${suffix}`;
    }
    return `${prefix}${kept.join(', ')}${suffix}`;
}

/**
 * The reason the **applicant** reads, drafted from what is missing.
 *
 * `''` when there is nothing to say — an `approve` estimate, or an
 * `indeterminate` one. ⚠ **Drafting a refusal the screen cannot substantiate is
 * worse than drafting none**: the text is forwarded to jovi-mall and stored on
 * the applicant's record, so a plausible sentence assembled out of rows that
 * failed to load would tell a vendor to re-upload documents they already sent,
 * signed with the operator's name.
 */
export function draftRejectionReason(estimate: VerdictEstimate): string {
    if (estimate.level !== 'reject' || estimate.missing.length === 0) return '';

    return fitList(
        estimate.missing.map(applicantName),
        'We could not verify your account yet. Still missing: ',
        '. Please add these to your profile and submit again.',
    );
}

/**
 * The internal note on an approval. Optional wherever it exists and **never
 * shown to the applicant** — so it is written for the next administrator reading
 * the trail, and says what was checked rather than congratulating anybody.
 */
export function draftApprovalNote(estimate: VerdictEstimate): string {
    if (estimate.level === 'indeterminate') {
        return 'Approved without the document set on screen — the verification record was not readable here, so nothing on it was checked.';
    }

    if (estimate.level === 'reject') {
        return fitList(
            estimate.missing.map((check) => check.label),
            'Approved despite an incomplete document set. Not on file: ',
            '.',
        );
    }

    const optional =
        estimate.optionalMissing.length > 0
            ? ` ${estimate.optionalMissing.length} optional item(s) not supplied.`
            : '';

    return `Checked: all ${estimate.requiredTotal} required items are on file.${optional}`.slice(
        0,
        VERDICT_REASON_MAX,
    );
}

/** The draft for whichever verdict is selected, or `''` when it takes no text. */
export function draftVerdictText(estimate: VerdictEstimate, option: VerdictOption): string {
    if (option.textMode === 'none') return '';
    if (option.textMode === 'required-reason') return draftRejectionReason(estimate);
    return draftApprovalNote(estimate);
}

// ─── Picking the verdict to preselect ─────────────────────────────────────────

/**
 * The option the dialog opens on.
 *
 * ⚠ **An `indeterminate` estimate preselects nothing**, and that is the point: a
 * dialog that opens with "Approve" already chosen has made the decision the
 * operator was called in to make, and every click after it is a confirmation of
 * something they were told rather than something they found.
 */
export function preselectedVerdict(
    estimate: VerdictEstimate,
    options: VerdictOption[],
): VerdictOption | null {
    if (estimate.level === 'indeterminate') return null;
    return options.find((option) => option.estimates === estimate.level) ?? null;
}
