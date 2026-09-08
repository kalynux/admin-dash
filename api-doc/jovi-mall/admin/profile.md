<!-- OBSOLETE-BANNER -->
> # 🔴 OBSOLETE — the role this page is written for no longer exists
>
> **Everything below describes a surface that no longer exists**, and it is the most misleading of
> the three obsolete pages because it looks like it is about *you*.
>
> It documents `GET|PATCH /admin/profile` on **jovi-mall**, behind `requireRole(['admin'])` on a
> jovi-mall `users` row. **jovi-mall has no `admin` role any more.** An administrator of this
> platform holds no jovi-mall `users` row at all — they live in wi-admin's own database and
> authenticate against a separate identity system with MFA. There is nothing for this page to be
> the profile *of*.
>
> **Where it went:** `GET|PATCH /api/v1/administrators/me`, plus
> `GET /api/v1/administrators/me/activity`.
>
> | Read instead | |
> |---|---|
> | The live contract | [`../../admin/api/administrators.md`](../../admin/api/administrators.md) |
> | Who an administrator *is* | [`../../admin/api/auth.md`](../../admin/api/auth.md) |
> | Every route and permission | [`../../ROUTE-MAP.md`](../../ROUTE-MAP.md) § `/administrators` |
>
> ⚠ **This page also shows the pre-Phase-16 error body.** Errors are now
> `{ success, requestId, error: { code, message, statusCode, category, details? } }` on all three
> services — see [`../../admin/api/errors.md`](../../admin/api/errors.md). Do not copy an error
> shape from this page.
>
> ⚠ **Note the path form.** This page writes `/admin/profile` without the `/api` prefix, so a
> repository-wide grep for `/api/admin/` does **not** find it. If you are auditing legacy
> references, search both forms.
>
> *Kept rather than deleted so the next reader finds the redirect instead of re-deriving it.
> Marked 2026-08-24.*
<!-- /OBSOLETE-BANNER -->

<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call jovi-mall.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> Field names here are jovi-mall's **snake_case** storage casing; wi-admin's wire is **camelCase**.
>
> Start at [`_CONTEXT.md`](../_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

---

# Admin — Self Profile

**Verified against source on 2026-09-08** — the obsolescence claim and the redirect — `GET|PATCH /api/v1/administrators/me` and `GET /api/v1/administrators/me/activity` are all served by wi-admin, and jovi-mall serves no `/api/admin/*` route at all, against `backend/DOC-PROGRAM/evidence/{jovi,admin}-routes.txt`.

Read and update the authenticated admin's own profile.

- **Base URL**: `http://localhost:8022/api`
- **Auth**: Required (cookie or `Bearer`) — see ../auth/README.md (not mirrored here — `backend/jovi-mall/api-doc/auth/README.md`)
- **Permissions**: `admin` only (`requireRole(['admin'])`)
- **Headers**: `Content-Type: application/json` on `PATCH`.
- **Response envelope**: standard `{ success, data, message? }` — see [../README.md](../README.md#the-response-envelope-read-this-first).

Admins have **no onboarding** (`onboarding_step` is always `0`). The admin is resolved from the JWT —
there is no admin-id path parameter.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/profile` | Get self-profile (includes `last_login_ip`) |
| `PATCH` | `/admin/profile` | Update self-profile fields |

> The admin router also mounts `POST /admin/products/bulk-vectorise`; that is documented in
> [admin/catalogue-vectorisation.md](./catalogue-vectorisation.md).

---

## GET `/admin/profile`

**Purpose**: Return the authenticated admin's profile, including the last login IP.

**Auth**: Required · **Permissions**: `admin`

### Example success `200`

```json
{
  "success": true,
  "data": {
    "_id": "664adm...",
    "user_id": "664usr...",
    "name": "Site Admin",
    "avatar": null,
    "job_title": "Operations Lead",
    "department": "Trust & Safety",
    "timezone": "Africa/Douala",
    "preferredLanguage": "en",
    "last_login_ip": "102.44.12.9",
    "onboarding_step": 0,
    "status": "active"
  }
}
```

---

## PATCH `/admin/profile`

**Purpose**: Update self-profile fields. All fields optional; only provided fields change.

**Auth**: Required · **Permissions**: `admin`

### Request body

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | ❌ | 1–100 chars, trimmed |
| `avatar_file_id` | string \| null | ❌ | MongoDB ObjectId of a file uploaded via `POST /api/files/upload` — *clearable*. The **write** field for the avatar; reads return the resolved `avatar` file object. |
| `avatar_url` | string \| null | ❌ | *(deprecated, no effect on reads)* still accepted for backward compatibility but no longer surfaced — use `avatar_file_id`. |
| `job_title` | string \| null | ❌ | 1–100 chars — *clearable* |
| `department` | string \| null | ❌ | 1–100 chars — *clearable* |
| `timezone` | string | ❌ | non-empty (IANA timezone) |
| `preferred_language` | string | ❌ | one of `en`, `fr`, `pt`, `es`, `ar` — the admin's language, used for notifications/messaging (no separate notification-language setting) |

> **Clearable fields**: send `null` **or `""`** to clear (stored and returned as `null`); omit the
> key to leave the value unchanged. See [Conventions](../README.md#conventions).

> **Profile avatar is a file reference.** Upload the image via `POST /api/files/upload`, then send the
> returned file `id` as `avatar_file_id`. Reads return `avatar` as a **resolved file object** — the same
> `{ id, key, url, mimeType, size, originalName }` shape product images use — or `null` when unset; never
> a bare URL string. While set, that file counts as *in use* — it appears under `usage.references` on
> `GET /api/files/:id` with `entityType: "admin", field: "avatar"`, and cannot be deleted until you detach
> it (`avatar_file_id: null`). See File Management — the `usage` object (not mirrored here — `backend/jovi-mall/api-doc/vendor/file-management.md`).

### Example request

```json
{ "job_title": "Head of Operations", "timezone": "Africa/Douala" }
```

### Example success `200`

```json
{ "success": true, "data": { "_id": "664adm...", "job_title": "Head of Operations", "timezone": "Africa/Douala", "...": "..." }, "message": "Profile updated successfully" }
```

### Example error `400` (validation)

```json
{ "success": false, "requestId": "req_abc", "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "statusCode": 400, "category": "validation", "details": { "fields": [{ "path": "avatar_file_id", "message": "avatar_file_id must be a valid file id", "code": "invalid_string" }] } } }
```

## Possible error codes

| `error.code` | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body fails the Zod schema |
| `AUTH_MISSING_TOKEN` / `AUTH_TOKEN_EXPIRED` | 401 | Not authenticated |
| `AUTH_ROLE_NOT_FOUND` | 403 | Authenticated as a non-admin role |

## Related

- ../auth/README.md (not mirrored here — `backend/jovi-mall/api-doc/auth/README.md`) — session & role model
- [./catalogue-vectorisation.md](./catalogue-vectorisation.md) — admin bulk-vectorise
- Other admin surfaces: [./orders.md](./orders.md) · [./agents.md](./agents.md) · [./cod.md](./cod.md) · [./delivery-agencies.md](./delivery-agencies.md) · [./payout-requests.md](./payout-requests.md)
