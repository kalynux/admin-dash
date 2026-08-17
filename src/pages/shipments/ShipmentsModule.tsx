import { Route, Routes } from 'react-router-dom';

import { ShipmentDetail } from '@/pages/shipments/ShipmentDetail';
import { ShipmentsList } from '@/pages/shipments/ShipmentsList';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/shipments` module.
 *
 * A childless nav entry, so `App.tsx` mounts it at `shipments/*` and this owns its
 * own remainder — including its own 404, which the shell's catch-all can no longer
 * see once the module route has matched.
 */
export function ShipmentsModule() {
    return (
        <Routes>
            <Route index element={<ShipmentsList />} />
            <Route path=":shipmentId" element={<ShipmentDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
