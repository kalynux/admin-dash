/**
 * `/refunds` — the refund queue. **Twelve routes** (2026-10-05).
 *
 * Source: `api-doc/admin/api/refunds.md`. The list, the detail and the activity
 * feed read `refund_requests` directly; **every write, the eligibility read and
 * the proof bytes are delegated** to jovi-mall, so their refusals arrive as
 * `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in `details.platformCode`
 * — read them with `refundRefusalCode()`, which also takes wi-admin's own
 * pre-flight codes of the same names.
 *
 * ── Who may call what ─────────────────────────────────────────────────────────
 * `orders.refund.read` (every tier) reads; `orders.refund.request` (every tier,
 * `financial` — it holds the seller's earnings) raises and uploads a proof;
 * `orders.refund` (tiers 1–2) approves, rejects, retries and resolves;
 * `orders.refund.settle_external` (tiers 1–2) records a hand payment.
 * **Support may hold, never send.**
 *
 * ── Every body is built as a literal ──────────────────────────────────────────
 * The schemas are `.strict()`: an unknown key is a `400`, and an empty optional
 * string is a `400` where an absent key is "none". Never spread a form object.
 */

import { withQuery } from '@/lib/query';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import { api, type RequestOptions } from '@/services/api';
import type { DualControlResult, Paginated } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import type { AuditEntry, AuditListQuery } from '@/types/audit.types';
import type { FileContent } from '@/types/files.types';
import type {
    ApproveNowOutcome,
    CreateRefundBody,
    CreateRefundResult,
    RefundEligibility,
    RefundEligibilityQuery,
    RefundListQuery,
    RefundRequest,
    ResolveRefundBody,
    SettleExternalRefundBody,
} from '@/types/refunds.types';

/** The pair `GET /refunds/:refundId/activity` needs, in `all` mode. */
export const REFUND_ACTIVITY_PERMISSIONS = ['orders.refund.read', 'audit.read'] as const;

/** The multipart field `POST /refunds/proofs` reads — `file`, ONE part. */
export const REFUND_PROOF_FIELD_NAME = 'file';

function refundPath(refundId: string, suffix = ''): string {
    return `/refunds/${encodeURIComponent(refundId)}${suffix}`;
}

/**
 * `GET /refunds` · `orders.refund.read`. Newest first by default.
 *
 * ⚠ `status` is a pinned enum — an unknown value is a `400`, so callers send only
 * names from `REFUND_REQUEST_STATUSES`. `open=true` is ignored when `status` is
 * given. **The phone is masked on this list.**
 */
export function listRefundRequests(
    query: RefundListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<RefundRequest>> {
    return api.list<RefundRequest>(withQuery('/refunds', { ...query }), options);
}

/** `GET /refunds/:refundId` · `orders.refund.read`. **The destination in full.** */
export function getRefundRequest(refundId: string, options?: RequestOptions): Promise<RefundRequest> {
    return api.get<RefundRequest>(refundPath(refundId), options);
}

/**
 * `GET /refunds/:refundId/activity` · `orders.refund.read` **+** `audit.read`.
 * A request still waiting for a second administrator is NOT here — it is at
 * `GET /approvals?targetId=<refundId>`.
 */
export function listRefundActivity(
    refundId: string,
    query: AuditListQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return api
        .list<AuditEntry>(withQuery(refundPath(refundId, '/activity'), { ...query }), options)
        .then(toAuditPage);
}

/**
 * `GET /refunds/eligibility` · `orders.refund.request` · **delegated**.
 *
 * Only the five documented keys are built — jovi-mall's query is strict and
 * wi-admin drops anything else. Call it again as the reason, the "defective"
 * flag or the amount changes.
 */
export function getRefundEligibility(
    query: RefundEligibilityQuery,
    options?: RequestOptions,
): Promise<RefundEligibility> {
    return api.get<RefundEligibility>(
        withQuery('/refunds/eligibility', {
            sourceKind: query.sourceKind,
            sourceId: query.sourceId,
            reasonKind: query.reasonKind,
            itemDefective: query.itemDefective,
            amount: query.amount,
        }),
        options,
    );
}

/**
 * `POST /refunds` · `orders.refund.request` · **delegated** · audited.
 *
 * ⚠ **Always `201` with the created request**, `approveNow` or not — read
 * `meta.approveNow.status`. On `failed` the request EXISTS: do not resubmit the
 * create (it would be `REFUND_ALREADY_OPEN`).
 */
export async function createRefundRequest(
    body: CreateRefundBody,
    options?: RequestOptions,
): Promise<CreateRefundResult> {
    const reason = body.reason.trim();
    const destinationName = body.destination?.name?.trim();
    const literal = {
        sourceKind: body.sourceKind,
        sourceId: body.sourceId,
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        reasonKind: body.reasonKind,
        reason,
        ...(body.itemDefective !== undefined ? { itemDefective: body.itemDefective } : {}),
        ...(body.overridePolicy ? { overridePolicy: true } : {}),
        ...(body.destination
            ? {
                  destination: {
                      phone: body.destination.phone.trim(),
                      ...(destinationName ? { name: destinationName } : {}),
                  },
              }
            : {}),
        ...(body.destinationProofFileId
            ? { destinationProofFileId: body.destinationProofFileId }
            : {}),
        ...(body.approveNow ? { approveNow: true } : {}),
        ...(body.ticketId ? { ticketId: body.ticketId } : {}),
    };

    const { data, meta, message } = await api.mutate<
        RefundRequest | { id: string },
        { approveNow?: ApproveNowOutcome }
    >('POST', '/refunds', literal, options);

    return {
        refund: data,
        approveNow: meta?.approveNow ?? { status: 'not_requested' },
        message,
    };
}

/**
 * `POST /refunds/:refundId/approve` · `orders.refund` · **dual-controlled**.
 *
 * `200` → approved (usually `sending`; `waiting_for_cash` for COD; `completed`
 * for a card). **`202` → nothing was approved**: `grossAmount ≥ 2,000,000` (read
 * off the row, never the body), queued for a second administrator. The body is
 * an empty literal — the schema is `.strict()`.
 *
 * `409 REFUND_SECOND_APPROVER_REQUIRED`: the caller typed this number (R-7).
 */
export function approveRefundRequest(
    refundId: string,
    options?: RequestOptions,
): Promise<DualControlResult<RefundRequest, Approval>> {
    return api.dualControl<RefundRequest, Approval>('POST', refundPath(refundId, '/approve'), {}, options);
}

/**
 * `POST /refunds/:refundId/reject` · `orders.refund`. From `awaiting_approval`
 * or `failed` only — **never `sending`**. The earnings pause lifts. Never queued.
 */
export function rejectRefundRequest(refundId: string, reason: string, options?: RequestOptions) {
    return api.mutate<RefundRequest>(
        'POST',
        refundPath(refundId, '/reject'),
        { reason: reason.trim() },
        options,
    );
}

/**
 * `POST /refunds/:refundId/retry` · `orders.refund`. From `approved` or
 * `failed`. jovi-mall sends again **with the same transfer reference**, so a
 * retry cannot pay twice — ⛔ do not add a client-side idempotency key.
 */
export function retryRefundRequest(refundId: string, options?: RequestOptions) {
    return api.mutate<RefundRequest>('POST', refundPath(refundId, '/retry'), {}, options);
}

/**
 * `POST /refunds/:refundId/settle-external` · `orders.refund.settle_external`.
 * The proof is mandatory (R-7b) and must come from `POST /refunds/proofs`.
 * **Never from `sending`.** A blank `reference` is omitted, never sent as `""`.
 */
export function settleRefundExternally(
    refundId: string,
    body: SettleExternalRefundBody,
    options?: RequestOptions,
) {
    const reference = body.reference?.trim();
    return api.mutate<RefundRequest>(
        'POST',
        refundPath(refundId, '/settle-external'),
        {
            method: body.method,
            ...(reference ? { reference } : {}),
            proofFileId: body.proofFileId,
        },
        options,
    );
}

/**
 * `POST /refunds/:refundId/resolve-unknown` · `orders.refund`. Only from
 * `sending`; `note` ≥ 10 characters. jovi-mall also refuses a request younger
 * than its reconciliation sweep's minimum age — a callback may still arrive.
 */
export function resolveRefundRequest(refundId: string, body: ResolveRefundBody, options?: RequestOptions) {
    return api.mutate<RefundRequest>(
        'POST',
        refundPath(refundId, '/resolve-unknown'),
        { outcome: body.outcome, note: body.note.trim() },
        options,
    );
}

/**
 * `POST /refunds/proofs` · `orders.refund.request` · audited.
 *
 * **One** picture, multipart field `file`, to jovi-mall's PRIVATE
 * `refund-proofs` tree — never `/files/upload`, whose trees are public. Answers
 * `{ fileId }`; use it as `destinationProofFileId` or `proofFileId`. Goes
 * through `api.upload`, which sets no `Content-Type` so the browser can write
 * the multipart boundary.
 */
export async function uploadRefundProof(file: File, options?: RequestOptions): Promise<string> {
    const form = new FormData();
    form.append(REFUND_PROOF_FIELD_NAME, file, file.name);
    const { data } = await api.upload<{ fileId?: string }>('/refunds/proofs', form, options);
    if (!data || typeof data.fileId !== 'string') {
        throw new Error('The proof was uploaded but no file id came back. Upload it again.');
    }
    return data.fileId;
}

/**
 * `GET /refunds/proofs/:fileId` · `orders.refund.read` — **bytes, not JSON**,
 * and ⚠ **every read writes an audit row first** (`orders.refund.proof.read`).
 * Call it from a click and from nothing else; see `useFileContent`.
 *
 * Served only when a refund request names the file — otherwise `404
 * FILE_NOT_FOUND`.
 */
export async function getRefundProof(fileId: string, options?: RequestOptions): Promise<FileContent> {
    const { blob, fileName, contentType, contentLength } = await api.download(
        `/refunds/proofs/${encodeURIComponent(fileId)}`,
        options,
    );
    return {
        objectUrl: URL.createObjectURL(blob),
        mimeType: contentType ?? blob.type ?? '',
        size: blob.size,
        truncated: contentLength !== undefined && blob.size < contentLength,
        fileName,
    };
}
