import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notify } from '@/lib/notify';
import { Notifications } from '@/pages/Notifications';
import { __resetNotificationSourceCache } from '@/services/notifications.service';
import { NotificationsContext, type NotificationsState } from '@/store/notifications-context';
import {
    adminFixture,
    notificationFixture,
    notificationMetaFixture,
    notificationSourceFixture,
} from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

// The registry is memoised at module scope, so one test's answer would otherwise
// serve the next one's filters.
beforeEach(__resetNotificationSourceCache);
afterEach(__resetNotificationSourceCache);

/**
 * The router's query string, in the DOM.
 *
 * `renderWithProviders` mounts a `MemoryRouter`, so `window.location` never
 * moves — asserting on it would pass vacuously against a screen that held its
 * filters in `useState`, which is the exact thing these tests exist to rule out.
 */
function SearchProbe() {
    return <span data-testid="search">{useLocation().search}</span>;
}

function inbox(overrides: Partial<NotificationsState> = {}, route = '/dashboard/notifications') {
    const state: NotificationsState = {
        unreadCount: 12,
        enabled: true,
        refresh: async () => {},
        adjustUnread: () => {},
        ...overrides,
    };

    return renderWithProviders(
        <NotificationsContext.Provider value={state}>
            <Notifications />
            <SearchProbe />
        </NotificationsContext.Provider>,
        { route, auth: { admin: adminFixture() } },
    );
}

const SOURCES = [
    notificationSourceFixture(),
    notificationSourceFixture({
        id: 'payout_requested',
        describe: 'A payout was requested',
        collection: 'payout_requests',
        produces: ['money.payout.requested'],
        requiredPermission: 'money.payouts.read',
        severity: ['warning'],
    }),
];

/**
 * Answer the list and the registry, and throw on anything else.
 *
 * **The `/sources` branch has to come first.** `/notifications/sources` contains
 * `/notifications`, so a broad list branch above it answers the registry with an
 * array — which the service then reads `.sources` off and quietly yields no
 * filters at all. The same ordering trap the COD trust feed hit in Phase 11.
 */
function stubList(rows = [notificationFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/notifications/sources')) {
            return successResponse({ sources: SOURCES });
        }
        if (call.url.includes('/notifications')) {
            return successResponse(rows, { meta: { ...notificationMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/** The most recent request for the list itself, ignoring the registry read. */
function lastListCall(calls: FetchCall[]): FetchCall {
    const list = calls.filter((call) => !call.url.includes('/notifications/sources'));
    return list[list.length - 1];
}

describe('the inbox', () => {
    it('opens on unread, which is the question somebody opens an inbox asking', async () => {
        const calls = stubList();

        inbox();

        await screen.findByText('Cash discrepancy opened');
        expect(lastListCall(calls).url).toContain('status=unread');
    });

    it('renders the row with its severity and type, unswitched', async () => {
        // Adding a type or a severity is an additive backend change, so the raw
        // string is rendered rather than mapped through a closed lookup that
        // would break on a routine deploy.
        stubList([notificationFixture({ severity: 'critical', type: 'a.brand.new.type' })]);

        inbox();

        expect(await screen.findByText('critical')).toBeInTheDocument();
        expect(screen.getByText('a.brand.new.type')).toBeInTheDocument();
    });

    it('links a row whose destination this dashboard has a route for', async () => {
        stubList();

        inbox();

        expect(await screen.findByRole('link', { name: /cash discrepancy opened/i })).toHaveAttribute(
            'href',
            '/dashboard/cod/discrepancies/6683aabbccddeeff00112233',
        );
    });

    it('renders a row with no reachable destination as plain text', async () => {
        // The service emits `actionPath` for surfaces it has and this dashboard
        // does not. A link to a 404 reads as a broken product; the notification
        // still says what happened.
        stubList([notificationFixture({ actionPath: '/support/tickets/665f1c2a9b3e4a91c7d2e5f0' })]);

        inbox();

        expect(await screen.findByText('Cash discrepancy opened')).toBeInTheDocument();
        expect(
            screen.queryByRole('link', { name: /cash discrepancy opened/i }),
        ).not.toBeInTheDocument();
    });

    it('explains an empty list without blaming the permission', async () => {
        // Holding `notifications.read` gets you the inbox; which rows are in it is
        // decided per row. Two administrators at the same level legitimately see
        // different things, so "you lack a permission" would often be a lie.
        stubList([], { total: 0, pages: 0, unreadCount: 0 });

        inbox();

        expect(await screen.findByText(/nothing unread/i)).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
    });

    it('refetches with the new filter and resets to the first page', async () => {
        // Page 3 of the unread list is not page 3 of the archived one. Keeping the
        // number lands on an empty page that looks like an empty inbox.
        const calls = stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Archived' }));

        await waitFor(() => {
            const latest = lastListCall(calls).url;
            expect(latest).toContain('status=archived');
            // The hook *deletes* `page` rather than writing `1`, so the default
            // view's URL stays clean — and an absent page is page 1 on the wire.
            expect(latest).not.toContain('page=2');
        });
    });

    it('marks a row read and moves the badge with it', async () => {
        const adjustUnread = vi.fn();
        const calls = stubFetch((call) => {
            if (call.url.includes('/notifications/sources')) {
                return successResponse({ sources: SOURCES });
            }
            if (call.method === 'PATCH') return successResponse(notificationFixture({ isRead: true }));
            return successResponse([notificationFixture()], { meta: { ...notificationMetaFixture() } });
        });

        inbox({ adjustUnread });
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('button', { name: /mark as read/i }));

        await waitFor(() => expect(adjustUnread).toHaveBeenCalledWith(-1));
        expect(calls.some((call) => call.method === 'PATCH' && call.url.endsWith('/read'))).toBe(
            true,
        );
    });

    it('offers mark-all only when there is something unread', async () => {
        stubList([], { total: 0, pages: 0, unreadCount: 0 });

        inbox();

        await screen.findByText(/nothing unread/i);
        expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();
    });

    it('reports a failed load rather than showing an empty inbox', async () => {
        // A failed request that also has no rows is a failure, not an empty list,
        // and "nothing unread" would be a lie an operator would act on.
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));

        inbox();

        expect(await screen.findByText(/could not load this/i)).toBeInTheDocument();
        expect(screen.queryByText(/nothing unread/i)).not.toBeInTheDocument();
    });

    it('pages only when there is more than one page', async () => {
        stubList([notificationFixture()], { total: 1, pages: 1 });

        inbox();

        await screen.findByText('Cash discrepancy opened');
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });

    it('walks to the next page, and says where it is', async () => {
        const calls = stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        const pager = screen.getByText(/page 1 of 3/i);
        expect(pager).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => expect(lastListCall(calls).url).toContain('page=2'));
    });
});

describe('the filters', () => {
    it('holds its state in the URL, so a filtered inbox is a link', async () => {
        // These screens are support tools: an administrator narrows a list and
        // sends it to a colleague. Local state carries none of that, and the URL
        // doubles as the fetch key so the two cannot drift.
        const calls = stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('combobox', { name: 'Severity' }));
        await userEvent.click(await screen.findByRole('option', { name: 'critical' }));

        await waitFor(() =>
            expect(screen.getByTestId('search')).toHaveTextContent('severity=critical'),
        );
        expect(lastListCall(calls).url).toContain('severity=critical');
    });

    it('reads every filter back out of the URL on first paint', async () => {
        // A shared link has to mean the same list to whoever opens it, which is
        // only true if the first request already carries the whole state.
        const calls = stubList();

        inbox({}, '/dashboard/notifications?status=read&type=approvals.decided&source=payout_requested&sort=severity');
        await screen.findByText('Cash discrepancy opened');

        const url = lastListCall(calls).url;
        expect(url).toContain('status=read');
        expect(url).toContain('type=approvals.decided');
        expect(url).toContain('source=payout_requested');
        expect(url).toContain('sort=severity');
    });

    it('builds the source filter from the registry, never from a hand-written list', async () => {
        // `?source=` is a `z.enum` over the *live* registry ids, so an option this
        // build invented is a 400 rather than an empty page.
        stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(await screen.findByRole('combobox', { name: 'Source' }));

        expect(await screen.findByRole('option', { name: 'payout_requested' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'cod_discrepancy_opened' })).toBeInTheDocument();
    });

    it('offers no source filter at all when the registry cannot be read', async () => {
        // Degrading to a select of guesses would be worse than degrading to no
        // select: every guess that drifted would be a 400 on a filter the
        // operator can see.
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/notifications/sources')) {
                return errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE');
            }
            return successResponse([notificationFixture()], {
                meta: { ...notificationMetaFixture() },
            });
        });

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await waitFor(() =>
            expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument(),
        );
        // The type filter still works, because its first half is transcribed.
        expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
    });

    it('keeps a severity from the URL that this build has never heard of', async () => {
        // Adding a severity is an additive backend change. Silently dropping the
        // value would make the control disagree with the request it is producing.
        stubList();

        inbox({}, '/dashboard/notifications?severity=catastrophic');

        expect(await screen.findByRole('combobox', { name: 'Severity' })).toHaveTextContent(
            'catastrophic',
        );
    });

    it('withholds an over-cap date range instead of round-tripping a 400', async () => {
        // The span cap is 366 days. Sending it anyway would replace the table
        // with an error panel; withholding leaves the last good page on screen
        // under the control's own inline message.
        const calls = stubList();

        inbox({}, '/dashboard/notifications?from=2024-01-01&to=2026-08-16');
        await screen.findByText('Cash discrepancy opened');

        expect(lastListCall(calls).url).not.toContain('from=');
        expect(await screen.findByText(/366 days or fewer/i)).toBeInTheDocument();
    });

    it('offers no ordering it cannot honestly describe', async () => {
        // `severity` sorts the stored *string*, so ascending happens to put
        // `critical` first by spelling and then `info` before `warning`. An
        // option called "most severe first" would name an ordering the database
        // is not producing.
        stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('combobox', { name: 'Sort' }));

        expect(await screen.findByRole('option', { name: 'Severity (A–Z)' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /most severe/i })).not.toBeInTheDocument();
    });
});

describe('mark-all', () => {
    it('sends the active filters and a `before` watermark', async () => {
        // An unscoped mark-all silently discards whatever arrived between the
        // page rendering and the click.
        const calls = stubList([
            notificationFixture({ occurredAt: '2026-08-11T00:05:00.000Z' }),
            notificationFixture({ id: 'b', occurredAt: '2026-08-12T09:30:00.000Z' }),
        ]);

        inbox({}, '/dashboard/notifications?severity=info');
        await screen.findAllByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('button', { name: /mark these read/i }));

        await waitFor(() => {
            const write = calls.find((call) => call.url.includes('/read-all'));
            expect(write).toBeDefined();
            expect(JSON.parse(write?.body ?? '{}')).toEqual({
                severity: 'info',
                // The *newest* instant on screen, not the first row — under any
                // sort but `-occurredAt` the page is not in time order.
                before: '2026-08-12T09:30:00.000Z',
            });
        });
    });

    it('says whether the gesture is scoped before it is made', async () => {
        stubList();

        inbox();
        await screen.findByText('Cash discrepancy opened');

        expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
    });

    it('reports the server’s own count rather than a client-side guess', async () => {
        // The confirmation is a toast, and no `<Toaster />` is mounted in a
        // screen test — so the assertion is on what was reported, not on a portal
        // this tree does not render.
        const reported = vi.spyOn(notify, 'success');

        const calls = stubFetch((call: FetchCall) => {
            if (call.url.includes('/notifications/sources')) {
                return successResponse({ sources: SOURCES });
            }
            if (call.url.includes('/read-all')) {
                return successResponse({ marked: 9 }, { message: '9 notifications marked read' });
            }
            return successResponse([notificationFixture()], {
                meta: { ...notificationMetaFixture() },
            });
        });

        inbox();
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('button', { name: /mark all read/i }));

        await waitFor(() =>
            expect(reported).toHaveBeenCalledWith('9 notifications marked read'),
        );
        expect(calls.some((call) => call.url.includes('/read-all'))).toBe(true);
    });

    it('will not mark read when there is nothing on screen to bound by', async () => {
        // Without a rendered row there is no watermark, so the call would be
        // unscoped in time — exactly what `before` exists to prevent.
        stubList([], { total: 0, pages: 0 });

        inbox();
        await screen.findByText(/nothing unread/i);

        expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();
    });
});

describe('the header', () => {
    it('titles the page itself rather than leaning on the app header', async () => {
        stubList();

        inbox();

        expect(
            within(await screen.findByRole('heading', { level: 1 })).getByText(/notifications/i),
        ).toBeInTheDocument();
    });
});
