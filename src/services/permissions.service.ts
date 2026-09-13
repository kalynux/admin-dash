/**
 * `/permissions` — two of the group's three routes.
 *
 * **Neither call sets `skipAuthRefresh` nor `suppressSessionEvents`**, and that
 * is deliberate rather than an oversight. `auth.service.ts` establishes the
 * opposite convention for the credential routes, so the omission here is worth
 * spelling out:
 *
 * - the refresh dance is **kept**, because these are ordinary authenticated
 *   reads and an expired access token should refresh and retry like any other;
 * - session events are **kept**, because `/permissions/me` answering
 *   `403 ADMIN_AUTH_MFA_REQUIRED` means a scoped enrolment session reached it,
 *   and that has to travel to the router as an enrolment redirect. In practice
 *   the tree prevents it — `PermissionsProvider` mounts under `RequireAuth`,
 *   which sends a scoped session to `/mfa-setup` before this file is reached —
 *   but suppressing the event would silently remove the second line of defence.
 *
 * `GET /permissions/tiers` joined them in Phase 11, when the administrator
 * surface that needs it was built. It is the only route in the group behind a
 * permission (`permissions.read`), and the docs are explicit about who it is
 * for: *"For the administrator-management screen: what changes when you move
 * someone from Support to Admin."*
 */

import { api, type RequestOptions } from '@/services/api';
import type {
    PermissionCatalog,
    PermissionsMeResult,
    TierMatrix,
} from '@/types/permissions.types';

/**
 * The caller's own effective permission set.
 *
 * No permission required — "an administrator who cannot discover what they may do
 * cannot use the service". The set is resolved from the caller's level on every
 * request, so it reflects a demotion immediately.
 *
 * **This is what navigation is built from.** The documented alternative — probing
 * endpoints and collecting 403s — is never done in this codebase.
 */
export function fetchMyPermissions(options?: RequestOptions): Promise<PermissionsMeResult> {
    return api.get<PermissionsMeResult>('/permissions/me', options);
}

/**
 * Every permission that exists, with its family, action, summary and the four
 * sensitivity flags. No permission required — the vocabulary is what a dashboard
 * is written against, and none of it is secret.
 *
 * **Not called during boot.** It is static, complete and 118 rows long, and
 * nothing about drawing the navigation needs it; blocking the shell on a second
 * read to render summaries nobody has asked for yet would be paying for the
 * "My access" screen on every page load. That screen fetches it itself.
 */
export function fetchPermissionCatalog(options?: RequestOptions): Promise<PermissionCatalog> {
    return api.get<PermissionCatalog>('/permissions/catalog', options);
}

/**
 * `GET /permissions/tiers` · `permissions.read` — the full level → permission
 * matrix.
 *
 * **This is the only legitimate source of the matrix.** Hard-coding the
 * permission *vocabulary* is correct and `types/permissions.types.ts` does it;
 * hard-coding which level holds what is not, and there is deliberately no
 * tier → permission table anywhere in `src/`. The tier sets in
 * `src/test/fixtures.ts` exist for tests and must never be imported by app code.
 *
 * Support does not hold `permissions.read` — not because the matrix is secret
 * (*"none of this is secret… it is the difference between a usable dashboard and
 * a guessing game"*) but because Support has no screen that renders it. So any
 * caller must degrade gracefully when the read is refused rather than blocking
 * on it.
 *
 * Fetched lazily by the tier-change dialog: it is a 118 × 3 payload that nobody
 * needs until somebody is actually moving a level.
 */
export function fetchTierMatrix(options?: RequestOptions): Promise<TierMatrix> {
    return api.get<TierMatrix>('/permissions/tiers', options);
}
