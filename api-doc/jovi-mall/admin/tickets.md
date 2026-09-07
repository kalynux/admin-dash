<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call jovi-mall.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> Field names here are jovi-mall's **snake_case** storage casing; wi-admin's wire is **camelCase**.
>
> Start at [`_CONTEXT.md`](../_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Admin Tickets

> ## ⚠️ This surface moved at the Phase 5 cutover — read this before the routes below
>
> **The public mount `/api/admin/tickets` is DELETED.** It was served to any platform session
> whose `users` row carried `roles: ['admin']` — jovi-mall's second authorization model, which
> carried no tier, no permission set and no audit identity. That model is retired.
>
> **The routes themselves are unchanged and still live, at `/api/internal/admin/tickets`**, behind
> `requireAdminCaller` (a service token plus `X-Actor-*` headers, never a user session). One
> factory always served both mounts, so every path, payload and response below is still exact —
> only the prefix and the guard changed. **Every path in this document has been rewritten to
> the internal prefix**, so what you read here is what the service answers.
>
> **If you are building a dashboard, this is not your document.** Call wi-admin's `/api/v1/support/tickets` instead — it resolves the
> administrator's tier and permissions, writes the audit row, and calls this surface on your
> behalf. See [internal-service-api.md](./internal-service-api.md) for the door itself, and
> `admin/docs/api/` in the wi-admin repository for the dashboard contract.

---

## Base Path

All endpoints in this document share this base path:

```
/api/internal/admin/tickets
```

## Authentication

**Authorization**: Admin access required.

All requests must include a valid Bearer token with admin role:

```
Authorization: Bearer <access_token>
```

## Admin Privileges

Admins have special privileges in the ticketing system:

- ~~**Exclusive Locking**: First admin to act on a ticket becomes the "active admin" and locks the ticket exclusively~~ — **REMOVED at Phase 17.** See the note below.
- **Priority Locking**: When admin updates priority, it becomes locked permanently
- **Reopen Tickets**: Only admins can reopen closed tickets
- **Remove Followers**: Only admins can remove followers from tickets
- **Delete Attachments**: Only admins can delete attachments
- **Full Visibility**: Admins see all notes and attachments (including private ones)

> ⚠ **Exclusive Admin Locking no longer exists, and this page described it in fourteen places**
> (corrected 2026-09-06, DOC-PROGRAM Phase 4 · § 20.1 C5-1). The column was `assigned_admin_id`
> and it was never an assignment: `setActiveAdminIfNotSet` stamped it on an administrator's
> **first action** and `validateActiveAdminPermission` then answered `403` to every other
> administrator — Developers included. So a Support administrator merely opening a ticket locked a
> Developer out of it, the exact opposite of the tier model wi-admin enforces. **The column, the
> lock and the `/api/admin/tickets` mount that depended on it are all gone**
> (`jovi-mall/src/modules/tickets/models/ticket.model.ts:99-110`).
>
> **What replaced it:** `admin_assignment` — `{ admin, assigned_by, assigned_at }`, written only
> by wi-admin over the internal API. `null` means unassigned, which is a real state: the system
> tickets the payout, dispute and booking-refund paths raise land in the admin **pool**, and any
> tier may claim from it. Who may see or act on a ticket is wi-admin's decision
> (`resolveScope('tickets')` plus the tier matrix), **never a lock on the row**.
>
> ⚠ **`assigned_admin_id` is not on the wire anywhere.** A client reading it reads `undefined`.
> The JSON examples below still showed it; they now show `admin_assignment`.

## Reference Lookups

For populating the ticket-creation form, the same cheap, role-scoped lookups documented in
vendor/tickets.md (not mirrored here — `backend/jovi-mall/api-doc/vendor/tickets.md`) are mounted under the admin namespace (admin scope is
unscoped — all orders / all products):

- `GET /api/internal/admin/tickets/reference/orders`
- `GET /api/internal/admin/tickets/reference/products`

When `trackingNumber` is supplied on creation it is persisted and returned as `tracking_number`
on ticket responses (`null` when omitted).

## Endpoints

### POST /api/internal/admin/tickets

**Description**: Create a new support ticket as an admin.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**: None

**Query Parameters**: None

**Request Body**:
```json
{
  "subject": "string (required, min 3, max 200 chars) - Ticket subject/title",
  "description": "string (required, min 10, max 5000 chars) - Detailed description",
  "type": "string (required) - Ticket type. Enum: technical, billing, feature_request, bug_report, other",
  "importance": "string (required) - Importance level. Enum: low, medium, high, urgent",
  "entityType": "string (required) - Related entity type. Enum: order, product, booking, account, other",
  "entityId": "string (required) - ID of the related entity"
}
```

**Success Response**:

Status: `201 Created`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "subject": "System performance issue",
    "description": "Database queries are slow...",
    "type": "technical",
    "importance": "urgent",
    "priority": "critical",
    "status": "open",
    "entityType": "other",
    "entityId": "string",
    "created_by_user_id": "string",
    "created_by_role": "admin",
    "assigned_to_role": "admin",
    "admin_assignment": { "admin": { "id": "string", "source": "admin", "name": "string", "tier": 3, "job_title": null, "department": null, "avatar_url": null }, "assigned_by": null, "assigned_at": "2026-02-11T19:20:00.000Z" },
    "priority_locked": false,
    "createdAt": "2026-02-11T19:00:00.000Z",
    "updatedAt": "2026-02-11T19:00:00.000Z"
  },
  "message": "Ticket created successfully"
}
```

**Error Responses**:
- `400` – `VALIDATION_ERROR` – Invalid request body

---

### GET /api/internal/admin/tickets

**Description**: List all tickets in the system with filters, search, sorting, and pagination. Admins can see all tickets.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**: None

**Query Parameters**:
- `status` (string, optional) - Filter by status. Enum: `open`, `in_progress`, `waiting_on_admin`, `waiting_on_vendor`, `waiting_on_customer`, `waiting_on_agency`, `waiting_on_agent`, `resolved`, `closed`
- `priority` (string, optional) - Filter by priority
- `type` (string, optional) - Filter by type
- `entityType` (string, optional) - Filter by entity type
- `createdByRole` (string, optional) - Filter by creator role
- `assignedToMe` (boolean, optional) - Filter tickets assigned to current admin
- `q` (string, optional, max 100 chars) - Search query
- `page` (integer, optional, default: 1) - Page number
- `limit` (integer, optional, default: 20, max: 100) - Items per page
- `sortBy` (string, optional, default: `createdAt`) - Sort field
- `sortOrder` (string, optional, default: `desc`) - Sort order

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": [
    {
      "_id": "string",
      "subject": "Payment integration issue",
      "status": "in_progress",
      "priority": "high",
      "type": "technical",
      "created_by_role": "vendor",
      "admin_assignment": { "admin": { "id": "string", "source": "admin", "name": "string", "tier": 3, "job_title": null, "department": null, "avatar_url": null }, "assigned_by": null, "assigned_at": "2026-02-11T19:20:00.000Z" },
      "priority_locked": true,
      "createdAt": "2026-02-11T19:00:00.000Z",
      "updatedAt": "2026-02-11T19:00:00.000Z"
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

**Error Responses**:
- `400` – `VALIDATION_ERROR` – Invalid query parameters

---

### GET /api/internal/admin/tickets/:id

**Description**: Get detailed information for any ticket in the system.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "subject": "Payment integration issue",
    "description": "Customers are unable to complete checkout...",
    "type": "technical",
    "importance": "urgent",
    "priority": "high",
    "status": "in_progress",
    "entityType": "order",
    "entityId": "string",
    "created_by_user_id": "string",
    "created_by_role": "vendor",
    "assigned_to_role": "admin",
    "admin_assignment": { "admin": { "id": "string", "source": "admin", "name": "string", "tier": 3, "job_title": null, "department": null, "avatar_url": null }, "assigned_by": null, "assigned_at": "2026-02-11T19:20:00.000Z" },
    "priority_locked": true,
    "createdAt": "2026-02-11T19:00:00.000Z",
    "updatedAt": "2026-02-11T19:00:00.000Z"
  }
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found

---

### PATCH /api/internal/admin/tickets/:id

**Description**: Update ticket subject and/or description. Requires exclusive admin lock.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**:
```json
{
  "subject": "string (optional, min 3, max 200 chars) - New subject",
  "description": "string (optional, min 10, max 5000 chars) - New description"
}
```

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "subject": "Updated subject",
    "description": "Updated description...",
    "updatedAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Ticket updated successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- ~~`403` – `FORBIDDEN` – Ticket is locked to another admin~~ — **UNREACHABLE.** The exclusivity lock was removed at Phase 17 and `FORBIDDEN` is not a code in the registry. This surface answers `403 TICKET_ACCESS_DENIED` for a non-follower, and nothing at all for "another admin holds it".
- `400` – `VALIDATION_ERROR` – Invalid request body

---

### PATCH /api/internal/admin/tickets/:id/status

**Description**: Update ticket status. First admin action locks the ticket exclusively to that admin.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**:
```json
{
  "status": "string (required) - New status. Enum: open, in_progress, waiting_on_admin, waiting_on_vendor, waiting_on_customer, waiting_on_agency, waiting_on_agent, resolved, closed"
}
```

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "status": "in_progress",
    "admin_assignment": { "admin": { "id": "string", "source": "admin", "name": "string", "tier": 3, "job_title": null, "department": null, "avatar_url": null }, "assigned_by": null, "assigned_at": "2026-02-11T19:20:00.000Z" },
    "updatedAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Status updated successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- ~~`403` – `FORBIDDEN` – Ticket is locked to another admin~~ — **UNREACHABLE.** The exclusivity lock was removed at Phase 17 and `FORBIDDEN` is not a code in the registry. This surface answers `403 TICKET_ACCESS_DENIED` for a non-follower, and nothing at all for "another admin holds it".
- `400` – `VALIDATION_ERROR` – Invalid status value
- `400` – `TICKET_WAITING_TARGET_NOT_PARTICIPANT` – A `waiting_on_<role>` status was requested but no participant with that role is on the ticket (does not apply to `waiting_on_admin`)

---

### PATCH /api/internal/admin/tickets/:id/assign

**Description**: Assign the ticket to an **administrator**, or claim it.

> 🔴 **This section's request body was WRONG until 2026-09-06** (DOC-PROGRAM P-4), here and in the
> backend's own copy. It documented `{ targetRole, targetUserId }`, which **this** endpoint does
> not accept — `AssignToAdministratorSchema` is `.strict()`, so that body is a `400` on the
> *entire* request, every field unknown.
>
> **The cause is worth knowing, because it is a trap you can fall into again.** jovi-mall has
> **four** `/:id/assign` routes — vendor, agency, agent and admin. The first three genuinely take
> `{ targetRole, targetUserId }` (`AssignTicketSchema` → `TicketController.assignTicket`). The
> **admin** one is a different handler with a different body
> (`AssignToAdministratorSchema` → `assignToAdministrator`). They share a path suffix and nothing
> else, and this page had the role-scoped body pasted under the admin route.

**Authorization**: wi-admin service token (`requireAdminCaller`). Reached from this dashboard
through wi-admin's `/api/v1/support/tickets/:id/assign` — **not called directly**, see the banner.

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body** — `.strict()`, so any unknown key is a `400`:
```json
{
  "admin": {
    "id": "wi-admin administrator id",
    "source": "admin",
    "name": "Awa N.",
    "tier": 2,
    "job_title": "Support Lead",
    "department": "Customer Care",
    "avatar_url": "https://…"
  },
  "assignedBy": { "…same shape…" }
}
```

| Field | Required | Rule |
|---|---|---|
| `admin` | ✅ | The **assignee**'s snapshot. `id` non-empty · `source` literal `"admin"` · `tier` exactly `1`, `2` or `3` · `name` 1–200 · `job_title`/`department` ≤120 nullable · `avatar_url` ≤2048 nullable |
| `assignedBy` | optional | The **assigner**'s snapshot. **Its absence IS a claim** |

**Why a snapshot and not a user id:** an administrator holds **no `users` row in jovi-mall**, so
there is nothing there to join against. The profile travels with the write so a ticket follower can
be shown who holds their ticket.

⚠ **The server decides claim-vs-assign by comparing ids, not by trusting `assignedBy`.** If the
calling actor's id equals `admin.id`, `assigned_by` is stored as `null` however the body was
filled — the two cannot disagree.

**Success Response**:

Status: `200 OK` — the updated ticket. **There is no `message` field** on this response.

```json
{ "success": true, "data": { "_id": "string", "admin_assignment": { "admin": { "…" }, "assigned_by": null }, "updatedAt": "2026-02-11T19:30:00.000Z" } }
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- ~~`403` – `FORBIDDEN` – Ticket is locked to another admin~~ — **UNREACHABLE.** The exclusivity lock was removed at Phase 17 and `FORBIDDEN` is not a code in the registry. This surface answers `403 TICKET_ACCESS_DENIED` for a non-follower, and nothing at all for "another admin holds it".
- `400` – `VALIDATION_ERROR` – Body failed `.strict()` parse (unknown key, bad `tier`, missing `admin`)

---

### PATCH /api/internal/admin/tickets/:id/admin-snapshot

> **Added 2026-09-06** (DOC-PROGRAM P-5). This route existed and appeared in **no** API document
> on either side; found by a route-coverage sweep, not by reading.

**Description**: **Re-stamp the assignee's profile without changing the assignee.** wi-admin calls
this on every mutation, so the snapshot a customer reads never goes stale behind a rename.

⚠ **Deliberately a different route and schema from `/assign`, even though the payload is a subset
— do not merge them.** Sending `{ admin }` to `/assign` means *"this administrator now holds the
ticket, claimed"*: it would **reassign on every edit and clear `assigned_by`**. A refresh must be
structurally unable to express that.

**Request Body** — `.strict()`: `{ "admin": { …same AdminSnapshot shape… } }`.
`assignedBy` is **not accepted here** — sending it is a `400`.

**Success Response**: `204 No Content`. **No body at all**, so do not attempt to parse one.

The refresh is **guarded on the assignee id**, so one racing a reassignment cannot overwrite the
new holder.

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- `400` – `VALIDATION_ERROR` – Body failed `.strict()` parse

---

### PATCH /api/internal/admin/tickets/:id/priority

**Description**: Update ticket priority. When admin updates priority, it becomes **locked permanently**. Active admin can re-update locked priority.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**:
```json
{
  "priority": "string (required) - New priority. Enum: low, medium, high, critical"
}
```

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "priority": "critical",
    "priority_locked": true,
    "updatedAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Priority updated and locked"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- ~~`403` – `FORBIDDEN` – Ticket is locked to another admin (only active admin can re-update locked priority)~~ — **UNREACHABLE.** There is no active admin. A locked priority is re-updatable by **any** administrator: the check is `role !== 'admin'` (`ticket.service.ts:400-404`), not an identity comparison. The real code for a non-admin is `403 TICKET_PRIORITY_LOCKED`.
- `400` – `VALIDATION_ERROR` – Invalid priority value

---

### POST /api/internal/admin/tickets/:id/close

**Description**: Close a ticket. ⚠ **There is no "auto-unlock"** — the exclusivity lock it referred to was removed at Phase 17, and closing a ticket does not clear `admin_assignment`.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "status": "closed",
    "admin_assignment": null,
    "updatedAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Ticket closed successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- ~~`403` – `FORBIDDEN` – Ticket is locked to another admin~~ — **UNREACHABLE.** The exclusivity lock was removed at Phase 17 and `FORBIDDEN` is not a code in the registry. This surface answers `403 TICKET_ACCESS_DENIED` for a non-follower, and nothing at all for "another admin holds it".

---

### POST /api/internal/admin/tickets/:id/reopen

**Description**: Reopen a closed ticket. **Admin only**. Admin who reopens becomes the new active admin.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "status": "open",
    "admin_assignment": { "admin": { "id": "string", "source": "admin", "name": "string", "tier": 3, "job_title": null, "department": null, "avatar_url": null }, "assigned_by": null, "assigned_at": "2026-02-11T19:20:00.000Z" },
    "updatedAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Ticket reopened successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- `400` – `VALIDATION_ERROR` – Only closed tickets can be reopened

---

### POST /api/internal/admin/tickets/:id/followers

**Description**: Add a follower to a ticket. Respects 5 non-admin user limit.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `id` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**:
```json
{
  "userId": "string (required) - User ID to add as follower",
  "role": "string (required) - User's role. Enum: admin, agent, vendor, customer, agency"
}
```

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "ticket_id": "string",
    "user_id": "string",
    "role": "vendor",
    "is_admin": false,
    "added_at": "2026-02-11T19:30:00.000Z"
  },
  "message": "Follower added successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- `409` – `ALREADY_FOLLOWING` – User is already following this ticket
- `400` – `FOLLOWER_LIMIT_EXCEEDED` – Maximum 5 non-admin users reached

---

### DELETE /api/internal/admin/tickets/:id/followers/:userId

**Description**: Remove a follower from a ticket. **Admin only**.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `id` (string, required) - Ticket ID
- `userId` (string, required) - User ID to remove

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "message": "Follower removed successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket or follower not found
- `403` – `TICKET_ACCESS_DENIED` – Cannot remove ticket creator from followers (`ticket-follower.service.ts:122`). ⚠ **Not `FORBIDDEN`** — that code is not in the registry

---

### POST /api/internal/admin/tickets/:ticketId/notes

**Description**: Create a note on a ticket. Admins can create PUBLIC or PRIVATE notes.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `ticketId` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**:
```json
{
  "message": "string (required, min 1, max 2000 chars) - Note content",
  "visibility": "string (optional, default: PUBLIC) - Enum: PUBLIC, PRIVATE",
  "visibleToUserIds": "array of strings (optional) - User IDs who can see private note"
}
```

**Success Response**:

Status: `201 Created`

Body:
```json
{
  "success": true,
  "data": {
    "_id": "string",
    "ticket_id": "string",
    "message": "Escalating to development team",
    "visibility": "PRIVATE",
    "visible_to_user_ids": ["dev1", "dev2"],
    "author_user_id": "string",
    "author_role": "admin",
    "createdAt": "2026-02-11T19:30:00.000Z"
  },
  "message": "Note created successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found
- `400` – `VALIDATION_ERROR` – Invalid message or visibility parameters

---

### GET /api/internal/admin/tickets/:ticketId/notes

**Description**: Get all notes for a ticket. **Admins see all notes** (PUBLIC and PRIVATE).

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `ticketId` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": [
    {
      "_id": "string",
      "ticket_id": "string",
      "message": "Working on this issue",
      "visibility": "PUBLIC",
      "author_user_id": "string",
      "author_role": "vendor",
      "createdAt": "2026-02-11T19:30:00.000Z"
    },
    {
      "_id": "string",
      "ticket_id": "string",
      "message": "Internal admin note",
      "visibility": "PRIVATE",
      "visible_to_user_ids": ["admin1", "admin2"],
      "author_user_id": "string",
      "author_role": "admin",
      "createdAt": "2026-02-11T19:31:00.000Z"
    }
  ]
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found

---

### POST /api/internal/admin/tickets/:ticketId/attachments

**Description**: Attach an already-uploaded file to a ticket. The file is **not**
uploaded here — first upload it via `POST /api/files/upload` (images, documents,
archives, audio) **or, for videos, `POST /api/files/upload/video`** (mp4/mov/webm,
70 MB max — see file-management.md (not mirrored here — `backend/jovi-mall/api-doc/vendor/file-management.md`)),
then send the returned `fileId` to this route (same pattern as product images).
Attachments can be PUBLIC or PRIVATE. Max 5 attachments per ticket.

**Authorization**: Admin access required. Admins may attach any file.

**Request Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Path Parameters**:
- `ticketId` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body** (application/json):
```json
{
  "fileId": "string (required) - ID returned by POST /api/files/upload",
  "visibility": "string (optional, default: PUBLIC) - Enum: PUBLIC, PRIVATE",
  "visibleToUserIds": ["string (optional) - user IDs for private attachment visibility"]
}
```

**Success Response**:

Status: `201 Created`

Body:
```json
{
  "success": true,
  "data": {
    "id": "string",
    "fileName": "debug-log.txt",
    "fileSize": 12345,
    "mimeType": "text/plain",
    "url": "http://localhost:8022/api/files/images/2026/02/a1b2c3…_checkout-error.png",
    "uploadedBy": "string",
    "uploadedByRole": "admin",
    "createdAt": "2026-02-11T19:30:00.000Z"
  }
}
```

**Error Responses**:
- `404` – `TICKET_NOT_FOUND` – Ticket not found
- `404` – `TICKET_ATTACHMENT_MISSING` – `fileId` does not reference an existing file
- `422` – `TICKET_ATTACHMENT_LIMIT_EXCEEDED` – Maximum 5 attachments per ticket
- `400` – `VALIDATION_ERROR` – Missing/invalid `fileId` or visibility parameters

---

### GET /api/internal/admin/tickets/:ticketId/attachments

**Description**: List all attachments for a ticket. **Admins see all attachments** (PUBLIC and PRIVATE).

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `ticketId` (string, required) - Ticket ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "fileName": "screenshot.png",
      "fileSize": 245678,
      "mimeType": "image/png",
      "url": "http://localhost:8022/api/files/images/2026/02/a1b2c3…_checkout-error.png",
      "uploadedBy": "string",
      "uploadedByRole": "vendor",
      "createdAt": "2026-02-11T19:30:00.000Z"
    }
  ]
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Ticket not found

---

### DELETE /api/internal/admin/tickets/attachments/:id

**Description**: Delete an attachment. **Admin only**.

**Authorization**: Admin access required.

**Request Headers**:
- `Authorization: Bearer <token>`

**Path Parameters**:
- `id` (string, required) - Attachment ID

**Query Parameters**: None

**Request Body**: None

**Success Response**:

Status: `200 OK`

Body:
```json
{
  "success": true,
  "message": "Attachment deleted successfully"
}
```

**Error Responses**:
- `404` – `NOT_FOUND` – Attachment not found
- `403` – `TICKET_ACCESS_DENIED` – Only admins can delete attachments (`ticket-attachment.service.ts:188`). ⚠ **Not `FORBIDDEN`**

---

## Notes & Constraints

### ~~Exclusive Admin Locking~~ — REMOVED at Phase 17

**This mechanism does not exist.** The block below is kept, struck through, because a client built
against it may still be branching on the shape it described. See § "Admin Privileges" above for
what replaced it.

- ~~First admin action sets `assigned_admin_id`~~
- ~~Other admins can **view** ticket metadata but **cannot perform actions**~~
- ~~Only the active admin can update status, priority, assign, close, etc.~~
- ~~Attempting action as non-active admin returns `403 FORBIDDEN`~~
- ~~**Auto-unlock**: ticket closed or resolved → `assigned_admin_id` cleared~~
- ~~**Reopening**: the admin who reopens becomes the new active admin~~

**What is true instead.** `admin_assignment` records who holds a ticket and who gave it to them; it
is written only by wi-admin, over the internal API, and it is **not** a lock — any administrator
whose tier permits it may act, and closing or resolving a ticket clears nothing. `assigned_admin_id`
is not on the wire at all, and `FORBIDDEN` is not a code in the registry.

### Priority Locking

**Permanent Locking**:
- When admin updates priority → `priority_locked = true` **permanently**
- Locked priorities **cannot** be changed by non-admin users
- **Exception**: Active admin can re-update a locked priority

### Follower Management

**Admin Privileges**:
- Admins can add any user as a follower
- Admins can remove followers (except ticket creator)
- Admins don't count toward 5-user limit
- Maximum 5 non-admin users can follow a ticket (lifetime)

### Visibility & Privacy

**Full Visibility**:
- Admins see **all notes** (PUBLIC and PRIVATE)
- Admins see **all attachments** (PUBLIC and PRIVATE)
- Admin followers are **auto-included** in all private attachments

**Private Items**:
- PRIVATE notes: Visible to admins + author + explicit list
- PRIVATE attachments: Visible to admins + uploader + explicit list

### Immutable Fields

The following cannot be modified:
- `priority_locked` (once set to true)
- `created_by_user_id`
- `created_by_role`
- `importance` (initial value, different from priority)
- `entityType` and `entityId`

### State Transitions

Valid status flow:
```
open → in_progress → waiting_on_<role> → resolved → closed
                     (admin | vendor | customer | agency | agent)

closed → open (via reopen endpoint, admin only)
```

**Waiting status rule**: a `waiting_on_<role>` status can only be set when a
participant (follower) with that role is on the ticket. The creator and assignee
count as participants. `waiting_on_admin` is always allowed (platform admin
support is implicit). Violations return `400 TICKET_WAITING_TARGET_NOT_PARTICIPANT`.

### Timestamps

All timestamp fields are in ISO 8601 format:
```
2026-02-11T19:00:00.000Z
```
