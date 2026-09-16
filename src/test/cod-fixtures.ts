/**
 * Wire-shaped fixtures for `/cod`.
 *
 * Shaped from `backend/admin/src/modules/cod/read-models/cod.dto.ts` rather than
 * from `cod.md`, which is wrong in twenty-four places on this surface — including
 * four **fabricated enum values** inside its response examples
 * (`remittance_confirmed`, `deposit_confirmed`, `wi-admin`,
 * `late_deposit_penalty`), none of which the schemas contain.
 */

import type {
    CodCashMovement,
    CodHolder,
    Deposit,
    DepositDetail,
    Discrepancy,
    DiscrepancyDetail,
    Remittance,
    RemittanceDetail,
    TrustEvent,
} from '@/types/cod.types';

/** `entryType` is `collection|deposit|remittance|adjustment` — never `*_confirmed`. */
export function cashMovementFixture(
    overrides: Partial<CodCashMovement> = {},
): CodCashMovement {
    return {
        id: '6685aabbccddeeff00112233',
        ownerType: 'agency',
        ownerId: '665c0011223344556677889a',
        entryType: 'remittance',
        amount: -1240000,
        balanceAfter: 0,
        refType: 'agency_remittance',
        refId: '6680aabbccddeeff00112233',
        createdAt: '2026-08-13T08:15:00.000Z',
        ...overrides,
    };
}

// ─── Holders ──────────────────────────────────────────────────────────────────

export function agentHolderFixture(overrides: Partial<CodHolder> = {}): CodHolder {
    return {
        ownerType: 'agent',
        owner: { id: '6660112233445566778899aa', name: 'Eric T.' },
        balance: 84500,
        currency: 'XAF',
        version: 41,
        lastMovementAt: '2026-08-13T07:12:00.000Z',
        trust: { score: 87, maxThreshold: 250000 },
        ...overrides,
    };
}

/** **`trust` is null for an agency** — does not apply, rather than unknown. */
export function agencyHolderFixture(overrides: Partial<CodHolder> = {}): CodHolder {
    return {
        ownerType: 'agency',
        owner: { id: '665c0011223344556677889a', name: 'Littoral Express' },
        balance: 1240000,
        currency: 'XAF',
        version: 812,
        lastMovementAt: '2026-08-13T06:40:00.000Z',
        trust: null,
        ...overrides,
    };
}

// ─── Remittances ──────────────────────────────────────────────────────────────

/** Declared and unresolved — `resolvedAt` null is what makes the actions available. */
export function remittanceFixture(overrides: Partial<Remittance> = {}): Remittance {
    return {
        id: '6680aabbccddeeff00112233',
        agencyId: '665c0011223344556677889a',
        amount: 1240000,
        currency: 'XAF',
        reference: 'BICEC/2026/08/13/44127',
        note: 'Weekly settlement',
        status: 'declared',
        declaredAt: '2026-08-13T06:00:00.000Z',
        resolvedAt: null,
        rejectionReason: null,
        /*
          ⚠ **`null` is the honest default.** Endorsement is advisory (ADR-024
          D-2/D-5) — an un-endorsed record is exactly as confirmable — so a
          fixture that arrived pre-endorsed would test every confirm control
          against the one state where a mistaken gate is invisible.
        */
        triage: null,
        ...overrides,
    };
}

export function remittanceDetailFixture(
    overrides: Partial<RemittanceDetail> = {},
): RemittanceDetail {
    return {
        ...remittanceFixture(),
        agency: { id: '665c0011223344556677889a', name: 'Littoral Express' },
        declaredByUserId: '665b998877665544332211ff',
        resolvedBy: null,
        createdAt: '2026-08-13T06:00:00.000Z',
        updatedAt: '2026-08-13T06:00:00.000Z',
        cashMovements: [],
        ...overrides,
    };
}

/** Confirmed: `resolvedBy.source` is `'admin'`, never the doc's `"wi-admin"`. */
export function confirmedRemittanceDetailFixture(
    overrides: Partial<RemittanceDetail> = {},
): RemittanceDetail {
    return remittanceDetailFixture({
        status: 'confirmed',
        resolvedAt: '2026-08-13T08:15:00.000Z',
        resolvedBy: { id: '665f112233445566778899aa', source: 'admin', name: 'Ada Nkemelu' },
        cashMovements: [cashMovementFixture()],
        ...overrides,
    });
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

/**
 * **`recipient: 'platform'`** — the one an administrator can actually resolve.
 *
 * The agent walked the cash to the platform directly, skipping the middle leg.
 */
export function platformDepositFixture(overrides: Partial<Deposit> = {}): Deposit {
    return {
        id: '6682aabbccddeeff00112233',
        agentId: '6660112233445566778899aa',
        agencyId: '665c0011223344556677889a',
        amount: 84500,
        currency: 'XAF',
        note: 'Agent walked the cash into the Akwa branch',
        recipient: 'platform',
        status: 'declared',
        reference: 'AFRILAND/DEP/2026-08-13/8841',
        declaredAt: '2026-08-13T09:00:00.000Z',
        resolvedAt: null,
        rejectionReason: null,
        triage: null,
        recordedAt: '2026-08-13T09:00:00.000Z',
        ...overrides,
    };
}

/**
 * **`recipient: 'agency'` — "the normal route", and the trap.**
 *
 * The agency confirms or rejects this one; an administrator gets a `403`
 * whatever permissions they hold, so the affordance is withheld.
 */
export function agencyDepositFixture(overrides: Partial<Deposit> = {}): Deposit {
    return platformDepositFixture({ recipient: 'agency', ...overrides });
}

export function depositDetailFixture(overrides: Partial<DepositDetail> = {}): DepositDetail {
    return {
        ...platformDepositFixture(),
        agent: { id: '6660112233445566778899aa', name: 'Eric T.' },
        agency: { id: '665c0011223344556677889a', name: 'Littoral Express' },
        declaredByUserId: '6660112233445566778899aa',
        recordedBy: { id: '665f112233445566778899aa', source: 'admin', name: 'Ada Nkemelu' },
        createdAt: '2026-08-13T09:00:00.000Z',
        updatedAt: '2026-08-13T09:00:00.000Z',
        cashMovements: [],
        ...overrides,
    };
}

/** An agency deposit detail — no confirm or reject may be offered on this. */
export function agencyDepositDetailFixture(
    overrides: Partial<DepositDetail> = {},
): DepositDetail {
    return depositDetailFixture({ recipient: 'agency', ...overrides });
}

/** Confirmed platform deposit: **two** movements, one per leg of the chain. */
export function confirmedDepositDetailFixture(
    overrides: Partial<DepositDetail> = {},
): DepositDetail {
    return depositDetailFixture({
        status: 'confirmed',
        resolvedAt: '2026-08-13T09:20:00.000Z',
        cashMovements: [
            cashMovementFixture({
                id: '6685aabbccddeeff00112240',
                ownerType: 'agent',
                ownerId: '6660112233445566778899aa',
                entryType: 'deposit',
                amount: -84500,
                refType: 'agent_deposit',
            }),
            cashMovementFixture({
                id: '6685aabbccddeeff00112241',
                ownerType: 'agency',
                ownerId: '665c0011223344556677889a',
                entryType: 'remittance',
                amount: -84500,
                refType: 'agent_deposit',
            }),
        ],
        ...overrides,
    });
}

// ─── Discrepancies ────────────────────────────────────────────────────────────

export function discrepancyFixture(overrides: Partial<Discrepancy> = {}): Discrepancy {
    return {
        id: '6683aabbccddeeff00112233',
        agentId: '6660112233445566778899aa',
        agencyId: '665c0011223344556677889a',
        agent: { id: '6660112233445566778899aa', name: 'Eric T.' },
        agency: { id: '665c0011223344556677889a', name: 'Littoral Express' },
        type: 'late_deposit',
        amount: 84500,
        currency: 'XAF',
        status: 'open',
        raisedBy: 'system',
        raisedByUserId: null,
        depositId: null,
        note: 'Cash held 6 days past the remittance window',
        resolutionNote: null,
        resolvedByUserId: null,
        openedAt: '2026-08-11T00:05:00.000Z',
        resolvedAt: null,
        createdAt: '2026-08-11T00:05:00.000Z',
        updatedAt: '2026-08-11T00:05:00.000Z',
        ...overrides,
    };
}

/** **`amount: null` is a non-monetary flag — not zero**, which would mean nothing at stake. */
export function nonMonetaryDiscrepancyFixture(
    overrides: Partial<Discrepancy> = {},
): Discrepancy {
    return discrepancyFixture({
        type: 'deposit_not_confirmed',
        amount: null,
        currency: null,
        ...overrides,
    });
}

/** Raised by the agent — this is how an agent disputes. */
export function disputedDiscrepancyFixture(overrides: Partial<Discrepancy> = {}): Discrepancy {
    return discrepancyFixture({
        raisedBy: 'agent',
        raisedByUserId: '6660112233445566778899aa',
        depositId: '6682aabbccddeeff00112233',
        ...overrides,
    });
}

export function discrepancyDetailFixture(
    overrides: Partial<DiscrepancyDetail> = {},
): DiscrepancyDetail {
    return {
        ...discrepancyFixture(),
        deposit: null,
        trustEvents: [],
        ...overrides,
    };
}

// ─── Trust ────────────────────────────────────────────────────────────────────

/** `eventType` is `late_deposit`, not the doc's invented `late_deposit_penalty`. */
export function trustEventFixture(overrides: Partial<TrustEvent> = {}): TrustEvent {
    return {
        id: '6684aabbccddeeff00112233',
        agentId: '6660112233445566778899aa',
        agencyId: '665c0011223344556677889a',
        eventType: 'late_deposit',
        delta: -8,
        scoreAfter: 87,
        refType: 'cod_discrepancy',
        refId: '6683aabbccddeeff00112233',
        note: null,
        createdAt: '2026-08-11T00:05:00.000Z',
        ...overrides,
    };
}

/** A manual adjustment: **`refType` is `'admin'`, not null** — only `refId` is null. */
export function manualTrustEventFixture(overrides: Partial<TrustEvent> = {}): TrustEvent {
    return trustEventFixture({
        eventType: 'admin_adjustment',
        delta: 5,
        scoreAfter: 100,
        refType: 'admin',
        refId: null,
        note: 'Discrepancy was our error — restoring the penalty',
        ...overrides,
    });
}

export function codListMetaFixture(overrides: Record<string, unknown> = {}) {
    return { total: 14, page: 1, limit: 20, pages: 1, ...overrides };
}
