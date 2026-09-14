/**
 * `GET /{vendors,agencies,agents}/:id/verification` — the evidence behind a KYC
 * verdict.
 *
 * Source: [`verification.md`](../../api-doc/admin/api/verification.md). **Not a
 * route group**: one read hangs off each of the three party domains, which is
 * why these three live in a module of their own rather than in
 * `vendors.service.ts`, `agencies.service.ts` and `agents.service.ts` — they
 * answer one shape and the dashboard treats them as one surface.
 *
 * ── Three properties that decide how a caller uses this ──────────────────────
 *
 * 1. **The permission is the ordinary `*.read`**, not the review permission —
 *    so **tier 3 Support can call it**, deliberately, because Support answers
 *    *"why was my shop rejected"* tickets and cannot answer one from a status.
 *    The verdict writes keep their own permission and stay where they were.
 * 2. **Delegated.** So a refusal arrives as `PLATFORM_OPERATION_REJECTED` with
 *    jovi-mall's code in `details.platformCode`, and `503
 *    SERVICE_DEPENDENCY_UNAVAILABLE` means `JOVI_MALL_BASE_URL` is unset.
 *    ⚠ `KYC_SUBJECT_NOT_FOUND` is a **platform code, not an `error.code`** —
 *    see `PLATFORM_CODE_KYC_SUBJECT_NOT_FOUND`.
 * 3. **Not audited**, unlike the four audited reads. It hands over handles;
 *    *looking at the picture* is the disclosure, and `GET /files/:fileId/content`
 *    is where that row is written. Which is why nothing here fetches bytes and
 *    every document in the checklist waits for a click.
 *
 * ⚠ **There is no write on this surface, and that is deliberate** — *"a second
 * path to one field is how two endpoints end up disagreeing about what
 * `legit_verified` means."* The verdict still goes to
 * `POST /vendors/:id/kyc/{approve,reject}`, `POST /agencies/:id/{verify,reject}`
 * and `PUT /agents/:id/kyc`.
 */

import { api, type RequestOptions } from '@/services/api';
import type { PartyVerification, VerificationParty } from '@/types/verification.types';

/** `GET /vendors/:vendorId/verification` · `vendors.read`. */
export function getVendorVerification(
    vendorId: string,
    options?: RequestOptions,
): Promise<PartyVerification> {
    return api.get<PartyVerification>(
        `/vendors/${encodeURIComponent(vendorId)}/verification`,
        options,
    );
}

/**
 * `GET /agencies/:agencyId/verification` · `agencies.read`.
 *
 * ⚠ The depot addresses in `storeAddresses` come from the **Magazin**, not from
 * the agency document — which is one of the two reasons this one read is
 * delegated while the rest of the agency screen is answered directly.
 */
export function getAgencyVerification(
    agencyId: string,
    options?: RequestOptions,
): Promise<PartyVerification> {
    return api.get<PartyVerification>(
        `/agencies/${encodeURIComponent(agencyId)}/verification`,
        options,
    );
}

/**
 * `GET /agents/:agentId/verification` · `agents.read`.
 *
 * ⚠ Adds `driversLicenseNumber` and `plateNumber`, and **omits `storeAddresses`
 * entirely** rather than sending `[]` — an agent has no premises on this
 * platform.
 */
export function getAgentVerification(
    agentId: string,
    options?: RequestOptions,
): Promise<PartyVerification> {
    return api.get<PartyVerification>(
        `/agents/${encodeURIComponent(agentId)}/verification`,
        options,
    );
}

/**
 * The read for one party, by kind.
 *
 * One entry point so a shared panel does not carry a three-way branch of its
 * own; the three named functions stay exported because a screen that already
 * knows which party it is on should say so.
 */
export function getPartyVerification(
    party: VerificationParty,
    id: string,
    options?: RequestOptions,
): Promise<PartyVerification> {
    if (party === 'vendor') return getVendorVerification(id, options);
    if (party === 'agency') return getAgencyVerification(id, options);
    return getAgentVerification(id, options);
}
