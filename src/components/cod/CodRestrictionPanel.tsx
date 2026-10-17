import { useState } from 'react';
import { HandCoins, Undo2 } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import {
    CodRestrictionDialog,
    type CodRestrictionActions,
    type CodRestrictionDirection,
    type CodRestrictionSubject,
} from '@/components/cod/CodRestrictionDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatInstantInZone } from '@/lib/format';
import {
    codRestrictionAuthor,
    type CodRestriction,
    type CodRestrictionReport,
} from '@/types/cod-restriction.types';

/**
 * What the state means for each subject, in one sentence each way. Describes
 * the switch — ⛔ never a prediction about a particular basket or shipment.
 */
const COPY: Record<
    CodRestrictionSubject,
    { party: string; hint: string; restricted: string; unrestricted: string }
> = {
    customer: {
        party: 'the customer',
        hint: 'An administrator can switch cash on delivery off for one customer, and back on. While it is off the customer cannot place a cash-on-delivery order; orders already placed and every other payment method are unaffected. Nothing sets it automatically.',
        restricted:
            'This customer cannot place a cash-on-delivery order. Orders already placed and other payment methods are unaffected.',
        unrestricted:
            'No administrator has switched cash on delivery off for this customer. The seller’s terms, the agency’s settings and the amount limits still decide each order.',
    },
    agency: {
        party: 'the agency',
        hint: 'An administrator can switch cash on delivery off for one agency, and back on. While it is off the agency receives no new cash-on-delivery shipment — a vendor’s forced dispatch included. Parcels it holds, its cash hand-overs and prepaid deliveries are unaffected. Nothing sets it automatically.',
        restricted:
            'This agency receives no new cash-on-delivery shipment. Parcels it already holds, its cash hand-overs and prepaid deliveries carry on.',
        unrestricted:
            'No administrator has switched cash on delivery off for this agency. Its own COD setting and its cash limit still decide each shipment.',
    },
};

/**
 * The administrator's cash-on-delivery switch for one customer or one agency
 * (2026-10-10) — the state, who set it and why, and one button.
 *
 * ── Read by everyone who reads the record, written by tiers 1–2 ───────────────
 * The state arrives on the detail the page already loaded (`users.read` /
 * `agencies.read`), so Support sees that a restriction exists, its reason and
 * who set it — that is the conversation they will be having. The button needs
 * `users.cod.restrict` / `agencies.cod.restrict`, which Support does not hold,
 * so it is **hidden** rather than left to answer `403`. ⛔ Gated on the
 * permission, never on tier.
 *
 * ── One button at a time ──────────────────────────────────────────────────────
 * Chosen from the stored state: *Restrict cash on delivery* when there is no
 * restriction, *Lift restriction* when there is.
 *
 * ── The reason is internal, and labelled so ───────────────────────────────────
 * jovi-mall never shows it to the restricted party. It is rendered here for
 * administrators only, under a heading that says it is not to be passed on.
 *
 * ⛔ Nothing here predicts whether an order or shipment may use cash: the badge
 * shows the switch, and jovi-mall decides each case.
 */
export function CodRestrictionPanel({
    subject,
    subjectName,
    restriction,
    permission,
    actions,
    timeZone,
    onChanged,
    offerWrite = true,
}: {
    subject: CodRestrictionSubject;
    subjectName: string;
    /** `null` when cash on delivery is not switched off. */
    restriction: CodRestriction | null;
    permission: 'users.cod.restrict' | 'agencies.cod.restrict';
    actions: CodRestrictionActions;
    timeZone: string;
    /** The service's latest report — after a write, a stale `409`, or a re-read. */
    onChanged: (report: CodRestrictionReport) => void;
    /** `false` shows the state with no button, whatever the caller holds. */
    offerWrite?: boolean;
}) {
    const copy = COPY[subject];
    // The direction is fixed when the dialog opens, so a state that moves
    // underneath it (a stale 409 re-read) cannot flip an open form.
    const [direction, setDirection] = useState<CodRestrictionDirection | null>(null);

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-1">
                    Cash on delivery restriction
                    <InfoHint label="About the cash-on-delivery restriction">{copy.hint}</InfoHint>
                </CardTitle>
                {offerWrite ? (
                    <Can permission={permission}>
                        {restriction ? (
                            <Button size="sm" variant="outline" onClick={() => setDirection('lift')}>
                                <Undo2 className="size-4" />
                                Lift restriction
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDirection('restrict')}
                            >
                                <HandCoins className="size-4" />
                                Restrict cash on delivery
                            </Button>
                        )}
                    </Can>
                ) : null}
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
                {restriction ? (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="destructive">Restricted</Badge>
                            <span>
                                by {codRestrictionAuthor(restriction)},{' '}
                                {formatInstantInZone(restriction.restrictedAt, timeZone) ??
                                    restriction.restrictedAt}
                            </span>
                        </div>
                        <p className="text-muted-foreground">{copy.restricted}</p>
                        <div className="space-y-1 rounded-lg border px-3 py-2">
                            <p className="text-muted-foreground text-xs font-medium">
                                Internal reason — never shown to {copy.party}
                            </p>
                            <p>{restriction.reason ? `“${restriction.reason}”` : 'None recorded.'}</p>
                        </div>
                    </>
                ) : (
                    <>
                        <Badge variant="outline">Not restricted</Badge>
                        <p className="text-muted-foreground">{copy.unrestricted}</p>
                    </>
                )}
            </CardContent>

            {direction ? (
                <CodRestrictionDialog
                    subject={subject}
                    subjectName={subjectName}
                    direction={direction}
                    current={restriction}
                    actions={actions}
                    timeZone={timeZone}
                    open
                    onOpenChange={(next) => setDirection(next ? direction : null)}
                    onSettled={onChanged}
                />
            ) : null}
        </Card>
    );
}
