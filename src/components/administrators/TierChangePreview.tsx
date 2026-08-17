import { useMemo } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useAsyncData } from '@/hooks/use-async-data';
import { fetchTierMatrix } from '@/services/permissions.service';
import { useCan } from '@/store';
import type { AdminTier } from '@/types/auth.types';

/**
 * What actually changes when a level moves.
 *
 * ── This is the whole of "assign permissions" on this service ─────────────────
 * There are **no per-administrator permission overrides and there never will
 * be**. `permissions.md`: *"This is the complete authorization policy. It is
 * static code, not data: there are no per-administrator overrides, no policy
 * collections, and nothing is editable at runtime."* A level is an
 * administrator's **entire** authorization state, so a tier change is the only
 * lever there is — and this panel is the only honest way to show what pulling it
 * does.
 *
 * ── The matrix comes from the endpoint, and from nowhere else ─────────────────
 * `GET /permissions/tiers` exists for this screen; its own documentation says
 * so. Hard-coding the permission *vocabulary* is correct and
 * `types/permissions.types.ts` does it — **hard-coding which level holds what is
 * not**, and there is deliberately no tier → permission table anywhere in
 * `src/`. In particular `TIER_1_PERMISSIONS` and friends in `src/test/fixtures.ts`
 * exist for tests and must never be imported by app code.
 *
 * ── It never blocks the change ────────────────────────────────────────────────
 * Gated on `permissions.read`, which Support does not hold — not because the
 * matrix is secret (*"none of this is secret… it is the difference between a
 * usable dashboard and a guessing game"*) but because Support has no screen that
 * renders it. Without the permission, while loading, or on any error, this
 * degrades to a sentence. The submit button is never disabled on its account:
 * the diff is an explanation, not a precondition.
 */
export function TierChangePreview({ fromTier, toTier }: { fromTier: AdminTier; toTier: AdminTier }) {
    const can = useCan();
    const mayRead = can('permissions.read');

    /*
     * Fetched here rather than on the detail screen: it is a 110 × 3 payload
     * that nobody needs until somebody is actually moving a level, and Radix
     * unmounts a closed dialog's content, so opening the dialog is what triggers
     * it. Safe under `useAsyncData` because it is an unaudited read of static
     * policy — unlike, say, revealing a payout destination.
     */
    const matrix = useAsyncData(mayRead ? '/permissions/tiers' : '', (signal) =>
        mayRead ? fetchTierMatrix({ signal }) : Promise.resolve(null),
    );

    const diff = useMemo(() => {
        const tiers = matrix.data?.tiers;
        if (!tiers) return null;

        const from = tiers.find((row) => row.tier === fromTier);
        const to = tiers.find((row) => row.tier === toTier);
        // A level the matrix does not describe is possible after an additive
        // deploy. Say nothing rather than guessing at a diff.
        if (!from || !to) return null;

        const held = new Set(from.permissions);
        const willHold = new Set(to.permissions);

        return {
            gained: to.permissions.filter((name) => !held.has(name)),
            lost: from.permissions.filter((name) => !willHold.has(name)),
            toLabel: to.label,
            toTotal: to.total,
        };
    }, [matrix.data, fromTier, toTier]);

    if (!diff) {
        return (
            <p className="text-muted-foreground bg-muted/40 rounded-md border p-3 text-xs leading-relaxed">
                A level is an administrator's entire authorization state — changing it replaces
                every permission they hold. There are no per-administrator overrides.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
                They would hold {diff.toTotal} permissions as {diff.toLabel}.
            </p>

            <PermissionDelta
                tone="gain"
                label={`Gains ${diff.gained.length} permission${diff.gained.length === 1 ? '' : 's'}`}
                names={diff.gained}
            />
            <PermissionDelta
                tone="loss"
                label={`Loses ${diff.lost.length} permission${diff.lost.length === 1 ? '' : 's'}`}
                names={diff.lost}
            />
        </div>
    );
}

function PermissionDelta({
    tone,
    label,
    names,
}: {
    tone: 'gain' | 'loss';
    label: string;
    names: readonly string[];
}) {
    if (names.length === 0) {
        return <p className="text-muted-foreground text-xs">{label}.</p>;
    }

    return (
        <Collapsible>
            <CollapsibleTrigger className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs">
                {tone === 'gain' ? (
                    <Plus className="text-success size-3.5 shrink-0" aria-hidden />
                ) : (
                    <Minus className="text-destructive size-3.5 shrink-0" aria-hidden />
                )}
                <span className="flex-1 font-medium">{label}</span>
                <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <ul className="text-muted-foreground max-h-48 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[11px]">
                    {/*
                      Rendered raw, and never filtered against `PERMISSION_NAMES`:
                      a name this build has never heard of is news, not noise.
                    */}
                    {names.map((name) => (
                        <li key={name}>{name}</li>
                    ))}
                </ul>
            </CollapsibleContent>
        </Collapsible>
    );
}
