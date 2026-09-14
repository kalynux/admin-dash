import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, LocateFixed } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    describeTimeZone,
    isKnownTimeZone,
    listTimeZones,
    searchTimeZones,
    timeZoneClock,
    timeZoneOffsetLabel,
    withZone,
} from '@/lib/timezones';
import { cn } from '@/lib/utils';

interface TimeZoneSelectProps {
    /** The current IANA name, or `''`. */
    value: string;
    onChange: (zone: string) => void;
    /** Spread `FormField`'s control props onto the trigger. */
    id?: string;
    'aria-invalid'?: true | undefined;
    'aria-describedby'?: string | undefined;
    disabled?: boolean;
    className?: string;
}

/**
 * Pick an IANA time zone by searching for it.
 *
 * ── What this replaces, and why a plain text box was wrong ───────────────────
 * The field was an `<Input placeholder="Africa/Douala">` beside a "Use this
 * device" button. The button covers the common case and the input covers
 * nothing: `Africa/Doula`, `WAT`, `GMT+1` and `Douala` are all things a person
 * reasonably types and none of them is a zone. The value decides **how every
 * date filter on this dashboard resolves a day**, so a plausible-looking wrong
 * one is not a cosmetic error — it silently shifts the boundaries of every
 * report the operator runs, by a day at the edges.
 *
 * ── Still not a closed enum ──────────────────────────────────────────────────
 * The vocabulary comes from the runtime (`listTimeZones`), not from a table in
 * this repository, and a stored value the runtime does not recognise is **kept
 * and shown at the top of the list** rather than dropped. The service takes any
 * 1–64 character string, so this narrows what is easy to do without narrowing
 * what is possible — and an operator on a browser too old for
 * `Intl.supportedValuesOf` still gets a working control.
 *
 * The offset and the local clock are rendered beside each name because they are
 * what the choice is actually checked against. A name alone does not tell you
 * whether you picked the right one.
 */
export function TimeZoneSelect({
    value,
    onChange,
    id,
    disabled,
    className,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
}: TimeZoneSelectProps) {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState('');

    const deviceZone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch {
            return '';
        }
    }, []);

    // `withZone` keeps an unrecognised saved value reachable; the search runs
    // over the same array so that value is findable by typing it too.
    const zones = useMemo(() => withZone(listTimeZones(), value), [value]);
    const results = useMemo(() => searchTimeZones(zones, term), [zones, term]);

    const offset = value ? timeZoneOffsetLabel(value) : null;
    const unresolvable = Boolean(value) && !isKnownTimeZone(value);

    function choose(zone: string) {
        onChange(zone);
        setOpen(false);
        setTerm('');
    }

    return (
        <Popover
            /*
              ⚠ `modal`, and it is not a style choice. Its only mount today is
              inside the profile `Dialog`, and a Radix `Dialog` traps focus: a
              non-modal popover portals its content outside the dialog's DOM, the
              trap pulls focus straight back out, and the search box cannot be
              typed in at all. A modal popover registers as its own layer, which
              is the arrangement Radix supports for this nesting.
            */
            modal
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                // Each open starts from the whole list. A term left over from
                // last time reads as "there are only three zones".
                if (!next) setTerm('');
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    // The trigger's content is the chosen zone, so without this
                    // the field name is never announced — see the same note on
                    // `DateRangeFilter`.
                    aria-label="Time zone"
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedBy}
                    disabled={disabled}
                    className={cn('w-full justify-between px-3 font-normal', className)}
                >
                    <span className="truncate">
                        {value ? (
                            <>
                                {value}
                                {offset ? (
                                    <span className="text-muted-foreground"> · {offset}</span>
                                ) : null}
                            </>
                        ) : (
                            <span className="text-muted-foreground">Choose a time zone</span>
                        )}
                    </span>
                    <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </Button>
            </PopoverTrigger>

            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
                align="start"
            >
                {/*
                  `shouldFilter={false}`: cmdk's own matcher scores every item on
                  every keystroke across ~400 zones and has no notion of a
                  prefix beating a substring, so `par` ranked `Europe/Paris`
                  below names that merely contain it. `searchTimeZones` does the
                  ranking and caps the rendered list.
                */}
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search city or region…"
                        value={term}
                        onValueChange={setTerm}
                    />
                    <CommandList>
                        <CommandEmpty>No zone matches that.</CommandEmpty>

                        {deviceZone ? (
                            <>
                                <CommandGroup>
                                    <CommandItem
                                        value={`__device__${deviceZone}`}
                                        onSelect={() => choose(deviceZone)}
                                    >
                                        <LocateFixed className="size-4" aria-hidden />
                                        <span className="flex-1 truncate">
                                            Use this device
                                            <span className="text-muted-foreground">
                                                {' '}
                                                — {deviceZone}
                                            </span>
                                        </span>
                                    </CommandItem>
                                </CommandGroup>
                                <CommandSeparator />
                            </>
                        ) : null}

                        <CommandGroup>
                            {results.map((zone) => {
                                const { region, city } = describeTimeZone(zone);
                                const zoneOffset = timeZoneOffsetLabel(zone);
                                const clock = timeZoneClock(zone);

                                return (
                                    <CommandItem
                                        key={zone}
                                        value={zone}
                                        onSelect={() => choose(zone)}
                                    >
                                        <Check
                                            className={cn(
                                                'size-4 shrink-0',
                                                zone === value ? 'opacity-100' : 'opacity-0',
                                            )}
                                            aria-hidden
                                        />
                                        <span className="min-w-0 flex-1 truncate">
                                            {city}
                                            {region ? (
                                                <span className="text-muted-foreground">
                                                    {' '}
                                                    — {region}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="text-muted-foreground shrink-0 tabular-nums">
                                            {clock ? `${clock} · ` : ''}
                                            {zoneOffset ?? 'unknown'}
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>

                {/*
                  A warning, never a refusal. A zone this browser cannot resolve
                  may still be one the service stores and another machine reads
                  perfectly — and refusing here would make the profile
                  uneditable on the wrong browser.
                */}
                {unresolvable ? (
                    <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                        This browser does not recognise <span className="font-mono">{value}</span>,
                        so dates on this device fall back to its own zone. Saved values are left
                        alone — pick a zone above only if you mean to change it.
                    </p>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}
