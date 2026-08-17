import { Route, Routes } from 'react-router-dom';

import { AccountDetail } from '@/pages/accounts/AccountDetail';
import { AccountsList } from '@/pages/accounts/AccountsList';
import { NotFound } from '@/pages/NotFound';

/**
 * `/dashboard/accounts` and everything under it.
 *
 * A childless module, so the route generator mounts it at `accounts/*` and it
 * owns its own remainder — including the 404.
 *
 * The detail takes **two** path segments, `:ownerType/:ownerId`, because every
 * collection on this mount is keyed on the pair and neither half means anything
 * alone.
 */
export function AccountsModule() {
    return (
        <Routes>
            <Route index element={<AccountsList />} />
            <Route path=":ownerType/:ownerId" element={<AccountDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
