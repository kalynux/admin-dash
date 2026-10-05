import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';

import { RefundStatusBadge } from '@/components/refunds/RefundBits';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listRefundRequests } from '@/services/refunds.service';
import { refundDetailPath } from '@/types/refunds.types';

/** How many of an order's requests the card lists before linking to the queue. */
const SHOWN = 5;

/**
 * This order's refund requests — `GET /refunds?sourceId=` · `orders.refund.read`.
 *
 * Callers mount it only under that permission. It answers *"is a refund already
 * open on this order?"* before anybody raises a second one (which would be
 * `REFUND_ALREADY_OPEN`), and links each to its request. **Renders nothing at
 * all when the order has none**, so an ordinary order carries no empty box.
 */
export function OrderRefundRequestsCard({
    orderId,
    timeZone,
    reloadToken,
}: {
    orderId: string;
    timeZone: string;
    reloadToken: number;
}) {
    const query = { sourceId: orderId, limit: SHOWN };
    const list = useAsyncData(`${withQuery('/refunds', { ...query })}#${reloadToken}`, (signal) =>
        listRefundRequests(query, { signal }),
    );

    if (list.isLoading) return <Skeleton className="h-10 w-full" />;

    if (list.error && !list.data) {
        return (
            <p className="text-muted-foreground text-sm">
                Could not read this order&rsquo;s refund requests — {resolveErrorMessage(list.error)}
            </p>
        );
    }

    const rows = list.data?.data ?? [];
    if (rows.length === 0) return null;
    const total = list.data?.meta.total ?? rows.length;

    return (
        <section aria-label="Refund requests" className="space-y-2 rounded-md border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
                <Undo2 className="text-muted-foreground size-4" />
                Refund requests
            </p>
            <ul className="divide-y">
                {rows.map((refund) => (
                    <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <Link to={refundDetailPath(refund.id)} className="font-medium tabular-nums hover:underline">
                            {formatMoney(refund.grossAmount, refund.currency)}
                        </Link>
                        <RefundStatusBadge status={refund.status} />
                        <span className="text-muted-foreground text-xs">
                            {formatInstantInZone(refund.createdAt, timeZone) ?? ''}
                        </span>
                    </li>
                ))}
            </ul>
            {total > rows.length ? (
                <Link
                    to={`/dashboard/refunds?sourceId=${encodeURIComponent(orderId)}&tab=all`}
                    className="text-primary text-xs hover:underline"
                >
                    All {total} requests
                </Link>
            ) : null}
        </section>
    );
}
