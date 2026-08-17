import { auditEntryFixture } from '@/test/fixtures';
import type {
    AuditActionCatalog,
    AuditActionCatalogEntry,
    AuditEntryDetail,
    AuditExport,
    LegacyAuditEntry,
    LegacyAuditListMeta,
} from '@/types/audit.types';

/**
 * The Phase-12 audit shapes: the entry detail, the action catalog, an export
 * manifest and a legacy row.
 *
 * A sibling file rather than more of `fixtures.ts`, following `money-fixtures.ts`
 * and `cod-fixtures.ts`. Several of these come in **pairs** — a normal one and
 * the awkward one beside it — because the awkward case is the one a screen gets
 * wrong, and a fixture that can only produce the happy shape lets it stay wrong.
 */

export function auditEntryDetailFixture(
    overrides: Partial<AuditEntryDetail> = {},
): AuditEntryDetail {
    return {
        ...auditEntryFixture(),
        payload: { tier: 2 },
        before: { tier: 3 },
        after: { tier: 2 },
        stateTruncated: false,
        ...overrides,
    };
}

/**
 * The shape the writer stores **instead of** the state when it is too large.
 *
 * The pair to `auditEntryDetailFixture`, and the reason it exists: `payload` here
 * is not a payload at all but `{ truncated, bytes, keys }`, so a screen that
 * renders it as JSON shows a three-key object as though it were the request.
 */
export function truncatedAuditEntryFixture(
    overrides: Partial<AuditEntryDetail> = {},
): AuditEntryDetail {
    return auditEntryDetailFixture({
        payload: {
            truncated: true,
            bytes: 262_144,
            keys: ['tier', 'status', 'reason'],
        },
        before: null,
        after: null,
        stateTruncated: true,
        ...overrides,
    });
}

/**
 * `GET /audit/actions`.
 *
 * ⚠ **`billing.subscriptions.assign_vendor` is load-bearing.** It carries
 * `target: 'vendor'` and genuinely appears on the vendor activity feed, but that
 * feed's `?action=` enum is built by *name prefix* and cannot select it. Any
 * derivation that filters by `target` instead of by prefix passes every other
 * test and fails this one, which is the entire point of it being here.
 */
export function auditActionCatalogFixture(
    overrides: Partial<AuditActionCatalog> = {},
): AuditActionCatalog {
    const actions: AuditActionCatalogEntry[] = [
        {
            name: 'vendors.suspend',
            family: 'vendors',
            target: 'vendor',
            transport: 'delegated',
            permission: 'vendors.suspend',
            summary: 'Suspend a vendor account',
        },
        {
            name: 'vendors.reinstate',
            family: 'vendors',
            target: 'vendor',
            transport: 'delegated',
            permission: 'vendors.reinstate',
            summary: 'Reinstate a suspended vendor',
        },
        {
            name: 'billing.subscriptions.assign_vendor',
            family: 'billing',
            target: 'vendor',
            transport: 'wi_admin_txn',
            permission: 'billing.subscriptions.assign',
            summary: 'Assign a plan to a vendor',
        },
        {
            name: 'money.payouts.mark_paid',
            family: 'money',
            target: 'payout',
            transport: 'delegated',
            permission: 'money.payouts.mark_paid',
            summary: 'Mark a payout request as paid — records that money has left the platform',
        },
        {
            name: 'money.earnings.read_platform',
            family: 'money',
            target: 'none',
            transport: 'observation',
            permission: 'money.earnings.read',
            summary: 'Read the platform earnings account',
        },
        {
            name: 'administrators.tier.change',
            family: 'administrators',
            target: 'administrator',
            transport: 'wi_admin_txn',
            permission: 'administrators.tier.change',
            summary: 'Change an administrator’s level',
        },
    ];

    return { actions, total: actions.length, ...overrides };
}

export function auditExportFixture(overrides: Partial<AuditExport> = {}): AuditExport {
    return {
        id: '66bd1122334455667788990a',
        status: 'complete',
        source: 'api',
        requestedBy: '665f1c2a9b3e4a91c7d2e5f0',
        requestedByName: 'Ada Nkemelu',
        rangeFrom: '2026-07-01T00:00:00.000Z',
        rangeTo: '2026-08-01T00:00:00.000Z',
        fileName: 'audit-2026-07-01_2026-08-01-66bd1122.ndjson',
        byteSize: 8_412_330,
        rowCount: 12_043,
        sha256: '9f2b8c1a',
        retentionDays: 365,
        startedAt: '2026-08-13T09:20:00.000Z',
        completedAt: '2026-08-13T09:20:07.442Z',
        stampedAt: '2026-08-13T09:20:07.501Z',
        stampedCount: 12_043,
        // Always null on an API export — purging lives in the CLI.
        purgedAt: null,
        purgedCount: null,
        failureReason: null,
        downloadable: true,
        ...overrides,
    };
}

/**
 * A CLI-written export: **no administrator behind it**.
 *
 * `requestedBy` and `requestedByName` are both `null`, which is a fact rather
 * than missing data — a screen that renders a blank cell here is reporting a bug
 * that does not exist.
 */
export function cliAuditExportFixture(overrides: Partial<AuditExport> = {}): AuditExport {
    return {
        ...auditExportFixture(),
        id: '66bd1122334455667788990b',
        source: 'cli',
        requestedBy: null,
        requestedByName: null,
        ...overrides,
    };
}

/** A `service` row: jovi-mall named a specific action. */
export function legacyAuditEntryFixture(
    overrides: Partial<LegacyAuditEntry> = {},
): LegacyAuditEntry {
    return {
        id: '66b0aabbccddeeff00112233',
        occurredAt: '2026-08-10T11:03:52.640Z',
        correlationId: 'c1d2e3f4-1111-2222-3333-444455556666',
        source: 'jovi-mall-legacy',
        kind: 'service',
        actor: {
            kind: 'platform_admin',
            // Rendered server-side so a client cannot present this as one of ours.
            label: 'Legacy admin session (jovi-mall)',
            userId: '6641aabbccddeeff00112233',
            role: 'admin',
            name: 'Jean Kamdem',
            ip: '41.202.219.90',
            userAgent: 'Mozilla/5.0',
        },
        request: {
            method: 'POST',
            path: '/api/admin/agencies/665c0011223344556677889a/deactivate',
            statusCode: 200,
            durationMs: 412,
        },
        action: 'DELIVERY_AGENCY_DEACTIVATED',
        resource: { type: 'delivery_agency', id: '665c0011223344556677889a' },
        params: { agencyId: '665c0011223344556677889a' },
        query: null,
        bodyKeys: ['reason'],
        changes: { status: { from: 'active', to: 'inactive' } },
        ...overrides,
    };
}

/**
 * A `request` row: the coarse per-request record.
 *
 * The pair to the above, and the one a feed gets wrong. `action`, `resource` and
 * `changes` are **all null** — the middleware recorded what was called, not what
 * it meant — so a screen must not synthesise an action for it or render three
 * blanks where an explanation belongs.
 */
export function legacyRequestRowFixture(
    overrides: Partial<LegacyAuditEntry> = {},
): LegacyAuditEntry {
    return legacyAuditEntryFixture({
        id: '66b0aabbccddeeff00112234',
        kind: 'request',
        action: null,
        resource: null,
        changes: null,
        bodyKeys: [],
        ...overrides,
    });
}

export function legacyAuditMetaFixture(
    overrides: Partial<LegacyAuditListMeta> = {},
): LegacyAuditListMeta {
    return {
        total: 218,
        page: 1,
        limit: 20,
        pages: 11,
        legacy: true,
        sourceService: 'jovi-mall',
        retiresAtCutover: true,
        // When this reaches 0 the feed and the shim behind it are deleted.
        unportedEndpoints: 37,
        ...overrides,
    };
}
