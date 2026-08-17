import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { PlanDetail } from '@/pages/billing/PlanDetail';
import { PlansList } from '@/pages/billing/PlansList';

/**
 * `/dashboard/billing` — the plan catalog and one tier's detail.
 *
 * Billing declares an **index child** (`billing-plans`), so the route generator
 * mounts this module at both `index` and `*` once the module is implemented. That
 * is what makes `/dashboard/billing` land on the catalog while
 * `/dashboard/billing/:planId` still resolves — and it obliges this module to
 * declare its own catch-all, which every splat-mounted module carries.
 *
 * Subscriptions is a **sibling child**, not a route here: it has its own path and
 * its own entry in `SCREENS`.
 */
export function BillingModule() {
    return (
        <Routes>
            <Route index element={<PlansList />} />
            <Route path=":planId" element={<PlanDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
