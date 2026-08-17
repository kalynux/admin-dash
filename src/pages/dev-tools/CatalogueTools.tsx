import { useState } from 'react';
import { Boxes } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog } from '@/components/system/DestructiveActionDialog';
import { DevToolsDisabledNotice } from '@/components/system/DevToolsDisabledNotice';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { notify } from '@/lib/notify';
import { vectoriseCatalogue } from '@/services/dev-tools.service';
import { isDevToolsDisabled, type VectoriseResult } from '@/types/dev-tools.types';

/**
 * Rebuild every product's search vectors.
 *
 * ── The one tool with no pre-flight of any kind ──────────────────────────────
 * There is no `dryRun`, no count to read first, and no partial mode: it takes the whole
 * catalogue. Rather than inventing a check that would not mean anything, the dialog says so.
 *
 * ── Synchronous, and long ────────────────────────────────────────────────────
 * The request is awaited rather than fired and forgotten, so the response reports what actually
 * happened — a `202` would give an administrator no way to know whether it worked. That makes
 * this the one call in the dashboard that may legitimately run for minutes, so it is deliberately
 * not given an abort signal tied to the component's lifetime: navigating away must not look like
 * a rebuild that failed.
 */
export function CatalogueTools() {
    const { token } = useRefreshToken();
    const { devToolsEnabled } = useFeatureFlags(token);

    const [open, setOpen] = useState(false);
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [result, setResult] = useState<{ data: VectoriseResult; message?: string } | null>(null);

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const outcome = await vectoriseCatalogue();
            setResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Catalogue search vectors rebuilt');
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    return (
        <PageContainer
            title="Catalogue"
            description="Rebuild the search vectors behind product search."
        >
            {devToolsEnabled === false ? (
                <DevToolsDisabledNotice subject="a rebuild" />
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        Rebuild search vectors
                        <OperationBadge level="dangerous" />
                    </CardTitle>
                    <CardDescription>
                        Recomputes the search vector for <strong>every</strong> product in the
                        catalogue.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        This runs synchronously and can take minutes on a large catalogue. The
                        request waits for it, so leave this screen open — that is deliberate: a
                        fire-and-forget version would give you no way to know whether it worked.
                    </p>
                    <p className="text-muted-foreground text-xs">
                        It is the only tool here with nothing to check first. There is no dry run
                        and no partial mode, so the confirmation is the whole of the guard.
                    </p>
                    <Button
                        variant="outline"
                        onClick={() => {
                            setResult(null);
                            setError(null);
                            setOpen(true);
                        }}
                    >
                        <Boxes className="size-4" />
                        Rebuild now
                    </Button>
                </CardContent>
            </Card>

            <DestructiveActionDialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setResult(null);
                        setError(null);
                    }
                }}
                title="Rebuild every product's search vectors"
                description="Runs against the live catalogue and does not stop partway."
                level="dangerous"
                payloadKey="catalogue"
                preflight={{
                    label: 'Dry run',
                    run: async () => {},
                    state: null,
                    unavailable:
                        'There is nothing to check first: this endpoint has no dry run and no count to report, so the confirmation below is the whole of the guard.',
                }}
                confirmLabel="Rebuild the catalogue"
                onConfirm={submit}
                isBusy={isBusy}
                error={isDevToolsDisabled(error) ? undefined : error}
                result={
                    result ? (
                        <div className="space-y-2 text-sm">
                            <p>{result.message}</p>
                            <pre className="bg-muted/50 max-h-48 overflow-auto rounded p-2 text-xs">
                                {JSON.stringify(result.data, null, 2)}
                            </pre>
                        </div>
                    ) : isDevToolsDisabled(error) ? (
                        <DevToolsDisabledNotice subject="the rebuild" refused />
                    ) : undefined
                }
            />
        </PageContainer>
    );
}
