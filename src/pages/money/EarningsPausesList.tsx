import { useMemo, useState } from 'react';
import { CirclePause } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { earningsPauseColumns } from '@/components/money/earningsPauseColumns';
import { ResumeEarningsDialog } from '@/components/money/EarningsPauseDialogs';
import { InfoHint } from '@/components/ui/info-hint';
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
import { formatCount } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listEarningsPauses } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    PAUSE_KIND_LABELS,
    PAUSE_KINDS,
    type EarningsPauseListQuery,
    type EarningsPauseRow,
    type PauseKind,
} from '@/types/earnings-pause.types';

/**
 * `GET /money/earnings/pauses` · **`money.earnings.read`** (tiers 1–2) ·
 * delegated.
 *
 * Every order and booking whose earnings are paused **now**, newest pause first.
 * Paused money is never paid out, so this is the list of payouts somebody has
 * to decide on: refund the customer, or resume. **Resume** per row is
 * `money.earnings.pause` and absent without it.
 *
 * ── A strict list ─────────────────────────────────────────────────────────────
 * `kind`, `page`, `limit` and nothing else — an unknown key is a `400`, so there
 * is no `sort` (the order is fixed) and no address-only filter. `kind` is pinned
 * to `order` · `booking`, and a hand-edited value outside them is dropped rather
 * than sent.
 *
 * ── What the row cannot say ──────────────────────────────────────────────────
 * The vendor is an id: the row carries no name, and resolving one per row would
 * be an N+1 this queue does not need — the id opens the vendor. A **booking**
 * reference is plain text: this dashboard has no booking screen. ⛔ No release
 * date is shown — a paused payout has none until it is resumed, and that date is
 * jovi-mall's to compute.
 */

const FILTER_KEYS = ['kind'] as const;
const FILTER_DEFAULTS = { kind: '' } as const;

function isKind(value: string): value is PauseKind {
    return (PAUSE_KINDS as readonly string[]).includes(value);
}

export function EarningsPausesList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const [resuming, setResuming] = useState<EarningsPauseRow | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const kind = isKind(values.kind) ? values.kind : undefined;
    const query: EarningsPauseListQuery = { kind, page };

    const path = withQuery('/money/earnings/pauses', { ...query });
    const pauses = useAsyncData(path, (signal) => listEarningsPauses(query, { signal }));

    const columns = useMemo(
        () => earningsPauseColumns({ timeZone, can, onResume: setResuming }),
        [timeZone, can],
    );

    const meta = pauses.data?.meta;

    return (
        <PageContainer
            title="Paused earnings"
            description="Orders and bookings whose payout is on hold. Nobody on them is paid until an administrator resumes it."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField
                        htmlFor="pause-kind"
                        label={
                            <>
                                Kind
                                <InfoHint label="About this queue">
                                    The platform pauses a payout on its own when a seller cancels a
                                    paid order or a paid booking (a high-priority refund ticket
                                    opens too) and when a customer disputes a card payment.
                                    Administrators may also pause one by hand.
                                </InfoHint>
                            </>
                        }
                    >
                        <Select
                            value={kind ?? 'all'}
                            onValueChange={(next) => set({ kind: next === 'all' ? '' : next })}
                        >
                            <SelectTrigger id="pause-kind" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Orders and bookings</SelectItem>
                                {PAUSE_KINDS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {PAUSE_KIND_LABELS[value]}s only
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} paused {meta.total === 1 ? 'payout' : 'payouts'}
                    </p>
                ) : null}

                <DataTable
                    caption="Paused earnings"
                    columns={columns}
                    rows={pauses.data?.data ?? []}
                    rowKey={(row) => `${row.kind}:${row.id}`}
                    isLoading={pauses.isLoading}
                    isRefreshing={pauses.isRefreshing}
                    error={pauses.error}
                    onRetry={pauses.reload}
                    empty={
                        <EmptyState
                            icon={CirclePause}
                            title="Nothing is paused"
                            description={
                                kind
                                    ? `No ${kind}'s payout is on hold.`
                                    : 'Every order and booking is free to pay out once its hold ends.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="payouts"
                        isBusy={pauses.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {resuming ? (
                <ResumeEarningsDialog
                    kind={isKind(resuming.kind) ? resuming.kind : 'order'}
                    id={resuming.id}
                    reference={resuming.reference}
                    pause={resuming.pause}
                    open
                    onOpenChange={(open) => {
                        if (!open) setResuming(null);
                    }}
                    onDone={() => {
                        setResuming(null);
                        pauses.reload();
                    }}
                    onStale={() => {
                        setResuming(null);
                        pauses.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

