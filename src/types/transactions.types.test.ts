/**
 * The transcription guard for `/money/transactions`.
 *
 * `transactions.types.ts` hard-codes five vocabularies so the filters can be
 * pickers, and that is only safe because the query schema **pins** all five — a
 * value outside the list is a `400`, never a silently empty page. This suite
 * diffs them, and the row's own keys, against the source mirror
 * `api-doc/admin/transaction-dto.ts`, a verbatim copy of
 * `admin/src/modules/money/read-models/transaction.dto.ts`.
 *
 * ⚠ **A failure here means the mirror moved.** Reconcile `src/` against it. Do
 * not weaken the assertion, and never edit the mirror to make it pass — a mirror
 * is re-copied or it is wrong.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { transactionLinksFixture, transactionRowFixture } from '@/test/transaction-fixtures';
import {
    TRANSACTION_DIRECTIONS,
    TRANSACTION_DIRECTION_LABELS,
    TRANSACTION_GROUPS,
    TRANSACTION_GROUP_LABELS,
    TRANSACTION_KINDS,
    TRANSACTION_KIND_LABELS,
    TRANSACTION_OUTCOMES,
    TRANSACTION_OUTCOME_LABELS,
    TRANSACTION_ROLES,
    TRANSACTION_ROLE_LABELS,
    transactionKindLabel,
    transactionOutcomeLabel,
    transactionPartyScreen,
    transactionPath,
    transactionReasonLabel,
    transactionRecordScreen,
    transactionRoleLabel,
    transactionRowKey,
} from '@/types/transactions.types';

const MIRROR = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../api-doc/admin/transaction-dto.ts'),
    'utf8',
).replace(/\r\n/g, '\n');

/** The members of `export const NAME = [ … ] as const;`. */
function mirroredList(name: string): string[] {
    const declaration = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(MIRROR);
    if (!declaration) throw new Error(`${name} is not declared in the mirror`);
    return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** The top-level keys of `export interface NAME { … }`, comments stripped. */
function mirroredKeys(name: string): string[] {
    const start = MIRROR.indexOf(`export interface ${name} {`);
    if (start === -1) throw new Error(`${name} is not declared in the mirror`);
    const end = MIRROR.indexOf('\n}', start);
    const body = MIRROR.slice(MIRROR.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
    return [...body.matchAll(/^ {4}([a-zA-Z]+)\??:/gm)].map((match) => match[1]);
}

describe('the five vocabularies wi-admin pins', () => {
    it.each([
        ['TRANSACTION_KINDS', TRANSACTION_KINDS],
        ['TRANSACTION_GROUPS', TRANSACTION_GROUPS],
        ['TRANSACTION_DIRECTIONS', TRANSACTION_DIRECTIONS],
        ['TRANSACTION_OUTCOMES', TRANSACTION_OUTCOMES],
        ['TRANSACTION_ROLES', TRANSACTION_ROLES],
    ] as const)('%s matches the mirror, order included', (name, ours) => {
        expect([...ours]).toEqual(mirroredList(name));
    });

    it('is eleven kinds — the delivery-fee refund (BR-027), then cash at the door and debt adjustments (BR-030)', () => {
        expect(TRANSACTION_KINDS).toHaveLength(11);
        expect(TRANSACTION_KINDS).toContain('delivery_fee_refund');
        expect(TRANSACTION_KINDS).toContain('cod_collection');
        expect(TRANSACTION_KINDS).toContain('earnings_adjustment');
    });

    it('labels every member of each', () => {
        expect(Object.keys(TRANSACTION_KIND_LABELS)).toEqual([...TRANSACTION_KINDS]);
        expect(Object.keys(TRANSACTION_GROUP_LABELS)).toEqual([...TRANSACTION_GROUPS]);
        expect(Object.keys(TRANSACTION_DIRECTION_LABELS)).toEqual([...TRANSACTION_DIRECTIONS]);
        expect(Object.keys(TRANSACTION_OUTCOME_LABELS)).toEqual([...TRANSACTION_OUTCOMES]);
        expect(Object.keys(TRANSACTION_ROLE_LABELS)).toEqual([...TRANSACTION_ROLES]);
    });
});

describe('the row', () => {
    it('carries exactly the keys the mirror declares', () => {
        expect(Object.keys(transactionRowFixture())).toEqual(mirroredKeys('TransactionRowDto'));
    });

    it('carries exactly the link keys the mirror declares', () => {
        expect(Object.keys(transactionLinksFixture())).toEqual(
            mirroredKeys('TransactionLinksDto'),
        );
    });

    it('is keyed by kind AND id — an id alone names nothing', () => {
        const payment = transactionRowFixture({ kind: 'payment', id: 'a'.repeat(24) });
        const refund = transactionRowFixture({ kind: 'refund', id: 'a'.repeat(24) });

        expect(transactionRowKey(payment)).not.toBe(transactionRowKey(refund));
        expect(transactionPath(refund)).toBe(
            `/dashboard/money/transactions/refund/${'a'.repeat(24)}`,
        );
    });
});

describe('open vocabularies render, never throw', () => {
    it('shows a kind, an outcome or a reason this build has not heard of in words', () => {
        expect(transactionKindLabel('voucher_redemption')).toBe('voucher redemption');
        expect(transactionOutcomeLabel('disputed')).toBe('disputed');
        expect(transactionReasonLabel('some_new_reason')).toBe('some new reason');
    });

    it('gives `unknown` a label of its own rather than folding it into pending', () => {
        expect(transactionOutcomeLabel('unknown')).toBe('Unrecognised status');
        expect(transactionOutcomeLabel('unknown')).not.toBe(transactionOutcomeLabel('pending'));
    });

    it('names the bargain-fee account as the platform, not as a sixth role', () => {
        expect(transactionRoleLabel('platform_ai')).toBe('Platform (bargain fee)');
        expect(transactionRoleLabel('platform')).toBe('Platform');
    });
});

describe('where a row leads', () => {
    it('has a record screen for the five kinds the service answers with a recordPath', () => {
        const withScreen = TRANSACTION_KINDS.filter((kind) => transactionRecordScreen(kind));

        expect(withScreen).toEqual([
            'payment',
            'delivery_fee_refund',
            'payout',
            'cod_deposit',
            'cod_remittance',
        ]);
        expect(transactionRecordScreen('payout')?.path('abc')).toBe('/dashboard/money/payouts/abc');
        expect(transactionRecordScreen('some_new_kind')).toBeNull();
    });

    it('links a vendor, an agency and an agent to their own screens', () => {
        expect(transactionPartyScreen({ role: 'vendor', id: 'v1' })).toEqual({
            path: '/dashboard/vendors/v1',
            permission: 'vendors.read',
        });
        expect(transactionPartyScreen({ role: 'agency', id: 'a1' })?.path).toBe(
            '/dashboard/agencies/a1',
        );
        expect(transactionPartyScreen({ role: 'agent', id: 'g1' })?.path).toBe(
            '/dashboard/agents/g1',
        );
    });

    it('links a customer nowhere — the id is not a user id', () => {
        expect(transactionPartyScreen({ role: 'customer', id: 'c1' })).toBeNull();
    });

    it('links the platform nowhere — its accounts have no id', () => {
        expect(transactionPartyScreen({ role: 'platform', id: null })).toBeNull();
    });
});
