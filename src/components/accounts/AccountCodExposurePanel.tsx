import { Link } from 'react-router-dom';

import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { useCan } from '@/store';
import {
    ACCOUNT_EXPOSURE_LIMIT,
    type AccountOwnerType,
    type CodExposure,
} from '@/types/accounts.types';

/**
 * The COD contracts an owner is exposed through, and an agency's rolling reserve.
 *
 * ── Why this replaced a count ─────────────────────────────────────────────────
 * The account overview previously rendered this block as *"N contract(s)"*. The
 * payload carries the contracts themselves — outstanding balances in **both**
 * directions and each contract's ceiling — and a count discards exactly the
 * figures somebody opens this screen to see.
 *
 * ── `null` is a statement, and it is not zero ─────────────────────────────────
 * The whole block is `null` for a vendor, who has no COD exposure of any kind,
 * and `reserveHolds` is `null` for an agent, who has no rolling reserve. Both are
 * rendered as *does not apply* rather than as an empty table, which would read as
 * "none right now".
 *
 * The rendering branches on **the value**, never on `ownerType` — the owner kind
 * only chooses the sentence explaining a `null` the server actually sent. So an
 * agency that legitimately holds no contracts today still shows its empty state,
 * and a figure appearing where one used to be absent renders without an edit.
 */
export function AccountCodExposurePanel({
    exposure,
    ownerType,
    currency,
    timeZone,
}: {
    exposure: CodExposure | null;
    ownerType: AccountOwnerType;
    currency: string | null;
    timeZone: string;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Cash-on-delivery exposure
                    <InfoHint label="About COD exposure">
                        The contracts under which this party handles cash, and what is
                        outstanding on each. Two different debts appear here and they point in
                        opposite directions — cash owed onward, and fees owed back to the agent.
                    </InfoHint>
                </CardTitle>
            </CardHeader>

            <CardContent className="space-y-6">
                {exposure === null ? (
                    <p className="text-sm">
                        {/*
                          Worded to complement the balances card above rather than
                          repeat it: that one explains the absent cash balance,
                          this one explains the absent contracts.
                        */}
                        <NotApplicable>
                            {ownerType === 'vendor'
                                ? 'A vendor holds no cash-on-delivery contracts, so there is no exposure to report — which is not the same as an exposure of zero.'
                                : 'No cash-on-delivery exposure is reported for this account.'}
                        </NotApplicable>
                    </p>
                ) : (
                    <>
                        <ContractsSection
                            contracts={exposure.contracts}
                            currency={currency}
                            timeZone={timeZone}
                        />
                        <ReserveSection
                            holds={exposure.reserveHolds}
                            ownerType={ownerType}
                            timeZone={timeZone}
                        />
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function ContractsSection({
    contracts,
    currency,
    timeZone,
}: {
    contracts: CodExposure['contracts'];
    currency: string | null;
    timeZone: string;
}) {
    const can = useCan();

    if (contracts.length === 0) {
        return (
            <section className="space-y-2">
                <h3 className="text-sm font-medium">Contracts</h3>
                <p className="text-muted-foreground text-sm">
                    No cash-on-delivery contracts are recorded.
                </p>
            </section>
        );
    }

    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium">Contracts</h3>

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Counterparty</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Outstanding cash</TableHead>
                            <TableHead>Owed to agent</TableHead>
                            <TableHead>Ceiling</TableHead>
                            <TableHead>Last settled</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {contracts.map((contract) => (
                            <TableRow key={contract.contractId}>
                                <TableCell className="align-top">
                                    <div className="space-y-1">
                                        {can('agencies.read') ? (
                                            <Link
                                                to={`/dashboard/agencies/${contract.agencyId}`}
                                                className="text-sm font-medium hover:underline"
                                            >
                                                Agency
                                            </Link>
                                        ) : (
                                            <span className="text-sm font-medium">Agency</span>
                                        )}
                                        {can('agents.read') ? (
                                            <Link
                                                to={`/dashboard/agents/${contract.agentId}`}
                                                className="text-muted-foreground block text-xs hover:underline"
                                            >
                                                Agent
                                            </Link>
                                        ) : (
                                            <span className="text-muted-foreground block text-xs">
                                                Agent
                                            </span>
                                        )}
                                    </div>
                                </TableCell>

                                <TableCell className="align-top">
                                    <ContractStatusBadge status={contract.status} />
                                </TableCell>

                                <TableCell className="align-top tabular-nums">
                                    {contract.outstandingBalance === null ? (
                                        <NotSet />
                                    ) : (
                                        formatMoney(contract.outstandingBalance, currency)
                                    )}
                                </TableCell>

                                <TableCell className="align-top tabular-nums">
                                    {/* The other direction — fees the agency owes the agent. */}
                                    {contract.outstandingToAgent === null ? (
                                        <NotSet />
                                    ) : (
                                        formatMoney(contract.outstandingToAgent, currency)
                                    )}
                                </TableCell>

                                <TableCell className="align-top">
                                    <Threshold value={contract.maxThreshold} currency={currency} />
                                </TableCell>

                                <TableCell className="text-muted-foreground align-top text-sm">
                                    {formatInstantInZone(contract.lastSettledAt, timeZone) ?? (
                                        <NotSet>Never</NotSet>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {contracts.length >= ACCOUNT_EXPOSURE_LIMIT ? (
                /*
                 * A bound, not a page — there is no cursor to follow. Saying so
                 * keeps a truncated list from reading as a complete one.
                 */
                <p className="text-muted-foreground text-xs">
                    Showing the first {formatCount(ACCOUNT_EXPOSURE_LIMIT)} contracts. There may be
                    more.
                </p>
            ) : null}
        </section>
    );
}

/**
 * A contract's COD ceiling.
 *
 * **`0` blocks all COD rather than meaning "no limit"** — the single most
 * invertible value on this screen, so it is spelled out in words instead of
 * rendered as a bare zero somebody reads as "unlimited".
 */
function Threshold({ value, currency }: { value: number | null; currency: string | null }) {
    if (value === null) return <NotSet>Not set</NotSet>;

    if (value === 0) {
        return (
            <Badge variant="destructive" className="font-normal">
                0 — COD blocked
            </Badge>
        );
    }

    return <span className="tabular-nums">{formatMoney(value, currency)}</span>;
}

function ReserveSection({
    holds,
    ownerType,
    timeZone,
}: {
    holds: CodExposure['reserveHolds'];
    ownerType: AccountOwnerType;
    timeZone: string;
}) {
    return (
        <section className="space-y-2">
            <h3 className="flex items-center gap-1 text-sm font-medium">
                Rolling reserve
                <InfoHint label="About the rolling reserve">
                    Slices of an agency&rsquo;s earnings held back against cash it has not yet
                    remitted, released as each matures.
                </InfoHint>
            </h3>

            {holds === null ? (
                <p className="text-sm">
                    <NotApplicable>
                        {ownerType === 'agent'
                            ? 'An agent has no rolling reserve — the mechanism applies to agencies.'
                            : 'No rolling reserve applies to this account.'}
                    </NotApplicable>
                </p>
            ) : holds.length === 0 ? (
                <p className="text-muted-foreground text-sm">No reserve slices are held.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Amount</TableHead>
                                <TableHead>Held</TableHead>
                                <TableHead>Releases</TableHead>
                                <TableHead>State</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {holds.map((hold) => (
                                <TableRow key={hold.id}>
                                    <TableCell className="align-top tabular-nums">
                                        {formatMoney(hold.amount, hold.currency)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground align-top text-sm">
                                        {formatInstantInZone(hold.heldAt, timeZone) ?? '—'}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground align-top text-sm">
                                        {formatInstantInZone(hold.releaseAt, timeZone) ?? '—'}
                                    </TableCell>
                                    <TableCell className="align-top">
                                        <Badge variant={hold.released ? 'outline' : 'secondary'}>
                                            {hold.released ? 'Released' : 'Held'}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </section>
    );
}
