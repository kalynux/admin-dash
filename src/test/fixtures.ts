/**
 * Wire-shaped fixtures.
 *
 * Field for field what `docs/admin/api/auth.md` shows, so a test that passes here
 * is a test that would pass against the service — the whole point of writing them
 * out rather than reaching for `Partial<>` everywhere.
 */

import type {
    AdminProfile,
    AdminSessionSummary,
    AdminTier,
    AuthSessionInfo,
    IssuedSession,
    LoginChallengeResult,
    LoginEnrolmentResult,
} from '@/types/auth.types';
import type {
    AdminNotification,
    NotificationListMeta,
    NotificationPreference,
    NotificationSource,
} from '@/types/notifications.types';
import {
    PERMISSION_NAMES,
    type PermissionsMeResult,
    type PermissionCatalog,
    type PermissionCatalogEntry,
    type TierMatrix,
} from '@/types/permissions.types';
import type {
    Administrator,
    AdministratorSession,
    CreateAdministratorResult,
} from '@/types/administrators.types';
import type { Approval } from '@/types/approvals.types';
import type { AuditEntry, AuditListMeta } from '@/types/audit.types';
import type { CodOverview } from '@/types/cod.types';
import type { PlatformEarnings } from '@/types/money.types';
import type { MaintenanceWindow, OutboxSummary, SystemHealth } from '@/types/system.types';
import type {
    MissingRoleProfile,
    PlatformUser,
    RoleProfile,
    User,
    UserDetail,
    UserRole,
} from '@/types/users.types';
import type { OwnerAccount } from '@/types/accounts.types';
import type {
    PlatformVendor,
    Vendor,
    VendorDetail,
    VendorAgencyConnection,
    VendorProduct,
    VendorProductDetail,
} from '@/types/vendors.types';
import type { ReadinessReport } from '@/services/api';
import type { UserListMeta } from '@/services/users.service';
import type { VendorListMeta } from '@/services/vendors.service';

export function adminFixture(overrides: Partial<AdminProfile> = {}): AdminProfile {
    return {
        id: '665f1c2a9b3e4a91c7d2e5f0',
        email: 'ada@wimall.cm',
        displayName: 'Ada Nkemelu',
        tier: 2,
        status: 'active',
        jobTitle: 'Operations Lead',
        department: 'Operations',
        timezone: 'Africa/Douala',
        preferredLanguage: 'en',
        mfaEnrolled: false,
        mfaRequired: false,
        lastLoginAt: '2026-08-12T17:44:10.882Z',
        createdAt: '2026-03-02T08:00:00.000Z',
        ...overrides,
    };
}

export function sessionInfoFixture(overrides: Partial<AuthSessionInfo> = {}): AuthSessionInfo {
    return {
        sessionId: '0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a',
        authenticatedAt: '2026-08-13T07:02:44.019Z',
        expiresAt: '2026-08-20T07:02:44.019Z',
        authMethod: 'cookie',
        ...overrides,
    };
}

export function sessionSummaryFixture(
    overrides: Partial<AdminSessionSummary> = {},
): AdminSessionSummary {
    return {
        sessionId: '0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a',
        startedAt: '2026-08-13T07:02:44.019Z',
        absoluteExpiresAt: '2026-08-20T07:02:44.019Z',
        ip: '102.244.18.7',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
        mfaUsed: true,
        current: true,
        ...overrides,
    };
}

/** An ordinary sign-in: the full session, cookies set. */
export function issuedSessionFixture(admin: Partial<AdminProfile> = {}): IssuedSession {
    return {
        admin: adminFixture(admin),
        accessToken: 'eyJhbGciOiJIUzI1NiIs.access',
        refreshToken: 'eyJhbGciOiJIUzI1NiIs.refresh',
        expiresIn: 900,
        csrfToken: 'nJ8Qm3F7pQ2xVb',
    };
}

/** The second shape: no cookies, no session, five minutes to answer. */
export function loginChallengeFixture(): LoginChallengeResult {
    return { mfaRequired: true, challengeId: '7c1e0d2b-9a44-4d31-8f2c-0b6f1a3e9c55' };
}

/** The third shape: a real session scoped to the four enrolment routes. */
export function loginEnrolmentFixture(): LoginEnrolmentResult {
    return {
        ...issuedSessionFixture({ tier: 1, mfaRequired: true, mfaEnrolled: false }),
        mfaEnrolmentRequired: true,
    };
}

/**
 * The trap case: a tier-1 administrator who **is** enrolled signing in normally.
 *
 * Its `admin.mfaRequired` is `true` — the same word that means "present a code
 * now" one level up. A discriminator that reads the wrong depth calls this a
 * challenge and strands a completed login on a code screen.
 */
export function loginOrdinaryTier1Fixture(): IssuedSession {
    return issuedSessionFixture({ tier: 1, mfaRequired: true, mfaEnrolled: true });
}

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * A row from `GET /notifications`, field for field.
 *
 * The defaults are the worked example in `docs/admin/api/notifications.md`,
 * including the two that catch a lazy client: `readAt`/`archivedAt` are present
 * and `null` rather than absent, and `actionPath` arrives **without** this
 * dashboard's `/dashboard` prefix.
 */
export function notificationFixture(
    overrides: Partial<AdminNotification> = {},
): AdminNotification {
    return {
        id: '66c0aabbccddeeff00112233',
        type: 'cod.discrepancy.opened',
        severity: 'warning',
        title: 'Cash discrepancy opened',
        body: 'Eric T. — late deposit, XAF 84,500 held 6 days past the remittance window',
        source: 'cod_discrepancy_opened',
        target: {
            type: 'discrepancy',
            id: '6683aabbccddeeff00112233',
            label: 'late_deposit',
        },
        actionPath: '/cod/discrepancies/6683aabbccddeeff00112233',
        occurredAt: '2026-08-11T00:05:00.000Z',
        readAt: null,
        archivedAt: null,
        isRead: false,
        isArchived: false,
        ...overrides,
    };
}

/** `meta` on the inbox list — pagination plus the badge's number. */
export function notificationMetaFixture(
    overrides: Partial<NotificationListMeta> = {},
): NotificationListMeta {
    return { total: 41, page: 1, limit: 20, pages: 3, unreadCount: 12, ...overrides };
}

/**
 * One entry of `GET /notifications/sources`.
 *
 * The defaults are the doc's own first example. Note `describe`, **not**
 * `description`, and that `produces` and `severity` are both arrays — on a
 * preference the same-named `severity` is a single string.
 */
export function notificationSourceFixture(
    overrides: Partial<NotificationSource> = {},
): NotificationSource {
    return {
        id: 'cod_discrepancy_opened',
        describe: 'A cash discrepancy was opened against an agent or agency',
        collection: 'cod_discrepancies',
        produces: ['cod.discrepancy.opened'],
        requiredPermission: 'cod.discrepancies.read',
        severity: ['warning'],
        ...overrides,
    };
}

/**
 * One row of `GET /notifications/preferences`.
 *
 * The default is the *untouched* case — `overridden: false`, tracking the
 * catalog. That is the state a client is most likely to get wrong, because
 * `enabled === defaultEnabled` here and a control reading value equality would
 * look correct until an override happened to agree with the default.
 */
export function notificationPreferenceFixture(
    overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
    return {
        type: 'cod.discrepancy.opened',
        summary: 'A cash discrepancy was opened against an agent or agency',
        severity: 'warning',
        enabled: true,
        defaultEnabled: true,
        overridden: false,
        ...overrides,
    };
}

// ─── Overview tiles ───────────────────────────────────────────────────────────

/**
 * `GET /system/health`.
 *
 * Note `ok`, not `status` — the unauthenticated `/health/ready` probe reports
 * the same four connections the other way round, and conflating them is the
 * mistake these two fixtures exist to keep apart.
 */
export function systemHealthFixture(overrides: Partial<SystemHealth> = {}): SystemHealth {
    return {
        dependencies: {
            admin: { ok: true, durationMs: 3, database: 'wi_admin' },
            platform: { ok: true, durationMs: 4, database: 'jovi_mall' },
            redis: { ok: true, durationMs: 1 },
            joviMall: { configured: true, ok: true, durationMs: 27 },
        },
        audit: {
            danglingIntents: 2,
            danglingIntentsCappedAt: 100,
            oldestDanglingAt: '2026-08-12T22:41:03.118Z',
            retentionDays: 365,
        },
        ...overrides,
    };
}

/** `GET /health/ready` — `status` strings, and `mongo*` rather than `admin`/`platform`. */
export function readinessFixture(overrides: Partial<ReadinessReport> = {}): ReadinessReport {
    return {
        status: 'ready',
        service: 'wi-admin',
        dependencies: {
            mongoPlatform: { status: 'up', durationMs: 4, database: 'jovi_mall' },
            mongoAdmin: { status: 'up', durationMs: 3, database: 'wi_admin' },
            redis: { status: 'up', durationMs: 1 },
            joviMall: { status: 'up', durationMs: 27 },
        },
        timestamp: '2026-08-14T09:14:02.331Z',
        ...overrides,
    };
}

/** `GET /system/outbox`. `totalUnsent` is `pending + failed`, computed by the service. */
export function outboxSummaryFixture(overrides: Partial<OutboxSummary> = {}): OutboxSummary {
    return {
        depth: { pending: 3, failed: 1, sent: 412088 },
        oldestPendingAt: '2026-08-13T09:12:44.000Z',
        maxAttempts: 4,
        totalUnsent: 4,
        ...overrides,
    };
}

/** `GET /system/maintenance`. Defaults to `off`, which renders no banner at all. */
export function maintenanceFixture(overrides: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
    return {
        storedMode: 'off',
        effectiveMode: 'off',
        reason: null,
        blockWebhooks: false,
        pauseWorkers: false,
        startedAt: null,
        expiresAt: null,
        setBy: null,
        ...overrides,
    };
}

/** `GET /approvals`. `description` is the line written for the approver. */
export function approvalFixture(overrides: Partial<Approval> = {}): Approval {
    return {
        id: '66a0f31c8b2d4e5f60718293',
        action: 'money.payouts.mark_paid',
        description: 'Mark payout request PR-2026-004182 PAID — XAF 3,400,000 to Littoral Express',
        status: 'pending',
        requestedBy: '665f1c2a9b3e4a91c7d2e5f0',
        requestedByTier: 2,
        requestedByTierLabel: 'Admin',
        targetType: 'payout_request',
        targetId: '66a1b2c3d4e5f60718293a4b',
        payload: {},
        approverId: null,
        decidedAt: null,
        decisionNote: null,
        failureReason: null,
        expiresAt: '2026-08-15T09:00:00.000Z',
        createdAt: '2026-08-14T09:00:00.000Z',
        ...overrides,
    };
}

/** One `GET /audit` row. `actionSummary` is what makes a feed read without a lookup table. */
export function auditEntryFixture(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return {
        id: '66bc4f0a1d2e3f4a5b6c7d8e',
        occurredAt: '2026-08-14T14:22:09.117Z',
        completedAt: '2026-08-14T14:22:09.884Z',
        correlationId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
        action: 'money.payouts.mark_paid',
        actionSummary: 'Mark a payout request as paid — records that money has left the platform',
        actionFamily: 'money',
        status: 'succeeded',
        sensitive: true,
        actor: {
            kind: 'administrator',
            id: '665f1c2a9b3e4a91c7d2e5f0',
            email: 'ada@wimall.cm',
            displayName: 'Ada Nkemelu',
            tier: 2,
            sessionId: '0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a',
        },
        target: {
            type: 'payout',
            id: '66a1b2c3d4e5f60718293a4b',
            label: 'PR-2026-004182',
            subjectClass: 'platform_record',
        },
        relatedTarget: null,
        request: {
            method: 'POST',
            path: '/api/v1/money/payouts/66a1b2c3d4e5f60718293a4b/mark-paid',
            ip: '102.244.18.7',
            userAgent: 'Mozilla/5.0',
        },
        outcome: {
            code: null,
            statusCode: 200,
            message: null,
            denialKind: null,
            requiredPermissions: [],
            platformCode: null,
        },
        viaApprovalId: null,
        delegated: true,
        exportedAt: null,
        purgeAfter: null,
        ...overrides,
    };
}

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * One `GET /users` row.
 *
 * **`suspension` is `null` here because `status` is `active`** — the service keys
 * the whole block on status, so a fixture pairing an active account with a
 * populated suspension would let a screen pass a test it could never pass live.
 * `suspendedUserFixture` is the other half of that pair.
 */
export function userFixture(overrides: Partial<User> = {}): User {
    return {
        id: '665f1c2a9b3e4a91c7d2e5f0',
        email: 'amina@example.cm',
        phone: '+237670112233',
        roles: ['customer', 'agent'],
        status: 'active',
        suspension: null,
        createdAt: '2026-02-14T10:05:31.220Z',
        updatedAt: '2026-08-01T08:12:44.907Z',
        ...overrides,
    };
}

/**
 * A suspended account, with the stamp the reads return.
 *
 * `by.source` is `'admin'`, which is the ordinary case for anything this
 * dashboard did: administrators live in a separate database, so `by.id` resolves
 * nowhere in jovi-mall and `by.name` is the only readable record of who acted.
 */
export function suspendedUserFixture(overrides: Partial<User> = {}): User {
    return userFixture({
        status: 'suspended',
        suspension: {
            at: '2026-08-13T09:31:02.118Z',
            reason: 'Fraudulent chargebacks on orders ORD-2026-8841 and ORD-2026-8902',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin', name: 'Ada Nkemelu' },
        },
        ...overrides,
    });
}

/** One healthy `profiles[]` entry. `verified` is vendor/agency only, `kycStatus` agent only. */
export function roleProfileFixture(overrides: Partial<RoleProfile> = {}): RoleProfile {
    return {
        role: 'customer',
        id: '665f1c2a9b3e4a91c7d2e5f1',
        name: 'Amina B.',
        status: 'active',
        verified: null,
        kycStatus: null,
        createdAt: '2026-02-14T10:05:31.400Z',
        ...overrides,
    };
}

/**
 * A claimed role whose entity does not exist.
 *
 * Every field is `null` and `missing` is present — the key is **absent** on a
 * healthy entry rather than `false`, which is what `isMissingProfile` narrows on.
 */
export function missingRoleProfileFixture(role: UserRole = 'agent'): MissingRoleProfile {
    return {
        role,
        id: null,
        name: null,
        status: null,
        verified: null,
        kycStatus: null,
        createdAt: null,
        missing: true,
    };
}

/** `GET /users/:userId` — every list field plus one entry per role, in `roles` order. */
export function userDetailFixture(overrides: Partial<UserDetail> = {}): UserDetail {
    return {
        ...userFixture(),
        profiles: [
            roleProfileFixture(),
            roleProfileFixture({
                role: 'agent',
                id: '665f1c2a9b3e4a91c7d2e5f2',
                name: 'Amina B.',
                kycStatus: 'verified',
            }),
        ],
        ...overrides,
    };
}

/** `meta` on `GET /users` — the four standard keys, nothing else. */
export function userListMetaFixture(overrides: Partial<UserListMeta> = {}): UserListMeta {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}

/**
 * What a **delegated write** answers: jovi-mall's flat DTO.
 *
 * Deliberately a different shape from `userFixture` — flat `suspendedAt` /
 * `suspendedReason` / `suspendedBy`, and no `profiles`. Tests that assert a write
 * is followed by a refetch depend on this being the wrong shape to merge.
 */
export function platformUserFixture(overrides: Partial<PlatformUser> = {}): PlatformUser {
    return {
        id: '665f1c2a9b3e4a91c7d2e5f0',
        email: 'amina.b@example.cm',
        phone: null,
        roles: ['customer', 'agent'],
        status: 'active',
        suspendedAt: null,
        suspendedReason: null,
        suspendedBy: null,
        createdAt: '2026-02-14T10:05:31.220Z',
        updatedAt: '2026-08-13T09:31:02.118Z',
        ...overrides,
    };
}

// ─── Administrators ───────────────────────────────────────────────────────────

/**
 * One `/administrators` row.
 *
 * **Deliberately carries no `mfaRequired` key**, and that absence is the point:
 * it is the field `AdminProfile` has and this projection does not, so a screen
 * that wrongly reused the auth-store shape would pass against a fixture that
 * quietly supplied it. `timezone` and `preferredLanguage` are non-null here,
 * unlike on `AdminProfile`, for the same reason.
 *
 * Tier 3 by default so the common case in a test is a target somebody may act
 * on — override `tier` to exercise the escalation rules.
 */
export function administratorFixture(overrides: Partial<Administrator> = {}): Administrator {
    return {
        id: '665f1c2a9b3e4a91c7d2e5f0',
        email: 'sam@wimall.cm',
        displayName: 'Samuel Etoo',
        tier: 3,
        tierLabel: 'Support',
        status: 'active',
        jobTitle: 'Support Agent',
        department: 'Customer Care',
        timezone: 'Africa/Douala',
        preferredLanguage: 'en',
        mfaEnrolled: false,
        lastLoginAt: '2026-08-13T07:02:44.019Z',
        createdBy: '6650aabbccddeeff00112233',
        suspendedAt: null,
        suspendedBy: null,
        suspendedReason: null,
        tierChangedAt: null,
        tierChangedBy: null,
        createdAt: '2026-02-14T10:05:31.220Z',
        ...overrides,
    };
}

/** The bootstrap administrator: tier 1, and the one record whose `createdBy` is `null`. */
export function bootstrapAdministratorFixture(
    overrides: Partial<Administrator> = {},
): Administrator {
    return administratorFixture({
        id: '6650aabbccddeeff00112233',
        email: 'ada@wimall.cm',
        displayName: 'Ada N.',
        tier: 1,
        tierLabel: 'Developer',
        jobTitle: 'Platform Engineer',
        department: 'Engineering',
        mfaEnrolled: true,
        createdBy: null,
        ...overrides,
    });
}

/** The paired half — all three suspension fields set, which reinstating clears. */
export function suspendedAdministratorFixture(
    overrides: Partial<Administrator> = {},
): Administrator {
    return administratorFixture({
        status: 'suspended',
        suspendedAt: '2026-08-12T14:22:09.771Z',
        suspendedBy: '6650aabbccddeeff00112233',
        suspendedReason: 'Offboarding — left the company 2026-08-12',
        ...overrides,
    });
}

/**
 * One row of `GET /administrators/:adminId/sessions` — the **richer**
 * admin-on-admin projection.
 *
 * ⚠ `current` is `false`, unlike `sessionSummaryFixture`: every session on this
 * route belongs to somebody else, so a test that expects a "this device" badge
 * here is testing the wrong screen.
 */
export function administratorSessionFixture(
    overrides: Partial<AdministratorSession> = {},
): AdministratorSession {
    return {
        sessionId: '0f9c8b7a-4d3e-4c21-9a8b-7c6d5e4f3a2b',
        startedAt: '2026-08-13T07:02:44.019Z',
        absoluteExpiresAt: '2026-08-20T07:02:44.019Z',
        ip: '102.244.18.7',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        mfaUsed: true,
        current: false,
        endedAt: null,
        endReason: null,
        lastSeenAt: '2026-08-13T09:11:20.004Z',
        tierAtLogin: 2,
        ...overrides,
    };
}

/** A finished session, as `?includeEnded=true` returns it. */
export function endedAdministratorSessionFixture(
    overrides: Partial<AdministratorSession> = {},
): AdministratorSession {
    return administratorSessionFixture({
        sessionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        endedAt: '2026-08-13T11:40:00.000Z',
        endReason: 'tier_changed',
        ...overrides,
    });
}

/** `POST /administrators` · 201 — the record plus the password shown exactly once. */
export function createAdministratorResultFixture(
    overrides: Partial<CreateAdministratorResult> = {},
): CreateAdministratorResult {
    return {
        administrator: administratorFixture(),
        oneTimePassword: 'kR7$mQ2pXv9!nB4wTz3Ld6Hy',
        ...overrides,
    };
}

/**
 * `GET /permissions/tiers`, built from the tier sets below.
 *
 * **Legal here and nowhere else.** App code must never import
 * `TIER_1_PERMISSIONS` and friends — the matrix comes from the endpoint, and
 * hard-coding it in `src/` is the one thing `CLAUDE.md` singles out as wrong.
 */
export function tierMatrixFixture(overrides: Partial<TierMatrix> = {}): TierMatrix {
    return {
        tiers: [
            { tier: 1, label: 'Developer', permissions: [...TIER_1_PERMISSIONS].sort(), total: TIER_1_PERMISSIONS.length },
            { tier: 2, label: 'Admin', permissions: [...TIER_2_PERMISSIONS].sort(), total: TIER_2_PERMISSIONS.length },
            { tier: 3, label: 'Support', permissions: [...TIER_3_PERMISSIONS].sort(), total: TIER_3_PERMISSIONS.length },
        ],
        ...overrides,
    };
}

/**
 * `GET /permissions/catalog` — a small, representative slice rather than all 116.
 *
 * Deliberately mixes the cases the matrix screen has to tell apart: an ordinary read, a
 * `destructive` write that no family grant can confer, and **a `†` permission whose endpoint
 * does not exist** (`support.tickets.read`), which is the row the screen must mark so that
 * "I hold this" and "there is a screen for this" stop looking like the same fact.
 */
export function permissionCatalogFixture(
    overrides: Partial<PermissionCatalog> = {},
): PermissionCatalog {
    const permissions: PermissionCatalogEntry[] = [
        {
            name: 'system.health.read',
            family: 'system',
            action: 'read',
            summary: 'View database, cache and downstream service health',
            financial: false,
            escalation: false,
            destructive: false,
            dualControl: false,
            scoped: false,
            phase: 14,
        },
        {
            name: 'developer_tools.cache.flush',
            family: 'developer_tools',
            action: 'write',
            summary: 'Delete cached keys from a named Redis database on the platform service',
            financial: false,
            escalation: false,
            destructive: true,
            dualControl: false,
            scoped: false,
            phase: 14,
        },
        {
            // Routed since Phase 5 Part B, and `scoped:tickets` — kept here as
            // the row-scope example, no longer as the "no endpoint" one.
            name: 'support.tickets.read',
            family: 'support',
            action: 'read',
            summary: 'View support tickets',
            financial: false,
            escalation: false,
            destructive: false,
            dualControl: false,
            scoped: true,
            phase: 5,
        },
        {
            // One of the **four** remaining `†`: catalogued policy with no
            // endpoint. Service-wide wording would block a tier-3 administrator
            // configuring their own preferences, which they already may.
            name: 'notifications.manage',
            family: 'notifications',
            action: 'write',
            summary: 'Configure which events raise an administrator alert',
            financial: false,
            escalation: false,
            destructive: false,
            dualControl: false,
            scoped: false,
            phase: 13,
        },
    ];

    return {
        families: [
            { family: 'system', permissions: ['system.health.read'] },
            { family: 'developer_tools', permissions: ['developer_tools.cache.flush'] },
            { family: 'support', permissions: ['support.tickets.read'] },
            { family: 'notifications', permissions: ['notifications.manage'] },
        ],
        permissions,
        total: permissions.length,
        ...overrides,
    };
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

/**
 * One `GET /vendors` row.
 *
 * **`onboardingStep: 0` with `onboardingComplete: true`** — the inversion, paired
 * the way the service pairs it. A fixture with a non-zero step and `complete: true`
 * would let a screen that re-derived the boolean wrongly pass.
 */
export function vendorFixture(overrides: Partial<Vendor> = {}): Vendor {
    return {
        id: '6650aa11bb22cc33dd44ee55',
        userId: '665f1c2a9b3e4a91c7d2e5f0',
        businessName: 'Douala Fresh Market',
        storeSlug: 'douala-fresh-market',
        displayName: 'Marcel T.',
        email: 'marcel@doualafresh.cm',
        phone: '+237699887766',
        country: 'CM',
        status: 'active',
        kycStatus: 'verified',
        verified: true,
        onboardingStep: 0,
        onboardingComplete: true,
        createdAt: '2025-11-03T09:14:00.000Z',
        updatedAt: '2026-08-02T11:20:14.311Z',
        ...overrides,
    };
}

/**
 * A vendor part-way through onboarding, with no store yet.
 *
 * The nullability the docs never annotate: no store means **no business name and
 * no slug**, so this is the fixture that proves `vendorDisplayName` falls through
 * rather than rendering an empty cell.
 */
export function onboardingVendorFixture(overrides: Partial<Vendor> = {}): Vendor {
    return vendorFixture({
        id: '6650aa11bb22cc33dd44ee56',
        businessName: null,
        storeSlug: null,
        status: 'pending_verification',
        kycStatus: 'pending',
        verified: false,
        onboardingStep: 2,
        onboardingComplete: false,
        ...overrides,
    });
}

/**
 * A suspended vendor.
 *
 * `suspension.fromStatus` is populated because a restore returns them to it — and
 * it is `'active'` here, never `'inactive'`, matching the model's enum.
 */
export function suspendedVendorFixture(overrides: Partial<Vendor> = {}): Vendor {
    return vendorFixture({ status: 'inactive', ...overrides });
}

/** `meta` on `GET /vendors`. `businessNameMatchesTruncated` is **absent** unless set. */
export function vendorListMetaFixture(overrides: Partial<VendorListMeta> = {}): VendorListMeta {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}

/**
 * `GET /vendors/:vendorId`, in full.
 *
 * Two blocks are shaped from `backend/admin`'s repositories rather than from the
 * docs, because the docs are wrong about both: `counts.products` carries **six**
 * keys including zeros (the doc shows four and claims zeros are omitted), and
 * `counts.agencyConnections` carries **seven** with `pausedReapproval` (the doc
 * shows three and names a `paused` key that does not exist).
 */
export function vendorDetailFixture(overrides: Partial<VendorDetail> = {}): VendorDetail {
    return {
        ...vendorFixture(),
        store: {
            id: '6650aa11bb22cc33dd44ee60',
            name: 'Douala Fresh Market',
            slug: 'douala-fresh-market',
            description: 'Fruit, vegetables and dry goods.',
            logoFileId: '6650aa11bb22cc33dd44ee61',
            bannerFileId: null,
            supportEmail: 'help@doualafresh.cm',
            supportPhone: '+237699887766',
            supportWhatsapp: '+237699887766',
            isOpen: true,
            createdAt: '2025-11-03T09:20:00.000Z',
        },
        account: {
            id: '665f1c2a9b3e4a91c7d2e5f0',
            email: 'marcel@doualafresh.cm',
            phone: '+237699887766',
            roles: ['vendor'],
            status: 'active',
            suspension: null,
        },
        suspension: null,
        verification: {
            status: 'verified',
            verified: true,
            rejectionReason: null,
            verifiedAt: '2025-11-08T14:00:00.000Z',
            reviewedBy: {
                id: '665f1c2a9b3e4a91c7d2e5f0',
                source: 'admin',
                name: 'Ada Nkemelu',
            },
        },
        contact: {
            emailVerified: true,
            phoneVerified: true,
            whatsappVerified: false,
            timezone: 'Africa/Douala',
            preferredLanguage: 'fr',
        },
        addresses: [
            {
                id: '6650aa11bb22cc33dd44ee70',
                label: 'Warehouse',
                addressLine1: 'Rue Njo-Njo 14',
                addressLine2: null,
                city: 'Douala',
                state: 'Littoral',
            },
        ],
        /**
         * **Content as well as presence**, since the dashboard-request round.
         * The three booleans are now *derived* from the blocks below, so
         * `hasSupportPolicy: false` is paired with `support: null` — a fixture
         * where they disagreed would let a panel pass against a shape the
         * server cannot send.
         */
        policies: {
            policyVersion: 3,
            hasReturnPolicy: true,
            hasCancellationPolicy: true,
            hasSupportPolicy: false,
            returns: {
                returnEligible: true,
                returnWindowDays: 14,
                refundType: 'partial',
                refundPercentage: 80,
                returnShippingPayer: 'customer_reimbursed_if_defect',
                refundProcessingDays: 5,
                returnConditionNotes: 'Unopened packaging only',
                // Administrator-controlled upstream, never vendor input.
                inspector: 'platform',
            },
            cancellation: {
                cancellable: true,
                cancellationDeadline: 'before_dispatch',
                cancellationDeadlineDays: null,
                cancellationFeeType: 'percentage',
                cancellationFeeValue: 10,
                lateCancellationRefundType: 'partial',
                lateCancellationRefundValue: 50,
            },
            support: null,
            documents: [],
        },
        settings: {
            autoRedirectOrdersToAgency: false,
            autoRedirectThresholdAmount: null,
            autoCancelUnpaidDays: 3,
            notifyDaysBeforeExpiry: 7,
        },
        defaultDeliveryAgencyId: '665c0011223344556677889a',
        counts: {
            products: {
                total: 153,
                draft: 9,
                active: 128,
                archived: 14,
                pendingReview: 0,
                suspended: 2,
            },
            orders: { total: 3401, lastOrderAt: '2026-08-13T06:41:09.220Z' },
            agencyConnections: {
                total: 3,
                active: 2,
                pending: 1,
                pausedReapproval: 0,
                rejected: 0,
                withdrawn: 0,
                terminated: 0,
            },
        },
        ...overrides,
    };
}

/** The suspended half of the detail pair — `suspension` is non-null only here. */
export function suspendedVendorDetailFixture(
    overrides: Partial<VendorDetail> = {},
): VendorDetail {
    return vendorDetailFixture({
        status: 'inactive',
        suspension: {
            at: '2026-08-13T09:40:11.502Z',
            reason: 'Mislabelled weights across the produce catalogue',
            fromStatus: 'active',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin', name: 'Ada Nkemelu' },
        },
        ...overrides,
    });
}

/** One catalogue row, on sale. `suspension` is `null` because `status` is not `suspended`. */
export function vendorProductFixture(overrides: Partial<VendorProduct> = {}): VendorProduct {
    return {
        id: '66601122334455667788990a',
        title: 'Plantain — 1 kg',
        slug: 'plantain-1kg',
        category: 'produce',
        type: 'physical',
        status: 'active',
        mode: 'simple',
        hasVariants: false,
        suspension: null,
        /**
         * **Replaces `deliveryAgencyId`** — a breaking rename. An object rather
         * than an id removes an N+1 and a permission question: the catalogue tab
         * needs `vendors.read` alone, so a caller without `agencies.read` could
         * not have resolved the name.
         */
        deliveryAgency: {
            id: '665c0011223344556677889a',
            businessName: 'Littoral Express Delivery',
        },
        lastOrderedAt: '2026-08-09T18:22:00.000Z',
        createdAt: '2026-01-20T07:00:00.000Z',
        updatedAt: '2026-08-10T13:02:41.008Z',
        ...overrides,
    };
}

/**
 * A listing an **administrator** took down.
 *
 * The only reason the per-product restore endpoint will lift — which is what makes
 * this and `agencySuspendedProductFixture` a pair worth having: the same status,
 * different reasons, and only one of them may be offered a "put back" button.
 */
export function oversightSuspendedProductFixture(
    overrides: Partial<VendorProduct> = {},
): VendorProduct {
    return vendorProductFixture({
        id: '66601122334455667788990b',
        title: 'Cassava flour — 5 kg',
        status: 'suspended',
        suspension: {
            reason: 'platform_oversight',
            previousStatus: 'active',
            at: '2026-08-10T13:02:41.008Z',
            byAgencyId: null,
            note: 'Mislabelled weight — three customer complaints',
        },
        ...overrides,
    });
}

/** A listing an **agency** cascade took down. The restore endpoint refuses it, 422. */
export function agencySuspendedProductFixture(
    overrides: Partial<VendorProduct> = {},
): VendorProduct {
    return vendorProductFixture({
        id: '66601122334455667788990c',
        title: 'Palm oil — 20 L',
        status: 'suspended',
        suspension: {
            reason: 'agency_storage_suspended',
            previousStatus: 'active',
            at: '2026-08-11T08:00:00.000Z',
            byAgencyId: '665c0011223344556677889a',
            note: null,
        },
        ...overrides,
    });
}

/**
 * `GET /vendors/:vendorId/products/:productId` — one listing, in full.
 *
 * ⚠ Deliberately the **awkward** case rather than the tidy one, because every
 * reading trap on this payload is a trap about a *state* rather than a number:
 * stock is tracked, the listing is warehoused, and the variants disagree on
 * price, so the panels have something real to render for each. The absent
 * states get their own fixtures below — they are not `overrides` of this one,
 * because "untracked" and "not warehoused" are what a screen is most likely to
 * flatten and each deserves a named starting point.
 *
 * `vendorId` and `tags` are on the wire and are **not** in `vendors.md`; they
 * are here because the source that computes the payload declares them. See
 * `VendorProductDetail`.
 */
export function vendorProductDetailFixture(
    overrides: Partial<VendorProductDetail> = {},
): VendorProductDetail {
    return {
        id: '66601122334455667788990a',
        vendorId: '6650aa11bb22cc33dd44ee55',
        title: 'Plantain — 1 kg',
        slug: 'plantain-1kg',
        category: 'produce',
        tags: ['produce', 'fresh'],
        type: 'physical',
        status: 'active',
        mode: 'simple',
        hasVariants: true,
        suspension: null,
        media: {
            images: [
                {
                    id: '6612aabbccddeeff00112233',
                    key: 'vendors/6650aa11bb22cc33dd44ee55/plantain-1.jpg',
                    // A public tree, so a real URL — which is what lets the
                    // gallery render without an audited content fetch.
                    url: 'https://cdn.example.com/vendors/6650aa11bb22cc33dd44ee55/plantain-1.jpg',
                    access: 'public',
                    mimeType: 'image/jpeg',
                    size: 148213,
                    originalName: 'plantain.jpg',
                },
            ],
            primaryImage: {
                id: '6612aabbccddeeff00112233',
                key: 'vendors/6650aa11bb22cc33dd44ee55/plantain-1.jpg',
                url: 'https://cdn.example.com/vendors/6650aa11bb22cc33dd44ee55/plantain-1.jpg',
                access: 'public',
                mimeType: 'image/jpeg',
                size: 148213,
                originalName: 'plantain.jpg',
            },
        },
        pricing: { amount: 4500, compareAtAmount: 5200, currency: 'XAF', range: null },
        inventory: {
            tracked: true,
            available: 42,
            reserved: 6,
            sellable: 36,
            // ⚠ Always null at product level — the alert is per SKU.
            lowStockThreshold: null,
            allowOversell: false,
        },
        deliveryAgency: {
            id: '665c0011223344556677889a',
            businessName: 'Littoral Express Delivery',
            status: 'active',
        },
        storage: {
            basis: 'per_sku_monthly',
            storageBasedEnabled: true,
            monthlyRatePerSku: 500,
            quantity: 42,
            monthlyEstimate: 21000,
            currency: 'XAF',
            // ⚠ Null at product level: a gallery of different-sized variants has
            // no single size.
            size: null,
        },
        variants: [
            {
                id: '6613aabbccddeeff00112233',
                name: '1 kg',
                sku: 'PLT-1KG',
                status: 'active',
                amount: 4500,
                compareAtAmount: 5200,
                inventory: {
                    tracked: true,
                    available: 42,
                    reserved: 6,
                    sellable: 36,
                    lowStockThreshold: 10,
                    allowOversell: false,
                },
                storage: {
                    basis: 'per_sku_monthly',
                    storageBasedEnabled: true,
                    monthlyRatePerSku: 500,
                    quantity: 42,
                    monthlyEstimate: 21000,
                    currency: 'XAF',
                    size: {
                        lengthCm: 30,
                        widthCm: 20,
                        heightCm: 12,
                        volumeCm3: 7200,
                        weightG: 1000,
                        source: 'variant',
                    },
                },
            },
        ],
        lastOrderedAt: '2026-08-09T18:22:00.000Z',
        createdAt: '2026-01-20T07:00:00.000Z',
        updatedAt: '2026-08-10T13:02:41.008Z',
        ...overrides,
    };
}

/**
 * A listing whose stock is **not counted**, and which nobody warehouses.
 *
 * ⚠ The two states this exists for are the two a screen is most likely to
 * flatten into a zero: `inventory.tracked: false` (every count below is `null`,
 * and `available: 0` would mean something completely different) and
 * `storage: null` (not warehoused at all — **not** a rent of zero).
 */
export function untrackedProductDetailFixture(
    overrides: Partial<VendorProductDetail> = {},
): VendorProductDetail {
    const untracked = {
        tracked: false,
        available: null,
        reserved: null,
        sellable: null,
        lowStockThreshold: null,
        allowOversell: true,
    };

    return vendorProductDetailFixture({
        id: '66601122334455667788990d',
        title: 'Recipe pack — download',
        type: 'digital',
        tags: [],
        inventory: untracked,
        deliveryAgency: null,
        storage: null,
        media: { images: [], primaryImage: null },
        /*
         * ⚠ The variant is untracked too, and that is not tidiness: the product
         * roll-up sets `tracked: false` when **any** active variant is
         * infinite-stock, so a fixture whose product is untracked while its only
         * variant counts stock is a shape the service cannot produce — and a
         * screen tested against it would look right while flattening exactly the
         * distinction the flag exists for.
         */
        variants: [
            {
                id: '6613aabbccddeeff00112255',
                name: null,
                sku: 'RCP-PACK',
                status: 'active',
                amount: 2500,
                compareAtAmount: null,
                inventory: untracked,
                storage: null,
            },
        ],
        ...overrides,
    });
}

/**
 * A **broken** listing: no variants at all, so no price.
 *
 * ⚠ `pricing: null` is not "free" and not "we could not load it" — the product
 * cannot be bought in this state, and saying so is the point.
 */
export function unpricedProductDetailFixture(
    overrides: Partial<VendorProductDetail> = {},
): VendorProductDetail {
    return vendorProductDetailFixture({
        id: '66601122334455667788990e',
        title: 'Draft listing',
        status: 'draft',
        hasVariants: false,
        pricing: null,
        variants: [],
        ...overrides,
    });
}

/**
 * A row of `GET /vendors/:vendorId/agencies` — one delivery-agency connection.
 *
 * ⚠ `reapproval` is **always a block, never `null`**: it is a state rather than
 * an event, so on a row that is not paused these three nulls truthfully mean
 * "not paused". The three event blocks below it are the opposite — `null` when
 * they did not happen, a whole object when they did.
 */
export function vendorAgencyConnectionFixture(
    overrides: Partial<VendorAgencyConnection> = {},
): VendorAgencyConnection {
    return {
        id: '6690aabbccddeeff00112233',
        agency: {
            id: '665c0011223344556677889a',
            businessName: 'Littoral Express Delivery',
            status: 'active',
            // ⚠ A PERSON, never the business.
            contactName: 'Nadege Mballa',
            country: 'CM',
        },
        status: 'active',
        isDefault: true,
        productCount: 42,
        requestedBy: 'agency',
        requestedAt: '2026-02-11T09:00:00.000Z',
        respondedAt: '2026-02-11T14:20:00.000Z',
        policyVersions: { vendorAtApproval: 3, agencyAtApproval: 7 },
        reapproval: { requiredFrom: null, pausedAt: null, pausedReason: null },
        rejection: null,
        withdrawal: null,
        termination: null,
        createdAt: '2026-02-11T09:00:00.000Z',
        updatedAt: '2026-08-02T10:11:00.000Z',
        ...overrides,
    };
}

/**
 * What a **delegated vendor write** answers: jovi-mall's narrower DTO.
 *
 * Deliberately not the detail shape — no `store`, no `account`, no `counts` — so a
 * test asserting that a write is followed by a refetch depends on this being the
 * wrong thing to merge. The cascade counts are the fields that exist *only* here.
 */
export function platformVendorFixture(overrides: Partial<PlatformVendor> = {}): PlatformVendor {
    return {
        id: '6650aa11bb22cc33dd44ee55',
        userId: '665f1c2a9b3e4a91c7d2e5f0',
        displayName: 'Marcel T.',
        email: 'marcel@doualafresh.cm',
        phone: '+237699887766',
        country: 'CM',
        status: 'inactive',
        suspension: {
            at: '2026-08-13T09:40:11.502Z',
            reason: 'Mislabelled weights across the produce catalogue',
            fromStatus: 'active',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin', name: 'Ada Nkemelu' },
        },
        verification: {
            status: 'verified',
            verified: true,
            rejectionReason: null,
            verifiedAt: '2025-11-08T14:00:00.000Z',
            reviewedBy: {
                id: '665f1c2a9b3e4a91c7d2e5f0',
                source: 'admin',
                name: 'Ada Nkemelu',
            },
        },
        onboardingStep: 0,
        createdAt: '2025-11-03T09:14:00.000Z',
        updatedAt: '2026-08-13T09:40:11.502Z',
        suspendedProductCount: 128,
        suspendedProductIds: ['66601122334455667788990a'],
        ...overrides,
    };
}

/**
 * `GET /accounts/vendor/:vendorId`.
 *
 * **Four fields are `null` and must stay that way**: `balances.codCash`,
 * `codExposure`, `flags.openDiscrepancies` and `flags.overCodThreshold`. A vendor
 * cannot hold cash, so those questions do not apply — writing `0` into any of them
 * would let a screen that renders "does not apply" as "zero" pass.
 */
export function vendorAccountFixture(overrides: Partial<OwnerAccount> = {}): OwnerAccount {
    return {
        owner: {
            type: 'vendor',
            id: '6650aa11bb22cc33dd44ee55',
            name: 'Douala Fresh Market',
            userId: '665f1c2a9b3e4a91c7d2e5f0',
            status: 'active',
            suspended: false,
            suspendedReason: null,
            createdAt: '2025-11-03T09:14:00.000Z',
        },
        profile: {
            email: 'marcel@doualafresh.cm',
            emailVerified: true,
            phone: '+237699887766',
            phoneVerified: true,
            country: 'CM',
            timezone: 'Africa/Douala',
            preferredLanguage: 'fr',
            kycStatus: 'verified',
            kycVerified: true,
            kycVerifiedAt: '2025-11-08T14:00:00.000Z',
            kycRejectionReason: null,
            onboardingStep: 0,
        },
        subscription: {
            subscriberPlanId: '6660aa11bb22cc33dd44ee01',
            planId: '6660aa11bb22cc33dd44ee02',
            planCode: 'vendor_growth',
            planName: 'Vendor Growth',
            status: 'active',
            startedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
            notifyDaysBeforeExpiry: 7,
            assignedBy: null,
            paymentReference: 'MTN-8841',
            allowanceGranted: true,
            entitlements: {
                planCode: 'vendor_growth',
                commissionPercent: 12,
                maxActiveProducts: 500,
                maxStorageBytes: 5_000_000_000,
                // Delivery limits — not part of a vendor plan.
                maxUnterminatedShipments: null,
                liveTrackingEnabled: null,
            },
        },
        balances: {
            earnings: {
                unit: 'money',
                currency: 'XAF',
                direction: 'owed_to_owner',
                pending: 412_000,
                available: 1_248_500,
                reserve: 0,
                requested: 0,
            },
            credits: {
                unit: 'credit',
                currency: null,
                direction: 'spendable_by_owner',
                balance: 340,
                walletExists: true,
            },
            codCash: null,
        },
        codExposure: null,
        payouts: {
            pendingCount: 0,
            pendingAmount: null,
            currency: 'XAF',
            lastPaidAt: '2026-07-30T12:00:00.000Z',
            lastPaidAmount: 900_000,
            destination: {
                method: 'mobile_money',
                isPreferred: true,
                masked: {
                    // `null` digits are the contract here, not a gap in the fixture:
                    // the projection behind this endpoint never reads the number.
                    mobileMoney: {
                        provider: 'MTN',
                        phoneNumberMasked: null,
                        accountName: 'Marcel Tchoumi',
                    },
                    bank: null,
                    card: null,
                },
                full: null,
                revealed: false,
            },
        },
        flags: {
            openDiscrepancies: null,
            unsettledCollections: 2,
            shipmentCapAlertedAt: null,
            overCodThreshold: null,
        },
        ...overrides,
    };
}

/** `meta` on the audit feed — `oldestRetainedAt` is the one the UI must render. */
export function auditMetaFixture(overrides: Partial<AuditListMeta> = {}): AuditListMeta {
    return {
        total: 4127,
        page: 1,
        limit: 6,
        pages: 688,
        retentionDays: 365,
        oldestRetainedAt: '2025-08-14T09:00:00.000Z',
        ...overrides,
    };
}

/**
 * `GET /cod/overview`, whose shape wi-admin passes through untyped.
 *
 * Field for field what `backend/jovi-mall`'s `CodSummaryService.adminOverview()`
 * builds. **No currency** — the aggregation groups on the balance alone.
 */
export function codOverviewFixture(overrides: Partial<CodOverview> = {}): CodOverview {
    return {
        cashHeldByAgents: { total: 1_284_500, agentsHoldingCash: 37 },
        agencyLiabilities: { total: 4_120_000, agenciesOwing: 6 },
        unsettledCollections: { count: 18, amount: 942_000 },
        ...overrides,
    };
}

/**
 * `GET /money/earnings/platform`.
 *
 * `reserve` and `requested`, **not** the `reserved`/`withdrawn` that
 * `money.md`'s prose names — see `types/money.types.ts` for the three sources
 * that settle it. `requested` is structurally `0`: the platform never pays
 * itself out.
 */
export function platformEarningsFixture(
    overrides: Partial<PlatformEarnings> = {},
): PlatformEarnings {
    return {
        pending: 2_310_000,
        available: 8_640_500,
        reserve: 450_000,
        requested: 0,
        currency: 'XAF',
        ...overrides,
    };
}

// ─── Permission sets ──────────────────────────────────────────────────────────

/**
 * The level → permission matrix, **for tests only**.
 *
 * `docs/admin/api/permissions.md` says "Do not hard-code the matrix below into
 * the dashboard", and that holds: **nothing under `src/` outside `src/test/` may
 * import these.** The application learns what it holds from
 * `GET /permissions/me` and from nowhere else. What tests need is different —
 * a realistic set to render against — and inventing a plausible-looking one by
 * hand is how a test ends up asserting behaviour no real administrator can
 * reach.
 *
 * Two of the three are *derived* rather than transcribed, so there is less to
 * get wrong: the counts (116 / 99 / 30) are asserted below, and
 * `permissions.types.test.ts` already proves every name here exists in the
 * catalogue — and that `permissions.md` states those same three numbers.
 */

/** Developer. Holds all 116, and is the only level for which MFA is mandatory. */
export const TIER_1_PERMISSIONS: readonly string[] = [...PERMISSION_NAMES];

/**
 * The seventeen an Admin does **not** hold: the four named in
 * `permissions.md` § "What Admin (tier 2) deliberately does not hold", plus the
 * whole `developer_tools` family. 116 − 17 = 99.
 */
const TIER_2_EXCLUSIONS: readonly string[] = [
    'administrators.tier.set',
    'administrators.mfa.reset',
    'files.delete',
    'users.roles.manage',
];

/** Admin — the operational level, including the money. 99 of 116. */
export const TIER_2_PERMISSIONS: readonly string[] = PERMISSION_NAMES.filter(
    (name) => !TIER_2_EXCLUSIONS.includes(name) && !name.startsWith('developer_tools.'),
);

/**
 * Support. **30 of 116**, and every one of them is routed — Support holds none
 * of the four `†` permissions, so a Support administrator can use everything
 * they hold. That is new: the set was 24 with twelve unusable before Phase 5
 * built the `support` and `content` surfaces.
 *
 * Transcribed from the ● marks in the Support column. Three surprises worth
 * keeping: `money.payments.read` is held deliberately, because "did my payment
 * go through" is one of the commonest ticket questions; `files.resolve` is
 * held by **every** tier, because the caller already holds the file id, which
 * means they already passed the guard on the record that carried it; and both
 * tracking reads are held by Support and **not** by Admin — answering "where is
 * my parcel" is ticket work, and each read is audited.
 *
 * `files.content.read` joined at BR-011 on the same argument as the tracking
 * reads: Support answers the delivery-proof disputes, and refusing them
 * escalates every ticket to a tier holding less context. It is audited for the
 * same reason too — the grant and the record were one decision.
 */
export const TIER_3_PERMISSIONS: readonly string[] = [
    'agents.read',
    'agents.tracking.read',
    'agencies.read',
    'money.payments.read',
    'orders.read',
    'orders.disputes.read',
    'support.errors.lookup',
    'support.tickets.read',
    'support.tickets.create',
    'support.tickets.update',
    'support.tickets.assign',
    'support.tickets.lifecycle',
    'support.tickets.followers.manage',
    'support.tickets.notes.read',
    'support.tickets.notes.write',
    'support.tickets.attachments.read',
    'support.tickets.attachments.write',
    'support.reference.read',
    'content.articles.read',
    'content.articles.write',
    'content.authors.read',
    'content.authors.write',
    'files.resolve',
    'files.content.read',
    'users.read',
    'vendors.read',
    'shipments.read',
    'shipments.tracking.read',
    'audit.read',
    'notifications.read',
];

const TIER_PERMISSIONS: Record<AdminTier, readonly string[]> = {
    1: TIER_1_PERMISSIONS,
    2: TIER_2_PERMISSIONS,
    3: TIER_3_PERMISSIONS,
};

/** The held set for a level, ready to hand to the shell or a gate. */
export function heldFixture(tier: AdminTier): ReadonlySet<string> {
    return new Set(TIER_PERMISSIONS[tier]);
}

/** `GET /permissions/me`, wire-shaped. */
export function permissionsMeFixture(
    tier: AdminTier = 2,
    overrides: Partial<PermissionsMeResult> = {},
): PermissionsMeResult {
    const labels: Record<AdminTier, string> = { 1: 'Developer', 2: 'Admin', 3: 'Support' };
    return {
        adminId: '665f1c2a9b3e4a91c7d2e5f0',
        tier,
        tierLabel: labels[tier],
        permissions: [...TIER_PERMISSIONS[tier]],
        ...overrides,
    };
}
