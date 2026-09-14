/**
 * `/employees` — the staff employment record. **Built 2026-09-14 (ADR-023).**
 *
 * Source: [`employees.md`](../../api-doc/admin/api/employees.md). Everything the
 * company holds about a member of its own staff: who they are, how to reach
 * them, where they live, where they are paid, and what they are paid.
 *
 * 🔴 **This is not the vendor/agency/agent KYC surface.** That one is
 * [`verification.types.ts`](./verification.types.ts), it is about people applying
 * to *use* the platform, and **it grades nothing on the backend**. This one is
 * about the people *running* it, and it **does** — see {@link EmployeeReadiness}.
 * `employees.md` says outright that reading one page as though it were the other
 * *"will produce a screen that is wrong in both directions"*.
 *
 * ── ⚠ The narrowest surface on the service ───────────────────────────────────
 * **The subject, and a tier-1 Developer. Nobody else, at any tier** — including
 * tier 2, who holds `allInFamily('administrators')` and can suspend accounts and
 * reset passwords, and still cannot open a colleague's file. Being a separate
 * permission family *is* the access control, and a **boot assertion** refuses it
 * to any other rung.
 *
 * ⚠ **One body, not two.** The employee and the Developer reading their file see
 * exactly the same response — every field was typed in *by* the employee about
 * themselves, except `employment`, which the company states *to* them. Do not
 * build a screen expecting a redacted variant for some readers; there is not one.
 *
 * ⚠ **No listing route, at any tier, and no delete.** A listing is how somebody
 * asks *"show me every salary"*; the repository has no query that could build
 * one. And an employment record outlives the employment — departure is
 * `employment.endedOn`, and access is removed by suspending the account.
 */

import type { GeoCandidate } from '@/types/geo.types';

// ─── Personal ─────────────────────────────────────────────────────────────────

/** ⚠ **Full E.164 — a leading `+` and a country code.** `670001122` is refused. */
export interface EmployeePhone {
    /** `personal` · `work` · … open, and `null` is allowed. */
    label: string | null;
    number: string;
}

export interface EmployeeRelative {
    fullName: string;
    /** `father` · `spouse` · … open vocabulary. */
    relationship: string | null;
    phones: EmployeePhone[];
}

// ─── Documents ────────────────────────────────────────────────────────────────

/**
 * The six slots. **A closed contract** — these strings are the `:slot` path
 * segment *and* the keys in `documents[]`.
 */
export const EMPLOYEE_DOCUMENT_SLOTS = [
    'id_card_front',
    'id_card_back',
    'selfie_with_id',
    'home_address_sketch',
    'home_exterior_photo',
    'signed_contract',
] as const;

export type EmployeeDocumentSlot = (typeof EMPLOYEE_DOCUMENT_SLOTS)[number];

/** The three required to activate. ⚠ `signed_contract` is deliberately not one. */
export const EMPLOYEE_REQUIRED_DOCUMENT_SLOTS: readonly EmployeeDocumentSlot[] = [
    'id_card_front',
    'id_card_back',
    'selfie_with_id',
];

/**
 * One slot's contents.
 *
 * ⚠ **`single` REPLACES on re-upload** — there is one front of one identity card,
 * so a second upload means the first was bad, and the displaced file is detached
 * and **soft-deleted immediately** rather than waiting out the unreferenced-file
 * grace period. **`multi` APPENDS**, up to ten; replacing one means deleting it
 * and uploading again.
 *
 * 🔴 **`fileIds` are IDS, never URLs, and there will never be a `url` here.**
 * Every one of these files is in a private storage tree, so a URL for it does not
 * exist. Resolve metadata with `GET /files?ids=` and fetch bytes with
 * `GET /files/:fileId/content`, which is **audited per file and fail-closed**.
 */
export interface EmployeeDocumentSlotState {
    slot: EmployeeDocumentSlot | (string & {});
    cardinality: 'single' | 'multi' | (string & {});
    fileIds: string[];
}

/** What `employees.md` says each slot is, for the screen that asks for it. */
export const EMPLOYEE_DOCUMENT_LABELS: Record<EmployeeDocumentSlot, string> = {
    id_card_front: 'Front of your identity document',
    id_card_back: 'Back of your identity document',
    selfie_with_id: 'A photograph of you holding your identity document',
    home_address_sketch: 'A hand-drawn sketch of how to reach your home',
    home_exterior_photo: 'A photograph of you in front of your house',
    signed_contract: 'Your countersigned employment contract',
};

// ─── Money ────────────────────────────────────────────────────────────────────

/**
 * Where the company sends this person's salary.
 *
 * 🔴 **Masked for EVERYBODY, the subject included.** Payout details are
 * write-mostly by design: *"echoing an account number to anything that can read a
 * profile turns a session hijack into a banking leak, and nobody needs the digits
 * back."* There is no reveal route and none should be asked for.
 *
 * ⚠ **Index `0` is the preferred destination**, and `isPreferred` mirrors it.
 * At most three entries. Only `mobile_money` is open for new configuration
 * today — sending `bank` or `card` is refused with a message naming what is
 * accepted, and card numbers are **refused, not stripped**, because a `200`
 * would let a client conclude the PAN it sent is on file.
 */
export interface EmployeePayoutMethod {
    method: 'mobile_money' | 'bank' | 'card' | (string & {});
    isPreferred: boolean;
    mobileMoney: {
        provider: string | null;
        /** Already masked. There is no unmasked form on any route. */
        phoneNumberMasked: string | null;
        accountName: string | null;
    } | null;
    bank: Record<string, unknown> | null;
    card: Record<string, unknown> | null;
}

// ─── Employment ───────────────────────────────────────────────────────────────

/**
 * What the company states *to* the employee. **They read it and cannot write it.**
 *
 * ⚠ **`monthlySalaryMinor` is in MINOR CURRENCY UNITS** — the platform's
 * convention everywhere. `450000` with `XAF` is 450,000 FCFA, because XAF has no
 * minor unit, so **this is the one money field on the dashboard that is not
 * already the displayable number**. A fractional value is *refused* rather than
 * rounded: *"a payroll figure that does not reconcile is a conversation with a
 * person."*
 */
export interface EmployeeEmployment {
    position: string | null;
    department: string | null;
    /** `permanent` · `contract` · … open. */
    employmentType: string | null;
    staffNumber: string | null;
    startedOn: string | null;
    /** Departure. There is no delete on this surface; this is what ending looks like. */
    endedOn: string | null;
    /** ⚠ Minor units. See this interface's note. */
    monthlySalaryMinor: number | null;
    currency: string | null;
    notes: string | null;
    updatedAt: string | null;
    /** An administrator id, as a bare string. */
    updatedBy: string | null;
}

// ─── Readiness ────────────────────────────────────────────────────────────────

/**
 * One thing still missing before this account can be activated.
 *
 * ⚠ **The codes are a contract and `message` is written for the employee** —
 * *"Upload a photograph of you in front of your home"*. `document_missing:<slot>`
 * is the one composite form.
 */
export interface EmployeeGap {
    code: string;
    /** `security` · `personal` · `identity` · `address` · `contact` · `payout` · `documents`. */
    section: string;
    message: string;
}

/**
 * 🔴 **The backend DOES enforce a required set here, unlike `/verification`, and
 * the difference is deliberate.**
 *
 * `employees.md` gives the reasoning and it is worth keeping: an *applicant* is a
 * member of the public the platform is deciding whether to admit, and refusing
 * their submission for incompleteness denies them the one thing they need — to be
 * told by a human what is missing. An *employee* is somebody about to be handed
 * administrative access, the Developer activating them is a colleague who can say
 * what is missing in a message, and *"the failure being guarded against, somebody
 * waved through on a blank file, is a risk the company carries itself."*
 *
 * ⚠ **The same block is on the SUBJECT's own read**, computed once — so the
 * button the Developer sees disabled and the list the employee sees outstanding
 * **can never disagree**. Render both from these codes; do not compute a second
 * checklist anywhere.
 *
 * ⚠ It also arrives as `details.gaps` on `422 ADMIN_ACTIVATION_INCOMPLETE`, so a
 * failed activation renders the same list without a second call.
 */
export interface EmployeeReadiness {
    ready: boolean;
    gaps: EmployeeGap[];
}

// ─── The record ───────────────────────────────────────────────────────────────

/**
 * `GET /employees/me` and `GET /employees/:adminId` — the same body either way.
 *
 * ⚠ **A record that has never been touched is NOT a 404.** A brand-new account
 * answers `200` with a fully-shaped record: nulls, empty arrays, **all six
 * document slots present with `fileIds: []`**, and a complete `readiness.gaps`.
 * Render it; do not treat it as an error.
 */
export interface EmployeeRecord {
    adminId: string;
    /** Repeated from the account, so one call drives the screen. */
    accountStatus: string;

    /**
     * 🔴 **Not `displayName`.** The account's `displayName` is what colleagues
     * call you and you may change it freely; this is what the state calls you,
     * and a reviewer compares it against a scanned card. They differ for
     * perfectly ordinary reasons. **Do not render one as the other, and do not
     * prefill one from the other.**
     */
    fullName: string | null;
    dateOfBirth: string | null;
    placeOfBirth: string | null;
    gender: string | null;
    nationality: string | null;
    motherFullName: string | null;
    fatherFullName: string | null;
    phones: EmployeePhone[];
    relatives: EmployeeRelative[];

    idNumber: string | null;
    /** `national_id` · `passport` · … open. */
    idType: string | null;
    idExpiresOn: string | null;

    /** A stored `GeoAddress`, in jovi-mall's own snake_case. See `geo.types.ts`. */
    homeAddress: GeoCandidate | null;

    documents: EmployeeDocumentSlotState[];
    payoutMethods: EmployeePayoutMethod[];
    employment: EmployeeEmployment | null;
    readiness: EmployeeReadiness;

    lastSelfUpdateAt: string | null;
    createdAt: string;
    updatedAt: string;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * `PATCH /employees/me` — everything the employee says about themselves.
 *
 * ⚠ **The schema is `.strict()`**, which is not this service's default and is
 * deliberate: *"the failure mode of a lenient schema on an identity record is an
 * employee who corrects their date of birth, gets a `200`, and finds the old
 * value still there."* An unknown key is a `400` naming it.
 *
 * ⚠ **An empty body is refused (`400`)**, not treated as a no-op — a body with no
 * recognised key almost always means the wrong shape was sent.
 *
 * ⚠ **Dates are calendar days, `YYYY-MM-DD`. An ISO instant is refused**, because
 * an instant carries a timezone and *"a date of birth shifted by an offset is a
 * person who is a day older in one reading than another"* — exactly the
 * discrepancy that makes an identity document appear not to match.
 *
 * ⚠ **`phones`, `relatives` and `payoutMethods` are a FULL REPLACE when
 * present**, never a merge. Send the complete list; `null` or `[]` empties it;
 * omit the key to leave it alone.
 *
 * ⚠ **`employment` is not accepted here** — it is a tier-1 write on the other
 * route, and sending it is a `400`.
 */
export interface UpdateEmployeeRecordBody {
    fullName?: string | null;
    /** `YYYY-MM-DD`. */
    dateOfBirth?: string | null;
    placeOfBirth?: string | null;
    gender?: string | null;
    nationality?: string | null;
    motherFullName?: string | null;
    fatherFullName?: string | null;
    idNumber?: string | null;
    idType?: string | null;
    /** `YYYY-MM-DD`. */
    idExpiresOn?: string | null;
    phones?: EmployeePhone[] | null;
    relatives?: EmployeeRelative[] | null;
    /** ⚠ A candidate from `GET /geo/search`, **sent back verbatim**. */
    homeAddress?: GeoCandidate | null;
    /** ⚠ Snake_case inside, unlike the read's `mobileMoney`. Only `mobile_money` is accepted. */
    payoutMethods?: Array<{
        method: 'mobile_money';
        mobile_money: { provider: string; phone_number: string; account_name: string };
    }> | null;
}

/**
 * `PATCH /employees/:adminId/employment` · `employees.employment.write`.
 *
 * ⚠ **Narrower than the permission's name suggests.** It cannot touch the
 * personal, identity, address, contact or payout halves — those have no
 * administrative write path at all. *"An employee states their own facts; the
 * company states its terms."*
 */
export interface UpdateEmploymentBody {
    position?: string | null;
    department?: string | null;
    employmentType?: string | null;
    staffNumber?: string | null;
    /** `YYYY-MM-DD`. */
    startedOn?: string | null;
    /** `YYYY-MM-DD`. Departure — the closest thing to a delete on this surface. */
    endedOn?: string | null;
    /** ⚠ **Minor units**, and a fractional value is refused rather than rounded. */
    monthlySalaryMinor?: number | null;
    currency?: string | null;
    notes?: string | null;
}

/** `PUT /employees/me/avatar` — `null` clears it. */
export interface SetEmployeeAvatarBody {
    fileId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The slot's state, or a synthetic empty one — every slot is always present on the wire. */
export function documentSlot(
    record: EmployeeRecord | null,
    slot: EmployeeDocumentSlot,
): EmployeeDocumentSlotState {
    return (
        record?.documents.find((entry) => entry.slot === slot) ?? {
            slot,
            cardinality: EMPLOYEE_REQUIRED_DOCUMENT_SLOTS.includes(slot) ? 'single' : 'multi',
            fileIds: [],
        }
    );
}

/** Gaps grouped by the section they belong to, in first-seen order. */
export function gapsBySection(readiness: EmployeeReadiness): Map<string, EmployeeGap[]> {
    const grouped = new Map<string, EmployeeGap[]>();
    for (const gap of readiness.gaps) {
        const bucket = grouped.get(gap.section);
        if (bucket) bucket.push(gap);
        else grouped.set(gap.section, [gap]);
    }
    return grouped;
}

/**
 * The `gaps` a `422 ADMIN_ACTIVATION_INCOMPLETE` carries, narrowed defensively.
 *
 * ⚠ `details` is typed as an open record, so this validates rather than casts —
 * the list is rendered to a Developer as the reason an activation was refused,
 * and a malformed entry must drop out rather than render `undefined`.
 */
export function gapsFromDetails(details: Record<string, unknown> | undefined): EmployeeGap[] {
    const raw = details?.gaps;
    if (!Array.isArray(raw)) return [];

    return raw.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const gap = entry as Partial<EmployeeGap>;
        if (typeof gap.code !== 'string' || typeof gap.message !== 'string') return [];
        return [{ code: gap.code, section: gap.section ?? 'other', message: gap.message }];
    });
}
