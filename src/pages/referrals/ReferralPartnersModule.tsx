import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ReferralPartnerDetail } from '@/pages/referrals/ReferralPartnerDetail';
import { ReferralPartnersList } from '@/pages/referrals/ReferralPartnersList';

/** Mounted at `referrals/partners/*`, on `referrals.read`. Every verb gates itself. */
export function ReferralPartnersModule() {
    return (
        <Routes>
            <Route index element={<ReferralPartnersList />} />
            <Route path=":partnerId" element={<ReferralPartnerDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
