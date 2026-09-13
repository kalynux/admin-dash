import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { AUTOMATION_WINDOW_HOURS_DEFAULT } from '@/types/automation.types';

/**
 * `windowHours` — offered as named spans rather than as a number box.
 *
 * The wire takes any integer from 1 to 720 and answers `400 VALIDATION_ERROR` outside it, with
 * **no clamping**. A free number field would put that refusal one keystroke away (`0`, `999`,
 * an empty box) on a screen somebody opens during an incident, and the extra reach buys
 * nothing an operator wants: the questions asked here are *"right now"*, *"this shift"*,
 * *"since yesterday"*, *"this week"* and *"the whole retention window"*.
 *
 * ⚠ **720 is the top and it is not arbitrary** — the rows carry a plain TTL
 * (`ADMIN_AUTOMATION_RETENTION_DAYS`, default 30), so a longer window would ask for data that
 * has already been deleted and answer `200` with a partial picture.
 */
export const AUTOMATION_WINDOW_OPTIONS = [
    { value: '1', label: 'Last hour' },
    { value: '6', label: 'Last 6 hours' },
    { value: `${AUTOMATION_WINDOW_HOURS_DEFAULT}`, label: 'Last 24 hours' },
    { value: '72', label: 'Last 3 days' },
    { value: '168', label: 'Last 7 days' },
    { value: '720', label: 'Last 30 days' },
] as const;

interface WindowHoursSelectProps {
    /** The URL's raw value. Empty means the endpoint's own default of 24 hours. */
    value: string;
    onChange: (next: string) => void;
}

export function WindowHoursSelect({ value, onChange }: WindowHoursSelectProps) {
    return (
        <Select
            value={value || `${AUTOMATION_WINDOW_HOURS_DEFAULT}`}
            onValueChange={onChange}
        >
            <SelectTrigger className="w-[150px]" aria-label="Window">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {AUTOMATION_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
