import { Route, Routes } from 'react-router-dom';

import { AllocationDetail } from '@/pages/money/AllocationDetail';
import { AllocationsList } from '@/pages/money/AllocationsList';
import { NotFound } from '@/pages/NotFound';

/** `/dashboard/money/allocations` and the per-allocation detail beneath it. */
export function AllocationsModule() {
    return (
        <Routes>
            <Route index element={<AllocationsList />} />
            <Route path=":allocationId" element={<AllocationDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
