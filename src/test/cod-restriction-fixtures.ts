/**
 * Wire-shaped fixtures for the administrator's COD restriction (2026-10-10).
 * Transcribed from the worked JSON in `users.md` § The customer's COD
 * restriction and `agencies.md` § The agency's COD restriction.
 */

import type { CodRestriction, CodRestrictionReport } from '@/types/cod-restriction.types';

export const COD_CUSTOMER_USER_ID = '665f1c2a9b3e4a91c7d2e5f0';
/** The customer **profile** — what `subjectId` is on the customer mount. */
export const COD_CUSTOMER_PROFILE_ID = '665f1c2a9b3e4a91c7d2e5f1';
export const COD_AGENCY_ID = '6650bb22cc33dd44ee55ff66';

export function codRestrictionFixture(overrides: Partial<CodRestriction> = {}): CodRestriction {
    return {
        reason: 'Refused three parcels without a reason',
        restrictedAt: '2026-10-10T09:30:00.000Z',
        restrictedByUserId: '66b0aa000000000000000001',
        restrictedBySource: 'admin',
        restrictedByName: 'Ada Admin',
        ...overrides,
    };
}

/** The customer mount's report. Restricted unless told otherwise. */
export function customerCodReportFixture(
    overrides: Partial<CodRestrictionReport> = {},
): CodRestrictionReport {
    return {
        subject: 'customer',
        subjectId: COD_CUSTOMER_PROFILE_ID,
        userId: COD_CUSTOMER_USER_ID,
        restricted: true,
        restriction: codRestrictionFixture(),
        ...overrides,
    };
}

/** The agency mount's report. Restricted unless told otherwise. */
export function agencyCodReportFixture(
    overrides: Partial<CodRestrictionReport> = {},
): CodRestrictionReport {
    return {
        subject: 'agency',
        subjectId: COD_AGENCY_ID,
        userId: '665f1c2a9b3e4a91c7d2e5aa',
        restricted: true,
        restriction: codRestrictionFixture({ reason: 'Three remittances short in two weeks' }),
        ...overrides,
    };
}

/** What every route answers once nothing is restricted — and every `/lift`. */
export const NOT_RESTRICTED = { restricted: false, restriction: null } as const;
