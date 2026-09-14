import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FilterFieldProps {
    /**
     * The small title above the control. A `ReactNode` rather than a string so a
     * filter that needs one can put an `InfoHint` beside its name — several do,
     * and the alternative was a second wrapper at those call sites only.
     */
    label: ReactNode;
    /**
     * The control's DOM id, so the title is a real `<label>` rather than text
     * that happens to sit above a box.
     *
     * ⚠ **Pass it, and put the same id on the control.** A Radix `Select` needs
     * it on `SelectTrigger`, not on `Select`. Without it the title is decoration:
     * clicking it focuses nothing and a screen reader reads the trigger with
     * whatever `aria-label` it was given — which is why the ones that have an
     * `aria-label` keep it.
     */
    htmlFor?: string;
    className?: string;
    children: ReactNode;
}

/**
 * One filter — its title, and the control under it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The filter rows were built page by page and drifted into three shapes: a bare
 * `Select` carrying only an `aria-label` (Orders, Users, Vendors), a `Select`
 * under a `<Label>` inside a hand-rolled `space-y-1.5` wrapper (all of `/money`,
 * `/cod`, `/billing`), and a `<Label className="text-xs">` variant on one page.
 * Mixed inside one `FilterBar` they do not line up — the labelled controls sit a
 * label's height lower than the unlabelled ones — and the invisible half is
 * unreadable to anyone who has not learnt the screen, because "Any status" alone
 * does not say *which* status.
 *
 * So: **every filter is labelled, and every label is the same size**. The title
 * is muted and small so a row of them reads as a caption line rather than
 * competing with the page heading, and the control keeps the standard `h-9`.
 *
 * ── The alignment rule ───────────────────────────────────────────────────────
 * `FilterBar` aligns its children to the **top**, not the middle, and that is
 * what makes this work: every child opens with one line of label text at the
 * same size, so every control underneath starts at the same y. A filter that
 * has something extra to say (the date range's over-cap warning) grows
 * *downward* and disturbs nothing.
 */
export function FilterField({ label, htmlFor, className, children }: FilterFieldProps) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            {/*
              A fixed `h-5`, not an intrinsic height — that is what guarantees
              every control in the row starts at the same y. 20px rather than the
              16px the text alone needs, because several of these titles carry an
              `InfoHint`, whose button is `size-5`: at `h-4` the icon spilled out
              of its own line.
            */}
            <Label
                htmlFor={htmlFor}
                className="text-muted-foreground h-5 gap-1 text-xs leading-5 font-medium"
            >
                {label}
            </Label>
            {children}
        </div>
    );
}

/**
 * A filter-row child that has no title of its own — the "Clear filters" button.
 *
 * It occupies the label line with an empty box of exactly the label's height, so
 * the control below it starts on the same y as every labelled control beside it.
 * `aria-hidden` because there is nothing there to read.
 */
export function FilterFieldSpacer({
    className,
    children,
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <span className="h-5 text-xs leading-5" aria-hidden />
            {children}
        </div>
    );
}
