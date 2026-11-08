import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { listListings } from '@/services/listings.service';
import { useCan } from '@/store';
import { providerListingsPath } from '@/types/listings.types';

/**
 * "Service listings (n)" on a vendor's page — the queue narrowed to this vendor.
 *
 * ⚠ **Shown when the vendor HAS listings, not when its `kind` is `provider`.**
 * wi-admin's vendor detail carries no `kind` (only the listing detail's vendor
 * summary does), so the one honest signal on this page is a count: one
 * `GET /listings?vendorId=&limit=1`. Only a provider can have listings, so a
 * seller costs one small read and shows nothing. A failed count shows nothing
 * too — the link is a convenience, never the only way in.
 */
export function ProviderListingsLink({ vendorId }: { vendorId: string }) {
    const can = useCan();
    if (!can('catalog.listings.read')) return null;
    return <CountedLink vendorId={vendorId} />;
}

function CountedLink({ vendorId }: { vendorId: string }) {
    const count = useAsyncData(`/listings?vendorId=${vendorId}#count`, (signal) =>
        listListings({ vendorId, page: 1, limit: 1, sort: '-createdAt' }, { signal })
            .then((page) => page.meta.total)
            .catch(() => 0),
    );
    const total = count.data ?? 0;
    if (total <= 0) return null;
    return (
        <Button variant="outline" size="sm" asChild>
            <Link to={providerListingsPath(vendorId)}>
                <Megaphone className="size-4" />
                Service listings ({formatCount(total)})
            </Link>
        </Button>
    );
}
