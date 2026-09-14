/**
 * `/employees` — the staff employment record. **Built 2026-09-14 (ADR-023).**
 *
 * Source: [`employees.md`](../../api-doc/admin/api/employees.md). Seven routes:
 * five *self-service* (the subject's own record, **reachable while `pending`**)
 * and two that read or write somebody else's, behind tier-1-only permissions.
 *
 * ⚠ **There is no `GET /employees`, at any tier, and no delete.** Both absences
 * are structural rather than permission decisions — see `employees.types.ts`.
 * Do not build a directory screen and expect a route to appear.
 *
 * ⚠ **Do not confuse this with `/verification`.** That surface is applicants and
 * grades nothing; this one is staff and the backend *does* enforce a required
 * set. `employees.md` opens by saying that reading one page as the other
 * *"will produce a screen that is wrong in both directions"*.
 */

import { api, type RequestOptions } from '@/services/api';
import type {
    EmployeeDocumentSlot,
    EmployeeRecord,
    SetEmployeeAvatarBody,
    UpdateEmployeeRecordBody,
    UpdateEmploymentBody,
} from '@/types/employees.types';

/** ⚠ `documents`, singular-per-request. Not `files` — that is the media library's. */
export const EMPLOYEE_DOCUMENT_FIELD_NAME = 'documents';

// ─── Self-service ─────────────────────────────────────────────────────────────

/**
 * `GET /employees/me` · *self*. **Reachable while `pending`** — it is the whole
 * reason that state exists.
 *
 * ⚠ **A record that has never been touched is not a 404.** A brand-new account
 * answers `200` with a fully-shaped record: nulls, empty arrays, all six document
 * slots present with `fileIds: []`, and a complete `readiness.gaps`.
 */
export function getMyEmployeeRecord(options?: RequestOptions): Promise<EmployeeRecord> {
    return api.get<EmployeeRecord>('/employees/me', options);
}

/**
 * `PATCH /employees/me` · *self* · audited `employees.record.update_self`.
 *
 * ⚠ **Strict schema, empty body refused, calendar dates only, and `phones` /
 * `relatives` / `payoutMethods` are a full replace.** Every one of those is a
 * `400` waiting to happen and each is documented on `UpdateEmployeeRecordBody`.
 *
 * ⚠ **The audit row names the FIELDS that changed and never their values** —
 * `audit.read` reaches tier 3, and a `before`/`after` diff carrying a salary, a
 * date of birth or a mother's maiden name would route this record's contents
 * straight into the one feed it is specifically withheld from.
 */
export function updateMyEmployeeRecord(
    body: UpdateEmployeeRecordBody,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    return api.patch<EmployeeRecord>('/employees/me', body, options);
}

/**
 * `PUT /employees/me/avatar` · *self* · audited `employees.avatar.set`.
 *
 * Upload the image through `POST /files/upload` first and send back the `id`.
 * An avatar is an ordinary media upload and lands in a **public** tree, so it
 * resolves to a real URL — unlike everything in `documents[]`.
 *
 * ⚠ **The file is not verified to exist**, so a wrong id stores a broken
 * reference, visible immediately. ⚠ It lives here rather than on
 * `PATCH /administrators/me` because that route can edit somebody else's
 * profile, and *"an avatar is yours"*.
 *
 * ⚠ **The one audit row on this surface that records a value** — the file id —
 * because it names a file in a public tree every administrator can already
 * resolve.
 */
export function setMyAvatar(
    body: SetEmployeeAvatarBody,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    return api.put<EmployeeRecord>('/employees/me/avatar', body, options);
}

/**
 * `POST /employees/me/documents/:slot` · *self* · **multipart**, field name
 * `documents`.
 *
 * ⚠ **Exactly ONE file per request.** A second part is refused outright; a
 * multi-value slot is filled one upload at a time — which is what a picker does
 * anyway, and it lets the service refuse a full slot *before* spending the
 * bandwidth rather than after.
 *
 * ⚠ **It must go through `api.upload`, which sets no `Content-Type`.** A
 * multipart body is unreadable without its `boundary` token and only the
 * `FormData` serialiser knows it; writing the header by hand omits it, and the
 * service answers `415 FILE_UPLOAD_NOT_MULTIPART` to a request that genuinely
 * was multipart.
 *
 * ⚠ **PNG is NOT converted to WebP here**, unlike the general media pipeline —
 * *"this is evidence somebody may have to produce later, and re-encoding it
 * through a lossy format is a bad trade."* PDFs are accepted for the same
 * reason a scan arrives as one.
 *
 * ⚠ **The response is the whole `EmployeeRecord`**, not the created file, so an
 * upload immediately says whether it closed the last gap on the checklist.
 *
 * ⚠ **The audit row commits BEFORE the body is streamed and its failure is not
 * caught** — with the audit store unreachable, no identity document is stored.
 * An `attempted` row with no target should be read conservatively: a file may
 * exist and this service cannot say.
 */
export async function uploadEmployeeDocument(
    slot: EmployeeDocumentSlot,
    file: File,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    const form = new FormData();
    form.append(EMPLOYEE_DOCUMENT_FIELD_NAME, file, file.name);

    const { data } = await api.upload<EmployeeRecord>(
        `/employees/me/documents/${encodeURIComponent(slot)}`,
        form,
        options,
    );

    return data;
}

/**
 * `DELETE /employees/me/documents/:slot/:fileId` · *self* · audited
 * `employees.documents.detach`. Removes the id from the slot and soft-deletes
 * the file.
 *
 * ⚠ **`404 EMPLOYEE_DOCUMENT_NOT_FOUND`, never `403`.** The record is loaded by
 * the caller's own id, so another administrator's file is simply not in the slot
 * — and a `403` would confirm that the id names a real staff document belonging
 * to somebody else.
 */
export function deleteEmployeeDocument(
    slot: EmployeeDocumentSlot,
    fileId: string,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    return api.delete<EmployeeRecord>(
        `/employees/me/documents/${encodeURIComponent(slot)}/${encodeURIComponent(fileId)}`,
        options,
    );
}

// ─── Somebody else's ──────────────────────────────────────────────────────────

/**
 * `GET /employees/:adminId` · **`employees.read`** — tier 1 only.
 *
 * ⚠ **The same body the subject sees.** There is no redacted variant.
 *
 * ⚠ **It does not disclose the DOCUMENTS.** The record returns file ids; the
 * bytes need `files.content.read`, which is audited per file and fail-closed.
 * Two separate exposures, separately recorded.
 */
export function getEmployeeRecord(
    adminId: string,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    return api.get<EmployeeRecord>(`/employees/${encodeURIComponent(adminId)}`, options);
}

/**
 * `PATCH /employees/:adminId/employment` · **`employees.employment.write`** —
 * tier 1 only, `financial`-flagged, audited `employees.employment.update`.
 *
 * ⚠ **Narrower than its permission's name.** It cannot touch the personal,
 * identity, address, contact or payout halves — those have no administrative
 * write path at all. *"An employee states their own facts; the company states
 * its terms."*
 *
 * ⚠ **`monthlySalaryMinor` is in minor units** and a fractional value is refused
 * rather than rounded.
 */
export function updateEmployment(
    adminId: string,
    body: UpdateEmploymentBody,
    options?: RequestOptions,
): Promise<EmployeeRecord> {
    return api.patch<EmployeeRecord>(
        `/employees/${encodeURIComponent(adminId)}/employment`,
        body,
        options,
    );
}
