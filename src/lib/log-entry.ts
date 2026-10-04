/**
 * One platform log line, read defensively.
 *
 * `GET /system/platform/logs` declares the entry **partially** on purpose —
 * `system.md` § "The shape of a log entry": `at`, `level` and `msg` are
 * guaranteed, `requestId`, `err` and `res` are named, and *"anything else — the
 * writer's context. Render it raw as text; do not assume a shape."* So the wire
 * type stays `Record<string, unknown>` and this is the one place that reads it.
 *
 * ── ⚠ On an error line, `msg` is NOT the error ────────────────────────────────
 * jovi-mall's global error handler writes `msg` as `"<category> <status> <code>"`
 * — `internal 500 INTERNAL_SERVER_ERROR` — and puts what actually happened in
 * `httpError.internalMessage`, `httpError.causeMessage`, `httpError.details` and
 * `err.stack` (`api/middlewares/error-handler.middleware.ts`). A screen that
 * renders `msg` alone therefore shows the code and never the failure, which is
 * exactly what Platform logs did until 2026-09-21.
 *
 * ⚠ **The keys below are read from jovi-mall's `LogRecord` (`core/logging/log-record.ts`),
 * not only from the page.** The page names `res.statusCode`; the service serves a
 * top-level `status` and has no `res` at all, and it serves `httpError`,
 * `method`, `path`, `durationMs`, `actorId` and `source`, none of which the page
 * lists. Both spellings of the status are read, and anything still unknown lands
 * in `extra` rather than being dropped.
 */

export interface LogEntryError {
    type: string | null;
    message: string | null;
    stack: string | null;
}

/**
 * The error handler's record. `internalMessage` is what the code threw;
 * `clientMessage` is what the caller was sent, and the two differ exactly when
 * the category is masked.
 */
export interface LogEntryHttpError {
    code: string | null;
    category: string | null;
    statusCode: number | null;
    routeGroup: string | null;
    actorRole: string | null;
    clientMessage: string | null;
    internalMessage: string | null;
    causeMessage: string | null;
    details: unknown;
    masked: boolean;
}

export interface LogEntryView {
    at: string;
    level: string;
    msg: string;
    requestId: string | null;
    /**
     * ⚠ A **user** id when `actorSource` is `platform`, an **administrator** id when it is
     * `admin`. Lines written before 2026-10-04 carry the id alone, so `actorSource` may be
     * null with an id present — say so rather than guess which namespace it is in.
     */
    actorId: string | null;
    actorSource: string | null;
    /** `customer` · `vendor` · `agency` · `agent` · `admin` — an open string; render unknowns raw. */
    actorRole: string | null;
    /** The person, read off their profile — a vendor's display name, never the shop's. */
    actorName: string | null;
    /** The vendor / agency / agent / customer id — the one on that party's page. */
    actorProfileId: string | null;
    /** `console` for a bridged `console.*` call, which carries no component name. */
    source: string | null;
    method: string | null;
    routeGroup: string | null;
    path: string | null;
    status: number | null;
    durationMs: number | null;
    err: LogEntryError | null;
    httpError: LogEntryHttpError | null;
    /** Every key this reader does not know — the writer's own context, rendered raw. */
    extra: Record<string, unknown>;
}

const KNOWN_KEYS = new Set([
    'at',
    'level',
    'msg',
    'requestId',
    'actorId',
    'actorSource',
    'actorRole',
    'actorName',
    'actorProfileId',
    'source',
    'method',
    'routeGroup',
    'path',
    'status',
    'durationMs',
    'err',
    'httpError',
    'res',
]);

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

export function readLogEntry(raw: Record<string, unknown>): LogEntryView {
    const err = record(raw.err);
    const http = record(raw.httpError);
    const res = record(raw.res);

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!KNOWN_KEYS.has(key)) extra[key] = value;
    }

    return {
        at: String(raw.at ?? ''),
        level: String(raw.level ?? ''),
        msg: String(raw.msg ?? ''),
        requestId: text(raw.requestId),
        actorId: text(raw.actorId),
        actorSource: text(raw.actorSource),
        // The error handler's own record carried the role before the line did, so an older
        // error line still answers "who" by role.
        actorRole: text(raw.actorRole) ?? text(http?.actorRole),
        actorName: text(raw.actorName),
        actorProfileId: text(raw.actorProfileId),
        source: text(raw.source),
        method: text(raw.method),
        routeGroup: text(raw.routeGroup),
        path: text(raw.path),
        status: count(raw.status) ?? count(res?.statusCode) ?? count(http?.statusCode),
        durationMs: count(raw.durationMs),
        err: err
            ? { type: text(err.type), message: text(err.message), stack: text(err.stack) }
            : null,
        httpError: http
            ? {
                  code: text(http.code),
                  category: text(http.category),
                  statusCode: count(http.statusCode),
                  routeGroup: text(http.routeGroup),
                  actorRole: text(http.actorRole),
                  clientMessage: text(http.clientMessage),
                  internalMessage: text(http.internalMessage),
                  causeMessage: text(http.causeMessage),
                  details: http.details ?? null,
                  masked: http.masked === true,
              }
            : null,
        extra,
    };
}

/** Platform logs, narrowed to one person — the `?actorId=` the screen reads from the address. */
export function platformLogsPathFor(userId: string): string {
    return `/dashboard/dev-tools/logs?${new URLSearchParams({ actorId: userId })}`;
}

const ROLE_WORDS: Record<string, string> = {
    customer: 'Customer',
    vendor: 'Vendor',
    agency: 'Agency',
    agent: 'Agent',
    admin: 'Administrator',
};

/** A role in words; an unknown one is rendered raw rather than guessed at. */
export function logActorRoleLabel(role: string | null): string | null {
    if (!role) return null;
    return ROLE_WORDS[role] ?? role;
}

/**
 * Who wrote this line, in one phrase — or `null` for a line no actor wrote (a worker, a boot
 * line, an anonymous request). Name first because a ticket names a person; the role beside it,
 * because two people share a name more often than a name and a role.
 *
 * ⚠ An id with no `actorSource` is a line from before the platform said which namespace the id
 * is in — so it is called "Signed-in caller", never "Administrator" (which is what the dialog
 * said of every id until 2026-10-04, platform users included).
 */
export function logActorLabel(entry: LogEntryView): string | null {
    if (!entry.actorId && !entry.actorName) return null;
    const role =
        logActorRoleLabel(entry.actorRole) ??
        (entry.actorSource === 'admin' ? 'Administrator' : null);
    if (entry.actorName) return role ? `${entry.actorName} · ${role}` : entry.actorName;
    return role ?? 'Signed-in caller';
}

/**
 * What actually went wrong, when the line says more than its `msg`.
 *
 * The thrown message first, because it is the half an operator needs first —
 * the error handler's own comment says so. `null` when there is nothing beyond
 * `msg`, so an ordinary info line gains no second line that repeats the first.
 */
export function logEntryHeadline(entry: LogEntryView): string | null {
    const candidate =
        entry.httpError?.internalMessage ??
        entry.err?.message ??
        entry.httpError?.causeMessage ??
        null;
    if (!candidate || candidate.trim() === entry.msg.trim()) return null;
    return candidate;
}

/**
 * Whether jovi-mall cut this value when it wrote the line.
 *
 * `parseLogLine` bounds a stack, an internal message and a cause at
 * `LOG_MAX_STACK_BYTES` (4096 by default) and marks the cut with a trailing `…`.
 * ⚠ `system.md` says *"nothing is truncated server-side"*, which is false for
 * exactly these fields — so the dialog says so, rather than let a reader go
 * looking for the rest of a stack that was never stored.
 */
export function wasCutAtWrite(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.endsWith('…');
}

/** `details` replaced wholesale by `boundDetails` for being over the same budget. */
export function detailsWereDropped(value: unknown): boolean {
    const shape = record(value);
    return shape !== null && shape.truncated === true;
}
