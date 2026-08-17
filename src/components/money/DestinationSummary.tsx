import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import type { PayoutDestination } from '@/types/money.types';

/**
 * Where a payout was addressed, as far as a masked endpoint will show it.
 *
 * ── Why there are no digits, and why that is not this component's doing ───────
 * On `/money/payouts`, `/money/payouts/:id` and the whole `/accounts` mount, the
 * masked account number is `null` — not `••••3456`. The query projection never
 * names the number columns, so the values do not leave the database on those
 * paths at all. Masking here would be a second lock in front of an empty room;
 * the real one is the projection.
 *
 * The consequence, which every caller should state near this component so nobody
 * reads it as a bug: **an operator recognises a destination by its provider and
 * account name** — "MTN · Nadège Mbarga" — never by its last four.
 *
 * ── The card is the exception, and it is not a disclosure ─────────────────────
 * `numberMasked` **is** populated for a card on every endpoint, because `last4`
 * is the entire number the platform holds. Rendering it discloses nothing.
 *
 * ── One renderer, two surfaces ────────────────────────────────────────────────
 * The payout queue and the account view show the same object, so they share this
 * rather than each growing a copy — two renderings of one destination could
 * disagree about whether an absent bank name is blank or missing.
 */
export function DestinationSummary({ destination }: { destination: PayoutDestination | null }) {
    if (!destination) {
        /*
         * A legacy row predating the snapshot carries no destination at all —
         * a different fact from a destination with no details, which is why the
         * sentence names the reason rather than saying "none".
         */
        return <NotSet>No destination on file</NotSet>;
    }

    const { mobileMoney, bank, card } = destination.masked;

    const label = mobileMoney
        ? [mobileMoney.provider, mobileMoney.accountName].filter(Boolean).join(' · ')
        : bank
          ? [bank.bankName, bank.accountName, bank.country].filter(Boolean).join(' · ')
          : card
            ? [card.brand, card.numberMasked, card.cardHolderName].filter(Boolean).join(' · ')
            : '';

    return (
        <span className="flex flex-wrap items-center gap-2">
            {/* Bounded string, not a pinned enum — rendered raw, never switched on. */}
            {destination.method ? (
                <Badge variant="outline">{destination.method.replace(/_/g, ' ')}</Badge>
            ) : null}
            {label || <NotSet>No detail recorded</NotSet>}
        </span>
    );
}
