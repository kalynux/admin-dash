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
import { PARTY_NAME_SOURCE_LABELS } from '@/lib/party';
import { withQuery } from '@/lib/query';
import { listAgencies } from '@/services/agencies.service';
import { resolveAgencyDisplayName, type AgencyListQuery } from '@/types/agencies.types';

/**
 * Choose an agency by searching the directory.
 *
 * ── Rendered only for a caller holding `agencies.read` ───────────────────────
 * `agents.transfer` does **not** imply it, so this must degrade rather than 403.
 * The caller decides which half to render; see `TransferAgentDialog`.
 *
 * ── ⚠ `excludeId` removes a choice, it does not enforce a rule ───────────────
 * The transfer schema's `.refine()` that source and destination differ stays
 * exactly where it is, and so does the platform's own refusal. Excluding the
 * source agency from the options only means the operator cannot reach that
 * refusal by accident — a list is an affordance, never a validator, and a client
 * that treated it as one would be a second definition of a rule it does not own.
 *
 * ── ⚠ Not narrowed to agencies that would accept this agent ──────────────────
 * Which agencies may receive one is the platform's rule and depends on the
 * agent's existing contracts and the destination's own state. Pre-filtering here
 * would be this client deciding a rule it does not own, and would quietly hide an
 * agency the platform would have accepted. The search is the directory's; the
 * platform is the authority at write time, and its three refusals land back on
 * the field that caused them.
 *
 * ── ⚠ An empty `?search=` is a 400 ──────────────────────────────────────────
 * Trimmed 1–120 characters, and a blank one is *rejected* rather than ignored —
 * so no parameter is sent until there is a term. The first page therefore arrives
 * unfiltered, which is what an operator opening a picker wants: candidates
 * immediately, narrowed by typing.
 *
 * ── ⚠ Nothing here takes a copy affordance ──────────────────────────────────
 * The result rows are `<button>`s — their second line is a *label for the choice*,
 * not a value on display, and a copy button nested inside a button is invalid
 * markup that also steals the click. The id field below is an `<Input>`: already
 * selectable, already whole, already the operator's to copy by the ordinary
 * means. The same call `AgentPicker` makes, for the same two reasons.
 */
export function AgencyPicker({
    value,
    onChange,
    error,
    excludeId,
    idFieldId = 'agency-picker-id',
    searchFieldId = 'agency-picker-search',
    label = 'Find an agency',
}: {
    value: string;
    onChange: (agencyId: string) => void;
    error?: string;
    /** The agency this choice must differ from — dropped from the options. */
    excludeId?: string;
    idFieldId?: string;
    searchFieldId?: string;
    label?: string;
}) {
    const [term, setTerm] = useState('');
    const trimmed = term.trim();

    const query = useMemo<AgencyListQuery>(
        () => ({
            // An empty `?search=` is a 400, so nothing is sent until there is a
            // term. `buildQuery` drops `''` as well; this is the intent stated.
            search: trimmed.length > 0 ? trimmed : undefined,
            // One more than shown, so excluding the source cannot empty a page
            // that had exactly one other candidate on it.
            limit: 9,
            page: 1,
        }),
        [trimmed],
    );

    const agencies = useAsyncData(withQuery('/agencies', { ...query }), (signal) =>
        listAgencies(query, { signal }),
    );

    const rows = (agencies.data?.data ?? []).filter((agency) => agency.id !== excludeId);
    const excludedOne =
        excludeId !== undefined &&
        (agencies.data?.data ?? []).some((agency) => agency.id === excludeId);

    return (
        <div className="space-y-2">
            <div className="space-y-1.5">
                <Label htmlFor={searchFieldId} className="flex items-center gap-1">
                    {label}
                    <InfoHint label="About this search">
                        <p>
                            The whole agency directory, not a shortlist. Whether this agency will
                            actually accept the agent depends on the platform&apos;s own rules —
                            it answers that when the transfer is submitted, and says which side
                            refused.
                        </p>
                    </InfoHint>
                </Label>
                <Input
                    id={searchFieldId}
                    placeholder="Business name, contact, email, phone or agency id"
                    autoComplete="off"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                />
            </div>

            {agencies.isLoading ? <InlineLoader label="Searching…" /> : null}

            {agencies.error ? (
                <p className="text-muted-foreground text-xs">
                    Could not search the directory — {resolveErrorMessage(agencies.error)}. Paste a
                    24-character agency id below instead.
                </p>
            ) : null}

            {!agencies.isLoading && !agencies.error && rows.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                    {trimmed.length > 0
                        ? 'No agency matches that.'
                        : excludedOne
                          ? 'The directory holds no other agency.'
                          : 'The directory is empty.'}
                </p>
            ) : null}

            {rows.length > 0 ? (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                    {rows.map((agency) => {
                        const name = resolveAgencyDisplayName(agency);

                        return (
                            <li key={agency.id}>
                                <button
                                    type="button"
                                    onClick={() => onChange(agency.id)}
                                    className={`hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                                        value === agency.id ? 'bg-accent' : ''
                                    }`}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">
                                            {name.value}
                                        </span>
                                        {/*
                                          ⚠ The id is shown on every row, because the
                                          ask is explicit that the options carry both
                                          the name and the id — an operator matching
                                          against something pasted from elsewhere needs
                                          the id to be visible, not hidden behind the
                                          name it resolved to.

                                          ⚠ And where the name IS a contact person, the
                                          row says so rather than passing a human off
                                          as the business.
                                        */}
                                        <span className="text-muted-foreground block truncate font-mono text-xs">
                                            {agency.id}
                                        </span>
                                        {name.kind === 'contact' ? (
                                            <span className="text-muted-foreground block truncate text-xs">
                                                {PARTY_NAME_SOURCE_LABELS[name.source]} — no
                                                business name recorded
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="flex shrink-0 flex-wrap gap-1">
                                        {agency.status !== 'active' ? (
                                            <Badge variant="outline" className="capitalize">
                                                {agency.status}
                                            </Badge>
                                        ) : null}
                                        {agency.country ? (
                                            <Badge variant="outline">{agency.country}</Badge>
                                        ) : null}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            <FormField
                id={idFieldId}
                label="Agency id"
                error={error}
                hint="Filled in by choosing above, or paste one from the agency directory."
            >
                {(field) => (
                    <Input
                        className="font-mono"
                        placeholder="24-character agency id"
                        autoComplete="off"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        {...field}
                    />
                )}
            </FormField>

            {value ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
                    Clear selection
                </Button>
            ) : null}
        </div>
    );
}
