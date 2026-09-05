import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';

import { NotSet } from '@/components/common/DefinitionList';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClipboard } from '@/hooks/use-clipboard';
import { cn } from '@/lib/utils';

/**
 * What kind of value this is. It decides two things and nothing else: whether
 * the value may be shortened for display, and whether it reads as a machine
 * value.
 *
 * ⚠ It never decides that the value becomes a link. See the component note on
 * `mailto:` and `tel:`.
 */
export type CopyableVariant = 'id' | 'email' | 'phone' | 'plain';

interface CopyableValueBaseProps {
    /** The raw value. `null` renders as an explicit gap, not an empty box. */
    value: string | null | undefined;
    /**
     * What this names, for the copy button's accessible name — "Copy vendor ID",
     * "Copy contact email". Icon-only controls need one, and "Copy" alone is
     * useless on a row carrying six of these.
     */
    label: string;
    /** Makes the value itself a link. The copy button stays a button. */
    to?: string;
    /**
     * Render in mono. Defaults to `true` for `id` and `false` for the rest.
     *
     * Pass it where the default is wrong: an opaque tracking number or a gateway
     * reference is `plain` — it must survive whole, character for character —
     * but it is still a machine value and reads better in mono.
     */
    mono?: boolean;
    className?: string;
}

/**
 * `truncate` is offered on the `id` variant only, and the union is what enforces
 * it: `<CopyableValue variant="email" truncate />` does not compile. Shortening
 * an email or a phone number is not a preference this component holds an opinion
 * about — it is the thing the ask forbids, so the type refuses rather than the
 * runtime ignoring it quietly.
 */
export type CopyableValueProps = CopyableValueBaseProps &
    (
        | {
              variant?: 'id';
              /**
               * Shorten the middle for display, default on. The full value is
               * always in the `title` and is always what gets copied.
               */
              truncate?: boolean;
          }
        | { variant: Exclude<CopyableVariant, 'id'>; truncate?: never }
    );

/**
 * Head and tail, never a bare prefix.
 *
 * ObjectIds share a leading timestamp component, so two ids created in the same
 * second differ only near the end — `665f1c2a…` truncated from the left is the
 * same string for half the rows on a page. Keeping both ends makes two ids
 * distinguishable at a glance, which is the entire reason to show one.
 *
 * ⚠ This is the `id` variant's privilege and no other's. An email or a phone
 * number has no shared prefix and no redundant middle; shortening one hides it
 * and buys nothing.
 */
function shorten(value: string): string {
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * A value shown as a value: readable, selectable, copyable.
 *
 * The dashboard shows a lot of raw ids, and it has to — a 24-hex ObjectId is
 * what an operator pastes into a support ticket, a Mongo query or a colleague's
 * chat window, and for several records (gateway references, opaque payout and
 * booking ids, the earnings accounts directory) the API returns no name at all.
 * The complaint was never that ids are shown; it was that they are shown
 * *instead of* names, and that they cannot be copied. The same complaint covers
 * every phone number and email address on the service: an operator ringing a
 * vendor back retypes the number off the screen today.
 *
 * So this is the affordance for the value, and where a name exists it pairs with
 * the name rather than replacing it — `orderColumns` and `payoutColumns` already
 * show the shape: `name ?? id`.
 *
 * ── ⚠ No `mailto:`, and no `tel:` ─────────────────────────────────────────────
 * These are values with no redirect link, deliberately. Half of these renders
 * sit inside a table row that is itself a link, or inside the stretched link on
 * a notification row; handing a click somewhere else — a mail client, a dialler
 * — changes what the row does depending on which few pixels were hit. `to`
 * exists for the cases where the value genuinely *is* a link to somewhere in the
 * dashboard, and even then the copy button stays a button: it calls
 * `preventDefault()` and `stopPropagation()` so copying never navigates.
 *
 * ── The copy button is an enhancement, never the only route ───────────────────
 * The value stays rendered as text and stays selectable, because
 * `navigator.clipboard` is absent on any non-secure origin and rejects when the
 * document is not focused. A failed copy says so rather than silently doing
 * nothing; see `useClipboard`.
 */
export function CopyableValue(props: CopyableValueProps) {
    const { value, label, to, mono, className, variant = 'id' } = props;
    const { copy, copied, failed } = useClipboard();

    if (!value) return <NotSet />;

    // Only `id` shortens, and only `id` can be asked to. It defaults on there,
    // which is what the twenty-one `CopyableId` call sites already get.
    const shortened = variant === 'id' && props.truncate !== false;
    const isMono = mono ?? variant === 'id';

    const body = (
        <span
            className={cn(
                // `select-all` so one click takes the whole value — half an
                // ObjectId is worse than none, and a double-click stops at the
                // first non-word character, which is the `@` in an email and the
                // space or `+` in a phone number.
                'select-all',
                isMono && 'font-mono text-xs',
                // Nothing but an id is shortened, so a long email has to be
                // allowed to wrap: it can otherwise force a table column wider
                // than the page. Not `truncate`/`text-ellipsis` — CSS clipping
                // would be the same hiding this variant exists to refuse, only
                // with no `title` visible to make up for it.
                variant !== 'id' && 'min-w-0 break-words',
            )}
            // Always the whole value, however little of it is displayed — and it
            // is the whole value that gets copied, never what is on screen.
            title={value}
        >
            {shortened ? shorten(value) : value}
        </span>
    );

    return (
        <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
            {to ? (
                <Link to={to} className="min-w-0 hover:underline">
                    {body}
                </Link>
            ) : (
                body
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        // Names the subject, not the gesture: a row can carry
                        // several of these and "Copy" would name them all alike.
                        aria-label={copied ? `${label} copied` : `Copy ${label}`}
                        onClick={(event) => {
                            // These sit inside table rows and inside the stretched
                            // link on a notification row; without this the copy
                            // click navigates instead.
                            event.preventDefault();
                            event.stopPropagation();
                            void copy(value);
                        }}
                    >
                        {copied ? (
                            <Check className="text-success size-3" />
                        ) : (
                            <Copy className="size-3" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {/* The failure is named here too, for the pointer user who
                        is already hovering. The announcement below is what makes
                        it reach everyone else. */}
                    {failed ? 'Could not copy — select it instead' : copied ? 'Copied' : 'Copy'}
                </TooltipContent>
            </Tooltip>

            {/* ── ⚠ Why the failure is NOT only in the tooltip ─────────────────
                A Radix tooltip opens on hover, and this repository has already
                written down what that costs once — `InfoHint` is a Popover
                rather than a Tooltip *"because Radix tooltips never open on
                touch, so on mobile the copy would be unreachable"*. A refused
                copy reported only on hover has exactly that defect and one
                more: Radix suppresses re-opening on hover after a click on the
                trigger, so the operator who just pressed the button — the only
                person who needs this sentence — is the one least likely to see
                it.

                So the refusal is also announced. `role="status"` is polite, it
                fires only on the failing path, and it says the same thing the
                tooltip says: the value is on screen and selectable whatever the
                clipboard did. Copying is a convenience over selecting; it must
                never be the only way to get the value, and a failure it cannot
                report is indistinguishable from a broken button. */}
            {failed ? (
                <span role="status" className="sr-only">
                    Could not copy — select it instead
                </span>
            ) : null}
        </span>
    );
}
