import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { FilterField } from '@/components/common/FilterField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SearchInputProps {
    /** The committed value — from the URL, not from the keystroke. */
    value: string;
    /** Called after the debounce, with the trimmed term or `''`. */
    onChange: (value: string) => void;
    /**
     * The visible title above the box, and the control's accessible name.
     *
     * ⚠ **It is rendered**, not just announced. It used to be an `aria-label`
     * and nothing else, which left the box's whole meaning invisible — a filter
     * row with four of these (the ticket list has four) was four identical
     * boxes, and the placeholder is a hint about *format*, not about which
     * field is being searched.
     */
    label: string;
    placeholder?: string;
    /** Milliseconds of quiet before committing. */
    delay?: number;
    /**
     * The service trims and bounds `?search=` at 1–120 characters and answers a
     * `400` outside that. Bounded here so a paste of a whole email thread is a
     * full input rather than a round-trip failure.
     */
    maxLength?: number;
    className?: string;
}

/**
 * A search box that commits on a pause, not on every keystroke.
 *
 * ── Why the local copy ────────────────────────────────────────────────────────
 * The committed value lives in the URL, and writing the URL on every keystroke
 * would put one history entry per character behind the back button and fire one
 * request per character in front of it. So the input holds its own text and
 * reports upward after a pause; the call site writes the URL with `replace` so
 * the back button steps through filter *decisions* rather than typing.
 *
 * ── The empty-string rule ─────────────────────────────────────────────────────
 * **`?search=` with no value is rejected, not treated as "no filter"** — an empty
 * term is a `400`. Clearing the box therefore has to mean *send no parameter*.
 * That is handled for free by `buildQuery` in `lib/query.ts`, which drops empty
 * strings, and by `useListQueryState`, which deletes a key set to `''`. This
 * component only has to report `''` honestly rather than swallowing it.
 */
export function SearchInput({
    value,
    onChange,
    label,
    placeholder,
    delay = 300,
    maxLength = 120,
    className,
}: SearchInputProps) {
    /**
     * What the person has typed since the last committed value, or `null` when
     * they have typed nothing since — in which case the prop is what shows.
     *
     * **Derived, not synchronised.** The alternative shape — mirroring `value`
     * into state and reconciling the two — needs a rule for "did this change come
     * from me or from outside?", and every spelling of that rule is either an
     * effect that runs after paint or a ref written during render. Falling back to
     * the prop needs no such rule: a change from either direction lands the same
     * way, because after a commit the prop *is* what was typed.
     */
    const [draft, setDraft] = useState<string | null>(null);
    const text = draft ?? value;

    /**
     * A latest-ref rather than a dependency, so the timer effect below does not
     * restart when a call site passes an inline arrow — the same trap
     * `useAsyncData` documents at length.
     */
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });

    /**
     * Hand authority back to the prop whenever it moves.
     *
     * Covers both directions at once: this component's own commit coming back
     * round through the URL, and a change nobody here made — "Clear filters", a
     * back navigation, a pasted link. Adjusted **during render**, which React
     * documents as the way to reset state when a prop changes: it re-renders
     * before anything paints, so there is no flash of the stale term.
     */
    const [seen, setSeen] = useState(value);
    if (seen !== value) {
        setSeen(value);
        setDraft(null);
    }

    useEffect(() => {
        const trimmed = text.trim();
        if (trimmed === value) return;

        const timer = setTimeout(() => onChangeRef.current(trimmed), delay);
        return () => clearTimeout(timer);
    }, [text, value, delay]);

    /*
      A generated id rather than one derived from the label: `TicketsList`
      renders four of these on one screen and `SystemErrors` two, and two
      filters whose labels slugged to the same string would produce two
      `<label for>` pointing at one box.
    */
    const inputId = useId();

    return (
        <FilterField label={label} htmlFor={inputId} className={className}>
            <div className="relative w-full sm:w-72">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                    id={inputId}
                    type="search"
                    placeholder={placeholder}
                    value={text}
                    maxLength={maxLength}
                    onChange={(event) => setDraft(event.target.value)}
                    className="pr-8 pl-8"
                />
                {text.length > 0 ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Clear ${label.toLowerCase()}`}
                        className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
                        onClick={() => {
                            // Commits at once rather than waiting out the debounce:
                            // pressing a control named "clear" is a decision, not
                            // typing that might continue.
                            setDraft('');
                            onChangeRef.current('');
                        }}
                    >
                        <X className="size-3.5" />
                    </Button>
                ) : null}
            </div>
        </FilterField>
    );
}
