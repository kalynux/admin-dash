import { Route, Routes } from 'react-router-dom';

import { HoldersList } from '@/pages/cod/HoldersList';
import { NotFound } from '@/pages/NotFound';

/**
 * `/dashboard/cod/holders`.
 *
 * One screen, and no detail beneath it: a holder is a balance rather than a
 * record, and the thing worth opening is the party — which the rows already link
 * to. Mounted at the child's splat all the same, so it owns its own 404.
 */
export function HoldersModule() {
    return (
        <Routes>
            <Route index element={<HoldersList />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
