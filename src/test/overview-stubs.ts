/**
 * Canned answers for the overview's sixteen reads.
 *
 * The page fires one request per permitted tile, so **any** test that lands on
 * `/dashboard` has to answer all of them or the tiles render failures. This is
 * the one place those answers live, so `App.test.tsx` — which is about routing —
 * does not grow a second, subtly different set beside `Overview.test.tsx`'s.
 *
 * Every count here is distinct, so a test can tell which tile rendered which
 * number rather than asserting on a `0` that four tiles could have produced.
 */

import {
    approvalFixture,
    auditEntryFixture,
    auditMetaFixture,
    codOverviewFixture,
    maintenanceFixture,
    outboxSummaryFixture,
    platformEarningsFixture,
    readinessFixture,
    systemHealthFixture,
} from '@/test/fixtures';
import { successResponse, type FetchCall } from '@/test/utils';

/** What each counting read reports as `meta.total`. */
export const OVERVIEW_COUNTS = {
    users: 8412,
    vendors: 214,
    agencies: 37,
    agents: 486,
    ordersToday: 318,
    shipmentsToday: 274,
    disputes: 7,
    unassigned: 41,
    held: 2,
    approvals: 3,
} as const;

/** A count answer: one row, and the real figure in `meta.total`. */
function countResponse(total: number): Response {
    return successResponse([{}], {
        // `pages: 0` on an empty list is the contract's rule, and `countMatching`
        // warns in dev when `pages` is missing — so it is always present here.
        meta: { total, page: 1, limit: 1, pages: total > 0 ? total : 0 },
    });
}

/**
 * The matchers, **in order** — `/orders/disputes` has to be tested before
 * `/orders`, and the unversioned `/health/ready` probe before `/system/health`.
 */
const ROUTES: ReadonlyArray<[test: (url: string) => boolean, answer: () => Response]> = [
    [(url) => url.includes('/health/ready'), () => successResponse(readinessFixture())],
    [(url) => url.includes('/system/health'), () => successResponse(systemHealthFixture())],
    [(url) => url.includes('/system/outbox'), () => successResponse(outboxSummaryFixture())],
    [(url) => url.includes('/system/maintenance'), () => successResponse(maintenanceFixture())],
    [(url) => url.includes('/cod/overview'), () => successResponse(codOverviewFixture())],
    [
        (url) => url.includes('/money/earnings/platform'),
        () => successResponse(platformEarningsFixture()),
    ],
    [
        (url) => url.includes('/approvals'),
        () =>
            successResponse([approvalFixture()], {
                meta: { total: OVERVIEW_COUNTS.approvals, page: 1, limit: 3, pages: 1 },
            }),
    ],
    [
        (url) => url.includes('/administrators/me/activity'),
        () => successResponse([auditEntryFixture()], { meta: { ...auditMetaFixture() } }),
    ],
    [
        (url) => url.includes('/audit'),
        () => successResponse([auditEntryFixture()], { meta: { ...auditMetaFixture() } }),
    ],
    [(url) => url.includes('/orders/disputes'), () => countResponse(OVERVIEW_COUNTS.disputes)],
    [
        (url) => url.includes('/orders'),
        () => countResponse(OVERVIEW_COUNTS.ordersToday),
    ],
    [
        (url) => url.includes('/shipments') && url.includes('unassigned=true'),
        () => countResponse(OVERVIEW_COUNTS.unassigned),
    ],
    [
        (url) => url.includes('/shipments') && url.includes('held=true'),
        () => countResponse(OVERVIEW_COUNTS.held),
    ],
    [(url) => url.includes('/shipments'), () => countResponse(OVERVIEW_COUNTS.shipmentsToday)],
    [(url) => url.includes('/users'), () => countResponse(OVERVIEW_COUNTS.users)],
    [(url) => url.includes('/vendors'), () => countResponse(OVERVIEW_COUNTS.vendors)],
    [(url) => url.includes('/agencies'), () => countResponse(OVERVIEW_COUNTS.agencies)],
    [(url) => url.includes('/agents'), () => countResponse(OVERVIEW_COUNTS.agents)],
    [
        (url) => url.includes('/notifications/unread-count'),
        () => successResponse({ unreadCount: 12 }),
    ],
];

/**
 * Answer an overview read, or `null` if the URL is not one.
 *
 * Returning `null` rather than throwing keeps the decision with the caller: a
 * test that wants "anything unexpected is a failure" still gets it, and a test
 * that wants to override one route can check its own matcher first.
 */
export function answerOverviewRead(call: FetchCall): Response | null {
    const matched = ROUTES.find(([test]) => test(call.url));
    return matched ? matched[1]() : null;
}
