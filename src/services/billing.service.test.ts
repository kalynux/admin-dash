import { describe, expect, it } from 'vitest';

import {
    archivePlan,
    assignSubscription,
    createPlan,
    getOwnerSubscriptions,
    getPlan,
    getSubscription,
    listPlanSubscribers,
    listPlans,
    listSubscriptions,
    updatePlan,
} from '@/services/billing.service';
import { planFixture, planListMetaFixture, subscriptionFixture } from '@/test/billing-fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listPlans', () => {
    it('carries every filter', async () => {
        const calls = stubFetch(() =>
            successResponse([planFixture()], { meta: planListMetaFixture() }),
        );

        await listPlans({ role: 'vendor', isActive: true, includeArchived: true, search: 'growth' });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/billing/plans');
        expect(query.get('role')).toBe('vendor');
        expect(query.get('isActive')).toBe('true');
        expect(query.get('includeArchived')).toBe('true');
        expect(query.get('search')).toBe('growth');
    });

    it('sends no empty search — an empty term is a 400, not "no filter"', async () => {
        const calls = stubFetch(() =>
            successResponse([planFixture()], { meta: planListMetaFixture() }),
        );

        await listPlans({ search: '' });

        expect(queryOf(calls[0]).get('search')).toBeNull();
    });
});

describe('getPlan', () => {
    it('reads a plan, archived ones included', async () => {
        // There is no deletedAt filter on this read, which is what lets the
        // detail screen explain an archived tier rather than 404 on it.
        const calls = stubFetch(() =>
            successResponse(planFixture({ archivedAt: '2026-08-01T00:00:00.000Z' })),
        );

        const plan = await getPlan('6690aabbccddeeff00112240');

        expect(calls[0].url).toContain('/billing/plans/6690aabbccddeeff00112240');
        expect(plan.archivedAt).toBe('2026-08-01T00:00:00.000Z');
    });
});

describe('listPlanSubscribers', () => {
    it('scopes to the plan in the path', async () => {
        const calls = stubFetch(() =>
            successResponse([subscriptionFixture()], { meta: planListMetaFixture() }),
        );

        await listPlanSubscribers('6690aabbccddeeff00112240', { status: 'active' });

        expect(calls[0].url).toContain('/billing/plans/6690aabbccddeeff00112240/subscribers');
        expect(queryOf(calls[0]).get('status')).toBe('active');
    });
});

describe('listSubscriptions', () => {
    it('carries the owner and expiry filters', async () => {
        const calls = stubFetch(() =>
            successResponse([subscriptionFixture()], { meta: planListMetaFixture() }),
        );

        await listSubscriptions({
            ownerType: 'vendor',
            ownerId: '6650aa11bb22cc33dd44ee55',
            expiringBefore: '2026-09-01T00:00:00.000Z',
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/billing/subscriptions');
        expect(query.get('ownerType')).toBe('vendor');
        expect(query.get('expiringBefore')).toBe('2026-09-01T00:00:00.000Z');
    });
});

describe('createPlan', () => {
    it('sends the limits FLAT, never nested', async () => {
        /*
         * The request is flat and the response is nested. The body is strict, so
         * sending `{ limits: {...} }` — the shape the DTO returns — is a 400.
         */
        const calls = stubFetch(() => successResponse(null, { status: 201, message: 'Plan created' }));

        await createPlan({
            role: 'vendor',
            code: 'vendor_growth',
            name: 'Growth',
            price: 15000,
            termDays: 30,
            creditAllowance: 100,
            commissionPercent: 8.5,
            maxActiveProducts: 500,
        });

        const body = JSON.parse(calls[0].body ?? '{}');
        expect(body.commissionPercent).toBe(8.5);
        expect(body.maxActiveProducts).toBe(500);
        expect(body).not.toHaveProperty('limits');
    });

    it('returns no document — the response is a raw platform record', async () => {
        // Rendering it would mean rendering snake_case with `_id` and `__v`.
        stubFetch(() =>
            successResponse({ _id: 'x', term_days: 30, __v: 0 }, { status: 201, message: 'Plan created' }),
        );

        const result = await createPlan({
            role: 'vendor',
            code: 'c',
            name: 'n',
            price: 1,
            termDays: null,
            creditAllowance: 0,
        });

        expect(result).toEqual({ message: 'Plan created' });
        expect(result).not.toHaveProperty('data');
    });

    it('surfaces a duplicate code as its platform code', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'The platform refused this operation',
                category: 'conflict',
                details: { platformCode: 'BILLING_PLAN_CODE_EXISTS' },
            }),
        );

        const error = await createPlan({
            role: 'vendor',
            code: 'taken',
            name: 'n',
            price: 1,
            termDays: null,
            creditAllowance: 0,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).platformCode).toBe('BILLING_PLAN_CODE_EXISTS');
    });
});

describe('updatePlan', () => {
    it('sends null to clear a nullable limit', async () => {
        // `null` writes null and an omitted key leaves the stored value alone —
        // but only on the five nullable keys.
        const calls = stubFetch(() => successResponse(null, { message: 'Plan updated' }));

        await updatePlan('6690aabbccddeeff00112240', { maxActiveProducts: null, name: 'Renamed' });

        const body = JSON.parse(calls[0].body ?? '{}');
        expect(calls[0].method).toBe('PATCH');
        expect(body.maxActiveProducts).toBeNull();
        expect(body.name).toBe('Renamed');
    });

    it('never sends role or code — both are refused by the schema', async () => {
        const calls = stubFetch(() => successResponse(null, { message: 'Plan updated' }));

        await updatePlan('6690aabbccddeeff00112240', { name: 'Renamed' });

        const body = JSON.parse(calls[0].body ?? '{}');
        expect(body).not.toHaveProperty('role');
        expect(body).not.toHaveProperty('code');
    });

    it('surfaces an archived plan as the platform not finding it', async () => {
        /*
         * wi-admin's read returns archived rows; jovi-mall's write filters them.
         * So editing an archived plan lands here every time — which is why the UI
         * hides the affordance rather than relying on this path.
         */
        stubFetch(() =>
            errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                message: 'The platform refused this operation',
                category: 'not_found',
                details: { platformCode: 'BILLING_PLAN_NOT_FOUND' },
            }),
        );

        const error = await updatePlan('6690aabbccddeeff00112240', { name: 'x' }).catch(
            (e: unknown) => e,
        );

        expect((error as ApiError).platformCode).toBe('BILLING_PLAN_NOT_FOUND');
    });
});

describe('archivePlan', () => {
    it('keeps the sentence about existing subscribers', async () => {
        // The platform answers `data: null`, so the message is the only place the
        // subscriber consequence is stated.
        const calls = stubFetch(() =>
            successResponse(null, {
                message:
                    'Plan vendor_growth archived — existing subscribers keep it until their term ends',
            }),
        );

        const result = await archivePlan('6690aabbccddeeff00112240');

        expect(calls[0].method).toBe('DELETE');
        expect(result.message).toContain('existing subscribers keep it');
    });
});

describe('assignSubscription', () => {
    it('sends the plan id and optional reference to the owner path', async () => {
        const calls = stubFetch(() =>
            successResponse(null, { message: 'Plan growth assigned to the vendor' }),
        );

        await assignSubscription('vendor', '6650aa11bb22cc33dd44ee55', {
            planId: '6690aabbccddeeff00112240',
            paymentReference: 'MTN-2026-08-15',
        });

        expect(calls[0].url).toContain('/billing/subscriptions/vendor/6650aa11bb22cc33dd44ee55');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            planId: '6690aabbccddeeff00112240',
            paymentReference: 'MTN-2026-08-15',
        });
    });

    it('returns no document — the response has no owner or plan block', async () => {
        stubFetch(() =>
            successResponse({ _id: 'x', owner_type: 'vendor', __v: 0 }, { message: 'Assigned' }),
        );

        const result = await assignSubscription('vendor', '6650aa11bb22cc33dd44ee55', {
            planId: '6690aabbccddeeff00112240',
        });

        expect(result).toEqual({ message: 'Assigned' });
    });

    it('surfaces the undocumented pending-term refusal', async () => {
        /*
         * Reachable on a completely normal path — assigning to an owner whose
         * paid term has not lapsed. billing.md lists only two codes for this
         * route and this is not one of them.
         */
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'The platform refused this operation',
                category: 'conflict',
                details: { platformCode: 'BILLING_PENDING_PLAN_EXISTS' },
            }),
        );

        const error = await assignSubscription('vendor', '6650aa11bb22cc33dd44ee55', {
            planId: '6690aabbccddeeff00112240',
        }).catch((e: unknown) => e);

        expect((error as ApiError).platformCode).toBe('BILLING_PENDING_PLAN_EXISTS');
    });

    it('distinguishes a missing owner from a missing plan', async () => {
        // Two different 404 codes on the same route.
        stubFetch(() =>
            errorResponse(404, 'ACCOUNT_OWNER_NOT_FOUND', {
                message: 'No vendor with that id',
                category: 'not_found',
            }),
        );

        const error = await assignSubscription('vendor', '6650aa11bb22cc33dd44ee55', {
            planId: '6690aabbccddeeff00112240',
        }).catch((e: unknown) => e);

        expect((error as ApiError).code).toBe('ACCOUNT_OWNER_NOT_FOUND');
    });
});

describe('the two single-owner reads', () => {
    it('asks the two-segment path and keeps the service’s own partition', async () => {
        /**
         * `current` / `queued` / `history` come from the service, not from a
         * client ranking `status`. That matters: `status` is an open vocabulary
         * wi-admin never writes, so a client ranking it guesses — and its guess
         * changes silently when a fifth value appears upstream.
         */
        const calls = stubFetch(() =>
            successResponse(
                {
                    owner: { type: 'vendor', id: '6650aa11bb22cc33dd44ee55', name: 'Douala Fresh' },
                    current: subscriptionFixture({ status: 'active' }),
                    queued: subscriptionFixture({ id: 'q1', status: 'pending_activation' }),
                    history: [subscriptionFixture({ id: 'h1', status: 'expired' })],
                },
                { meta: { total: 3 } },
            ),
        );

        const result = await getOwnerSubscriptions('vendor', '6650aa11bb22cc33dd44ee55');

        expect(new URL(calls[0].url, 'http://localhost').pathname).toBe(
            '/api/v1/billing/subscriptions/vendor/6650aa11bb22cc33dd44ee55',
        );
        expect(result.current?.status).toBe('active');
        expect(result.queued?.id).toBe('q1');
        expect(result.history).toHaveLength(1);
    });

    it('reads current: null as “no active plan”, not as a failure', async () => {
        // An owner who has never had a plan answers `current: null` with an empty
        // history — that is NOT `ACCOUNT_OWNER_NOT_FOUND`.
        stubFetch(() =>
            successResponse({
                owner: { type: 'agent', id: '6660112233445566778899aa', name: null },
                current: null,
                queued: null,
                history: [],
            }),
        );

        const result = await getOwnerSubscriptions('agent', '6660112233445566778899aa');

        expect(result.current).toBeNull();
        expect(result.history).toEqual([]);
    });

    it('asks the one-segment path for a term by its own id', async () => {
        // No collision with the owner-scoped read: two segments versus one, so
        // Express separates them structurally rather than by declaration order.
        const calls = stubFetch(() => successResponse(subscriptionFixture()));

        await getSubscription('66d1aabbccddeeff00112233');

        expect(new URL(calls[0].url, 'http://localhost').pathname).toBe(
            '/api/v1/billing/subscriptions/66d1aabbccddeeff00112233',
        );
    });
});
