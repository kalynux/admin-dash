import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useAuditActionVocabulary } from '@/hooks/use-audit-actions';
import { __resetAuditActionCache } from '@/services/audit.service';
import { auditActionCatalogFixture } from '@/test/audit-fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

/**
 * The action vocabulary, and the one rule it exists to get right.
 */

function stubCatalog() {
    return stubFetch((call) => {
        if (call.url.includes('/audit/actions')) {
            return successResponse(auditActionCatalogFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function catalogCalls(calls: FetchCall[]): FetchCall[] {
    return calls.filter((call) => call.url.includes('/audit/actions'));
}

beforeEach(() => {
    __resetAuditActionCache();
});

describe('narrowing by prefix', () => {
    /**
     * ⚠ **The regression this whole file exists for.**
     *
     * `billing.subscriptions.assign_vendor` carries `target: 'vendor'` and really
     * does appear on the vendor activity feed — but that feed's `?action=` enum is
     * `AUDIT_ACTION_NAMES.filter(a => a.startsWith('vendors.'))`, so it cannot be
     * selected there. Deriving the options by `target` would offer it and earn a
     * 400 on a row already in the table.
     */
    it('excludes an action that targets vendors but is not named vendors.*', async () => {
        stubCatalog();
        const { result } = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        expect(result.current.actions).toEqual(['vendors.suspend', 'vendors.reinstate']);
        expect(result.current.actions).not.toContain('billing.subscriptions.assign_vendor');
    });

    it('narrows payouts on two segments, not on the money family', async () => {
        stubCatalog();
        const { result } = renderHook(() =>
            useAuditActionVocabulary({ prefix: 'money.payouts.' }),
        );

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        expect(result.current.actions).toEqual(['money.payouts.mark_paid']);
        // `money.` would have offered this one, which that feed refuses.
        expect(result.current.actions).not.toContain('money.earnings.read_platform');
    });

    it('offers the whole catalog for an empty prefix', async () => {
        stubCatalog();
        const { result } = renderHook(() => useAuditActionVocabulary({ prefix: '' }));

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        expect(result.current.actions).toHaveLength(auditActionCatalogFixture().actions.length);
    });
});

describe('narrowing by target', () => {
    /**
     * Legal only where the endpoint validates against the whole catalog — the two
     * administrator feeds. There it expresses "things done to an administrator",
     * which spans several families and no prefix can ask for.
     */
    it('selects by the catalog’s target rather than by name', async () => {
        stubCatalog();
        const { result } = renderHook(() =>
            useAuditActionVocabulary({ target: 'administrator' }),
        );

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        expect(result.current.actions).toEqual(['administrators.tier.change']);
    });

    it('selects vendor-targeted actions across families, unlike the prefix rule', async () => {
        stubCatalog();
        const { result } = renderHook(() => useAuditActionVocabulary({ target: 'vendor' }));

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        // The same action the prefix rule must exclude is included here — which is
        // exactly why the two axes are not interchangeable.
        expect(result.current.actions).toContain('billing.subscriptions.assign_vendor');
    });
});

describe('labels', () => {
    it('labels from the whole catalog, not from the narrowed set', async () => {
        stubCatalog();
        const { result } = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));

        await waitFor(() => expect(result.current.actions.length).toBeGreaterThan(0));

        // A feed can show a row whose action its own filter cannot select; that row
        // should still read as a sentence rather than a dotted name.
        expect(result.current.labels['billing.subscriptions.assign_vendor']).toBe(
            'Assign a plan to a vendor',
        );
    });
});

describe('sharing and failure', () => {
    it('issues one request for two consumers', async () => {
        const calls = stubCatalog();

        const first = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));
        const second = renderHook(() => useAuditActionVocabulary({ prefix: 'orders.' }));

        await waitFor(() => expect(first.result.current.actions.length).toBeGreaterThan(0));
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        // The promise is memoised in the service, so N consumers share one call.
        expect(catalogCalls(calls)).toHaveLength(1);
    });

    it('issues no request at all when disabled', async () => {
        const calls = stubCatalog();

        const { result } = renderHook(() =>
            useAuditActionVocabulary({ prefix: 'vendors.', enabled: false }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        // This is what keeps the nine call sites that have not opted in — and
        // their tests — completely unchanged.
        expect(catalogCalls(calls)).toHaveLength(0);
        expect(result.current.actions).toEqual([]);
    });

    /**
     * A cached rejection would make every later consumer replay the same failure
     * for the rest of the session, so one flaky request would cost every screen
     * its action filter permanently.
     */
    it('does not cache a rejection', async () => {
        let attempts = 0;
        const calls = stubFetch((call) => {
            if (!call.url.includes('/audit/actions')) {
                throw new Error(`unexpected request: ${call.url}`);
            }
            attempts += 1;
            if (attempts === 1) return errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE');
            return successResponse(auditActionCatalogFixture());
        });

        const first = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));
        expect(first.result.current.actions).toEqual([]);

        const second = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));
        await waitFor(() => expect(second.result.current.actions.length).toBeGreaterThan(0));

        expect(catalogCalls(calls)).toHaveLength(2);
    });

    it('degrades to an empty vocabulary rather than throwing', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));

        const { result } = renderHook(() => useAuditActionVocabulary({ prefix: 'vendors.' }));
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        // An empty list makes the calling panel render no action select at all,
        // which is the behaviour those panels already shipped with.
        expect(result.current.actions).toEqual([]);
        expect(result.current.labels).toEqual({});
    });
});
