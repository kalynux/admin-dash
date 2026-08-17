import type { ReactNode } from 'react';

import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/utils';

/**
 * The trailing actions cell of a table row.
 *
 * `DataTable` has no actions column of its own and needs none — a row action is
 * just a `{ id: 'actions', header: '', cell }` column, which `PlansList`,
 * `SystemWorkers`, `VendorProductsPanel` and `AgentContractsPanel` already
 * declare by hand. This is that cluster, so the six work queues do not each
 * invent their own spacing and alignment.
 *
 * **An inline cluster, not a dropdown.** There is no dropdown-menu affordance
 * for actions anywhere in this app — `ui/dropdown-menu` is used only by the
 * account menu and the theme and language toggles — so introducing one here
 * would be inventing a pattern for six screens. Queues carry one or two verbs;
 * two buttons are cheaper to reach than a menu that hides them.
 */
export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>
            {children}
        </div>
    );
}

/**
 * What to render where an action *cannot* succeed, whatever the caller holds.
 *
 * The case this exists for: a COD deposit whose `recipient` is `agency` — the
 * majority of rows — is refused by `assertConfirmer` with a `403` that no
 * permission changes, because only the party the cash was handed to may confirm
 * it. Rendering the button anyway would offer an action that always fails; and
 * rendering *nothing* would read as "you lack the permission", which is a
 * different and equally wrong message.
 *
 * So the affordance is withheld **and the reason is given** — the same rule the
 * detail screens already follow for this record.
 */
export function ActionWithheld({ reason, label }: { reason: ReactNode; label: string }) {
    return (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            {label}
            <InfoHint label={`Why ${label.toLowerCase()}`}>{reason}</InfoHint>
        </span>
    );
}
