import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ContractDetail } from '@/pages/contracts/ContractDetail';

/**
 * `/dashboard/contracts/:contractId` — one agent↔agency contract.
 *
 * ── Why there is no index, and no sidebar entry ───────────────────────────────
 * **`/contracts` has no list endpoint.** The service offers exactly four routes,
 * all of them addressing a single contract by id: the same rows are listed from
 * an agency's roster (`GET /agencies/:agencyId/agents`) and an agent's contracts
 * (`GET /agents/:agentId/contracts`), and this mount exists so a caller holding
 * only a contract id — which is what a support ticket carries — does not have to
 * look up an agent first.
 *
 * A nav entry would therefore be a link to nothing, and the module's index is a
 * 404 rather than an empty list, which is the honest answer to "show me
 * contracts".
 *
 * ── Which is why it is declared by hand in `App.tsx` ──────────────────────────
 * Every other module route is generated from `navigation.ts`, so that what is
 * visible is reachable and the sidebar and the gate read one object. This one is
 * reachable but not visible, so it carries its guard explicitly —
 * `agencies.read` **+** `agents.read` in `all` mode, matching the endpoint,
 * which names a party from each directory.
 */
export function ContractsModule() {
    return (
        <Routes>
            <Route path=":contractId" element={<ContractDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
