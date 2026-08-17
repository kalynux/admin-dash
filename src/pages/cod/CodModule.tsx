import { Route, Routes } from 'react-router-dom';

import { CodOverview } from '@/pages/cod/CodOverview';
import { NotFound } from '@/pages/NotFound';

/**
 * `/dashboard/cod` — the cash position, and nothing beneath it.
 *
 * COD declares an **index child** (`cod-overview`), so once the module is
 * implemented the route generator mounts this at both `index` and `*`. The splat
 * is what obliges this file to exist at all: without its own catch-all,
 * `/dashboard/cod/nonsense` would quietly render the overview instead of a 404.
 *
 * The four sibling children — holders, remittances, deposits, discrepancies —
 * carry their own paths, their own permissions and their own modules.
 */
export function CodModule() {
    return (
        <Routes>
            <Route index element={<CodOverview />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
