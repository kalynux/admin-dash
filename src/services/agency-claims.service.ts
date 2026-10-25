/**
 * `/agency-claims` — the four endpoints of the damage-claim surface (2026-10-22).
 *
 * Source: `api-doc/admin/api/agency-claims.md` and
 * `backend/admin/src/modules/agencies/{routes,gateways}/agency-claim.*.ts`.
 *
 * ── Every route delegated ────────────────────────────────────────────────────
 * The reads too: whether an agency owes money is jovi-mall's verdict, read
 * against the parcel's history and the customer's reports, and the list is
 * served beside it so the two cannot disagree. So any call can fail with
 * `PLATFORM_OPERATION_REJECTED` carrying `details.platformCode` — read it with
 * `agencyClaimRefusalOf`. The charge is audited fail-closed as
 * `agencies.claims.charge`, filed against the **agency**. Nothing is
 * dual-controlled; nothing answers `202`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    AgencyClaim,
    AgencyClaimEligibility,
    AgencyClaimListQuery,
    ChargeAgencyClaimBody,
} from '@/types/agency-claims.types';

/**
 * `GET /agency-claims` · `agencies.read` · newest first. ⚠ **Strict query** —
 * `agencyId`, `vendorId`, `shipmentId`, `page`, `limit` and nothing else; any
 * other key is a `400`, so the query is built from those five only.
 */
export function listAgencyClaims(
    query: AgencyClaimListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<AgencyClaim>> {
    return api.list<AgencyClaim>(
        withQuery('/agency-claims', {
            agencyId: query.agencyId,
            vendorId: query.vendorId,
            shipmentId: query.shipmentId,
            page: query.page,
            limit: query.limit,
        }),
        options,
    );
}

/**
 * `GET /agency-claims/eligibility` · `agencies.read`. Can this parcel be
 * claimed now, and its limits. `shipmentId` is required; strict query.
 */
export function getAgencyClaimEligibility(
    query: { shipmentId: string; refundRequestId?: string },
    options?: RequestOptions,
): Promise<AgencyClaimEligibility> {
    return api.get<AgencyClaimEligibility>(
        withQuery('/agency-claims/eligibility', {
            shipmentId: query.shipmentId,
            refundRequestId: query.refundRequestId,
        }),
        options,
    );
}

/** `GET /agency-claims/:claimId` · `agencies.read`. */
export function getAgencyClaim(claimId: string, options?: RequestOptions): Promise<AgencyClaim> {
    return api.get<AgencyClaim>(`/agency-claims/${encodeURIComponent(claimId)}`, options);
}

/**
 * `POST /agency-claims` · **`agencies.claims.charge`** (financial, tiers 1–2) ·
 * audited `agencies.claims.charge`. **`201`** with the claim — print its
 * `explanation`. ⛔ A claim cannot be edited or undone.
 */
export function chargeAgencyClaim(
    body: ChargeAgencyClaimBody,
    options?: RequestOptions,
): Promise<AgencyClaim> {
    return api.post<AgencyClaim>(
        '/agency-claims',
        {
            shipmentId: body.shipmentId,
            itemCount: body.itemCount,
            amount: body.amount,
            note: body.note.trim(),
            ...(body.refundRequestId ? { refundRequestId: body.refundRequestId } : {}),
        },
        options,
    );
}
