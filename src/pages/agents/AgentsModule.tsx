import { Route, Routes } from 'react-router-dom';

import { AgentDetail } from '@/pages/agents/AgentDetail';
import { AgentsList } from '@/pages/agents/AgentsList';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/agents` module.
 *
 * Mounted by `App.tsx` at `agents/*` from the navigation config, so this owns its
 * own remainder — including its own 404, which the shell's catch-all can no longer
 * see once the module route has matched.
 */
export function AgentsModule() {
    return (
        <Routes>
            <Route index element={<AgentsList />} />
            <Route path=":agentId" element={<AgentDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
