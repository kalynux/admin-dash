import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { FilterField } from '@/components/common/FilterField';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/*
 * The two filter controls the Transactions bar needs and the shared set did not
 * have: "is any of" over a short closed list, and a typed value that waits for
 * the typing to stop.
 */

export interface MultiSelectOption {
    value: string;
    label: string;
    /** A heading drawn above the first option that carries it. */
    section?: string;
}

interface MultiSelectFilterProps {
    label: string;
    /** What the closed control says when nothing is chosen — "Any kind". */
    anyLabel: string;
    options: readonly MultiSelectOption[];
    value: readonly string[];
    onChange: (next: string[]) => void;
    className?: string;
}

/**
 * "Is any of": tick one value or several.
 *
 * For wi-admin's own closed vocabularies only — the query schema pins them, so a
 * picker cannot go stale into a filter that matches nothing while looking
 * applied. A change applies at once, like every select in a filter bar.
 */
export function MultiSelectFilter({
    label,
    anyLabel,
    options,
    value,
    onChange,
    className,
}: MultiSelectFilterProps) {
    const id = useId();
    const chosen = options.filter((option) => value.includes(option.value));

    const summary =
        chosen.length === 0
            ? anyLabel
            : chosen.length === 1
              ? chosen[0].label
              : `${chosen.length} selected`;

    function toggle(option: string, checked: boolean) {
        // Kept in the options' own order, so the address reads the same however it was built.
        const next = options
            .map((entry) => entry.value)
            .filter((entry) => (entry === option ? checked : value.includes(entry)));
        onChange(next);
    }

    return (
        <FilterField label={label}>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id={id}
                        // The visible label and the current choice, as one name: a
                        // `<label for>` alone would name this "Type" and hide the value.
                        aria-label={`${label}: ${summary}`}
                        variant="outline"
                        className={cn(
                            'h-9 w-[170px] justify-between px-3 font-normal',
                            chosen.length === 0 && 'text-muted-foreground',
                            className,
                        )}
                    >
                        <span className="truncate">{summary}</span>
                        <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                    <div role="group" aria-label={label} className="space-y-0.5">
                        {options.map((option, index) => {
                            const optionId = `${id}-${option.value}`;
                            const startsSection =
                                option.section && option.section !== options[index - 1]?.section;

                            return (
                                <div key={option.value}>
                                    {startsSection ? (
                                        <p className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                                            {option.section}
                                        </p>
                                    ) : null}
                                    <label
                                        htmlFor={optionId}
                                        className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                                    >
                                        <Checkbox
                                            id={optionId}
                                            checked={value.includes(option.value)}
                                            onCheckedChange={(checked) =>
                                                toggle(option.value, checked === true)
                                            }
                                        />
                                        {option.label}
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                    {chosen.length > 0 ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground mt-1 w-full justify-start"
                            onClick={() => onChange([])}
                        >
                            Clear
                        </Button>
                    ) : null}
                </PopoverContent>
            </Popover>
        </FilterField>
    );
}

interface TextFilterProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Why what is typed here was not sent. Announced, and tied to the input. */
    issue?: string;
    maxLength?: number;
    inputMode?: 'text' | 'decimal';
    /** Known values offered as suggestions. The box still takes anything. */
    suggestions?: readonly string[];
    mono?: boolean;
    className?: string;
    /** Milliseconds of quiet before the value is committed. */
    delay?: number;
}

/**
 * A typed filter that commits once the typing stops.
 *
 * Every committed value is a request — two of them here, the page and its
 * totals — so a keystroke must not be one. The draft is local; the committed
 * value is the address bar's, and a change from outside (Clear filters, back)
 * replaces the draft.
 */
export function TextFilter({
    label,
    value,
    onChange,
    placeholder,
    issue,
    maxLength = 128,
    inputMode = 'text',
    suggestions,
    mono = false,
    className,
    delay = 350,
}: TextFilterProps) {
    const id = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const text = draft ?? value;

    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });

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

    const listId = suggestions ? `${id}-suggestions` : undefined;
    const issueId = issue ? `${id}-issue` : undefined;

    return (
        <FilterField label={label} htmlFor={id}>
            <Input
                id={id}
                className={cn('w-[170px]', mono && 'font-mono text-xs', className)}
                value={text}
                placeholder={placeholder}
                maxLength={maxLength}
                inputMode={inputMode}
                autoComplete="off"
                spellCheck={false}
                list={listId}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issueId}
                onChange={(event) => setDraft(event.target.value)}
            />
            {suggestions ? (
                <datalist id={listId}>
                    {suggestions.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                    ))}
                </datalist>
            ) : null}
            {issue ? (
                <p id={issueId} role="status" className="text-destructive max-w-[170px] text-xs">
                    {issue}
                </p>
            ) : null}
        </FilterField>
    );
}
