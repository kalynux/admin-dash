import { useLocation } from 'react-router-dom';
import { Construction } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { findNavEntry, navEntryPermissions } from '@/config/navigation';

/**
 * Stands in for a screen that has not been built yet.
 *
 * It exists so the shell, the routing and the permission-driven navigation can
 * be exercised end to end without pretending a module works. It shows the owning
 * phase and the permissions the real screen will be gated on — and it calls no
 * endpoint, so nothing here can be mistaken for live data.
 *
 * It resolves the **deepest** entry, not the module: `/dashboard/cod/deposits`
 * is Deposits with `cod.deposits.read`, and naming its container instead would
 * print a permission the route does not actually check.
 */
export function ModulePlaceholder() {
    const { pathname } = useLocation();
    const entry = findNavEntry(pathname);

    const permissions = navEntryPermissions(entry);

    return (
        <PageContainer title={entry?.label ?? 'Not built yet'}>
            <EmptyState
                icon={Construction}
                title={`${entry?.label ?? 'This screen'} is not built yet`}
                description={
                    entry
                        ? `Scheduled for phase ${entry.phase}. The backend surface it will call is verified and documented in api-doc/admin/dashboard/BACKEND-INTEGRATION-MATRIX.md.`
                        : 'This route has no screen behind it yet.'
                }
                action={
                    permissions.length > 0 ? (
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {permissions.map((name) => (
                                <Badge
                                    key={name}
                                    variant="outline"
                                    className="font-mono text-[11px]"
                                >
                                    {name}
                                </Badge>
                            ))}
                        </div>
                    ) : undefined
                }
            />
        </PageContainer>
    );
}
