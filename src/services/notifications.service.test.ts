import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    __resetNotificationSourceCache,
    archiveNotification,
    getNotificationPreferences,
    getUnreadCount,
    listNotifications,
    listNotificationSources,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationUnread,
    updateNotificationPreferences,
} from '@/services/notifications.service';
import {
    notificationFixture,
    notificationMetaFixture,
    notificationPreferenceFixture,
    notificationSourceFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';

// Module state that survives between tests is state one test can leak into the
// next — and the source registry is memoised across mounts on purpose.
beforeEach(__resetNotificationSourceCache);
afterEach(__resetNotificationSourceCache);

describe('listNotifications', () => {
    it('GETs /notifications and keeps the whole envelope', async () => {
        const calls = stubFetch(() =>
            successResponse([notificationFixture()], { meta: { ...notificationMetaFixture() } }),
        );

        const page = await listNotifications();

        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/notifications');
        expect(page.data).toHaveLength(1);
        // `unreadCount` rides on `meta` and is computed with the same filters, so
        // the badge and the list cannot disagree. Dropping it would force a
        // second request that can.
        expect(page.meta.unreadCount).toBe(12);
        expect(page.meta.pages).toBe(3);
    });

    it('sends only the filters that were set', async () => {
        // An empty `?search=` is a 400 on this service and an undefined filter is
        // not a filter. `buildQuery` drops both; this pins that the service layer
        // does not defeat it by spreading nulls.
        const calls = stubFetch(() => successResponse([], { meta: { ...notificationMetaFixture() } }));

        await listNotifications({ status: 'archived', severity: 'critical', page: 2 });

        expect(calls[0].url).toContain('status=archived');
        expect(calls[0].url).toContain('severity=critical');
        expect(calls[0].url).toContain('page=2');
        expect(calls[0].url).not.toContain('type=');
        expect(calls[0].url).not.toContain('source=');
    });

    it('reports an empty list as zero pages, not one', async () => {
        // The contract's rule. "Page 1 of 1" over nothing invites a reader to
        // wonder where the rows went.
        stubFetch(() =>
            successResponse([], {
                meta: { total: 0, page: 1, limit: 20, pages: 0, unreadCount: 0 },
            }),
        );

        expect((await listNotifications()).meta.pages).toBe(0);
    });

    it('sends no CSRF header — it is a safe method', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { ...notificationMetaFixture() } }),
        );

        await listNotifications();

        expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
    });
});

describe('getUnreadCount', () => {
    it('unwraps the number rather than the object', async () => {
        const calls = stubFetch(() => successResponse({ unreadCount: 7 }));

        expect(await getUnreadCount()).toBe(7);
        expect(calls[0].url).toContain('/notifications/unread-count');
    });

    it('never sends status or paging, which this route does not accept', async () => {
        // Its whole subject is unread, so `status` is meaningless here and paging
        // has nothing to page. The type refuses them; this pins the URL too.
        const calls = stubFetch(() => successResponse({ unreadCount: 0 }));

        await getUnreadCount({ severity: 'critical' });

        expect(calls[0].url).toContain('severity=critical');
        expect(calls[0].url).not.toContain('status=');
        expect(calls[0].url).not.toContain('page=');
    });
});

describe('the hygiene writes', () => {
    it('PATCHes read and unread, and POSTs archive', async () => {
        const calls = stubFetch(() => successResponse(notificationFixture({ isRead: true })));

        await markNotificationRead('66c0aabbccddeeff00112233');
        await markNotificationUnread('66c0aabbccddeeff00112233');
        await archiveNotification('66c0aabbccddeeff00112233');

        expect(calls[0].method).toBe('PATCH');
        expect(calls[0].url).toContain('/notifications/66c0aabbccddeeff00112233/read');
        expect(calls[1].method).toBe('PATCH');
        expect(calls[1].url).toContain('/unread');
        expect(calls[2].method).toBe('POST');
        expect(calls[2].url).toContain('/archive');
    });

    it('carries the CSRF token, unaudited or not', async () => {
        // These five writes record nothing in the audit trail by design — which
        // says nothing about authentication. CSRF is required on every
        // cookie-authenticated unsafe method, and skipping it here because the
        // action feels trivial is how a write starts 403ing.
        document.cookie = 'admin_csrf_token=nJ8Qm3F7pQ2xVb';
        const calls = stubFetch(() => successResponse(notificationFixture()));

        await markNotificationRead('66c0aabbccddeeff00112233');

        expect(calls[0].headers.get('X-CSRF-Token')).toBe('nJ8Qm3F7pQ2xVb');
    });

    it('surfaces a 404 as an ApiError the caller can branch on', async () => {
        // On this surface a 404 covers not-found, somebody else's row, and "your
        // level no longer holds the permission it is gated on" — never a 403. All
        // three mean the row is gone.
        stubFetch(() => errorResponse(404, 'NOTIFICATION_NOT_FOUND'));

        await expect(markNotificationRead('66c0aabbccddeeff00112233')).rejects.toBeInstanceOf(
            ApiError,
        );
    });

    it('reads the count off `marked`, which is the field the service sends', async () => {
        // `notification.controller.ts` ends with `sendSuccess(res, { marked }, …)`.
        // A client reading `updated` gets `undefined`, and `Number(undefined ?? 0)`
        // is a perfectly good `0` — so the miss is silent and every confirmation
        // reports zero however many rows it touched.
        const calls = stubFetch(() =>
            successResponse({ marked: 12 }, { message: '12 notifications marked read' }),
        );

        const result = await markAllNotificationsRead();

        expect(result.marked).toBe(12);
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/notifications/read-all');
    });

    it('keeps the server’s own sentence for the confirmation', async () => {
        // The server composes it and counts the rows. Re-deriving the sentence
        // here would be a second copy of a claim only it can make.
        stubFetch(() =>
            successResponse({ marked: 7 }, { message: '7 notifications marked read' }),
        );

        expect((await markAllNotificationsRead()).message).toBe('7 notifications marked read');
    });

    it('scopes read-all by the filters it is given, and by `before`', async () => {
        // An unscoped mark-all silently discards whatever arrived between the page
        // rendering and the click. The body is what makes the gesture mean "mark
        // read what I was looking at".
        const calls = stubFetch(() => successResponse({ marked: 3 }));

        await markAllNotificationsRead({
            severity: 'info',
            before: '2026-08-13T09:00:00.000Z',
        });

        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            severity: 'info',
            before: '2026-08-13T09:00:00.000Z',
        });
    });

    it('sends an empty body rather than omitting fields as null', async () => {
        // The body is strict. `undefined` members must not be serialised, or a
        // `{"type": null}` would be a 400 on a call that asked for no narrowing.
        const calls = stubFetch(() => successResponse({ marked: 0 }));

        await markAllNotificationsRead();

        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({});
    });

    it('tolerates a read-all that answers with no body', async () => {
        // `data` is always present but may be `null`. Reading `.marked` off it
        // without a guard is how a successful bulk action throws.
        stubFetch(() => successResponse(null));

        expect((await markAllNotificationsRead()).marked).toBe(0);
    });
});

describe('listNotificationSources', () => {
    it('unwraps `sources` and requests the registry once for two callers', async () => {
        // Memoised across mounts: the inbox's two filters and the reference
        // screen all want it, and a request per consumer would be several
        // identical round trips for a constant.
        const calls = stubFetch(() =>
            successResponse({ sources: [notificationSourceFixture()] }),
        );

        const [first, second] = await Promise.all([
            listNotificationSources(),
            listNotificationSources(),
        ]);

        expect(first).toHaveLength(1);
        expect(first[0].id).toBe('cod_discrepancy_opened');
        expect(second).toBe(first);
        expect(calls).toHaveLength(1);
    });

    it('clears the memo on failure, so a retry actually retries', async () => {
        // Caching a rejected promise would make every later call replay the same
        // failure forever — one flaky request costing every screen its source
        // filter for the rest of the session.
        let attempt = 0;
        stubFetch(() => {
            attempt += 1;
            if (attempt === 1) return errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE');
            return successResponse({ sources: [notificationSourceFixture()] });
        });

        await expect(listNotificationSources()).rejects.toBeInstanceOf(ApiError);
        expect(await listNotificationSources()).toHaveLength(1);
    });
});

describe('preferences', () => {
    it('GETs the list and unwraps `preferences`', async () => {
        const calls = stubFetch(() =>
            successResponse({ preferences: [notificationPreferenceFixture()] }),
        );

        const preferences = await getNotificationPreferences();

        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/notifications/preferences');
        expect(preferences).toHaveLength(1);
    });

    it('PATCHes the overrides under an `overrides` key', async () => {
        // The body is strict: an unknown top-level field is a 400, so the map
        // cannot be sent bare.
        const calls = stubFetch(() =>
            successResponse({ preferences: [notificationPreferenceFixture()] }),
        );

        await updateNotificationPreferences({ 'audit.export.finished': false });

        expect(calls[0].method).toBe('PATCH');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            overrides: { 'audit.export.finished': false },
        });
    });

    it('serialises a cleared override as `null`, not by omitting it', async () => {
        // The three states are absent / boolean / null, and only `null` means
        // "remove the override and track the catalog again". Omitting the key
        // instead means "leave it alone" — the opposite instruction.
        const calls = stubFetch(() => successResponse({ preferences: [] }));

        await updateNotificationPreferences({ 'cod.remittance.declared': null });

        expect(calls[0].body).toContain('"cod.remittance.declared":null');
    });

    it('keeps the message, which the contract asks to be shown', async () => {
        // "Preferences apply to notifications raised from now on; anything
        // already in your inbox stays there." The obvious reading of muting a
        // type is that it cleans the inbox, and it does not.
        const message =
            'Saved. Preferences apply to notifications raised from now on; anything already in your inbox stays there.';
        stubFetch(() => successResponse({ preferences: [] }, { message }));

        expect((await updateNotificationPreferences({})).message).toBe(message);
    });
});
