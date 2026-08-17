import { describe, expect, it } from 'vitest';

import {
    adjustTrust,
    confirmDeposit,
    confirmRemittance,
    getDeposit,
    getDiscrepancy,
    getRemittance,
    listCodHolders,
    listDeposits,
    listDiscrepancies,
    listRemittances,
    listTrustEvents,
    recordDeposit,
    rejectDeposit,
    rejectRemittance,
    resolveDiscrepancy,
} from '@/services/cod.service';
import {
    agencyHolderFixture,
    agentHolderFixture,
    codListMetaFixture,
    confirmedDepositDetailFixture,
    depositDetailFixture,
    discrepancyDetailFixture,
    discrepancyFixture,
    nonMonetaryDiscrepancyFixture,
    platformDepositFixture,
    remittanceDetailFixture,
    remittanceFixture,
    trustEventFixture,
} from '@/test/cod-fixtures';
import { stubFetch, successResponse, type FetchCall } from '@/test/utils';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listCodHolders', () => {
    it('carries the owner filter and the settled flag', async () => {
        const calls = stubFetch(() =>
            successResponse([agentHolderFixture()], { meta: codListMetaFixture() }),
        );

        await listCodHolders({ ownerType: 'agent', includeSettled: true, sort: '-balance' });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/cod/holders');
        expect(query.get('ownerType')).toBe('agent');
        expect(query.get('includeSettled')).toBe('true');
        expect(query.get('sort')).toBe('-balance');
    });

    it('serialises includeSettled=false rather than dropping it', async () => {
        // `boolFlag` accepts true|false|1|0 — `false` is a real filter value, and
        // dropping it as falsy would silently change the question asked.
        const calls = stubFetch(() =>
            successResponse([agentHolderFixture()], { meta: codListMetaFixture() }),
        );

        await listCodHolders({ includeSettled: false });

        expect(queryOf(calls[0]).get('includeSettled')).toBe('false');
    });

    it('reports an agency holder with no trust standing', async () => {
        // `trust: null` is "does not apply", not "unknown" — an agency's exposure
        // is bounded by its contracts instead.
        stubFetch(() =>
            successResponse([agencyHolderFixture()], { meta: codListMetaFixture() }),
        );

        const page = await listCodHolders();

        expect(page.data[0].trust).toBeNull();
        expect(page.data[0].balance).toBe(1240000);
    });
});

describe('listRemittances', () => {
    it('carries only the filters the endpoint accepts', async () => {
        const calls = stubFetch(() =>
            successResponse([remittanceFixture()], { meta: codListMetaFixture() }),
        );

        await listRemittances({ status: 'declared', agencyId: '665c0011223344556677889a' });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/cod/remittances');
        expect(query.get('status')).toBe('declared');
        expect(query.get('agencyId')).toBe('665c0011223344556677889a');
    });

    it('never sends a sort — the delegated list offers none', async () => {
        const calls = stubFetch(() =>
            successResponse([remittanceFixture()], { meta: codListMetaFixture() }),
        );

        await listRemittances({ page: 2 });

        expect(queryOf(calls[0]).get('sort')).toBeNull();
    });
});

describe('getRemittance', () => {
    it('reads the detail, which is a strict superset of the list row', async () => {
        stubFetch(() => successResponse(remittanceDetailFixture()));

        const remittance = await getRemittance('6680aabbccddeeff00112233');

        // Five fields the delegated list does not carry.
        expect(remittance.agency.name).toBe('Littoral Express');
        expect(remittance.createdAt).not.toBeUndefined();
        expect(remittance.cashMovements).toEqual([]);
    });
});

describe('listDeposits', () => {
    it('carries the recipient filter', async () => {
        // The filter that separates the deposits an administrator can resolve
        // from the ones that belong to the agency.
        const calls = stubFetch(() =>
            successResponse([platformDepositFixture()], { meta: codListMetaFixture() }),
        );

        await listDeposits({ recipient: 'platform' });

        expect(calls[0].url).toContain('/cod/deposits');
        expect(queryOf(calls[0]).get('recipient')).toBe('platform');
    });

    it('never sends a sort', async () => {
        const calls = stubFetch(() =>
            successResponse([platformDepositFixture()], { meta: codListMetaFixture() }),
        );

        await listDeposits({ status: 'declared' });

        expect(queryOf(calls[0]).get('sort')).toBeNull();
    });
});

describe('getDeposit', () => {
    it('carries two cash movements on a confirmed platform deposit', async () => {
        /*
         * The two-sided settlement made visible: a platform deposit clears the
         * agent's leg and the agency's. An agency deposit carries one.
         */
        stubFetch(() => successResponse(confirmedDepositDetailFixture()));

        const deposit = await getDeposit('6682aabbccddeeff00112233');

        expect(deposit.cashMovements).toHaveLength(2);
        expect(deposit.cashMovements.map((m) => m.ownerType)).toEqual(['agent', 'agency']);
    });

    it('reads an unresolved deposit', async () => {
        stubFetch(() => successResponse(depositDetailFixture()));

        const deposit = await getDeposit('6682aabbccddeeff00112233');

        expect(deposit.resolvedAt).toBeNull();
        expect(deposit.recipient).toBe('platform');
    });
});

describe('listDiscrepancies', () => {
    it('carries the filters and the date range', async () => {
        const calls = stubFetch(() =>
            successResponse([discrepancyFixture()], { meta: codListMetaFixture() }),
        );

        await listDiscrepancies({
            status: 'open',
            type: 'late_deposit',
            agentId: '6660112233445566778899aa',
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-14T00:00:00.000Z',
            sort: '-openedAt',
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/cod/discrepancies');
        expect(query.get('status')).toBe('open');
        expect(query.get('type')).toBe('late_deposit');
        expect(query.get('sort')).toBe('-openedAt');
    });

    it('keeps a non-monetary flag as null rather than zero', async () => {
        // `amount: null` means nothing is at stake financially; `0` would mean a
        // shortfall of nothing, which is a different claim.
        stubFetch(() =>
            successResponse([nonMonetaryDiscrepancyFixture()], { meta: codListMetaFixture() }),
        );

        const page = await listDiscrepancies();

        expect(page.data[0].amount).toBeNull();
    });
});

describe('getDiscrepancy', () => {
    it('carries the deposit at issue and the trust events it caused', async () => {
        stubFetch(() =>
            successResponse(
                discrepancyDetailFixture({
                    deposit: platformDepositFixture(),
                    trustEvents: [trustEventFixture()],
                }),
            ),
        );

        const discrepancy = await getDiscrepancy('6683aabbccddeeff00112233');

        expect(discrepancy.deposit?.id).toBe('6682aabbccddeeff00112233');
        expect(discrepancy.trustEvents).toHaveLength(1);
    });

    it('tolerates a discrepancy with neither', async () => {
        stubFetch(() => successResponse(discrepancyDetailFixture()));

        const discrepancy = await getDiscrepancy('6683aabbccddeeff00112233');

        expect(discrepancy.deposit).toBeNull();
        expect(discrepancy.trustEvents).toEqual([]);
    });
});

describe('listTrustEvents', () => {
    it('scopes to the agent in the path', async () => {
        const calls = stubFetch(() =>
            successResponse([trustEventFixture()], { meta: codListMetaFixture() }),
        );

        await listTrustEvents('6660112233445566778899aa', { eventType: 'late_deposit' });

        expect(calls[0].url).toContain('/cod/agents/6660112233445566778899aa/trust-events');
        expect(queryOf(calls[0]).get('eventType')).toBe('late_deposit');
    });

    it('keeps the signed delta and the score snapshot', async () => {
        stubFetch(() =>
            successResponse([trustEventFixture()], { meta: codListMetaFixture() }),
        );

        const page = await listTrustEvents('6660112233445566778899aa');

        expect(page.data[0].delta).toBe(-8);
        expect(page.data[0].scoreAfter).toBe(87);
    });
});

// ─── The seven writes ─────────────────────────────────────────────────────────

const REMITTANCE_ID = '6680aabbccddeeff00112233';
const DEPOSIT_ID = '6682aabbccddeeff00112233';
const DISCREPANCY_ID = '6683aabbccddeeff00112233';
const AGENT_ID = '6660112233445566778899aa';

/** Every write answers through `api.mutate`, so `message` has to survive. */
function stubWrite(message: string, status = 200) {
    return stubFetch(() => successResponse({ id: 'whatever' }, { status, message }));
}

describe('confirmRemittance', () => {
    it('posts with no body and returns the platform sentence, not the record', async () => {
        const calls = stubWrite('Remittance confirmed');

        const result = await confirmRemittance(REMITTANCE_ID);

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(`/cod/remittances/${REMITTANCE_ID}/confirm`);
        // No body at all — the endpoint takes none, and sending `{}` invites a
        // strict-schema 400 the day one is added.
        expect(calls[0].body).toBeUndefined();
        expect(result).toEqual({ message: 'Remittance confirmed' });
    });
});

describe('rejectRemittance', () => {
    it('sends the reason and nothing else', async () => {
        const calls = stubWrite('Remittance declaration rejected');

        await rejectRemittance(REMITTANCE_ID, 'The reference is not on the statement');

        expect(calls[0].url).toContain(`/cod/remittances/${REMITTANCE_ID}/reject`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'The reference is not on the statement',
        });
    });
});

describe('recordDeposit', () => {
    it('sends exactly the five fields the strict schema names', async () => {
        const calls = stubWrite('Direct deposit recorded', 201);

        await recordDeposit({
            agentId: AGENT_ID,
            agencyId: '665c0011223344556677889a',
            amount: 84500,
            reference: 'AFRILAND/DEP/2026-08-13/8841',
            note: 'Walked into the Akwa branch',
        });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/cod/deposits');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            agentId: AGENT_ID,
            agencyId: '665c0011223344556677889a',
            amount: 84500,
            reference: 'AFRILAND/DEP/2026-08-13/8841',
            note: 'Walked into the Akwa branch',
        });
    });

    it('treats 201 as the success it is', async () => {
        stubWrite('Direct deposit recorded', 201);

        const result = await recordDeposit({
            agentId: AGENT_ID,
            agencyId: '665c0011223344556677889a',
            amount: 84500,
            reference: 'AFRILAND/DEP/2026-08-13/8841',
        });

        expect(result.message).toBe('Direct deposit recorded');
    });

    it('sends no recipient — jovi-mall pins it to the platform itself', async () => {
        const calls = stubWrite('Direct deposit recorded', 201);

        await recordDeposit({
            agentId: AGENT_ID,
            agencyId: '665c0011223344556677889a',
            amount: 500,
            reference: 'R-1',
        });

        expect(JSON.parse(calls[0].body ?? '{}')).not.toHaveProperty('recipient');
    });
});

describe('the deposit answers', () => {
    it('confirms with no body', async () => {
        const calls = stubWrite('Deposit confirmed');

        await confirmDeposit(DEPOSIT_ID);

        expect(calls[0].url).toContain(`/cod/deposits/${DEPOSIT_ID}/confirm`);
        expect(calls[0].body).toBeUndefined();
    });

    it('rejects with a reason', async () => {
        const calls = stubWrite('Deposit declaration rejected');

        await rejectDeposit(DEPOSIT_ID, 'Nothing arrived at the branch');

        expect(calls[0].url).toContain(`/cod/deposits/${DEPOSIT_ID}/reject`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'Nothing arrived at the branch',
        });
    });
});

describe('resolveDiscrepancy', () => {
    it('sends the pinned resolution and the note', async () => {
        const calls = stubWrite('Discrepancy written_off');

        await resolveDiscrepancy(DISCREPANCY_ID, {
            resolution: 'written_off',
            note: 'Agent left the platform',
        });

        expect(calls[0].url).toContain(`/cod/discrepancies/${DISCREPANCY_ID}/resolve`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            resolution: 'written_off',
            note: 'Agent left the platform',
        });
    });
});

describe('adjustTrust', () => {
    it('targets the agent and sends a signed delta', async () => {
        const calls = stubWrite('Trust score adjusted');

        await adjustTrust(AGENT_ID, { delta: -8, note: 'Repeated late deposits' });

        expect(calls[0].url).toContain(`/cod/agents/${AGENT_ID}/trust-adjustment`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            delta: -8,
            note: 'Repeated late deposits',
        });
    });

    it('returns no score — the platform clamps it, and only a read says what it became', async () => {
        stubFetch(() =>
            successResponse({ agentId: AGENT_ID, trustScore: 100 }, { message: 'Trust score adjusted' }),
        );

        const result = await adjustTrust(AGENT_ID, { delta: 15, note: 'Restoring a penalty' });

        expect(result).toEqual({ message: 'Trust score adjusted' });
        expect(result).not.toHaveProperty('trustScore');
    });
});
