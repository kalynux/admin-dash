import { describe, expect, it } from 'vitest';

import { toDashboardPath } from '@/lib/notification-path';

describe('toDashboardPath', () => {
    it('adds the prefix the service leaves off', () => {
        // The live coupling. `docs/admin/api/notifications.md` shows exactly this
        // shape, and this dashboard mounts every module under /dashboard.
        expect(toDashboardPath('/cod/discrepancies/6683aabbccddeeff00112233')).toBe(
            '/dashboard/cod/discrepancies/6683aabbccddeeff00112233',
        );
    });

    it('resolves each of the ten sources onto a route that exists', () => {
        // If a later phase renames a module path, this is what fails — rather
        // than every notification of that type silently becoming unclickable.
        const paths = [
            '/cod/discrepancies/665f1c2a9b3e4a91c7d2e5f0',
            '/cod/remittances/665f1c2a9b3e4a91c7d2e5f0',
            '/money/payouts/665f1c2a9b3e4a91c7d2e5f0',
            '/orders/665f1c2a9b3e4a91c7d2e5f0',
            '/agencies/665f1c2a9b3e4a91c7d2e5f0',
            '/vendors/665f1c2a9b3e4a91c7d2e5f0',
            '/approvals/665f1c2a9b3e4a91c7d2e5f0',
            '/audit/exports/665f1c2a9b3e4a91c7d2e5f0',
        ];

        for (const path of paths) {
            expect(toDashboardPath(path), path).toBe(`/dashboard${path}`);
        }
    });

    it('does not prefix a path that already carries it', () => {
        expect(toDashboardPath('/dashboard/orders')).toBe('/dashboard/orders');
    });

    it('returns null when there is no action path at all', () => {
        // The field is nullable, and a row without one still says what happened.
        expect(toDashboardPath(null)).toBeNull();
        expect(toDashboardPath(undefined)).toBeNull();
        expect(toDashboardPath('   ')).toBeNull();
    });

    it('returns null for a route this dashboard has not built', () => {
        // The service emits `actionPath` for surfaces that exist on its side and
        // not on this one — tickets among them. Linking anyway would take an
        // operator to a 404, which reads as a broken product; a row with no link
        // is honest.
        expect(toDashboardPath('/support/tickets/665f1c2a9b3e4a91c7d2e5f0')).toBeNull();
        expect(toDashboardPath('/content/articles/665f1c2a9b3e4a91c7d2e5f0')).toBeNull();
    });

    it('refuses anything that would leave the application', () => {
        // An inbox row is attacker-adjacent input in the sense that matters: it
        // is rendered as a link and clicked without thought. A protocol-relative
        // or absolute URL here would be an open redirect wearing a
        // notification's clothes — the same rule `resolveReturnTo` applies to the
        // post-sign-in destination.
        expect(toDashboardPath('//evil.example/steal')).toBeNull();
        expect(toDashboardPath('https://evil.example/steal')).toBeNull();
        expect(toDashboardPath('javascript:alert(1)')).toBeNull();
        expect(toDashboardPath('orders/123')).toBeNull();
    });

    it('keeps a query string and validates only the path', () => {
        expect(toDashboardPath('/orders?status=disputed')).toBe(
            '/dashboard/orders?status=disputed',
        );
    });
});
