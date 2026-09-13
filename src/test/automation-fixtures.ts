/**
 * Wire-shaped fixtures for `/automation`.
 *
 * Shaped from `api-doc/admin/api/automation.md`'s two worked JSON bodies, with the ids and
 * workflow names taken from ADR-022's re-measure of the instance rather than invented — the
 * `UP-wi-mall-core` / `wi-mall-product-cards` pair below is the actual naming inconsistency
 * D-8 records, and it is here so that a screen which quietly assumed the `UP-` prefix would
 * have something to fail against.
 */

import type {
    AdminAutomationFailure,
    AutomationFailureGroup,
    AutomationFailuresPage,
    AutomationSummary,
    DeveloperAutomationFailure,
    SupportAutomationFailure,
} from '@/types/automation.types';

/** n8n workflow ids are opaque and short — not 24-hex, unlike everything else on this service. */
export const CORE_WORKFLOW_ID = 'vvbouV2136P5weCs';
/** ⚠ The workflow with **no** `UP-` prefix. Its presence in a fixture is the point. */
export const CARDS_WORKFLOW_ID = 'Q1r8xKp3TzLm40Ay';

// ─── GET /automation/failures ─────────────────────────────────────────────────

/** The support rung: a channel was degraded, and when. Three fields, and that is all there is. */
export function supportFailureFixture(
    overrides: Partial<SupportAutomationFailure> = {},
): SupportAutomationFailure {
    return {
        id: '665f1a2b3c4d5e6f70819201',
        kind: 'degraded_turn',
        occurredAt: '2026-09-07T11:12:31.874Z',
        channel: 'whatsapp',
        ...overrides,
    };
}

/** The admin rung: which workflow, which node, what it said. */
export function adminFailureFixture(
    overrides: Partial<AdminAutomationFailure> = {},
): AdminAutomationFailure {
    return {
        ...supportFailureFixture(),
        workflowId: CORE_WORKFLOW_ID,
        workflowName: 'UP-wi-mall-core',
        executionId: '902',
        nodeName: 'sync identity',
        errorMessage: 'timeout of 20000ms exceeded',
        receivedAt: '2026-09-07T11:12:33.000Z',
        ...overrides,
    };
}

/**
 * An `execution_failed` row — **and its channel is `unknown`, which is the ordinary case.**
 *
 * The workflow died before there was an envelope to read a channel out of, so the stored
 * default stands. This fixture is what a Telegram/WhatsApp-only filter would hide.
 */
export function executionFailedFixture(
    overrides: Partial<AdminAutomationFailure> = {},
): AdminAutomationFailure {
    return adminFailureFixture({
        id: '665f1a2b3c4d5e6f70819202',
        kind: 'execution_failed',
        channel: 'unknown',
        workflowId: CARDS_WORKFLOW_ID,
        // ⚠ No `UP-` prefix, on purpose — see the module docblock.
        workflowName: 'wi-mall-product-cards',
        executionId: '1044',
        nodeName: 'send whatsapp',
        errorMessage: 'Request failed with status code 401 (OAuthException, code 190)',
        occurredAt: '2026-09-07T11:40:02.115Z',
        receivedAt: '2026-09-07T11:40:02.480Z',
        ...overrides,
    });
}

/** The developer rung: the stack and the report's own request id. */
export function developerFailureFixture(
    overrides: Partial<DeveloperAutomationFailure> = {},
): DeveloperAutomationFailure {
    return {
        ...adminFailureFixture(),
        errorStack:
            'AxiosError: timeout of 20000ms exceeded\n    at RedirectableRequest.handleRequestTimeout',
        requestId: '902',
        ...overrides,
    };
}

/**
 * A whole page. `view: 'support'` by default, matching the thinnest rung — a screen that only
 * renders correctly against the richest projection fails here rather than in production.
 */
export function automationFailuresPageFixture(
    overrides: Partial<AutomationFailuresPage> = {},
): AutomationFailuresPage {
    return {
        configured: true,
        windowHours: 24,
        count: 1,
        view: 'support',
        entries: [supportFailureFixture()],
        ...overrides,
    } as AutomationFailuresPage;
}

/**
 * ⚠ **The deployment accepts no reports at all.** `AUTOMATION_REPORT_TOKEN` is unset, so this
 * is *not* "nothing failed" — and telling the two apart is the whole reason `configured` is on
 * the wire.
 */
export function unconfiguredFailuresPageFixture(): AutomationFailuresPage {
    return automationFailuresPageFixture({ configured: false, count: 0, entries: [] });
}

// ─── GET /automation/summary ──────────────────────────────────────────────────

export function failureGroupFixture(
    overrides: Partial<AutomationFailureGroup> = {},
): AutomationFailureGroup {
    return {
        workflowId: CORE_WORKFLOW_ID,
        workflowName: 'UP-wi-mall-core',
        kind: 'degraded_turn',
        channel: 'whatsapp',
        count: 47,
        // 47 reports from 12 customers — the incident reading.
        distinctCustomers: 12,
        lastOccurredAt: '2026-09-07T11:12:31.874Z',
        ...overrides,
    };
}

/** 47 reports from **one** customer — the same count, the opposite conclusion. */
export function oneCustomerRetryingGroupFixture(): AutomationFailureGroup {
    return failureGroupFixture({
        workflowId: CARDS_WORKFLOW_ID,
        workflowName: 'wi-mall-product-cards',
        kind: 'execution_failed',
        channel: 'unknown',
        count: 47,
        distinctCustomers: 1,
        lastOccurredAt: '2026-09-07T11:40:02.115Z',
    });
}

export function automationSummaryFixture(
    overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
    return {
        configured: true,
        windowHours: 24,
        since: '2026-09-06T11:00:00.000Z',
        groups: [failureGroupFixture()],
        ...overrides,
    };
}

/** No reporter points here. An empty summary and a healthy platform look identical without it. */
export function unconfiguredSummaryFixture(): AutomationSummary {
    return automationSummaryFixture({ configured: false, groups: [] });
}
