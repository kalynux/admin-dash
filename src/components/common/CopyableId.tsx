import { CopyableValue } from '@/components/common/CopyableValue';

interface CopyableIdProps {
    /** The raw identifier. `null` renders as an explicit gap, not an empty box. */
    value: string | null | undefined;
    /**
     * What this identifies, for the copy button's accessible name — "Copy vendor
     * ID". Icon-only controls need one, and "Copy" alone is useless on a screen
     * carrying six of these.
     */
    label: string;
    /** Makes the id itself a link. The copy button stays a button. */
    to?: string;
    /**
     * Shorten the middle for display. The full value is always in the `title`
     * and is always what gets copied.
     */
    truncate?: boolean;
    className?: string;
}

/**
 * An identifier: readable, selectable, copyable.
 *
 * This is `CopyableValue`'s `id` variant under its original name, and nothing
 * else — same props, same rendering, same head-and-tail shortening. It stays
 * because twenty-one files import it and an id is by far the commonest thing
 * this affordance is wanted for; renaming those call sites would be churn that
 * tells a reviewer nothing.
 *
 * ⚠ **New call sites should reach for `CopyableValue` directly**, and must where
 * the value is an email, a phone number or anything else that may not be
 * shortened — `CopyableId` truncates by default, because an id is the one kind
 * of value where that is the right answer. The reasoning for all of it lives in
 * [`CopyableValue`](./CopyableValue.tsx).
 */
export function CopyableId({ value, label, to, truncate = true, className }: CopyableIdProps) {
    return (
        <CopyableValue
            variant="id"
            value={value}
            label={label}
            to={to}
            truncate={truncate}
            className={className}
        />
    );
}
