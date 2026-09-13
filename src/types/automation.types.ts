/**
 * `/automation` — what the customer bot reported about its own failures.
 *
 * Source: `api-doc/admin/api/automation.md` (verified against source 2026-09-08) and
 * `api-doc/docs/ADR-022-AUTOMATION-FAILURE-AUDIT.md` (re-measured against the n8n instance
 * 2026-09-09). Two `GET`s, neither audited — the subject is a machine, and nothing here
 * discloses anything about a person.
 *
 * ── Why this is not part of `/system` ─────────────────────────────────────────
 * `/system` reports on **this platform's** machinery. The bot runs on a third-party runtime
 * (n8n) that fails independently of it, so *"is the customer bot working?"* is a question
 * `/system` cannot answer at any depth.
 *
 * ── ⚠ A successful execution can still be a failure, which is why there are two kinds ──
 * `wi-mall-core` carries fifteen error-swallowing nodes **by design**, so that a customer
 * always gets *an* answer. On 2026-09-07 jovi-mall was down, a customer got the "cannot reach
 * the service" fallback, and n8n recorded the execution as `success`. ADR-022 states the
 * consequence outright: *execution status is not a failure signal on this platform*.
 *
 * So the feed carries `execution_failed` (**the workflow died**) and `degraded_turn` (**the
 * workflow succeeded and the answer was worse than it should have been**), and a screen must
 * never merge them. A wall of `degraded_turn` with no `execution_failed` is the signature of
 * *something else* being down — usually jovi-mall; a wall of `execution_failed` is the bot
 * itself. Collapsing the two destroys the only diagnosis this surface offers.
 *
 * ── ⚠ Two documented facts about coverage that a screen must NOT restate ─────
 * 1. **State no coverage count.** `automation.md:145` says nine workflows report; ADR-022's
 *    re-measure of `settings.errorWorkflow` across all thirteen workflows on the instance says
 *    **ten**. The number is not the interesting part — D-8 predicted its own drift in writing
 *    (*"a new bot workflow is invisible until somebody wires it"*) and then drifted within a
 *    day. Say that coverage is an **allowlist**; never print a figure.
 * 2. **The `UP-` prefix means nothing.** `automation.md:151` says every workflow belonging to
 *    this backend is named `UP-wi-mall-…`; ADR-022 records that `wi-mall-product-cards` has no
 *    prefix at all. Do not strip it, group on it, or use it to decide whether a workflow is
 *    ours. `workflowId` is the only stable handle.
 */

// ─── The two filter vocabularies ──────────────────────────────────────────────

/**
 * `kind` — the two things this surface reports, and the reason it reports two.
 *
 * A **filter** vocabulary, not a rendering one: the row's own `kind` stays a plain `string`,
 * because adding an enum member is an additive, non-breaking change on this service and a
 * closed `switch` would break on a routine deploy.
 */
export const AUTOMATION_FAILURE_KINDS = ['execution_failed', 'degraded_turn'] as const;

export type AutomationFailureKind = (typeof AUTOMATION_FAILURE_KINDS)[number];

/**
 * `channel` — and **`unknown` is a real value that a filter must offer.**
 *
 * It is the *stored default*, and an `execution_failed` report has no envelope to read a
 * channel out of: the workflow died before there was one. A dropdown offering only Telegram
 * and WhatsApp therefore hides most of the *died-outright* rows — the more urgent half of the
 * feed — while looking complete. Stated as a trap in `automation.md:55`.
 */
export const AUTOMATION_CHANNELS = ['telegram', 'whatsapp', 'unknown'] as const;

export type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number];

// ─── GET /automation/failures — one route, three answers ──────────────────────

/**
 * The support rung — **that a channel was degraded, and when.** Nothing about the machine.
 *
 * ⚠ **No tier ever receives the customer identifier**, hashed or otherwise (ADR-022 D-5). The
 * salted digest exists so `summary` can answer *"one customer ten times or ten customers
 * once?"* server-side; handing it out would let a caller correlate a customer across every
 * report, which is the one thing the hash was chosen to prevent.
 */
export interface SupportAutomationFailure {
    id: string;
    /** Open — see `AUTOMATION_FAILURE_KINDS`. */
    kind: string;
    occurredAt: string;
    /** Open, and `unknown` is the stored default rather than a missing value. */
    channel: string;
}

/**
 * The admin rung — which workflow, which node, what it said, and when it landed.
 *
 * ⚠ **`workflowName` is a display string and `workflowId` is the identifier.** The name has
 * already changed twice in one day (`tg-adapter` → `wi-mall-tg-adapter` →
 * `UP-wi-mall-tg-adapter`, both 2026-09-07) and the id did not move through either rename.
 * Show the name; key, filter and group on the id.
 *
 * `receivedAt` is when wi-admin was told, `occurredAt` is when it happened — during a
 * correlated outage the gap between them is itself information, so both are kept.
 */
export interface AdminAutomationFailure extends SupportAutomationFailure {
    workflowId: string;
    workflowName: string;
    executionId: string | null;
    nodeName: string | null;
    errorMessage: string | null;
    receivedAt: string;
}

/**
 * The developer rung — the stack and the report's own request id.
 *
 * A stack names our files and our call graph rather than the state of the platform, which is
 * why it belongs to `developer_tools.logs.read` and stops there. ADR-022 D-7: one permission
 * for all three rungs is *not expressible*, because `assertGrantTableValid()` refuses the
 * `developer_tools` family to any tier but 1 at boot.
 */
export interface DeveloperAutomationFailure extends AdminAutomationFailure {
    errorStack: string | null;
    requestId: string | null;
}

export type AutomationFailure =
    | SupportAutomationFailure
    | AdminAutomationFailure
    | DeveloperAutomationFailure;

/**
 * `GET /automation/failures` — the **open `view` arm**, exactly as `SystemErrorsPage` models it.
 *
 * ── Narrow on `view` for copy, on the ROW for fields ─────────────────────────
 * `view` names which grading answered and **must be rendered**: without it a Support agent
 * reading a three-field row cannot tell *"there is nothing more to know"* from *"I am not
 * being shown it"*, and escalates an incident that is already understood. But the *union* is
 * narrowed on the row's own shape (`'workflowId' in entry`), never on `usePermissions().tier`
 * — `tier` and `status` are re-read from the database on every request, so a grant that
 * changed mid-session would have the client reading fields the response does not carry.
 * `if (tier === 3)` is banned in this codebase for exactly this.
 *
 * The fourth arm is open on purpose: a `view` this client has not heard of must render as an
 * unknown projection with the thinnest row shape, not as a parse failure.
 *
 * ⚠ **`configured: false` is not "all healthy".** When `AUTOMATION_REPORT_TOKEN` is unset this
 * deployment accepts no reports at all and both routes answer with nothing in them. An empty
 * board otherwise means one of two opposite things — *nothing failed*, or *no reporter is
 * pointed here* — and only this flag separates them. The failure mode is silent by
 * construction: ADR-022's own Consequences note that a token mismatch surfaces as reports that
 * **stop arriving**, which looks exactly like nothing failing.
 *
 * ⚠ **There is no cursor and no `meta`.** This is a monitoring surface, not an export, and the
 * rows are TTL'd (`ADMIN_AUTOMATION_RETENTION_DAYS`, default 30). `count` is the number of rows
 * in *this* answer, bounded by `limit` — it is not a total and there is no page to ask for.
 */
export type AutomationFailuresPage = {
    configured: boolean;
    windowHours: number;
    count: number;
} & (
    | { view: 'support'; entries: SupportAutomationFailure[] }
    | { view: 'admin'; entries: AdminAutomationFailure[] }
    | { view: 'developer'; entries: DeveloperAutomationFailure[] }
    | { view: string; entries: SupportAutomationFailure[] }
);

/**
 * Query bounds, verbatim from the contract's table. Anything outside them is a
 * `400 VALIDATION_ERROR` — there is no clamping on the service's side.
 */
export interface AutomationFailuresQuery {
    /** 1–64 characters. **The id, never the name.** */
    workflowId?: string;
    /** `execution_failed` · `degraded_turn`. */
    kind?: string;
    /** `telegram` · `whatsapp` · **`unknown`**. */
    channel?: string;
    /** 1–720 (30 days). Default 24. */
    windowHours?: number;
    /** 1–200. Default 50. */
    limit?: number;
}

// ─── GET /automation/summary — not tier-projected ─────────────────────────────

/**
 * One group per (workflow, kind, channel) over the window.
 *
 * ⚠ **`distinctCustomers` is the field to read twice.** *47 reports from 12 customers* is a
 * platform incident; *47 from 1* is one person retrying. A list of rows cannot tell you which,
 * and this is the only place the answer exists — it is computed server-side from a hash that
 * never leaves the service.
 */
export interface AutomationFailureGroup {
    workflowId: string;
    workflowName: string;
    /** Open — see `AUTOMATION_FAILURE_KINDS`. */
    kind: string;
    /** Open — `unknown` is the stored default. */
    channel: string;
    count: number;
    distinctCustomers: number;
    lastOccurredAt: string;
}

/**
 * `GET /automation/summary` — **the one surface in this module that is not graded.**
 *
 * A count carries no machine detail and no identifier, so there is nothing to withhold and
 * every rung gets the same answer. That asymmetry is worth knowing before laying out the
 * module: a Support administrator sees *more* here — the workflow name, the id, the distinct
 * customer count — than the failures feed will ever show them.
 *
 * `since` is the window's start as the service computed it; prefer it to re-deriving the
 * boundary from `windowHours` in the browser's clock.
 */
export interface AutomationSummary {
    configured: boolean;
    windowHours: number;
    since: string;
    groups: AutomationFailureGroup[];
}

export interface AutomationSummaryQuery {
    /** 1–720 (30 days). Default 24. */
    windowHours?: number;
}

// ─── Shared bounds, named once ────────────────────────────────────────────────

/** `windowHours` — 1 to 720, default 24. Outside the range is a `400`, not a clamp. */
export const AUTOMATION_WINDOW_HOURS_DEFAULT = 24;
export const AUTOMATION_WINDOW_HOURS_MIN = 1;
export const AUTOMATION_WINDOW_HOURS_MAX = 720;

/** `limit` — 1 to 200, default 50. Not the service-wide 100 ceiling; this route sets its own. */
export const AUTOMATION_LIMIT_DEFAULT = 50;
export const AUTOMATION_LIMIT_MAX = 200;

/** `workflowId` — 1 to 64 characters. n8n ids are 16 alphanumerics today; the bound is not. */
export const AUTOMATION_WORKFLOW_ID_MAX_LENGTH = 64;

/**
 * Does this row carry the machine detail, i.e. did the admin rung or better answer?
 *
 * ⚠ **Tested on the row, not on the reader.** See `AutomationFailuresPage`.
 */
export function isAdminAutomationFailure(
    entry: SupportAutomationFailure,
): entry is AdminAutomationFailure {
    return 'workflowId' in entry;
}

/**
 * Does this row carry the stack?
 *
 * ⚠ Key **presence**, not value: this service's output rule is that a field which exists is
 * always present and absent data is `null`, so a developer row with no stack still narrows
 * here and renders "no stack recorded" rather than disappearing into the admin shape.
 */
export function isDeveloperAutomationFailure(
    entry: SupportAutomationFailure,
): entry is DeveloperAutomationFailure {
    return 'errorStack' in entry;
}

/**
 * Split rows by `kind`, **known kinds first and in the contract's order**, unknown kinds after.
 *
 * The one helper both screens share, and it exists so that *"never merge the two kinds"* is a
 * property of the data on the way into the render rather than a rule each screen remembers.
 *
 * Two things it deliberately does:
 * - **Emits a known kind even when it has no rows.** *Zero `execution_failed` beside forty-seven
 *   `degraded_turn`* is the diagnosis, so the empty half has to be visible; dropping it would
 *   render a one-sided window as an ordinary one.
 * - **Keeps an unrecognised kind rather than discarding it.** Adding an enum member is an
 *   additive, non-breaking change on this service, so a `kind` this client has not heard of
 *   gets its own section and its raw string as a heading.
 */
export function partitionByKind<T extends { kind: string }>(
    rows: readonly T[],
): { kind: string; rows: T[] }[] {
    const buckets = new Map<string, T[]>(AUTOMATION_FAILURE_KINDS.map((kind) => [kind, []]));

    for (const row of rows) {
        const bucket = buckets.get(row.kind);
        if (bucket) bucket.push(row);
        else buckets.set(row.kind, [row]);
    }

    return [...buckets].map(([kind, kindRows]) => ({ kind, rows: kindRows }));
}
