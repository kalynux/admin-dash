import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { PayoutActivityPanel } from '@/components/money/PayoutActivityPanel';
import {
    PayoutOriginBadge,
    PayoutStatusBadge,
    PayoutTriageBadge,
    PayoutVerificationBadge,
} from '@/components/money/PayoutBadges';
import { PayoutDestinationReveal } from '@/components/money/PayoutDestinationReveal';
import {
    SendPayoutDialog,
    TriagePayoutDialog,
} from '@/components/money/PayoutTransferDialogs';
import {
    MarkPaidDialog,
    PayoutQueuedNotice,
    RejectPayoutDialog,
} from '@/components/money/PayoutWriteDialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { usePendingPermission } from '@/hooks/use-pending-permission';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { getPayout, PAYOUT_ACTIVITY_PERMISSIONS } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import type { Approval } from '@/types/approvals.types';
import { isPlatformActor } from '@/types/actor.types';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import { PERMISSION_MONEY_PAYOUTS_TRIAGE } from '@/types/permissions.pending';
import {
    canMarkPayoutPaid,
    canRejectPayout,
    isGatewaySendableDestination,
    isPayoutSendable,
    payoutHoldsFunds,
    type Payout,
} from '@/types/money.types';

/**
 * `GET /money/payouts/:payoutId` · `money.payouts.read`.
 *
 * The screen where money is released or refused, and the only place on this
 * dashboard that can disclose a beneficiary's account number.
 *
 * ── Why the write buttons check `status` as well as the permission ────────────
 * This departs from `OrderDetail`, which always offers its actions and lets the
 * platform re-evaluate. There, the guards are jovi-mall's and invisible from the
 * row; here the status is on the record this page is rendering and wi-admin
 * pre-flights it, so offering "Mark paid" on a payout the screen shows as *paid*
 * is nonsense. The `409` is still handled — somebody else can resolve it between
 * load and click.
 */
export function PayoutDetail() {
    const { payoutId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    /*
      Read here rather than beside the other capability checks below, which sit
      after this component's early returns — a hook called past a conditional
      `return` runs in a different order on the loading and loaded renders.
    */
    const canEndorse = usePendingPermission(PERMISSION_MONEY_PAYOUTS_TRIAGE);
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [reloadToken, setReloadToken] = useState(0);
    const [markPaidOpen, setMarkPaidOpen] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [endorseOpen, setEndorseOpen] = useState(false);
    const [queued, setQueued] = useState<{ approval: Approval; message?: string } | null>(null);
    const [activityAction, setActivityAction] = useState<string | undefined>(undefined);

    const payout = useAsyncData(`/money/payouts/${payoutId}`, (signal) =>
        getPayout(payoutId, { signal }),
    );

    /** Re-read the record and bump the feed, rather than merging a delegated write's answer. */
    function reconcile() {
        payout.reload();
        setReloadToken((token) => token + 1);
        setMarkPaidOpen(false);
        setRejectOpen(false);
        setEndorseOpen(false);
        /*
          ⚠ `sendOpen` is deliberately NOT closed here. The send dialog reconciles
          as soon as the transfer resolves and then keeps showing its outcome —
          "awaiting confirmation" or "the gateway refused it, the funds are still
          held" — which is the whole reason that dialog reports in place rather
          than through a toast. Closing it on reconcile would throw away the
          sentence the operator most needs to read.
        */
    }

    if (payout.isLoading) {
        return (
            <PageContainer title="Payout">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!payout.data) {
        return (
            <PageContainer title="Payout">
                <div className="space-y-4">
                    <ErrorState
                        error={payout.error}
                        onRetry={payout.reload}
                        deniedTitle="No such payout"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = payout.data;
    const canSeeActivity = can(PAYOUT_ACTIVITY_PERMISSIONS, 'all');

    /*
      ── Who may do what, ADR-024 § 4 ──────────────────────────────────────────

      ⛔ **Not one of these consults `record.triage`.** Endorsement is advisory: a
      payout nobody has endorsed is exactly as payable as one that has been (D-2),
      so letting it enter a control's enabled-ness would invert the whole design —
      the pre-screen exists to save the approver work, not to gate them.

      ⚠ **Reject reaches Support**, because `/reject` takes
      `anyPermission('money.payouts.reject', 'money.payouts.triage')` — it is the
      half of triage that actually closes a request. One Reject control, shown to
      both tiers; there is deliberately no separate "recommend rejection" flow.
    */
    const canPay = can('money.payouts.mark_paid');
    const mayReject = can('money.payouts.reject') || canEndorse;

    /*
      A gateway send needs the permission, a sendable status (`pending | failed`)
      and a destination the gateway can actually reach. The last of those fails
      OPEN — see `isGatewaySendableDestination` — so a wrong guess costs a
      handled 422 offering the manual path, never a hidden control.
    */
    const showSend =
        canPay && isPayoutSendable(record.status) && isGatewaySendableDestination(record.destination);

    /*
      ⚠ **`pending` only, and narrower than the lifecycle diagram in the brief.**
      wi-admin's manual pre-flight allows `['pending']` alone, so Mark-paid on a
      `failed` payout is a guaranteed `409 PAYOUT_NOT_PENDING` before the
      delegated call is even made — even though jovi-mall itself would accept it.
      Offering it there would walk an operator into a refusal they cannot act on.
    */
    const showMarkPaid = canPay && canMarkPayoutPaid(record.status);

    /*
      Reject stays on screen for every status that still holds the owner's money —
      including `processing`, where it is **disabled with a reason** rather than
      hidden. ⛔ `processing → rejected` is refused (D-7): releasing a hold while
      a transfer may still be in flight is how a payout goes out twice. An
      operator who finds the button simply missing learns nothing; one who presses
      it into a 409 learns it the hard way.
    */
    const showReject = mayReject && payoutHoldsFunds(record.status);
    const rejectAllowed = canRejectPayout(record.status);

    /* Endorsing is for an open request, and a request carries one endorsement. */
    const showEndorse = canEndorse && record.status === 'pending' && record.triage === null;

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Payout to ${record.owner.name ?? record.owner.type}`}
            actions={
                showEndorse || showReject || showSend || showMarkPaid ? (
                    <div className="flex flex-wrap gap-2">
                        {showEndorse ? (
                            <Button variant="outline" onClick={() => setEndorseOpen(true)}>
                                Endorse
                            </Button>
                        ) : null}
                        {showReject ? (
                            <Button
                                variant="outline"
                                onClick={() => setRejectOpen(true)}
                                disabled={!rejectAllowed}
                                // The reason travels with the disabled control —
                                // a disabled button with no explanation is the
                                // thing this is meant to avoid.
                                title={
                                    rejectAllowed
                                        ? undefined
                                        : 'Waiting for the provider to confirm this transfer'
                                }
                            >
                                Reject
                            </Button>
                        ) : null}
                        {showSend ? (
                            <Button onClick={() => setSendOpen(true)}>
                                {record.status === 'failed' ? 'Retry transfer' : 'Send'}
                            </Button>
                        ) : null}
                        {showMarkPaid ? (
                            <Button
                                variant={showSend ? 'outline' : 'default'}
                                onClick={() => setMarkPaidOpen(true)}
                            >
                                Mark paid
                            </Button>
                        ) : null}
                    </div>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                {queued ? (
                    <PayoutQueuedNotice
                        approval={queued.approval}
                        message={queued.message}
                        timeZone={timeZone}
                    />
                ) : null}

                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        {/* A tab that could only ever show a refusal is not rendered. */}
                        {canSeeActivity ? (
                            <TabsTrigger value="activity">Activity</TabsTrigger>
                        ) : null}
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                        <TransferStateNotice record={record} />
                        <RequestCard record={record} timeZone={timeZone} />

                        <PayoutDestinationReveal
                            payoutId={record.id}
                            destination={record.destination}
                            timeZone={timeZone}
                            onShowDisclosures={
                                canSeeActivity
                                    ? () => {
                                          setActivityAction('money.payouts.destination.read');
                                          setTab('activity');
                                      }
                                    : undefined
                            }
                        />

                        <ResolutionCard record={record} timeZone={timeZone} />
                    </TabsContent>

                    {canSeeActivity ? (
                        <TabsContent value="activity">
                            <PayoutActivityPanel
                                payoutId={record.id}
                                timeZone={timeZone}
                                reloadToken={reloadToken}
                                initialAction={activityAction}
                            />
                        </TabsContent>
                    ) : null}
                </Tabs>
            </div>

            {showMarkPaid ? (
                <MarkPaidDialog
                    payout={record}
                    open={markPaidOpen}
                    onOpenChange={setMarkPaidOpen}
                    onPaid={reconcile}
                    onQueued={(approval, message) => {
                        setQueued({ approval, message });
                        // Still reconcile: nothing was paid, so the payout must
                        // re-read as pending rather than look acted upon.
                        reconcile();
                    }}
                />
            ) : null}

            {/*
              ⚠ `|| sendOpen`, and it is load-bearing. `showSend` is derived from
              `record.status`, which `onSettled` has just refreshed — so a payout
              that went `pending → processing` stops being sendable the instant
              the transfer is accepted. Mounting on `showSend` alone would tear
              the dialog down exactly when it is showing "sent to the provider —
              awaiting confirmation", or the `failed` notice saying the funds are
              still held, leaving the operator with a dialog that vanished and no
              answer. Once open, it stays until they close it.
            */}
            {showSend || sendOpen ? (
                <SendPayoutDialog
                    payout={record}
                    open={sendOpen}
                    onOpenChange={setSendOpen}
                    onSettled={reconcile}
                    onQueued={(approval, message) => {
                        setQueued({ approval, message });
                        setSendOpen(false);
                        // ⚠ Nothing was SENT — reconcile so the row re-reads as
                        // pending rather than looking dispatched.
                        reconcile();
                    }}
                    onMarkPaidInstead={
                        /*
                          Offered only where it can succeed. A `422` says this
                          destination needs the manual path, but wi-admin's manual
                          pre-flight still takes `pending` alone — so on a `failed`
                          payout there is no manual path to hand them either, and a
                          button leading to a second refusal is worse than none.
                        */
                        canPay && canMarkPayoutPaid(record.status)
                            ? () => {
                                  setSendOpen(false);
                                  setMarkPaidOpen(true);
                              }
                            : undefined
                    }
                />
            ) : null}

            {showReject ? (
                <RejectPayoutDialog
                    payout={record}
                    open={rejectOpen}
                    onOpenChange={setRejectOpen}
                    onRejected={reconcile}
                />
            ) : null}

            {showEndorse ? (
                <TriagePayoutDialog
                    payout={record}
                    open={endorseOpen}
                    onOpenChange={setEndorseOpen}
                    onEndorsed={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}

/**
 * What a gateway transfer is doing, above everything else on the page.
 *
 * ⛔ **The sentence that matters on `failed` is that the funds are still held.**
 * A failed transfer has not returned anything (ADR-024 D-7) — the request is
 * still open and still needs a retry or a rejection — and an administrator
 * reading a red "failed" badge will assume the opposite unless told. It renders
 * above the request card for that reason.
 *
 * Nothing at all for the three statuses where no transfer is in play: a notice
 * that appears on every payout stops being read on the two where it matters.
 */
function TransferStateNotice({ record }: { record: Payout }) {
    if (record.status !== 'processing' && record.status !== 'failed') return null;

    const processing = record.status === 'processing';

    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">
                {processing
                    ? 'Sent to the provider — awaiting confirmation.'
                    : 'The gateway refused this transfer.'}
            </p>
            <p>
                {processing ? (
                    <>
                        The money has been handed to the payment gateway and{' '}
                        <strong>is not settled yet</strong>. It confirms by callback. This request
                        cannot be rejected while the transfer may still be in flight.
                    </>
                ) : (
                    <>
                        <strong>The funds are still held.</strong> Nothing has been returned to the
                        owner — retry the transfer, or reject the request to release the money back
                        to their available balance.
                    </>
                )}
            </p>
            {record.transferFailureReason ? (
                <p className="text-muted-foreground">
                    The provider said: {record.transferFailureReason}
                </p>
            ) : null}
            {record.transferGatewayRef ? (
                <p className="text-muted-foreground text-xs">
                    Provider reference:{' '}
                    <CopyableValue
                        value={record.transferGatewayRef}
                        label="gateway transfer reference"
                        truncate={false}
                    />
                </p>
            ) : null}
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/payouts"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to payouts
        </Link>
    );
}

function RequestCard({ record, timeZone }: { record: Payout; timeZone: string }) {
    const can = useCan();
    const { owner } = record;

    const directory =
        owner.type === 'vendor' && can('vendors.read') && owner.id
            ? `/dashboard/vendors/${owner.id}`
            : owner.type === 'agency' && can('agencies.read') && owner.id
              ? `/dashboard/agencies/${owner.id}`
              : owner.type === 'agent' && can('agents.read') && owner.id
                ? `/dashboard/agents/${owner.id}`
                : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Amount">
                        <span className="font-medium tabular-nums">
                            {formatMoney(record.amount, record.currency)}
                        </span>
                    </Definition>

                    <Definition label="Status">
                        <PayoutStatusBadge status={record.status} />
                    </Definition>

                    <Definition
                        label="Opened by"
                        hint={
                            <InfoHint label="About payout origin">
                                A request the owner made, versus one the platform opened
                                automatically once their available balance reached the payout
                                threshold — in which case nobody asked for it.
                            </InfoHint>
                        }
                    >
                        <PayoutOriginBadge origin={record.origin} />
                    </Definition>

                    <Definition label="Beneficiary">
                        <span className="flex flex-wrap items-center gap-2">
                            {directory ? (
                                <Link to={directory} className="font-medium hover:underline">
                                    {owner.name ?? owner.id}
                                </Link>
                            ) : (
                                <span className="font-medium">{owner.name ?? owner.id}</span>
                            )}
                            <span className="text-muted-foreground text-xs capitalize">
                                {owner.type}
                            </span>
                        </span>
                    </Definition>

                    {/*
                      ⚠ Beside the beneficiary, because it qualifies THEM — this is
                      "has a human vetted the business I am about to pay", and
                      `owner` being `active` stopped answering that on 2026-09-15.

                      ⚠ It is information, never a precondition. The mark-paid and
                      reject controls on this page are keyed on `status` alone and
                      must stay that way: the platform does not refuse an
                      unverified owner's payout, and disabling the button here
                      would invent an enforcement rule the service does not have.
                    */}
                    <Definition label="Owner vetted">
                        <PayoutVerificationBadge verification={record.verification} />
                    </Definition>

                    <Definition label="Their account">
                        {/*
                          The composed account view needs three permissions; this
                          screen needs one. The link is offered only where it
                          leads somewhere.
                        */}
                        {owner.id && can(ACCOUNT_READ_PERMISSIONS, 'all') ? (
                            <Link
                                to={`/dashboard/accounts/${owner.type}/${owner.id}`}
                                className="hover:underline"
                            >
                                Open the account
                            </Link>
                        ) : (
                            <NotSet>Not available to you</NotSet>
                        )}
                    </Definition>

                    <Definition label="Requested">
                        {formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}
                    </Definition>

                    {/*
                      ⚠ **Rendered only when somebody endorsed it.** The absence of
                      a review is an ordinary state, not a missing step: a payout
                      nobody has endorsed is exactly as payable as one that has
                      been (ADR-024 D-2). A "Not endorsed" row would put the
                      absence in front of the person about to release the money,
                      and an advisory field that is displayed like a checklist item
                      becomes a gate in practice however the API is written.
                    */}
                    {record.triage ? (
                        <Definition
                            label="Endorsed"
                            hint={
                                <InfoHint label="About endorsement">
                                    A reviewer has checked this request and believes it is genuine.
                                    It is advice, not an approval — it moves no money and is not
                                    required before releasing funds.
                                </InfoHint>
                            }
                        >
                            <div className="space-y-1">
                                <span className="flex flex-wrap items-center gap-2">
                                    <PayoutTriageBadge triage={record.triage} />
                                    <span className="text-muted-foreground text-xs">
                                        {record.triage.by.name ?? 'Administrator'}
                                        {record.triage.at
                                            ? ` · ${formatInstantInZone(record.triage.at, timeZone)}`
                                            : null}
                                    </span>
                                </span>
                                {record.triage.note ? (
                                    <p className="text-sm">{record.triage.note}</p>
                                ) : null}
                            </div>
                        </Definition>
                    ) : null}
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function ResolutionCard({ record, timeZone }: { record: Payout; timeZone: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Resolution</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Resolved">
                        {record.resolvedAt ? (
                            formatInstantInZone(record.resolvedAt, timeZone)
                        ) : (
                            /* Nobody has resolved it — not the same as unknown. */
                            <NotSet>Not resolved</NotSet>
                        )}
                    </Definition>

                    <Definition label="Resolved by">
                        {record.resolvedBy ? (
                            <span>
                                {record.resolvedBy.name ?? 'Not recorded'}
                                {!isPlatformActor(record.resolvedBy) ? (
                                    <span className="text-muted-foreground"> · administrator</span>
                                ) : null}
                            </span>
                        ) : (
                            <NotSet>Nobody yet</NotSet>
                        )}
                    </Definition>

                    <Definition label="Transfer reference">
                        {record.paidReference ?? <NotSet />}
                    </Definition>

                    <Definition label="Rejection reason">
                        {record.rejectionReason ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}
