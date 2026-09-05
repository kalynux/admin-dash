import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { VendorDetail } from '@/pages/vendors/VendorDetail';
import { VendorProductDetail } from '@/pages/vendors/VendorProductDetail';
import { VendorsList } from '@/pages/vendors/VendorsList';

/**
 * The `/dashboard/vendors` module.
 *
 * ── Why the module owns its own routes ────────────────────────────────────────
 * `App.tsx` mounts every childless module at `path="<module>/*"` and hands it one
 * element, so a module with an index and a detail route declares them here rather
 * than growing the router. That keeps the generated-from-navigation shape intact:
 * a module cannot exist in the sidebar without a route, or the reverse, because
 * both still come from one entry in `config/navigation.ts`.
 *
 * The permission gate has already run by the time this renders —
 * `RequirePermission` wraps this element with the *same* requirement object the
 * sidebar filtered on. Nothing here re-checks `vendors.read`; the screens inside
 * gate only what is narrower than the module, which is the four write permissions,
 * the composite-guarded activity feed and the three-permission account tab.
 *
 * `findNavTrail` resolves `/dashboard/vendors/:id` to the Vendors item by longest
 * prefix, so the breadcrumb and the active sidebar link already work for the
 * detail route.
 */
export function VendorsModule() {
    return (
        <Routes>
            <Route index element={<VendorsList />} />
            <Route path=":vendorId" element={<VendorDetail />} />
            {/*
              The listing detail, from BR-005. Nested under the vendor because the
              endpoint is — `GET /vendors/:vendorId/products/:productId`, where the
              ownership IS the authorisation, so a product's address needs both ids
              and there is no vendor-free product read anywhere on this service.

              No extra permission: the route requires `vendors.read`, exactly as the
              catalogue does, so the module gate above has already run.
            */}
            <Route
                path=":vendorId/products/:productId"
                element={<VendorProductDetail />}
            />
            {/*
              The module's own 404. Without it the shell-level catch-all never sees
              these paths — `vendors/*` already matched — and the gated element would
              render with nothing inside it.
            */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
