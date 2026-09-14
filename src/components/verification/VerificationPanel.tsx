import { useMemo, useState, type ReactNode } from 'react';
import { FileClock, Lock, RotateCw } from 'lucide-react';

import { ErrorState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { buildChecks, estimateVerdict } from '@/lib/verification-review';
import { cn } from '@/lib/utils';
import { getPartyVerification } from '@/services/verification.service';
import { ApiError } from '@/types/api.types';
import {
    isDraft,
    PLATFORM_CODE_KYC_SUBJECT_NOT_FOUND,
    type PartyVerification,
    type VerificationParty,
} from '@/types/verification.types';

import { VerificationChecklist } from './VerificationChecklist';

/**
 * The Verification tab — **the evidence, for anybody who may read the party.**
 *
 * ── Why this is a tab and not only a dialog ──────────────────────────────────
 * The read is gated on the ordinary `{vendors,agencies,agents}.read`, **not** on
 * the review permission, and `verification.md` says why in as many words:
 * *"Support holds `read`, answers 'why was my shop rejected' tickets, and cannot
 * answer one from a status alone."* A tier-3 administrator therefore may — and
 * needs to — see this, and cannot record a verdict. Putting the evidence only
 * inside the verdict dialog would have made the Support grant buy them nothing.
 *
 * So: the evidence lives here, behind the same permission the tab's own screen
 * already required, and the **verdict** is an affordance on top of it, behind
 * its own permission. One read serves both.
 *
 * ── ⚠ A draft is not a queue item ────────────────────────────────────────────
 * `submittedAt === null` means the applicant has not pressed submit. The panel
 * says so at the top and the estimate declines to grade it, because badging a
 * half-filled draft *evidence incomplete* is true and is not a finding — and it
 * invites a rejection for not having finished something nobody was asked to
 * review.
 *
 * ── ⚠ `KYC_SUBJECT_NOT_FOUND` is an absence, not a fault ─────────────────────
 * It arrives as a **platform code** on a delegated 404 and means *"no such
 * party, or an account in a state that has no verification record"*. The second
 * is ordinary — most accounts have never touched verification — so it renders as
 * "nothing submitted", never as an error banner.
 */
export function VerificationPanel({
    party,
    partyId,
    timeZone,
    /** Rendered under the header — the verdict affordance, when the caller may offer one. */
    actions,
    // No `children`: the verdict dialog needs the loaded record, so it is rendered
    // by `actions`, which is handed one.
}: {
    party: VerificationParty;
    partyId: string;
    timeZone: string;
    actions?: (record: PartyVerification | null, reload: () => void) => ReactNode;

}) {
    const [reloadToken, setReloadToken] = useState(0);

    const verification = useAsyncData(`/${party}/${partyId}/verification#${reloadToken}`, (signal) =>
        getPartyVerification(party, partyId, { signal }),
    );

    const record = verification.data ?? null;

    /*
      ⚠ The checklist is built from the *party*, not from `record.role`, so the
      right rows are on screen before the read resolves — and every one of them
      reports `unavailable` rather than `missing` until it does.
    */
    const checks = useMemo(() => buildChecks(party, record), [party, record]);
    const estimate = useMemo(() => estimateVerdict(checks, record), [checks, record]);

    function reload() {
        setReloadToken((current) => current + 1);
    }

    if (verification.isLoading) return <ListSkeleton rows={4} />;

    /*
      A 404 here — including the delegated `KYC_SUBJECT_NOT_FOUND` — is "this
      account has no verification record", which is the ordinary state of an
      account that never started one. Everything else is a real failure.
    */
    const notFound =
        verification.error instanceof ApiError &&
        (verification.error.isNotFound ||
            verification.error.platformCode === PLATFORM_CODE_KYC_SUBJECT_NOT_FOUND);

    if (verification.error && !notFound) {
        return <ErrorState error={verification.error} onRetry={reload} />;
    }

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <h2 className="text-sm font-medium">Identity verification</h2>
                    {notFound || !record ? (
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            This account has no verification record. Most accounts never start one
                            — it is not a fault, and there is nothing here to review.
                        </p>
                    ) : (
                        <RecordState record={record} timeZone={timeZone} />
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={reload}>
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    {actions?.(record, reload)}
                </div>
            </header>

            {record ? <VerificationChecklist checks={checks} estimate={estimate} /> : null}
        </div>
    );
}

/**
 * What the record is, in one line each.
 *
 * ⚠ **`submittedAt` is reported before `status`, and on purpose.** On a vendor
 * and an agency `pending` is also the schema default, so it means *"never
 * touched verification"* as well as *"waiting for you"* — the timestamp is the
 * field that separates them, which is the trap the contract spends a callout on.
 */
function RecordState({ record, timeZone }: { record: PartyVerification; timeZone: string }) {
    const draft = isDraft(record);

    return (
        <div className="space-y-1 text-xs">
            <p className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                    {record.status}
                </Badge>
                {draft ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                        <FileClock className="size-3.5" aria-hidden />
                        Draft — never submitted
                    </span>
                ) : (
                    <span className="text-muted-foreground">
                        Submitted {formatInstantInZone(record.submittedAt, timeZone)}
                    </span>
                )}
                {record.locked ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Lock className="size-3.5" aria-hidden />
                        Frozen while it stands
                    </span>
                ) : null}
            </p>

            {draft ? (
                <p className="text-muted-foreground max-w-prose leading-relaxed">
                    The applicant has not asked anybody to look at this yet, and can still change
                    it. Whatever is missing below is not yet a finding.
                </p>
            ) : null}

            {record.rejectionReason ? (
                <p className={cn('text-muted-foreground max-w-prose leading-relaxed')}>
                    Last reason given to them: &ldquo;{record.rejectionReason}&rdquo;
                </p>
            ) : null}
        </div>
    );
}
