import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, GitCompareArrows } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    listingContactFieldLabel,
    listingReviewStateLabel,
    listingStatusLabel,
    listingSuspensionLabel,
} from '@/types/listings.types';

/**
 * The small, shared pieces of the listing screens.
 *
 * Every vocabulary is open: an unknown status or field renders through the
 * label functions, which print it in words rather than throwing.
 */

const tone = {
    good: 'border-success/30 bg-success/10 text-success',
    wait: 'border-warning/40 bg-warning/10 text-warning',
    bad: 'border-destructive/30 bg-destructive/10 text-destructive',
    quiet: 'text-muted-foreground',
} as const;

const STATUS_TONE: Record<string, keyof typeof tone> = {
    live: 'good',
    pending_review: 'wait',
    suspended: 'bad',
    rejected: 'bad',
    draft: 'quiet',
    archived: 'quiet',
};

/** Live · Waiting for review · Offline (with why) · Rejected · Draft · Archived. */
export function ListingStatusBadge({
    status,
    suspensionReason,
}: {
    status: string;
    suspensionReason?: string | null;
}) {
    const label =
        status === 'suspended' && suspensionReason
            ? `${listingStatusLabel(status)} · ${listingSuspensionLabel(suspensionReason)}`
            : listingStatusLabel(status);
    return (
        <Badge variant="outline" className={tone[STATUS_TONE[status] ?? 'quiet']}>
            {label}
        </Badge>
    );
}

/**
 * The review state, shown only when it says something the status does not:
 * a change waiting on a LIVE listing, or a rejected change. A new submission's
 * status already reads "Waiting for review".
 */
export function ListingReviewBadge({ status, reviewState }: { status: string; reviewState: string | null }) {
    if (!reviewState || reviewState === 'editing') return null;
    if (reviewState === 'pending_review' && status === 'pending_review') return null;
    if (reviewState === 'rejected' && status === 'rejected') return null;
    return (
        <Badge variant="outline" className={reviewState === 'rejected' ? tone.bad : tone.wait}>
            {reviewState === 'rejected' ? 'Change rejected' : `Change ${listingReviewStateLabel(reviewState).toLowerCase()}`}
        </Badge>
    );
}

/** "Change to a live listing" — the queue row is a revision, and the live copy stays up meanwhile. */
export function RevisionBadge() {
    return (
        <Badge variant="outline" className="gap-1">
            <GitCompareArrows className="size-3" aria-hidden />
            Change to a live listing
        </Badge>
    );
}

/** How many contacts the automatic check found in the public text. Nothing when none. */
export function PreflagCountBadge({ count }: { count: number }) {
    if (count <= 0) return null;
    return (
        <Badge variant="outline" className={cn('gap-1', tone.wait)}>
            <AlertTriangle className="size-3" aria-hidden />
            {count === 1 ? '1 contact found in the text' : `${count} contacts found in the text`}
        </Badge>
    );
}

/** The contact fields a listing has — names only, never values. */
export function ContactFieldChips({ fields, empty = 'None' }: { fields: readonly string[]; empty?: ReactNode }) {
    if (fields.length === 0) return <span className="text-muted-foreground text-sm">{empty}</span>;
    return (
        <span className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
                <Badge key={field} variant="secondary">
                    {listingContactFieldLabel(field)}
                </Badge>
            ))}
        </span>
    );
}

/**
 * `text` with every excerpt the automatic check found marked, so a reviewer's
 * eye lands on the contact slipped into the description. Case-insensitive;
 * an excerpt that is not in the text (it came from another field) marks nothing.
 */
export function HighlightedText({ text, excerpts }: { text: string; excerpts: readonly string[] }) {
    const needles = [...new Set(excerpts.map((e) => e.trim()).filter((e) => e.length >= 3))];
    if (needles.length === 0) return <>{text}</>;
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${needles.map(escape).join('|')})`, 'gi');
    const parts = text.split(pattern);
    return (
        <>
            {parts.map((part, index) =>
                index % 2 === 1 ? (
                    <mark key={index} className="bg-warning/25 text-foreground rounded px-0.5">
                        {part}
                    </mark>
                ) : (
                    <Fragment key={index}>{part}</Fragment>
                ),
            )}
        </>
    );
}

// ─── The rich description ─────────────────────────────────────────────────────

interface RichInline {
    type?: unknown;
    text?: unknown;
    href?: unknown;
    bold?: unknown;
    italic?: unknown;
    strike?: unknown;
}

interface RichBlock {
    type?: unknown;
    text?: unknown;
    ordered?: unknown;
    items?: unknown;
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * jovi-mall's rich description — paragraphs and flat lists of text and links.
 *
 * ⚠ **A link shows its ADDRESS, and it is not clickable.** The address is
 * exactly where a provider would hide a contact (`wa.me/…`, `mailto:…`), and a
 * reviewer who sees only the label "our page" approves it. So every link is
 * rendered as its label followed by its address in plain text.
 *
 * Tolerant by design: an unknown block or span type is skipped rather than
 * thrown on, and the caller falls back to the plain `description` when the
 * document is not one.
 */
export function RichDescription({ doc, excerpts = [] }: { doc: { blocks: unknown[] }; excerpts?: readonly string[] }) {
    const inline = (nodes: unknown, key: string) =>
        isArray(nodes)
            ? nodes.map((raw, index) => {
                  const node = (raw ?? {}) as RichInline;
                  const text = typeof node.text === 'string' ? node.text : '';
                  const className = cn(
                      node.bold === true && 'font-semibold',
                      node.italic === true && 'italic',
                      node.strike === true && 'line-through',
                  );
                  if (node.type === 'link') {
                      const href = typeof node.href === 'string' ? node.href : '';
                      return (
                          <span key={`${key}-${index}`} className={className}>
                              <span className="underline decoration-dotted">
                                  <HighlightedText text={text} excerpts={excerpts} />
                              </span>{' '}
                              <span className="text-muted-foreground font-mono text-xs break-all">
                                  (link to <HighlightedText text={href} excerpts={excerpts} />)
                              </span>
                          </span>
                      );
                  }
                  if (node.type !== 'text') return null;
                  return (
                      <span key={`${key}-${index}`} className={className}>
                          <HighlightedText text={text} excerpts={excerpts} />
                      </span>
                  );
              })
            : null;

    return (
        <div className="space-y-2 text-sm whitespace-pre-wrap">
            {doc.blocks.map((raw, index) => {
                const block = (raw ?? {}) as RichBlock;
                if (block.type === 'paragraph') return <p key={index}>{inline(block.text, `p${index}`)}</p>;
                if (block.type === 'list' && isArray(block.items)) {
                    const Tag = block.ordered === true ? 'ol' : 'ul';
                    return (
                        <Tag key={index} className={cn('space-y-1 pl-5', block.ordered === true ? 'list-decimal' : 'list-disc')}>
                            {block.items.map((item, itemIndex) => (
                                <li key={itemIndex}>{inline(item, `l${index}-${itemIndex}`)}</li>
                            ))}
                        </Tag>
                    );
                }
                return null;
            })}
        </div>
    );
}
