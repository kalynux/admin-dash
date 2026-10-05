import { Link } from 'react-router-dom';

import { formatMoney } from '@/lib/format';
import type { Refund } from '@/types/money.types';
import { refundChannelLabel, refundDetailPath } from '@/types/refunds.types';

/**
 * One `refund_transactions` row's money: the gross, and — since the refund
 * queue (2026-10-05) — the fee the platform kept and what the customer
 * received, **as sent**. A legacy row has neither (`null`): the customer
 * received `amount`, and the cell says nothing more rather than inventing a
 * zero fee.
 */
export function RefundSettlementAmount({ row }: { row: Refund }) {
    const hasSplit = typeof row.feeAmount === 'number' && typeof row.netAmount === 'number';
    return (
        <div className="space-y-0.5">
            <p className="font-medium tabular-nums">{formatMoney(row.amount, row.currency)}</p>
            {hasSplit ? (
                <p className="text-muted-foreground text-xs tabular-nums">
                    fee {formatMoney(row.feeAmount as number, row.currency)} · customer got{' '}
                    {formatMoney(row.netAmount as number, row.currency)}
                </p>
            ) : null}
        </div>
    );
}

/**
 * How the money went back. ⚠ **Keyed on `channel`, never on `gateway`** — the
 * gateway is `null` on a COD or externally-settled refund, and a row from before
 * the refund flow has no channel at all (it then names the gateway, which it
 * always had).
 */
export function RefundSettlementChannel({ row }: { row: Refund }) {
    const channel = row.channel ?? null;
    return (
        <div className="space-y-0.5 text-sm">
            <p>{channel ? refundChannelLabel(channel) : (row.gateway ?? 'Not recorded')}</p>
            {channel && row.gateway ? (
                <p className="text-muted-foreground text-xs">{row.gateway}</p>
            ) : null}
            {row.refundRequestId ? (
                <Link
                    to={refundDetailPath(row.refundRequestId)}
                    className="text-primary text-xs hover:underline"
                >
                    Refund request
                </Link>
            ) : null}
        </div>
    );
}
