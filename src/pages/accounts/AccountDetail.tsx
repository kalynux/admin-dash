import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';

import { AccountActivityPanel } from '@/components/accounts/AccountActivityPanel';
import { AccountCashLedgerPanel } from '@/components/accounts/AccountCashLedgerPanel';
import { AccountCreditsPanel } from '@/components/accounts/AccountCreditsPanel';
import { AccountPanel } from '@/components/accounts/AccountPanel';
import { AccountPayoutsPanel } from '@/components/accounts/AccountPayoutsPanel';
import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { resolveTimeZone } from '@/lib/datetime';
import {
    ACCOUNT_ACTIVITY_PERMISSIONS,
    ACCOUNT_CASH_LEDGER_PERMISSION,
    ACCOUNT_CREDITS_PERMISSION,
    ACCOUNT_PAYOUTS_PERMISSION,
    ACCOUNT_READ_PERMISSIONS,
} from '@/services/accounts.service';
import { useAdmin, useCan } from '@/store';
import {
    ACCOUNT_OWNER_TYPES,
    supportsCashLedger,
    type AccountOwnerType,
} from '@/types/accounts.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `/dashboard/accounts/:ownerType/:ownerId` — one party's financial position.
 *
 * ── Every tab is gated on the permission owning the data it carries ───────────
 * The mount composes rather than inventing an `accounts` family, and the
 * sub-routes narrow to one family each. So an administrator who may work the
 * payout queue but not see a COD position gets exactly that, on the same
 * account — and a tab that could only ever render a refusal is not shown at all.
 *
 * ── Why the params are validated before anything fetches ──────────────────────
 * `ownerType` is a pinned enum and `ownerId` a 24-hex id; a bad value is a `400`,
 * not an empty account. Checking here means a `platform` pasted into the URL
 * renders an explanation and fires no request, rather than spending a round trip
 * to be told what this screen already knows.
 *
 * ── Why the title does not carry the business name ────────────────────────────
 * The name arrives on `GET /accounts/:ownerType/:ownerId`, which needs all three
 * permissions. Lifting that read up here for a heading would mean a conditional
 * hook and a guaranteed `403` for anyone holding only, say, `money.payouts.read`.
 * The name appears on the Overview panel, where the read that knows it lives.
 */
export function AccountDetail() {
    const { ownerType = '', ownerId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const validType = (ACCOUNT_OWNER_TYPES as readonly string[]).includes(ownerType);
    const validId = OBJECT_ID.test(ownerId);

    if (!validType || !validId) {
        return (
            <PageContainer title="Account">
                <div className="space-y-4">
                    <EmptyState
                        title="That is not an account address"
                        description={
                            validType
                                ? 'An account id is a 24-character hexadecimal value.'
                                : `An account belongs to a vendor, an agency or an agent. The platform's own commission account is not one — it has no plan, no credit wallet and no cash liability, and lives under Money instead.`
                        }
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    return (
        <ResolvedAccount
            ownerType={ownerType as AccountOwnerType}
            ownerId={ownerId}
            timeZone={timeZone}
            can={can}
        />
    );
}

function ResolvedAccount({
    ownerType,
    ownerId,
    timeZone,
    can,
}: {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
    can: ReturnType<typeof useCan>;
}) {
    const canSeeOverview = can(ACCOUNT_READ_PERMISSIONS, 'all');
    const canSeeActivity = can(ACCOUNT_ACTIVITY_PERMISSIONS, 'all');
    const canSeePayouts = can(ACCOUNT_PAYOUTS_PERMISSION);
    const canSeeCredits = can(ACCOUNT_CREDITS_PERMISSION);
    /*
     * Two conditions, and they are different kinds of fact. The permission is
     * about this administrator; `supportsCashLedger` is about the route, which
     * accepts an agent and an agency only — a vendor is refused by the parameter
     * schema, so no value the server could send would make this tab meaningful.
     */
    const canSeeCashLedger =
        can(ACCOUNT_CASH_LEDGER_PERMISSION) && supportsCashLedger(ownerType);

    const tabs = [
        canSeeOverview && 'overview',
        canSeeActivity && 'activity',
        canSeePayouts && 'payouts',
        canSeeCredits && 'credits',
        canSeeCashLedger && 'cash-ledger',
    ].filter(Boolean) as string[];

    // The first tab this administrator may actually open, never a fixed default:
    // hard-coding 'overview' would land a payout-only operator on a blank panel.
    const [tab, setTab] = useState(tabs[0] ?? 'overview');

    return (
        <PageContainer
            title={`${ownerType.charAt(0).toUpperCase()}${ownerType.slice(1)} account`}
            // Still the id rather than the owner's name — see "Why the title
            // does not carry the business name" above; that reasoning is
            // unchanged. What changes is that it is now copyable, which is what
            // an operator actually wants a raw id *for*.
            description={<CopyableId value={ownerId} label="owner ID" truncate={false} />}
        >
            <div className="space-y-4">
                <BackLink />

                {tabs.length === 0 ? (
                    <EmptyState
                        icon={Lock}
                        title="Not available to you"
                        description="An account is composed of earnings, billing and cash-on-delivery data, each behind its own permission. You hold none of them, so there is nothing on this page to show."
                    />
                ) : (
                    <Tabs value={tab} onValueChange={setTab}>
                        <TabsList>
                            {canSeeOverview ? (
                                <TabsTrigger value="overview">Overview</TabsTrigger>
                            ) : null}
                            {canSeeActivity ? (
                                <TabsTrigger value="activity">Activity</TabsTrigger>
                            ) : null}
                            {canSeePayouts ? (
                                <TabsTrigger value="payouts">Payouts</TabsTrigger>
                            ) : null}
                            {canSeeCredits ? (
                                <TabsTrigger value="credits">Credits</TabsTrigger>
                            ) : null}
                            {canSeeCashLedger ? (
                                <TabsTrigger value="cash-ledger">Cash ledger</TabsTrigger>
                            ) : null}
                        </TabsList>

                        {canSeeOverview ? (
                            <TabsContent value="overview">
                                {/* Activity has its own tab here, so the panel omits it. */}
                                <AccountPanel
                                    ownerType={ownerType}
                                    ownerId={ownerId}
                                    timeZone={timeZone}
                                    showActivity={false}
                                />
                            </TabsContent>
                        ) : null}

                        {canSeeActivity ? (
                            <TabsContent value="activity">
                                <AccountActivityPanel
                                    ownerType={ownerType}
                                    ownerId={ownerId}
                                    timeZone={timeZone}
                                />
                            </TabsContent>
                        ) : null}

                        {canSeePayouts ? (
                            <TabsContent value="payouts">
                                <AccountPayoutsPanel
                                    ownerType={ownerType}
                                    ownerId={ownerId}
                                    timeZone={timeZone}
                                />
                            </TabsContent>
                        ) : null}

                        {canSeeCredits ? (
                            <TabsContent value="credits">
                                <AccountCreditsPanel
                                    ownerType={ownerType}
                                    ownerId={ownerId}
                                    timeZone={timeZone}
                                />
                            </TabsContent>
                        ) : null}

                        {canSeeCashLedger && supportsCashLedger(ownerType) ? (
                            <TabsContent value="cash-ledger">
                                <AccountCashLedgerPanel
                                    ownerType={ownerType}
                                    ownerId={ownerId}
                                    timeZone={timeZone}
                                    currency={null}
                                />
                            </TabsContent>
                        ) : null}
                    </Tabs>
                )}
            </div>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/accounts"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to accounts
        </Link>
    );
}
