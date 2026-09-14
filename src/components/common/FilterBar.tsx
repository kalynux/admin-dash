import type { ReactNode } from 'react';
import { FilterX } from 'lucide-react';

import { FilterFieldSpacer } from '@/components/common/FilterField';
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
 *
 * ── ⚠ `items-start`, and it is load-bearing ──────────────────────────────────
 * This was `items-center` while some filters carried a visible title and some
 * did not, and the result was a row where nothing lined up: a labelled `Select`
 * is a label taller than a bare one, so centring put the two controls at
 * different heights and the eye had to re-find the row for every filter.
 *
 * Every child is now a `FilterField` — one line of title over one `h-9` control
 * — so aligning to the top puts every title on one line and every control on the
 * next. It also means a filter with something extra to say underneath (the date
 * range's over-cap warning) grows downward without dragging its neighbours' boxes
 * up, which centring did.
 *
 * The clear button is wrapped in a `FilterFieldSpacer` for the same reason: it
 * has no title, so it borrows the height of one.
 */
export function FilterBar({ children, isFiltered, onClear, className }: FilterBarProps) {
    return (
        <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-3', className)}>
            {children}

            {isFiltered && onClear ? (
                <FilterFieldSpacer>
                    <Button
                        variant="ghost"
                        onClick={onClear}
                        className="text-muted-foreground h-9"
                    >
                        <FilterX className="size-4" />
                        Clear filters
                    </Button>
                </FilterFieldSpacer>
            ) : null}
        </div>
    );
}
