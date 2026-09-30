import { FilterField } from '@/components/common/FilterField';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAggregatorNames } from '@/hooks/use-aggregator-names';

const ANY = 'any';

interface GatewayFilterProps {
    id: string;
    /** `''` for no filter. */
    value: string;
    /** `typing` is true for keystrokes in the text box, so the list can replace history rather than push. */
    onChange: (next: string | null, options: { typing: boolean }) => void;
}

/**
 * The `?gateway=` filter on the money lists.
 *
 * ── The options are never a constant ─────────────────────────────────────────
 * `gateway` became an open list on 2026-09-30: the aggregator is switched at runtime and Campay
 * will appear on new rows with no dashboard release. So a caller who may read
 * `GET /dev-tools/payments` gets a picker built from its `aggregators[]`, and everyone else — Admin
 * and Support, who read these lists and not that one — gets a text box.
 *
 * ⚠ **The text box upper-cases what is typed.** wi-admin matches `?gateway=` exactly and does not
 * validate it against a list, so `notchpay` returns an **empty page, not an error** — a filter
 * that looks applied and matches nothing. Every gateway value on the wire is upper-case.
 */
export function GatewayFilter({ id, value, onChange }: GatewayFilterProps) {
    const names = useAggregatorNames();

    if (!names) {
        return (
            <FilterField label="Gateway" htmlFor={id}>
                <Input
                    id={id}
                    className="w-[160px] uppercase"
                    maxLength={40}
                    placeholder="e.g. NOTCHPAY"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    onChange={(event) =>
                        onChange(event.target.value.trim().toUpperCase() || null, { typing: true })
                    }
                />
            </FilterField>
        );
    }

    // The current value is kept even when the catalogue no longer names it, so a shared link
    // still shows what it filters on.
    const options = value && !names.includes(value) ? [...names, value] : names;

    return (
        <FilterField label="Gateway" htmlFor={id}>
            <Select value={value || ANY} onValueChange={(next) => onChange(next === ANY ? null : next, { typing: false })}>
                <SelectTrigger id={id} className="w-[160px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ANY}>Any gateway</SelectItem>
                    {options.map((name) => (
                        <SelectItem key={name} value={name}>
                            {name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FilterField>
    );
}
