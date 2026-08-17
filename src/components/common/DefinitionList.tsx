import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A label/value grid, for the read-only blocks a detail screen is made of.
 *
 * Extracted in Phase 7 because the vendor detail renders eight of them and
 * `UserDetail` had already hand-written the same `<dl className="grid …">` twice.
 * A real `<dl>` rather than a two-column div: the pairing is the semantics, and a
 * screen reader announces "Status, active" instead of two unrelated strings.
 *
 * It renders values, not data. Formatting, `null` handling and the choice of
 * fallback stay at the call site, because "—" and "Not set" and "Does not apply"
 * are three different statements and only the caller knows which is true.
 */
export function DefinitionList({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]', className)}>
            {children}
        </dl>
    );
}

/**
 * One pair.
 *
 * `hint` folds an explanation into the label rather than adding a helper
 * paragraph under every row — the same reason `LabelWithHint` exists for forms.
 */
export function Definition({
    label,
    children,
    hint,
}: {
    label: ReactNode;
    children: ReactNode;
    hint?: ReactNode;
}) {
    return (
        <>
            <dt className="text-muted-foreground flex items-center gap-1">
                {label}
                {hint}
            </dt>
            <dd className="min-w-0 break-words">{children}</dd>
        </>
    );
}

/**
 * A value the record does not have.
 *
 * Distinct from "we did not load it": on this service a field that exists is
 * always present and absent data is `null`, never omitted and never `''`. So
 * `null` is a fact about the record, and saying so reports it rather than leaving
 * a blank that reads as a rendering bug.
 */
export function NotSet({ children = 'Not set' }: { children?: ReactNode }) {
    return <span className="text-muted-foreground">{children}</span>;
}

/**
 * A field that **does not apply to this kind of owner**.
 *
 * The distinction `/accounts` spends a mechanism on: `null` means the question
 * makes no sense here, `0` means it applies and is currently empty. A vendor's
 * COD balance is the first; a settled agent's is the second. Rendering both as
 * "0" would say *owes nothing* where the truth is *cannot owe*.
 */
export function NotApplicable({ children = 'Does not apply' }: { children?: ReactNode }) {
    return <span className="text-muted-foreground italic">{children}</span>;
}
