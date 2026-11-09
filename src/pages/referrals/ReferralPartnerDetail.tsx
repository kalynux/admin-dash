import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft,
    Ban,
    Check,
    LockOpen,
    PauseCircle,
    PlayCircle,
    RotateCcw,
    Users,
    Wallet,
    X,
} from 'lucide-react';

import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { PartnerActionDialog } from '@/components/referrals/PartnerActionDialog';
import { PartnerTermsPanel } from '@/components/referrals/PartnerTermsPanel';
import {
    ReferralBalanceList,
    ReferralFrozenNotice,
    ReferralStatusBadge,
    ReferredPersonLink,
} from '@/components/referrals/ReferralBits';
import { CommissionWithheldNote, ReferralRewardsTable } from '@/components/referrals/ReferralRewardsTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listAuditEntries } from '@/services/audit.service';
import {
    getReferralPartner,
    listPartnerReferred,
    listPartnerRewards,
} from '@/services/referrals.service';
import { useAdmin, useCan } from '@/store';
import {
    referralPartnerName,
    REFERRAL_ACTIVITY_MAX_RANGE_DAYS,
    REFERRAL_PARTNER_AUDIT_ACTIONS,
    REFERRAL_PARTNER_AUDIT_ACTION_LABELS,
    REFERRAL_REWARD_STATUSES,
    REFERRAL_VERB_PERMISSION,
    REFERRED_CATEGORIES,
    referralCategoryLabel,
    referralChannelLabel,
    referralPartnerStatusLabel,
    referralPartnerVerbs,
    referralRewardStatusLabel,
    referredEarningLabel,
    type ReferralPartner,
    type ReferralPartnerVerb,
    type ReferralPartnerWriteResult,
    type ReferralStatusChange,
    type ReferredAccount,
    referralCommissionWithheld,
} from '@/types/referrals.types';

/**
 * One partner — `GET /referrals/partners/:partnerId` · `referrals.read`.
 *
 * Identity, status with its history, terms, balances, referred accounts, rewards,
 * and the verbs valid for the status. A verb appears only with **both** the status
 * (`referralPartnerVerbs`) and the permission (`REFERRAL_VERB_PERMISSION`).
 *
 * ⛔ **There is no way to change who referred whom, and nothing here offers one.**
 *
 * ⚠ **No payout destination appears here**: reading one is the audited act on the
 * payout queue, so this links there instead.
 */

const VERB_BUTTONS: Record<
    ReferralPartnerVerb,
    { label: string; icon: ReactNode; variant: 'default' | 'outline' | 'destructive' }
> = {
    approve: { label: 'Approve', icon: <Check className="size-4" />, variant: 'default' },
    reject: { label: 'Reject', icon: <X className="size-4" />, variant: 'destructive' },
    suspend: { label: 'Suspend', icon: <PauseCircle className="size-4" />, variant: 'outline' },
    reinstate: { label: 'Reinstate', icon: <PlayCircle className="size-4" />, variant: 'default' },
    terminate: { label: 'End partnership', icon: <Ban className="size-4" />, variant: 'destructive' },
    'allow-reapply': { label: 'Allow a new application', icon: <RotateCcw className="size-4" />, variant: 'outline' },
    'release-balance': { label: 'Release balance', icon: <LockOpen className="size-4" />, variant: 'outline' },
};

const LINKABLE_TABS = ['overview', 'referred', 'rewards', 'history'];

export function ReferralPartnerDetail() {
    const { partnerId = '' } = useParams();
    return <PartnerScreen key={partnerId} partnerId={partnerId} />;
}

function BackLink() {
    return (
        <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link to="/dashboard/referrals/partners">
                <ArrowLeft className="size-4" />
                All partners
            </Link>
        </Button>
    );
}

function PartnerScreen({ partnerId }: { partnerId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [searchParams] = useSearchParams();
    const [tab, setTab] = useState(() => {
        const requested = searchParams.get('tab');
        return requested && LINKABLE_TABS.includes(requested) ? requested : 'overview';
    });
    const [verb, setVerb] = useState<ReferralPartnerVerb | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    // A write's answer is newer than the read; the next read replaces it.
    const [fresh, setFresh] = useState<{ over: ReferralPartner | null; next: ReferralPartner } | null>(null);

    const partner = useAsyncData(`/referrals/partners/${partnerId}`, (signal) =>
        getReferralPartner(partnerId, { signal }),
    );

    if (partner.isLoading) {
        return (
            <PageContainer title="Partner">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const record = fresh && fresh.over === partner.data ? fresh.next : partner.data;

    if (!record) {
        return (
            <PageContainer title="Partner">
                <div className="space-y-4">
                    <ErrorState error={partner.error} onRetry={partner.reload} deniedTitle="No such partner" />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    function onWritten(write: ReferralPartnerWriteResult) {
        if (write.partner) setFresh({ over: partner.data, next: write.partner });
        else partner.reload();
        setReloadToken((current) => current + 1);
    }

    function onStale() {
        partner.reload();
        setReloadToken((current) => current + 1);
    }

    const verbs = referralPartnerVerbs(record).filter((name) => can(REFERRAL_VERB_PERMISSION[name]));
    const canSeeActivity = can('audit.read');

    return (
        <PageContainer
            title={referralPartnerName(record)}
            description={<CopyableId value={record.id} label="partner ID" truncate={false} />}
            actions={
                verbs.length > 0 ? (
                    <>
                        {verbs.map((name) => (
                            <Button
                                key={name}
                                size="sm"
                                variant={VERB_BUTTONS[name].variant}
                                onClick={() => setVerb(name)}
                            >
                                {VERB_BUTTONS[name].icon}
                                {VERB_BUTTONS[name].label}
                            </Button>
                        ))}
                    </>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                <ReferralFrozenNotice partner={record} canRelease={can('referrals.partners.balance')} />

                <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                    <div className="overflow-x-auto">
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="referred">
                                Referred accounts ({formatCount(record.referred.referred)})
                            </TabsTrigger>
                            <TabsTrigger value="rewards">Rewards</TabsTrigger>
                            <TabsTrigger value="history">Status history</TabsTrigger>
                            {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                        </TabsList>
                    </div>

                    <TabsContent value="overview" className="space-y-4">
                        <PartnerOverview partner={record} timeZone={timeZone} />
                        <PartnerTermsPanel partner={record} onWritten={onWritten} onStale={onStale} />
                    </TabsContent>

                    <TabsContent value="referred">
                        <ReferredPanel partner={record} timeZone={timeZone} />
                    </TabsContent>

                    <TabsContent value="rewards">
                        <PartnerRewardsPanel partnerId={record.id} timeZone={timeZone} />
                    </TabsContent>

                    <TabsContent value="history">
                        <StatusHistory history={record.history} timeZone={timeZone} />
                    </TabsContent>

                    {canSeeActivity ? (
                        <TabsContent value="activity">
                            <AuditActivityPanel
                                read={(query, options) =>
                                    listAuditEntries(
                                        { ...query, targetType: 'referral_partner', targetId: record.id },
                                        options,
                                    )
                                }
                                basePath={`/audit#referral_partner/${record.id}`}
                                actions={REFERRAL_PARTNER_AUDIT_ACTIONS}
                                actionLabels={REFERRAL_PARTNER_AUDIT_ACTION_LABELS}
                                maxRangeDays={REFERRAL_ACTIVITY_MAX_RANGE_DAYS}
                                timeZone={timeZone}
                                reloadToken={reloadToken}
                                caption="Administrative history for this partner"
                                emptyTitle="No administrator has acted on this partner"
                                emptyDescription="This feed records decisions, changed terms, released balances and written-off debt. What the partner did themselves is under Status history."
                            />
                        </TabsContent>
                    ) : null}
                </Tabs>
            </div>

            <PartnerActionDialog
                request={verb ? { verb, partner: record } : null}
                onClose={() => setVerb(null)}
                onWritten={onWritten}
                onStale={onStale}
            />
        </PageContainer>
    );
}

function PartnerOverview({ partner, timeZone }: { partner: ReferralPartner; timeZone: string }) {
    const can = useCan();
    const payouts = withQuery('/dashboard/money/payouts', {
        ownerType: 'referral_partner',
        ownerId: partner.id,
    });

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Identity and status</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Status">
                            <ReferralStatusBadge status={partner.status} />
                        </Definition>
                        {partner.statusReason ? (
                            <Definition label="Reason given to them">
                                <span className="whitespace-pre-wrap">{partner.statusReason}</span>
                            </Definition>
                        ) : null}
                        <Definition label="Code">
                            {partner.code ? (
                                <CopyableValue value={partner.code} label="referral code" variant="plain" />
                            ) : (
                                <NotSet>No code yet</NotSet>
                            )}
                        </Definition>
                        <Definition label="Account">
                            <CopyableValue
                                value={partner.userId}
                                label="user ID"
                                to={can('users.read') ? `/dashboard/users/${partner.userId}` : undefined}
                            />
                        </Definition>
                        <Definition label="Phone">
                            {partner.phone ? (
                                <CopyableValue value={partner.phone} label="phone" variant="phone" />
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Email">
                            {partner.email ? (
                                <CopyableValue value={partner.email} label="email" variant="email" />
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Applied as">
                            <span className="capitalize">{humaniseEnum(partner.appliedAsRole) ?? 'Unknown'}</span>
                        </Definition>
                        <Definition label="Applied">
                            {formatInstantInZone(partner.appliedAt, timeZone) ?? <NotSet />}
                        </Definition>
                        <Definition label="Accepted the terms">
                            {formatInstantInZone(partner.termsAcceptedAt, timeZone) ?? <NotSet />}
                        </Definition>
                        <Definition label="Approved">
                            {formatInstantInZone(partner.approvedAt, timeZone) ?? <NotSet>Not approved</NotSet>}
                        </Definition>
                        <Definition label="Why they applied">
                            {partner.motivation ? (
                                <span className="whitespace-pre-wrap">{partner.motivation}</span>
                            ) : (
                                <NotSet>They gave no reason</NotSet>
                            )}
                        </Definition>
                        {partner.status === 'rejected' || partner.status === 'terminated' ? (
                            <Definition label="May apply again">
                                {partner.canReapply ? 'Yes, an administrator allowed it' : 'No'}
                            </Definition>
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Balances</CardTitle>
                    <CardDescription>
                        {formatCount(partner.referred.referred)} referred{' '}
                        {partner.referred.referred === 1 ? 'account' : 'accounts'},{' '}
                        {formatCount(partner.referred.earning)} still earning.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ReferralBalanceList balances={partner.balances} />

                    {partner.balanceReleased ? (
                        <div className="bg-muted/40 rounded-md border p-3 text-sm">
                            <p className="font-medium">The balance was released for withdrawal</p>
                            <p className="text-muted-foreground">
                                {formatInstantInZone(partner.balanceReleased.at, timeZone)}
                                {partner.balanceReleased.by ? ` by ${partner.balanceReleased.by}` : ''}.
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{partner.balanceReleased.reason}</p>
                        </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                        {can('money.payouts.read') ? (
                            <Button asChild variant="outline" size="sm">
                                <Link to={payouts}>
                                    <Wallet className="size-4" />
                                    Their payout requests
                                </Link>
                            </Button>
                        ) : null}
                        {partner.balances.clawback > 0 && can('money.earnings.read') ? (
                            <Button asChild variant="outline" size="sm">
                                <Link to="/dashboard/money/clawbacks?ownerType=referral_partner">
                                    Partners’ refund debt
                                </Link>
                            </Button>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
        </>
    );
}

const PANEL_PAGE_SIZE = 20;
const ANY = 'any';

function ReferredPanel({ partner, timeZone }: { partner: ReferralPartner; timeZone: string }) {
    const [category, setCategory] = useState(ANY);
    const [page, setPage] = useState(1);
    const { currency } = partner.balances;

    const query = { category: category === ANY ? undefined : category, page, limit: PANEL_PAGE_SIZE };
    const list = useAsyncData(withQuery(`/referrals/partners/${partner.id}/referred`, { ...query }), (signal) =>
        listPartnerReferred(partner.id, query, { signal }),
    );
    const meta = list.data?.meta;

    const columns: Column<ReferredAccount>[] = [
        {
            id: 'person',
            header: 'Account',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    <ReferredPersonLink userId={row.userId} name={row.name} />
                    {row.phone ? <CopyableValue value={row.phone} label="phone" variant="phone" /> : null}
                </div>
            ),
        },
        {
            id: 'category',
            header: 'Signed up as',
            className: 'align-top',
            cell: (row) => referralCategoryLabel(row.category),
        },
        {
            id: 'how',
            header: 'How',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p>{referralChannelLabel(row.channel)}</p>
                    <p className="text-muted-foreground text-xs">{row.codeUsed}</p>
                </div>
            ),
        },
        {
            id: 'registeredAt',
            header: 'Registered',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.registeredAt, timeZone) ?? '—',
        },
        {
            id: 'earning',
            header: 'Earning',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p>{referredEarningLabel(row)}</p>
                    {row.expiresAt ? (
                        <p className="text-muted-foreground text-xs">
                            until {formatInstantInZone(row.expiresAt, timeZone)}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'totalEarned',
            header: 'Earned so far',
            numeric: true,
            className: 'align-top',
            cell: (row) => formatMoney(row.totalEarned, currency),
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Select
                    value={category}
                    onValueChange={(next) => {
                        setCategory(next);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-44" aria-label="Signed up as">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Every category</SelectItem>
                        {REFERRED_CATEGORIES.map((value) => (
                            <SelectItem key={value} value={value}>
                                {referralCategoryLabel(value)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">
                    Who referred whom is fixed when the account is created and cannot be changed.
                </p>
            </div>

            <DataTable
                caption="Accounts this partner referred"
                columns={columns}
                rows={list.data?.data ?? []}
                rowKey={(row) => row.id}
                isLoading={list.isLoading}
                isRefreshing={list.isRefreshing}
                error={list.error}
                onRetry={list.reload}
                empty={
                    <EmptyState
                        icon={Users}
                        title={category === ANY ? 'No referred accounts yet' : 'None in this category'}
                        description="An account appears here when it signs up with this partner’s code."
                    />
                }
            />
            {meta ? <Pager meta={meta} noun="accounts" isBusy={list.isRefreshing} onPageChange={setPage} /> : null}
        </div>
    );
}

function PartnerRewardsPanel({ partnerId, timeZone }: { partnerId: string; timeZone: string }) {
    const [status, setStatus] = useState(ANY);
    const [page, setPage] = useState(1);

    const query = { status: status === ANY ? undefined : status, page, limit: PANEL_PAGE_SIZE };
    const list = useAsyncData(withQuery(`/referrals/partners/${partnerId}/rewards`, { ...query }), (signal) =>
        listPartnerRewards(partnerId, query, { signal }),
    );
    const rows = list.data?.data ?? [];
    const meta = list.data?.meta;

    return (
        <div className="space-y-4">
            <Select
                value={status}
                onValueChange={(next) => {
                    setStatus(next);
                    setPage(1);
                }}
            >
                <SelectTrigger className="w-44" aria-label="Reward status">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ANY}>Any status</SelectItem>
                    {REFERRAL_REWARD_STATUSES.map((value) => (
                        <SelectItem key={value} value={value}>
                            {referralRewardStatusLabel(value)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {rows.some(referralCommissionWithheld) ? <CommissionWithheldNote /> : null}

            <ReferralRewardsTable
                caption="This partner’s rewards"
                rows={rows}
                timeZone={timeZone}
                showPartner={false}
                isLoading={list.isLoading}
                isRefreshing={list.isRefreshing}
                error={list.error}
                onRetry={list.reload}
                empty={
                    <EmptyState
                        icon={Wallet}
                        title={status === ANY ? 'No rewards yet' : 'None with this status'}
                        description="A reward appears when Wi-Mall earns a commission on an account this partner referred."
                    />
                }
            />
            {meta ? <Pager meta={meta} noun="rewards" isBusy={list.isRefreshing} onPageChange={setPage} /> : null}
        </div>
    );
}

/** Who made a change. `null` means no administrator did: the person themselves applying. */
function historyActor(change: ReferralStatusChange): string {
    if (change.by) return change.by;
    return change.to === 'pending' ? 'The applicant' : 'Not recorded';
}

function StatusHistory({ history, timeZone }: { history: ReferralStatusChange[]; timeZone: string }) {
    if (history.length === 0) {
        return <EmptyState title="No status changes recorded" description="This partner has no history yet." />;
    }
    // Newest first; the wire is chronological.
    const rows = [...history].reverse();
    return (
        <Card>
            <CardHeader>
                <CardDescription>
                    A reason on a rejection, suspension or termination was shown to the partner. Any other note was
                    for administrators.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ol className="space-y-3">
                    {rows.map((change, index) => (
                        <li key={`${change.at}-${index}`} className="border-b pb-3 text-sm last:border-b-0 last:pb-0">
                            <p className="font-medium">
                                {change.from ? `${referralPartnerStatusLabel(change.from)} → ` : ''}
                                {referralPartnerStatusLabel(change.to)}
                            </p>
                            <p className="text-muted-foreground">
                                {formatInstantInZone(change.at, timeZone)} · {historyActor(change)}
                            </p>
                            {change.reason ? <p className="mt-1 whitespace-pre-wrap">{change.reason}</p> : null}
                        </li>
                    ))}
                </ol>
            </CardContent>
        </Card>
    );
}
