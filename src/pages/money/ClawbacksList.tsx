import { useMemo, useState } from 'react';
import { HandCoins, Scale } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { WriteOffClawbackDialog } from '@/components/money/WriteOffClawbackDialog';
import { ApprovalQueuedNotice } from '@/components/refunds/RefundBits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listClawbacks } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import type { Approval } from '@/types/approvals.types';
import {
    CLAWBACK_OWNER_TYPES,
    CLAWBACK_SORT_DEFAULT,
    CLAWBACK_SORT_OPTIONS,
    clawbackTotalsOf,
    type ClawbackDebtRow,
    type ClawbackListQuery,
} from '@/types/money.types';

/**
 * Refund debt — `GET /money/earnings/clawbacks` · `money.earnings.read`.
 *
 * A refund recovers the earnings it touches from what is still held, then from
 * `available`; what neither covers becomes **debt**, repaid automatically from
 * the owner's next earnings. When there will be none — the owner left — an
 * administrator **writes it off** and the platform absorbs the loss
 * (`money.earnings.clawback.write_off`, tiers 1–2, `202` at ≥ 2,000,000).
 *
 * The totals strip is `meta.totals` — the whole filtered debt per currency,
 * which only the server can see. ⛔ Never summed from the page.
 */

const FILTER_KEYS = ['ownerType', 'sort'] as const;
const FILTER_DEFAULTS = { sort: CLAWBACK_SORT_DEFAULT } as const;
const ANY = 'any';

export function ClawbacksList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const canWriteOff = can('money.earnings.clawback.write_off');

    const [writingOff, setWritingOff] = useState<ClawbackDebtRow | null>(null);
    const [queued, setQueued] = useState<{ approval: Approval; message?: string; ownerId: string } | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const sort = CLAWBACK_SORT_OPTIONS.some((option) => option.value === values.sort)
        ? values.sort
        : CLAWBACK_SORT_DEFAULT;

    const query: ClawbackListQuery = {
        ownerType: (CLAWBACK_OWNER_TYPES as readonly string[]).includes(values.ownerType)
            ? values.ownerType
            : undefined,
        sort,
        page,
    };
    const path = withQuery('/money/earnings/clawbacks', { ...query });
    const list = useAsyncData(path, (signal) => listClawbacks(query, { signal }));
    const meta = list.data?.meta;
    const totals = clawbackTotalsOf(meta);

    const columns = useMemo<Column<ClawbackDebtRow>[]>(() => {
        const base: Column<ClawbackDebtRow>[] = [
            {
                id: 'owner',
                header: 'Owner',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        {row.owner.name ? <p className="font-medium">{row.owner.name}</p> : null}
                        {row.owner.id ? (
                            <CopyableValue
                                value={row.owner.id}
                                label={`${row.owner.type} ID`}
                                to={`/dashboard/accounts/${row.owner.type}/${row.owner.id}`}
                            />
                        ) : null}
                        <Badge variant="outline" className="capitalize">
                            {row.owner.type}
                        </Badge>
                    </div>
                ),
            },
            {
                id: 'clawback',
                numeric: true,
                header: 'Owes back',
                className: 'align-top',
                cell: (row) => (
                    <span className="text-destructive font-medium tabular-nums">
                        {formatMoney(row.clawback, row.currency)}
                    </span>
                ),
            },
            {
                id: 'updatedAt',
                header: 'Last change',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.updatedAt, timeZone) ?? '—',
            },
        ];
        if (canWriteOff) {
            base.push({
                id: 'actions',
                header: 'Action',
                className: 'align-top text-right',
                cell: (row) =>
                    row.owner.id ? (
                        <Button variant="outline" size="sm" onClick={() => setWritingOff(row)}>
                            <Scale className="size-4" />
                            Write off
                        </Button>
                    ) : null,
            });
        }
        return base;
    }, [timeZone, canWriteOff]);

    return (
        <PageContainer
            title="Refund debt"
            description="Owners who owe the platform money back after a refund took more than they held. It is repaid from their next earnings."
        >
            <div className="space-y-4">
                {queued ? (
                    <div className="space-y-2">
                        <ApprovalQueuedNotice
                            approval={queued.approval}
                            message={queued.message}
                            timeZone={timeZone}
                            targetId={queued.ownerId}
                            what="this write-off"
                        />
                        <Button variant="ghost" size="sm" onClick={() => setQueued(null)}>
                            Dismiss
                        </Button>
                    </div>
                ) : null}

                {totals.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                        {totals.map((total) => (
                            <div key={total.currency} className="rounded-md border p-3">
                                <p className="text-muted-foreground text-xs">
                                    Owed in total{' '}
                                    {typeof total.owners === 'number'
                                        ? `· ${formatCount(total.owners)} ${total.owners === 1 ? 'owner' : 'owners'}`
                                        : ''}
                                </p>
                                <p className="text-destructive text-lg font-semibold tabular-nums">
                                    {formatMoney(total.clawback, total.currency)}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : null}

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Owner kind" htmlFor="clawback-owner-type">
                        <Select
                            value={values.ownerType || ANY}
                            onValueChange={(next) => set({ ownerType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="clawback-owner-type" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Every owner</SelectItem>
                                {CLAWBACK_OWNER_TYPES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                    <FilterField label="Order" htmlFor="clawback-sort">
                        <Select value={sort} onValueChange={(next) => set({ sort: next })}>
                            <SelectTrigger id="clawback-sort" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CLAWBACK_SORT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                <DataTable
                    caption="Owners with refund debt"
                    columns={columns}
                    rows={list.data?.data ?? []}
                    rowKey={(row) => `${row.owner.type}:${row.owner.id ?? 'unknown'}`}
                    isLoading={list.isLoading}
                    isRefreshing={list.isRefreshing}
                    error={list.error}
                    onRetry={list.reload}
                    empty={
                        <EmptyState
                            icon={HandCoins}
                            title="Nobody owes anything"
                            description={
                                isFiltered
                                    ? 'No owner of this kind has refund debt.'
                                    : 'No refund has taken back more than an owner held.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager meta={meta} noun="owners" isBusy={list.isRefreshing} onPageChange={setPage} />
                ) : null}
            </div>

            {canWriteOff ? (
                <WriteOffClawbackDialog
                    row={writingOff}
                    onClose={() => setWritingOff(null)}
                    onDone={() => {
                        setWritingOff(null);
                        list.reload();
                    }}
                    onQueued={(approval, message) => {
                        const ownerId = writingOff?.owner.id ?? '';
                        setWritingOff(null);
                        setQueued({ approval, message, ownerId });
                        list.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
