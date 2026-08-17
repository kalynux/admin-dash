import { useMemo, useState } from 'react';

import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { withQuery } from '@/lib/query';
import { listAgents } from '@/services/agents.service';
import { agentDisplayName, type AgentListQuery } from '@/types/agents.types';

/**
 * Choose a replacement agent by searching the directory.
 *
 * ── Rendered only for a caller holding `agents.read` ──────────────────────────
 * `shipments.reassign` does **not** imply it — the endpoint requires only the one
 * permission — so this must degrade rather than 403. The caller decides which half
 * to render; see `ReassignShipmentDialog`.
 *
 * ── Not filtered to the shipment's agency, deliberately ───────────────────────
 * Which agents may take a shipment is the platform's assignment rule, and it
 * depends on contract coverage, availability, capacity, tracking and the device.
 * Pre-filtering the list here would be this client deciding a rule it does not
 * own, and would quietly hide an agent the platform would have accepted. The
 * search is the directory's, and the platform is the authority at write time.
 *
 * What the picker *does* narrow is the obviously-useless: an agent who is banned
 * or whose account is not active cannot take anything, and those two are on the
 * row already.
 */
export function AgentPicker({
    value,
    onChange,
    error,
}: {
    value: string;
    onChange: (agentId: string) => void;
    error?: string;
}) {
    const [term, setTerm] = useState('');
    const trimmed = term.trim();

    const query = useMemo<AgentListQuery>(
        () => ({
            // An empty `?search=` is a 400, so nothing is sent until there is a term.
            search: trimmed.length > 0 ? trimmed : undefined,
            limit: 8,
            page: 1,
        }),
        [trimmed],
    );

    const path = withQuery('/agents', { ...query });
    const agents = useAsyncData(trimmed.length > 0 ? path : '', (signal) =>
        listAgents(query, { signal }),
    );

    const rows = agents.data?.data ?? [];

    return (
        <div className="space-y-2">
            <div className="space-y-1.5">
                <Label htmlFor="reassign-agent-search" className="flex items-center gap-1">
                    Find an agent
                    <InfoHint label="About this search">
                        The whole agent directory, not a filtered shortlist. Which agents may
                        actually take this shipment depends on contract coverage, availability,
                        capacity, tracking and their device — that is the platform&apos;s rule, and
                        it answers it when the reassignment is submitted.
                    </InfoHint>
                </Label>
                <Input
                    id="reassign-agent-search"
                    placeholder="Name, email, phone or agent id"
                    autoComplete="off"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                />
            </div>

            {agents.isLoading ? <InlineLoader label="Searching…" /> : null}

            {agents.error ? (
                <p className="text-muted-foreground text-xs">
                    Could not search the directory — {resolveErrorMessage(agents.error)}. Paste a
                    24-character agent id below instead.
                </p>
            ) : null}

            {trimmed.length > 0 && !agents.isLoading && rows.length === 0 && !agents.error ? (
                <p className="text-muted-foreground text-xs">No agent matches that.</p>
            ) : null}

            {rows.length > 0 ? (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                    {rows.map((agent) => (
                        <li key={agent.id}>
                            <button
                                type="button"
                                onClick={() => onChange(agent.id)}
                                className={`hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                                    value === agent.id ? 'bg-accent' : ''
                                }`}
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                        {agentDisplayName(agent)}
                                    </span>
                                    <span className="text-muted-foreground block truncate text-xs">
                                        {agent.email ?? agent.phone ?? agent.id}
                                    </span>
                                </span>
                                <span className="flex shrink-0 flex-wrap gap-1">
                                    {agent.banned ? (
                                        <Badge
                                            variant="outline"
                                            className="border-destructive/30 bg-destructive/10 text-destructive"
                                        >
                                            banned
                                        </Badge>
                                    ) : null}
                                    {agent.status !== 'active' ? (
                                        <Badge variant="outline" className="capitalize">
                                            {agent.status}
                                        </Badge>
                                    ) : null}
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {agent.operational.activeShipments}/
                                        {agent.operational.maxActiveShipments}
                                    </span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}

            <FormField
                id="reassign-agent-id"
                label="Agent id"
                error={error}
                hint="Filled in by choosing above, or paste one from the offer trail."
            >
                {(field) => (
                    <Input
                        className="font-mono"
                        placeholder="24-character agent id"
                        autoComplete="off"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        {...field}
                    />
                )}
            </FormField>

            {value ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange('')}
                >
                    Clear selection
                </Button>
            ) : null}
        </div>
    );
}
