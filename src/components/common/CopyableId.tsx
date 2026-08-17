import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';

import { NotSet } from '@/components/common/DefinitionList';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClipboard } from '@/hooks/use-clipboard';
import { cn } from '@/lib/utils';

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
 * Head and tail, never a bare prefix.
 *
 * ObjectIds share a leading timestamp component, so two ids created in the same
 * second differ only near the end — `665f1c2a…` truncated from the left is the
 * same string for half the rows on a page. Keeping both ends makes two ids
 * distinguishable at a glance, which is the entire reason to show one.
 */
function shorten(value: string): string {
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * An identifier: readable, selectable, copyable.
 *
 * The dashboard shows a lot of raw ids, and it has to — a 24-hex ObjectId is
 * what an operator pastes into a support ticket, a Mongo query or a colleague's
 * chat window, and for several records (gateway references, opaque payout and
 * booking ids, the earnings accounts directory) the API returns no name at all.
 * The complaint was never that ids are shown; it was that they are shown
 * *instead of* names, and that they cannot be copied.
 *
 * So this is the affordance for the id, and it pairs with a name rather than
 * replacing one. Where a name exists, render the name as the primary text and
 * put this beside or beneath it — `orderColumns` and `payoutColumns` already
 * show the shape: `name ?? id`.
 *
 * ── The copy button is an enhancement, never the only route ───────────────────
 * The value stays rendered as text and stays selectable, because
 * `navigator.clipboard` is absent on any non-secure origin and rejects when the
 * document is not focused. A failed copy says so rather than silently doing
 * nothing; see `useClipboard`.
 */
export function CopyableId({ value, label, to, truncate = true, className }: CopyableIdProps) {
    const { copy, copied, failed } = useClipboard();

    if (!value) return <NotSet />;

    const shown = truncate ? shorten(value) : value;
    const body = (
        // `select-all` so one click takes the whole id — half an ObjectId is
        // worse than none, and double-click stops at the first non-word char.
        <span className="font-mono text-xs select-all" title={value}>
            {shown}
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
                    {/* The failure is reported, and it names the way out — the
                        value is on screen and selectable whatever the clipboard
                        did. */}
                    {failed ? 'Could not copy — select it instead' : copied ? 'Copied' : 'Copy'}
                </TooltipContent>
            </Tooltip>
        </span>
    );
}
