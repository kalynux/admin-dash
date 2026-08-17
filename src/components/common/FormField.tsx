import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** What the field hands its control. Spread it: every key is load-bearing. */
export interface FieldControlProps {
    id: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
}

interface FormFieldProps {
    /**
     * The control's DOM id. The hint and the error derive theirs from it, so it
     * has to be unique on the page — prefix it with the dialog or screen when a
     * field name like `reason` appears more than once.
     */
    id: string;
    label: ReactNode;
    /**
     * Standing guidance — what to write, what the bounds are, what happens next.
     * Hidden while there is an error, because the error is the more urgent thing
     * to read and stacking both makes neither land.
     */
    hint?: ReactNode;
    /** The current message, from the resolver or from the server's field errors. */
    error?: string;
    /*
      There is deliberately no `required` marker.

      These forms already say it the other way round — a label reads "Note
      (optional)", "Reason (optional)" — and required is the default. Adding an
      asterisk would put two conventions on the same screen, each answering the
      same question, and a field with neither mark would then be ambiguous
      rather than merely unmarked.

      An asterisk is also a poor marker on its own: it carries no meaning to a
      screen reader unless it is `aria-hidden` and paired with `aria-required`,
      and paired with `aria-required` it is redundant with the resolver, which
      is what actually refuses an empty value and says so in words.
    */
    /**
     * Extra element ids to describe the control by, on top of the hint or error
     * this field renders itself.
     *
     * The escape hatch for the field that has a second thing to say — the new
     * password whose policy failures list beside its message. The caller renders
     * that element and owns its id; this only points at it. Space-separated, as
     * `aria-describedby` takes a list.
     */
    describedBy?: string;
    className?: string;
    /** The control. Spread the argument onto it. */
    children: (field: FieldControlProps) => ReactNode;
}

/**
 * A labelled control, its guidance, and its error — wired together.
 *
 * ── The bug this exists to make unwriteable ───────────────────────────────────
 * Every form on the console already marked its invalid controls `aria-invalid`
 * and rendered the message underneath in red. Neither of those tells assistive
 * technology **what** is wrong: `aria-invalid` says "this is rejected" and
 * stops, and the red paragraph is a sibling with no relationship to the input at
 * all. A screen reader user tabbing into a rejected field heard "Reason, edit,
 * invalid" — the fact of the refusal, never the reason for it — and the sentence
 * explaining it was five nodes away with nothing pointing at it.
 *
 * `aria-describedby` is the pointer. It has to name an element that exists,
 * which is why the ids are derived here rather than written per call site:
 * fifty-one hand-written pairs is fifty-one chances to typo one, and a dangling
 * `aria-describedby` fails silently.
 *
 * ── Why a render prop ─────────────────────────────────────────────────────────
 * The controls are not interchangeable — `Input`, `Textarea`, a Radix `Select`
 * trigger, an `InputOTP`, a bare `<select>` — and half of them also take
 * `{...register(name)}` from React Hook Form. Cloning a child to inject props
 * would fight both. Handing the props to the caller keeps the control the
 * caller's business and the wiring this component's.
 *
 * ```tsx
 * <FormField id="suspend-reason" label="Reason" error={errors.reason?.message}
 *            hint="Reinstating clears this from the account.">
 *     {(field) => <Textarea rows={3} {...field} {...register('reason')} />}
 * </FormField>
 * ```
 *
 * ── The error is announced twice, on purpose ──────────────────────────────────
 * `role="alert"` announces it **when it appears** — a submit that bounces is
 * otherwise silent for anyone not watching the pixels change.
 * `aria-describedby` announces it **on focus** — which is what a person who
 * tabbed back to fix it needs. They answer different moments; neither covers the
 * other.
 */
export function FormField({
    id,
    label,
    hint,
    error,
    describedBy: extraDescribedBy,
    className,
    children,
}: FormFieldProps) {
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    // The hint is replaced by the error, so only one of the two is ever in the
    // DOM — and pointing at the one that is not would be a dangling reference.
    const own = error ? errorId : hint ? hintId : undefined;
    const describedBy = [own, extraDescribedBy].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('space-y-2', className)}>
            <Label htmlFor={id}>{label}</Label>

            {children({
                id,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': describedBy,
            })}

            {error ? (
                <p id={errorId} role="alert" className="text-destructive text-xs">
                    {error}
                </p>
            ) : hint ? (
                <p id={hintId} className="text-muted-foreground text-xs">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
