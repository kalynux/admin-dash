import type { ReactNode } from 'react';
import { FilterX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilterBarProps {
    children: ReactNode;
    /** Shows the clear control. Compute it from the URL state, not from a guess. */
    isFiltered?: boolean;
    onClear?: () => void;
    className?: string;
}

/**
 * The row of controls above a list.
 *
 * A layout shell and nothing more — it owns no filter state and knows no
 * parameter names. Every list's filters differ, but the arrangement, the wrapping
 * behaviour and the "clear everything" affordance are the same, and that is the
 * part worth having once.
 *
 * **The clear control appears only when something is set.** A permanently visible
 * "Clear filters" on an unfiltered list is a button that does nothing, which
 * teaches people to ignore it.
 */
export function FilterBar({ children, isFiltered, onClear, className }: FilterBarProps) {
    return (
        <div className={cn('flex flex-wrap items-center gap-2', className)}>
            {children}

            {isFiltered && onClear ? (
                <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
                    <FilterX className="size-4" />
                    Clear filters
                </Button>
            ) : null}
        </div>
    );
}
