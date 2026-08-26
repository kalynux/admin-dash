import { describe, expect, it } from 'vitest';

import {
    getContract,
    reinstateContract,
    suspendContract,
    terminateContract,
} from '@/services/contracts.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

const CONTRACT_ID = '665d0011223344556677889a';

describe('the addressable read', () => {
    it('asks /contracts/:id, which is the only view keyed on the contract', async () => {
        // A contract belongs to both an agent and an agency, and to neither.
        // Hanging it off either directory would force a caller holding only a
        // contract id — which is what a support ticket carries — to look up an
        // agent first.
        const calls = stubFetch(() => successResponse({ id: CONTRACT_ID }));

        await getContract(CONTRACT_ID);

        expect(urlOf(calls[0]).pathname).toBe(`/api/v1/contracts/${CONTRACT_ID}`);
    });

    it('reports CONTRACT_NOT_FOUND rather than a bare 404', async () => {
        // Its own code because the id is what a support ticket carries, and the
        // neighbouring 404s on that screen are about agents and agencies — so
        // "not found" has to say what.
        stubFetch(() => errorResponse(404, 'CONTRACT_NOT_FOUND'));

        await expect(getContract(CONTRACT_ID)).rejects.toMatchObject({
            code: 'CONTRACT_NOT_FOUND',
        });
    });
});

describe('the three interventions', () => {
    it('sends the reason on each', async () => {
        const calls = stubFetch(() => successResponse({ id: CONTRACT_ID }));

        await suspendContract(CONTRACT_ID, { reason: 'Under investigation' });
        await reinstateContract(CONTRACT_ID, { reason: 'Cleared' });

        expect(urlOf(calls[0]).pathname).toBe(`/api/v1/contracts/${CONTRACT_ID}/suspend`);
        expect(JSON.parse(calls[0].body as string)).toEqual({ reason: 'Under investigation' });
        expect(urlOf(calls[1]).pathname).toBe(`/api/v1/contracts/${CONTRACT_ID}/reinstate`);
    });

    it('surfaces an invalid transition as the platform code, not error.code', async () => {
        // Delegated, so jovi-mall's verdict arrives in `details.platformCode` —
        // the only handle on why.
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                details: {
                    platformCode: 'CONTRACT_INVALID_TRANSITION',
                    from: 'deactivated',
                    allowedFrom: ['active', 'paused'],
                },
            }),
        );

        await expect(
            suspendContract(CONTRACT_ID, { reason: 'Under investigation' }),
        ).rejects.toMatchObject({
            platformCode: 'CONTRACT_INVALID_TRANSITION',
            details: { from: 'deactivated' },
        });
    });
});

describe('termination is a request until it is not', () => {
    it('reports contract: null as “requested”, not as success', async () => {
        /**
         * ⚠ A `200` here does not mean the contract ended. Deactivation needs
         * the counterparty's agreement **and** both balances clear; when they
         * are not, a request is opened and the contract does not move.
         *
         * **Branch on `data.contract`, never on the status.**
         */
        stubFetch(() =>
            successResponse({
                contract: null,
                pendingRequest: { id: '665e0011223344556677889a' },
                blockers: { outstandingCod: 42000, outstandingPayment: 18500, clear: false },
            }),
        );

        const result = await terminateContract(CONTRACT_ID, { reason: 'Relationship ended' });

        expect(result.contract).toBeNull();
        expect(result.pendingRequest?.id).toBe('665e0011223344556677889a');
        expect(result.blockers?.clear).toBe(false);
    });

    it('reports a contract object as done', async () => {
        stubFetch(() =>
            successResponse({
                contract: { id: CONTRACT_ID, status: 'deactivated' },
                pendingRequest: null,
                blockers: { outstandingCod: 0, outstandingPayment: 0, clear: true },
            }),
        );

        const result = await terminateContract(CONTRACT_ID, { reason: 'Both settled' });

        expect(result.contract).not.toBeNull();
        expect(result.blockers?.clear).toBe(true);
    });
});
