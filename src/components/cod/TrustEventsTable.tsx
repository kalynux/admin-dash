import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CanPredicate } from '@/store';
import type { TrustEvent } from '@/types/cod.types';

/**
 * The columns of an agent's conduct record, shared by the two places it appears:
 * the agent's own Cash tab (paged, filterable) and a discrepancy's detail (the
 * handful of movements *that* flag caused).
 *
 * A factory rather than a component so each call site keeps its own table — one
 * pages a real endpoint, the other renders a capped embedded array, and those
 * differ in loading, emptiness and what truncation means.
 */
export function trustEventColumns({
    timeZone,
    can,
    /** The discrepancy already being read — no point linking a row back to itself. */
    currentDiscrepancyId,
}: {
    timeZone: string;
    can: CanPredicate;
    currentDiscrepancyId?: string;
}): Column<TrustEvent>[] {
    return [
        {
            id: 'createdAt',
            header: 'When',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? <NotSet />,
        },
        {
            id: 'eventType',
            header: 'Why',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    <Badge variant="outline" className="capitalize">
                        {humaniseEnum(row.eventType) ?? '—'}
                    </Badge>
                    {row.note ? <p className="text-muted-foreground text-xs">{row.note}</p> : null}
                </div>
            ),
        },
        {
            id: 'delta',
            header: 'Change',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p
                        className={cn(
                            'font-medium tabular-nums',
                            row.delta < 0 ? 'text-destructive' : 'text-success',
                        )}
                    >
                        {row.delta > 0 ? '+' : ''}
                        {row.delta}
                    </p>
                    {/*
                      Post-clamp, and saying so matters: an adjustment of +15
                      against a score of 95 is stored as +5, so this is the
                      movement that happened rather than the one that was asked
                      for.
                    */}
                    <p className="text-muted-foreground text-xs">
                        {row.delta < 0 ? 'Penalty' : 'Restored'}
                    </p>
                </div>
            ),
        },
        {
            id: 'scoreAfter',
            header: 'Score after',
            className: 'align-top font-medium tabular-nums',
            // The audit snapshot, not a recomputation — the score as it stood.
            cell: (row) => `${row.scoreAfter} / 100`,
        },
        {
            id: 'ref',
            header: 'Source',
            className: 'align-top text-sm',
            cell: (row) => renderSource(row, can, currentDiscrepancyId),
        },
    ];
}

/**
 * What explains this movement.
 *
 * ⚠ **`refType` is `'admin'` on a manual adjustment, not `null`** — only `refId`
 * is null. So the discriminator is the presence of the id, and a row with a type
 * and no id is a person's decision rather than missing data.
 *
 * A plain function called from the cell rather than a component, so this file
 * keeps exporting only the factory — a module that exports both a component and a
 * non-component breaks fast refresh, which is the rule the rest of `components/`
 * follows.
 */
function renderSource(row: TrustEvent, can: CanPredicate, current?: string): ReactNode {
    if (row.refType === 'cod_discrepancy' && row.refId) {
        if (row.refId === current) return <span className="text-muted-foreground">This flag</span>;

        return can('cod.discrepancies.read') ? (
            <Link to={`/dashboard/cod/discrepancies/${row.refId}`} className="hover:underline">
                The discrepancy
            </Link>
        ) : (
            <span className="text-muted-foreground">A discrepancy</span>
        );
    }

    if (row.refType === 'admin') {
        return <span className="text-muted-foreground">Adjusted by hand</span>;
    }

    return row.refType ? (
        <span className="text-muted-foreground capitalize">{humaniseEnum(row.refType) ?? '—'}</span>
    ) : (
        <NotSet />
    );
}
