import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { AuditExportDetail } from '@/pages/audit/AuditExportDetail';
import { AuditExportsList } from '@/pages/audit/AuditExportsList';

/**
 * `/dashboard/audit/exports`, gated on `audit.export`.
 *
 * A separate destination from the trail rather than a tab on it, because the two
 * are separately granted: Support holds `audit.read` and not `audit.export`, so
 * they see the trail and no Exports entry at all. That is the contract's shape,
 * not a UI choice — and a tab that only ever showed a refusal would be worse than
 * no tab.
 */
export function AuditExportsModule() {
    return (
        <Routes>
            <Route index element={<AuditExportsList />} />
            <Route path=":exportId" element={<AuditExportDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
