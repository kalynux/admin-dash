import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { SubscriptionDetail } from '@/pages/billing/SubscriptionDetail';
import { SubscriptionsList } from '@/pages/billing/SubscriptionsList';

/**
 * `/dashboard/billing/subscriptions` — the cross-owner list and one term.
 *
 * Subscriptions is a **static sibling child** of Billing rather than its index,
 * so `App.tsx` mounts it at `subscriptions/*` and it declares its own routes and
 * its own 404 — the same obligation every splat-mounted module carries. Without
 * the catch-all, `/dashboard/billing/subscriptions/nonsense` would render the
 * list instead of a 404.
 *
 * The detail route takes **one** segment. The owner-scoped read next to it in
 * the API (`/billing/subscriptions/:ownerType/:ownerId`) takes two and has no
 * screen of its own — it is read by `ChangePlanDialog` to name a queued term
 * before an assignment is offered, and by `/dashboard/accounts/:ownerType/:ownerId`,
 * which is where an owner's billing already lives.
 */
export function SubscriptionsModule() {
    return (
        <Routes>
            <Route index element={<SubscriptionsList />} />
            <Route path=":subscriptionId" element={<SubscriptionDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
