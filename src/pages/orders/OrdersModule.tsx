import { Route, Routes } from 'react-router-dom';

import { OrderDetail } from '@/pages/orders/OrderDetail';
import { OrdersList } from '@/pages/orders/OrdersList';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/orders` module — the **index child** of the Orders container.
 *
 * `App.tsx` mounts an implemented index child at `*` rather than at `index`, for
 * the reason this module exists: an index route cannot nest, and the orders list
 * has a `:orderId` detail beneath it. The splat matches the empty remainder too,
 * so `/dashboard/orders` still lands on the list, and React Router ranks the
 * container's static `disputes/*` above this — which is what keeps the dispute
 * queue reachable at its own permission.
 *
 * Being splat-mounted, this owns its own 404: the shell's catch-all can no longer
 * see these paths once the module route has matched.
 */
export function OrdersModule() {
    return (
        <Routes>
            <Route index element={<OrdersList />} />
            <Route path=":orderId" element={<OrderDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
