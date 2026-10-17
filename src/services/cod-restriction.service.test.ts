import { describe, expect, it } from 'vitest';

import {
    getAgencyCodRestriction,
    liftAgencyCodRestriction,
    restrictAgencyCod,
} from '@/services/agencies.service';
import {
    getUserCodRestriction,
    liftUserCodRestriction,
    restrictUserCod,
} from '@/services/users.service';
import {
    COD_AGENCY_ID,
    COD_CUSTOMER_PROFILE_ID,
    COD_CUSTOMER_USER_ID,
    NOT_RESTRICTED,
    agencyCodReportFixture,
    customerCodReportFixture,
} from '@/test/cod-restriction-fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';
import { PLATFORM_CODE_COD_RESTRICTION_UNCHANGED } from '@/types/cod-restriction.types';

/**
 * The COD restriction's six routes (2026-10-10): one read and two writes on
 * each of `/users/:userId` and `/agencies/:agencyId`, all delegated, all
 * answering the same report.
 *
 * What is pinned is what a reasonable client gets wrong: the direction is the
 * **route** and never a field, and both write bodies are `.strict()` — so a
 * `restricted` boolean, or any key beside `reason`, is a `400`.
 */
const pathOf = (url: string) => new URL(url).pathname;
const bodyOf = (body: string | undefined) => JSON.parse(body ?? 'null') as unknown;

describe('the customer mount', () => {
    it('reads from /users/:userId/cod-restriction', async () => {
        const calls = stubFetch(() => successResponse(customerCodReportFixture()));

        const report = await getUserCodRestriction(COD_CUSTOMER_USER_ID);

        expect(calls[0].method).toBe('GET');
        expect(pathOf(calls[0].url)).toBe(`/api/v1/users/${COD_CUSTOMER_USER_ID}/cod-restriction`);
        // The profile id, not the user id the path named.
        expect(report.subjectId).toBe(COD_CUSTOMER_PROFILE_ID);
        expect(report.userId).toBe(COD_CUSTOMER_USER_ID);
    });

    it('restricts with a PUT carrying the reason and nothing else', async () => {
        const calls = stubFetch(() =>
            successResponse(customerCodReportFixture(), {
                message: 'Cash on delivery restricted for this customer',
            }),
        );

        const { report, message } = await restrictUserCod(COD_CUSTOMER_USER_ID, {
            reason: '  Refused three parcels without a reason  ',
        });

        expect(calls[0].method).toBe('PUT');
        expect(pathOf(calls[0].url)).toBe(`/api/v1/users/${COD_CUSTOMER_USER_ID}/cod-restriction`);
        expect(bodyOf(calls[0].body)).toEqual({ reason: 'Refused three parcels without a reason' });
        expect(report.restricted).toBe(true);
        expect(message).toBe('Cash on delivery restricted for this customer');
    });

    it('lifts with a POST to /lift, a reason, and no boolean', async () => {
        const calls = stubFetch(() =>
            successResponse(customerCodReportFixture(NOT_RESTRICTED)),
        );

        const { report } = await liftUserCodRestriction(COD_CUSTOMER_USER_ID, {
            reason: 'Customer explained; the parcels were damaged',
        });

        expect(calls[0].method).toBe('POST');
        expect(pathOf(calls[0].url)).toBe(
            `/api/v1/users/${COD_CUSTOMER_USER_ID}/cod-restriction/lift`,
        );
        expect(bodyOf(calls[0].body)).toEqual({
            reason: 'Customer explained; the parcels were damaged',
        });
        expect(report).toMatchObject(NOT_RESTRICTED);
    });

    it('never forwards a key the caller smuggled in beside the reason', async () => {
        const calls = stubFetch(() => successResponse(customerCodReportFixture()));

        await restrictUserCod(COD_CUSTOMER_USER_ID, {
            reason: 'Refused three parcels',
            restricted: true,
        } as never);

        expect(bodyOf(calls[0].body)).toEqual({ reason: 'Refused three parcels' });
    });

    it('surfaces the compare-and-set refusal as a platform code', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: { platformCode: 'COD_RESTRICTION_UNCHANGED' },
            }),
        );

        const error = await restrictUserCod(COD_CUSTOMER_USER_ID, { reason: 'Again' }).catch(
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).platformCode).toBe(PLATFORM_CODE_COD_RESTRICTION_UNCHANGED);
    });
});

describe('the agency mount', () => {
    it('reads from /agencies/:agencyId/cod-restriction', async () => {
        const calls = stubFetch(() => successResponse(agencyCodReportFixture()));

        const report = await getAgencyCodRestriction(COD_AGENCY_ID);

        expect(calls[0].method).toBe('GET');
        expect(pathOf(calls[0].url)).toBe(`/api/v1/agencies/${COD_AGENCY_ID}/cod-restriction`);
        expect(report.subjectId).toBe(COD_AGENCY_ID);
    });

    it('restricts with a PUT carrying the reason and nothing else', async () => {
        const calls = stubFetch(() => successResponse(agencyCodReportFixture()));

        await restrictAgencyCod(COD_AGENCY_ID, { reason: 'Three remittances short in two weeks' });

        expect(calls[0].method).toBe('PUT');
        expect(pathOf(calls[0].url)).toBe(`/api/v1/agencies/${COD_AGENCY_ID}/cod-restriction`);
        expect(bodyOf(calls[0].body)).toEqual({ reason: 'Three remittances short in two weeks' });
    });

    it('lifts with a POST to /lift and a reason', async () => {
        const calls = stubFetch(() => successResponse(agencyCodReportFixture(NOT_RESTRICTED)));

        const { report } = await liftAgencyCodRestriction(COD_AGENCY_ID, {
            reason: 'Shortfalls settled; reviewed with the agency',
        });

        expect(calls[0].method).toBe('POST');
        expect(pathOf(calls[0].url)).toBe(
            `/api/v1/agencies/${COD_AGENCY_ID}/cod-restriction/lift`,
        );
        expect(bodyOf(calls[0].body)).toEqual({
            reason: 'Shortfalls settled; reviewed with the agency',
        });
        expect(report.restricted).toBe(false);
    });
});
