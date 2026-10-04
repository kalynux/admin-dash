import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';

/**
 * A delivery-fee refund row's status.
 *
 * `manual_required` is the one that asks for a person, so it is drawn in the
 * **warning** tone and named for what it means — *owed, pay by hand* — rather
 * than humanised as "Manual required", which reads like a setting. Everything
 * else is the platform's word, rendered raw on an unknown value.
 */
const LABELS: Record<string, string> = {
    manual_required: 'Owed — pay by hand',
    completed: 'Returned',
};

const VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    completed: 'default',
    processing: 'secondary',
    failed: 'destructive',
};

export function DeliveryFeeRefundStatusBadge({ status }: { status: string | null | undefined }) {
    const label = (status ? LABELS[status] : undefined) ?? humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    if (status === 'manual_required') {
        return (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                {label}
            </Badge>
        );
    }

    return (
        <Badge variant={VARIANTS[status as string] ?? 'outline'} className="capitalize">
            {label}
        </Badge>
    );
}
