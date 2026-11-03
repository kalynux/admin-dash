import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';
import {
    MultiSelectFilter,
    TextFilter,
    type MultiSelectOption,
} from '@/components/money/transactions/FilterControls';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAggregatorNames } from '@/hooks/use-aggregator-names';
import type { ListQueryState } from '@/hooks/use-list-query-state';
import {
    AMOUNT_OPERATORS,
    AMOUNT_OPERATOR_LABELS,
    TRANSACTION_SECONDARY_KEYS,
    joinFilterList,
    splitFilterList,
    type TransactionFilterIssues,
    type TransactionFilterKey,
} from '@/lib/transaction-filters';
import {
    TRANSACTION_DIRECTIONS,
    TRANSACTION_DIRECTION_LABELS,
    TRANSACTION_GROUPS,
    TRANSACTION_GROUP_LABELS,
    TRANSACTION_KINDS,
    TRANSACTION_KIND_LABELS,
    TRANSACTION_MAX_RANGE_DAYS,
    TRANSACTION_OUTCOMES,
    TRANSACTION_OUTCOME_LABELS,
    TRANSACTION_ROLES,
    TRANSACTION_ROLE_LABELS,
    type TransactionGroup,
    type TransactionKind,
} from '@/types/transactions.types';

const ANY = 'any';

/** Which family each kind belongs to — a property of the kind (transactions.md § What a row is). */
const KIND_GROUP: Record<TransactionKind, TransactionGroup> = {
    payment: 'provider',
    plan_purchase: 'provider',
    credit_topup: 'provider',
    refund: 'provider',
    delivery_fee_refund: 'provider',
    payout: 'provider',
    cod_deposit: 'cash',
    cod_remittance: 'cash',
    cod_collection: 'cash',
    ledger_entry: 'internal',
    earnings_adjustment: 'internal',
};

const KIND_OPTIONS: MultiSelectOption[] = TRANSACTION_KINDS.map((kind) => ({
    value: kind,
    label: TRANSACTION_KIND_LABELS[kind],
    section: TRANSACTION_GROUP_LABELS[KIND_GROUP[kind]],
}));

const options = <T extends string>(
    values: readonly T[],
    labels: Record<T, string>,
): MultiSelectOption[] => values.map((value) => ({ value, label: labels[value] }));

const DIRECTION_OPTIONS = options(TRANSACTION_DIRECTIONS, TRANSACTION_DIRECTION_LABELS);
const ROLE_OPTIONS = options(TRANSACTION_ROLES, TRANSACTION_ROLE_LABELS);
const OUTCOME_OPTIONS = options(TRANSACTION_OUTCOMES, TRANSACTION_OUTCOME_LABELS);

/** Suggestions only — each of these is jovi-mall's open vocabulary and the box takes anything. */
const PROVIDER_SUGGESTIONS = ['MTN', 'ORANGE', 'MOOV', 'CARD'];
const METHOD_SUGGESTIONS = [
    'MOBILE',
    'CARD',
    'CASH',
    'mobile_money',
    'bank',
    'card_refund',
    'payout',
    'external',
    'other',
];
const REASON_SUGGESTIONS = [
    'order_payment',
    'booking_payment',
    'booking_balance',
    'delivery_topup',
    'plan_purchase',
    'credit_topup',
    'refund',
    'delivery_fee_refund',
    'payout_manual',
    'payout_auto_threshold',
    'cod_deposit_to_platform',
    'cod_deposit_to_agency',
    'cod_remittance',
    'cod_order_payment',
    'cod_delivery_fee',
    'debt_write_off',
    'referral_reward',
    'referral_reward_matured',
    'referral_reward_clawback',
    'debt_recovered_from_payout',
    'partial_return_fault',
    'order_split',
    'hold_release',
    'refund_reversal',
    'refund_clawback',
];

interface TransactionFilterBarProps {
    query: ListQueryState<TransactionFilterKey>;
    issues: TransactionFilterIssues;
    timeZone: string;
}

/**
 * One filter per column of the Transactions list.
 *
 * Every control writes the address bar and nothing else; the request is built
 * from the address by `resolveTransactionFilters`, which is also what decides
 * that a half-typed id or a malformed amount is **not sent** — and hands the
 * reason back here, to sit under the box it concerns.
 *
 * The commonly used filters are always on screen. The rest sit under *More
 * filters*, which opens by itself when the address already carries one of them.
 */
export function TransactionFilterBar({ query, issues, timeZone }: TransactionFilterBarProps) {
    const { values, set, reset, isFiltered } = query;
    const aggregatorNames = useAggregatorNames();

    const secondaryCount = TRANSACTION_SECONDARY_KEYS.filter((key) => values[key] !== '').length;
    const [showMore, setShowMore] = useState(secondaryCount > 0);

    const list = (key: TransactionFilterKey) => splitFilterList(values[key]);
    const setList = (key: TransactionFilterKey) => (next: string[]) =>
        set({ [key]: next.length > 0 ? joinFilterList(next) : null });
    /** Typed values settle with `replace`, so each pause is not a back-button stop. */
    const setText = (key: TransactionFilterKey) => (next: string) =>
        set({ [key]: next || null }, { replace: true });

    const isBetween = values.amountOp === 'between';

    return (
        <div className="space-y-3">
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <FilterField label="Movements" htmlFor="transaction-group">
                    <Select
                        value={values.group || ANY}
                        onValueChange={(next) => set({ group: next === ANY ? null : next })}
                    >
                        <SelectTrigger id="transaction-group" className="w-[190px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>All movements</SelectItem>
                            {TRANSACTION_GROUPS.map((group) => (
                                <SelectItem key={group} value={group}>
                                    {TRANSACTION_GROUP_LABELS[group]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <MultiSelectFilter
                    label="Type"
                    anyLabel="Any type"
                    options={KIND_OPTIONS}
                    value={list('kind')}
                    onChange={setList('kind')}
                    className="w-[190px]"
                />

                <MultiSelectFilter
                    label="Direction"
                    anyLabel="In and out"
                    options={DIRECTION_OPTIONS}
                    value={list('direction')}
                    onChange={setList('direction')}
                    className="w-[150px]"
                />

                <MultiSelectFilter
                    label="Role"
                    anyLabel="Any role"
                    options={ROLE_OPTIONS}
                    value={list('role')}
                    onChange={setList('role')}
                    className="w-[150px]"
                />

                <MultiSelectFilter
                    label="Status"
                    anyLabel="Any status"
                    options={OUTCOME_OPTIONS}
                    value={list('outcome')}
                    onChange={setList('outcome')}
                    className="w-[160px]"
                />

                <FilterField label="Amount" htmlFor="transaction-amount-operator">
                    <Select
                        value={values.amountOp}
                        onValueChange={(next) =>
                            set({
                                amountOp: next,
                                // The second box belongs to "between" alone.
                                ...(next === 'between' ? {} : { amountTo: null }),
                            })
                        }
                    >
                        <SelectTrigger id="transaction-amount-operator" className="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {AMOUNT_OPERATORS.map((operator) => (
                                <SelectItem key={operator} value={operator}>
                                    {AMOUNT_OPERATOR_LABELS[operator]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <TextFilter
                    label={isBetween ? 'From amount' : 'Amount value'}
                    value={values.amount}
                    onChange={setText('amount')}
                    placeholder="e.g. 50000"
                    inputMode="decimal"
                    maxLength={20}
                    issue={issues.amount}
                    className="w-[130px]"
                />

                {isBetween ? (
                    <TextFilter
                        label="To amount"
                        value={values.amountTo}
                        onChange={setText('amountTo')}
                        placeholder="e.g. 200000"
                        inputMode="decimal"
                        maxLength={20}
                        issue={issues.amountTo}
                        className="w-[130px]"
                    />
                ) : null}

                <DateRangeFilter
                    label="Date"
                    from={values.createdFrom}
                    to={values.createdTo}
                    onChange={(next) =>
                        set({ createdFrom: next.from || null, createdTo: next.to || null })
                    }
                    timeZone={timeZone}
                    maxDays={TRANSACTION_MAX_RANGE_DAYS}
                />

                <FilterFieldSpacer>
                    <Button
                        variant="outline"
                        className="h-9"
                        aria-expanded={showMore}
                        aria-controls="transaction-more-filters"
                        onClick={() => setShowMore((open) => !open)}
                    >
                        <SlidersHorizontal className="size-4" />
                        More filters
                        {secondaryCount > 0 ? ` (${secondaryCount})` : ''}
                    </Button>
                </FilterFieldSpacer>
            </FilterBar>

            {showMore ? (
                <div
                    id="transaction-more-filters"
                    className="bg-muted/30 flex flex-wrap items-start gap-x-3 gap-y-3 rounded-lg border p-3"
                >
                    <TextFilter
                        label="Paid with"
                        value={values.provider}
                        onChange={setText('provider')}
                        placeholder="e.g. MTN"
                        maxLength={40}
                        suggestions={PROVIDER_SUGGESTIONS}
                    />

                    <TextFilter
                        label="Aggregator"
                        value={values.gateway}
                        onChange={setText('gateway')}
                        placeholder="e.g. NOTCHPAY"
                        maxLength={40}
                        suggestions={aggregatorNames ?? undefined}
                    />

                    <TextFilter
                        label="Method"
                        value={values.method}
                        onChange={setText('method')}
                        placeholder="e.g. mobile_money"
                        maxLength={40}
                        suggestions={METHOD_SUGGESTIONS}
                    />

                    <TextFilter
                        label="Exact status"
                        value={values.status}
                        onChange={setText('status')}
                        placeholder="e.g. SUCCEEDED"
                        maxLength={40}
                    />

                    <TextFilter
                        label="Reason code"
                        value={values.reasonCode}
                        onChange={setText('reasonCode')}
                        placeholder="e.g. order_payment"
                        maxLength={40}
                        suggestions={REASON_SUGGESTIONS}
                    />

                    <TextFilter
                        label="Reference"
                        value={values.reference}
                        onChange={setText('reference')}
                        placeholder="Whole reference"
                        mono
                        className="w-[220px]"
                    />

                    <TextFilter
                        label="Order ID"
                        value={values.orderId}
                        onChange={setText('orderId')}
                        maxLength={24}
                        issue={issues.orderId}
                        mono
                        className="w-[210px]"
                    />

                    <TextFilter
                        label="Booking ID"
                        value={values.bookingId}
                        onChange={setText('bookingId')}
                        maxLength={24}
                        issue={issues.bookingId}
                        mono
                        className="w-[210px]"
                    />

                    <TextFilter
                        label="Party ID"
                        value={values.partyId}
                        onChange={setText('partyId')}
                        maxLength={24}
                        issue={issues.partyId}
                        mono
                        className="w-[210px]"
                    />

                    <FilterFieldSpacer>
                        <span className="text-muted-foreground flex h-9 items-center gap-1 text-xs">
                            How these match
                            <InfoHint label="How these filters match">
                                Several values can be given with commas, such as MTN, ORANGE. Paid
                                with, aggregator and method ignore capitals; a reference and an ID
                                must be given whole. A filter on something a type of transaction does
                                not have leaves that type out — filtering by what was paid with
                                shows no refund, cash or earnings movement. Charges made before
                                providers were recorded have none, so filter those by aggregator
                                instead.
                            </InfoHint>
                        </span>
                    </FilterFieldSpacer>
                </div>
            ) : null}
        </div>
    );
}
