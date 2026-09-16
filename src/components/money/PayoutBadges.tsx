import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';
import { PAYOUT_ORIGIN_LABELS, type OwnerVerification } from '@/types/money.types';
import type { TriageStamp } from '@/types/triage.types';

/**
 * A payout's status — five of them since ADR-024.
 *
 * **A bounded string on the wire, not a pinned enum** — wi-admin writes against
 * none of jovi-mall's vocabularies. So the variant is chosen by lookup with a
 * neutral default and the value is always rendered raw: adding a member is an
 * additive, non-breaking change on the platform, and a closed `switch` would
 * break on a routine deploy. That open reading is what let `processing` and
 * `failed` arrive here without a crash; it is **not** what makes them read
 * correctly, which is the work below.
 *
 * ── ⛔ Why `failed` is not `destructive` ──────────────────────────────────────
 * `destructive` is this palette's "closed, and the money went back" — it is what
 * `rejected` wears. **A failed transfer has not returned anything** (ADR-024
 * D-7): the gateway refused it and the hold stayed exactly where it was, so the
 * request is still open and still needs a retry or a rejection. Dressing it like
 * `rejected` is the precise mistake the whole change warns about, and it would
 * be invisible — the badge would look deliberate. It wears the warning tone
 * instead, the same one an unvetted owner gets: *something needs your attention
 * and nothing has concluded*.
 *
 * ⚠ `processing` is `secondary` like `pending`, because it is the same
 * answer to "is this finished?" — no. It must never borrow `paid`'s `default`:
 * a 200 from `/send` does not mean the money arrived.
 */
const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    pending: 'secondary',
    processing: 'secondary',
    paid: 'default',
    rejected: 'destructive',
};

/**
 * The statuses drawn in the warning tone rather than by `variant`.
 *
 * Kept as a set beside the map instead of a third variant on the primitive:
 * `badge.tsx` is generated shadcn output and the two existing warning treatments
 * in this module (here and `PayoutVerificationBadge`) are both className
 * overrides for the same reason.
 */
const WARNING_STATUSES = new Set(['failed']);

export function PayoutStatusBadge({ status }: { status: string | null | undefined }) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    const warning = WARNING_STATUSES.has(status as string);

    return (
        <Badge
            variant={warning ? 'outline' : (STATUS_VARIANTS[status as string] ?? 'outline')}
            className={
                warning
                    ? 'border-warning/40 bg-warning/10 text-warning capitalize'
                    : 'capitalize'
            }
        >
            {label}
        </Badge>
    );
}

/**
 * Who endorsed this request, if anybody has.
 *
 * ⛔ **Its absence is not a warning and must never be drawn as one.** A payout
 * nobody has endorsed is exactly as payable as one that has been (ADR-024 D-2),
 * so an empty pre-screen is an ordinary state, not a missing step — which is why
 * the caller renders nothing at all rather than a "not endorsed" badge. Drawing
 * attention to the absence is how a purely advisory field turns into a soft gate
 * that operators start treating as one.
 *
 * ⚠ **An endorsed payout is still `pending`.** This sits *beside* the status
 * badge, never instead of it: endorsement is a field, not a state (D-6).
 */
export function PayoutTriageBadge({ triage }: { triage: TriageStamp | null | undefined }) {
    if (!triage) return null;

    return (
        <Badge variant="outline" className="font-normal">
            {/* The role's own word, like every other vocabulary here. */}
            {humaniseEnum(triage.verdict) ?? 'Endorsed'}
        </Badge>
    );
}

/**
 * Who opened the request.
 *
 * The distinction is operational rather than cosmetic: `auto_threshold` means the
 * platform's daily sweep opened it once the available balance reached the payout
 * threshold, so nobody asked for it and there is no requester to query.
 */
export function PayoutOriginBadge({ origin }: { origin: string | null | undefined }) {
    const label = humaniseEnum(origin);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge variant="outline" className="font-normal">
            {PAYOUT_ORIGIN_LABELS[origin as string] ?? label}
        </Badge>
    );
}

/**
 * Has a human vetted the owner this money is going to? — BR-026 § 1.
 *
 * ── ⛔ Three things this must never become ───────────────────────────────────
 *
 * 1. **A gate.** It is information, not enforcement: the platform does not refuse
 *    an unverified owner's payout, and `PayoutsQueue`'s row actions are keyed on
 *    `status === 'pending'` alone and must stay that way. The reviewer decides.
 * 2. **A derivation.** The tone branches on `verification.verified` and nothing
 *    else — never on `verdict !== 'rejected'` (*never reviewed* is not approval,
 *    and on this platform that is most accounts) and never on the owner's
 *    `status`, which stopped meaning "vetted" on 2026-09-15.
 * 3. **A flattening.** The three roles do not share a vocabulary: vendor and
 *    agency default to `pending`, an agent to `unverified`, reaching `pending`
 *    only once documents are submitted. So the **role's own word is rendered**,
 *    because on an agent those two separate *nothing submitted* from *submitted,
 *    waiting* — the one thing that tells a reviewer whether to chase somebody.
 *
 * ── Why unverified is a warning here and neutral on a party screen ───────────
 * `AgencyVerificationBadge` draws the same fact neutrally, on purpose: on a
 * directory page being unvetted is a queue position, not a fault. On this screen
 * money is about to leave the platform against that owner, so the reviewer is
 * being asked to notice. Same fact, different question, different weight — and
 * the *reason* is why these are two components rather than one shared badge.
 */
export function PayoutVerificationBadge({
    verification,
}: {
    verification: OwnerVerification | null | undefined;
}) {
    /*
      Unlike the two badges above, a missing object is NOT rendered as a neutral
      "Unknown". The mapper defaults an unresolvable owner to
      `{ verified: false, verdict: 'unverified' }`, so an absent one means a stale
      client or a hand-built fixture — and the safe reading of "I do not know
      whether anybody vetted the account I am about to pay" is *not vetted*.
      Failing closed matches `verificationOf` on the service.
    */
    if (!verification) {
        return (
            <Badge variant="outline" className="font-normal">
                Not verified
            </Badge>
        );
    }

    const label = humaniseEnum(verification.verdict) ?? 'Unverified';

    return (
        <Badge
            variant={verification.verified ? 'default' : 'outline'}
            className={verification.verified ? 'capitalize' : 'border-warning/40 bg-warning/10 text-warning capitalize'}
        >
            {label}
        </Badge>
    );
}
