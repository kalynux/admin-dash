import { Route, Routes } from 'react-router-dom';

import { ApprovalDetail } from '@/pages/approvals/ApprovalDetail';
import { ApprovalsList } from '@/pages/approvals/ApprovalsList';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/approvals` module — the four-eyes queue.
 *
 * A childless module, so `App.tsx` mounts it at `approvals/*` and it declares
 * its own index, detail and 404 here. Same shape as `UsersModule`.
 *
 * `approvals.read` has already been checked by the gate. Nothing inside
 * re-checks it — and note that it is the *only* permission this module's route
 * can be gated on, because whether a given row is actionable depends on the
 * permission that row's queued action names, which is a per-row question the
 * screens answer with `lib/approval-actions.ts`.
 */
export function ApprovalsModule() {
    return (
        <Routes>
            <Route index element={<ApprovalsList />} />
            <Route path=":approvalId" element={<ApprovalDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
