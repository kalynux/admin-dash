import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listAgentActivity } from '@/services/agents.service';
import {
    AGENT_AUDIT_ACTIONS,
    AGENT_AUDIT_ACTION_LABELS,
    AGENT_MAX_RANGE_DAYS,
} from '@/types/agents.types';

interface AgentActivityPanelProps {
    agentId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /agents/:agentId/activity` — **what administrators have done to this
 * agent**: status changes, KYC verdicts, tracking decisions, cash-pool changes,
 * bans and transfers.
 *
 * ── This is not the agent's delivery record ───────────────────────────────────
 * Their shipments, offers and cash collections live behind `shipments.read` and
 * `cod.*`, and nothing assembles them here. "No activity" means no administrator
 * has touched this agent — not that the agent has done nothing.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `agents.read` **and** `audit.read` in `all` mode.
 * `AgentDetail` refuses to render the tab at all without both.
 */
export function AgentActivityPanel({ agentId, timeZone, reloadToken }: AgentActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listAgentActivity(agentId, query, options)}
            basePath={`/agents/${agentId}/activity`}
            actions={AGENT_AUDIT_ACTIONS}
            actionLabels={AGENT_AUDIT_ACTION_LABELS}
            actionPrefix="agents."
            maxRangeDays={AGENT_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this agent"
            emptyTitle="No administrator has acted on this agent"
            emptyDescription="This feed records status changes, identity-document verdicts, tracking decisions, cash-pool changes, bans and transfers made by administrators. It is not the agent's delivery record — their shipments and cash collections live behind their own permissions."
        />
    );
}
