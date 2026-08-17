import { useCallback, useEffect, useState } from 'react';
import { RotateCw, ShieldCheck } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { TierBadge } from '@/components/layout/TierBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchPermissionCatalog } from '@/services/permissions.service';
import { usePermissions } from '@/store';
import {
    PERMISSION_NAMES,
    UNROUTED_PERMISSION_NAMES,
    type PermissionCatalog,
    type PermissionCatalogEntry,
} from '@/types/permissions.types';

const UNROUTED = new Set<string>(UNROUTED_PERMISSION_NAMES);

/** The four sensitivity flags, as badges. Order matches the doc's own table. */
function Flags({ entry }: { entry: PermissionCatalogEntry }) {
    const flags: string[] = [];
    if (entry.financial) flags.push('financial');
    if (entry.escalation) flags.push('escalation');
    if (entry.destructive) flags.push('destructive');
    if (entry.dualControl) flags.push('dual-control');
    if (entry.scoped) flags.push('scoped');

    if (flags.length === 0) return null;

    return (
        <span className="flex flex-wrap gap-1">
            {flags.map((flag) => (
                <Badge key={flag} variant="outline" className="text-[10px] font-normal">
                    {flag}
                </Badge>
            ))}
        </span>
    );
}

/**
 * What this administrator may do, in their own words.
 *
 * Reads `GET /permissions/catalog` — no permission required, because "the
 * vocabulary is what a dashboard is written against" — and intersects it with the
 * set already in the store. Nothing here is computed from the level: the whole
 * point of the page is to show what the *server* resolved, which is also what
 * makes it the honest place to admit that **twenty-eight catalogued permissions
 * have no endpoint yet**. A Support administrator holds twelve of those, so the
 * gap is not a footnote for them — it is half their access.
 *
 * The page is permission-free itself. An administrator who cannot see what they
 * hold has no way to tell a missing feature from a missing grant.
 */
export function MyAccess() {
    const { held, tier, tierLabel, status: permissionsStatus, reload } = usePermissions();

    /**
     * The catalog read, as one piece of state plus an attempt counter.
     *
     * The counter is what re-runs the effect, rather than the effect calling a
     * `load()` that flips `isLoading` on its way in — that shape sets state
     * synchronously in an effect body, which cascades a render before the request
     * has even left. Here the effect's first statement is the `await`, and the
     * only synchronous write lives in the retry handler, where it belongs.
     */
    const [attempt, setAttempt] = useState(0);
    const [request, setRequest] = useState<{
        catalog: PermissionCatalog | null;
        error: unknown;
        isLoading: boolean;
    }>({ catalog: null, error: null, isLoading: true });

    useEffect(() => {
        const controller = new AbortController();

        void (async () => {
            try {
                const result = await fetchPermissionCatalog({ signal: controller.signal });
                if (controller.signal.aborted) return;
                setRequest({ catalog: result, error: null, isLoading: false });
            } catch (caught) {
                if (controller.signal.aborted) return;
                setRequest({ catalog: null, error: caught, isLoading: false });
            }
        })();

        return () => controller.abort();
    }, [attempt]);

    const retry = useCallback(() => {
        setRequest((current) => ({ ...current, error: null, isLoading: true }));
        setAttempt((n) => n + 1);
    }, []);

    const { catalog, error, isLoading } = request;

    const heldNames = held ?? new Set<string>();

    // Grouped by the catalog's own family order, so the page reads the way the
    // policy document does.
    const families = (catalog?.families ?? [])
        .map((family) => ({
            family: family.family,
            entries: family.permissions
                .filter((name) => heldNames.has(name))
                .map((name) => catalog?.permissions.find((entry) => entry.name === name))
                .filter((entry): entry is PermissionCatalogEntry => Boolean(entry)),
        }))
        .filter((family) => family.entries.length > 0);

    const heldUnrouted = [...heldNames].filter((name) => UNROUTED.has(name));

    /**
     * Anything the server granted that this build has never heard of.
     *
     * Not an error — adding a permission is an additive, non-breaking backend
     * change, and the client tolerates it by design. Surfacing it is how a
     * newer service becomes visible instead of silently ignored.
     */
    const unknownToThisBuild = [...heldNames].filter(
        (name) => !(PERMISSION_NAMES as readonly string[]).includes(name),
    );

    return (
        <PageContainer
            title="Your access"
            description={`${tierLabel ? `${tierLabel} · ` : ''}${heldNames.size} of ${
                catalog?.total ?? PERMISSION_NAMES.length
            } permissions, resolved by the server for your level on every request.`}
            actions={
                <>
                    {tier ? <TierBadge tier={tier} /> : null}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void reload()}
                        disabled={permissionsStatus === 'loading'}
                    >
                        <RotateCw className="size-4" />
                        Re-check
                    </Button>
                </>
            }
        >
            {heldUnrouted.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {heldUnrouted.length} of these have no screen yet
                        </CardTitle>
                        <CardDescription>
                            They are decided policy, not oversights — the service catalogues a
                            permission before the endpoint that serves it exists. Holding one does
                            not mean there is anywhere to use it.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                        {heldUnrouted.map((name) => (
                            <Badge key={name} variant="secondary" className="font-mono text-[11px]">
                                {name}
                            </Badge>
                        ))}
                    </CardContent>
                </Card>
            ) : null}

            {unknownToThisBuild.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Newer than this dashboard</CardTitle>
                        <CardDescription>
                            The service granted permissions this build does not know about. That is
                            expected — the catalogue grows — but the screens for them are not here.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                        {unknownToThisBuild.map((name) => (
                            <Badge key={name} variant="secondary" className="font-mono text-[11px]">
                                {name}
                            </Badge>
                        ))}
                    </CardContent>
                </Card>
            ) : null}

            <DataState
                isLoading={isLoading}
                error={error}
                isEmpty={families.length === 0}
                onRetry={retry}
                loading={<ListSkeleton />}
            >
                <div className="space-y-6">
                    {families.map(({ family, entries }) => (
                        <section key={family} className="space-y-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                                <ShieldCheck className="text-muted-foreground size-4" />
                                <span className="font-mono">{family}</span>
                                <span className="text-muted-foreground font-sans font-normal">
                                    ({entries.length})
                                </span>
                            </h3>

                            <ul className="border-border divide-border divide-y rounded-lg border">
                                {entries.map((entry) => (
                                    <li
                                        key={entry.name}
                                        className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                                    >
                                        <div className="min-w-0 space-y-0.5">
                                            <p className="font-mono text-xs break-all">
                                                {entry.name}
                                                {UNROUTED.has(entry.name) ? (
                                                    <span className="text-muted-foreground ml-2 font-sans">
                                                        no screen yet
                                                    </span>
                                                ) : null}
                                            </p>
                                            <p className="text-muted-foreground text-sm">
                                                {entry.summary}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                                            {/* Rendered raw, never switched on — a new action
                                                value is an additive backend change. */}
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] font-normal"
                                            >
                                                {entry.action}
                                            </Badge>
                                            <Flags entry={entry} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            </DataState>
        </PageContainer>
    );
}
