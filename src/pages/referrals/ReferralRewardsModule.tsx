import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ReferralRewardDetailScreen } from '@/pages/referrals/ReferralRewardDetail';
import { ReferralRewardsList } from '@/pages/referrals/ReferralRewardsList';

/** Mounted at `referrals/rewards/*`, on `referrals.read`. Read-only. */
export function ReferralRewardsModule() {
    return (
        <Routes>
            <Route index element={<ReferralRewardsList />} />
            <Route path=":rewardId" element={<ReferralRewardDetailScreen />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
