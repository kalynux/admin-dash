/**
 * `GET /money/orders/:orderId/split` · `money.splits.read` (every tier) ·
 * **delegated** — who gets what from one order, on what basis, and why it is
 * not released yet (money-split changelog, 2026-10-04).
 *
 * ── Where the shape comes from ────────────────────────────────────────────────
 * jovi-mall's `OrderMoneySplitDto`
 * (`backend/jovi-mall/src/modules/earnings/domain/order-money-split.ts` — not
 * mirrored in this repository), passed through by wi-admin, which **adds**
 * `vendorName`, `agencyName`, `agentName` and `beneficiary.name` beside each id.
 * [money.md](../../api-doc/admin/api/money.md) § `GET /money/orders/:orderId/split`
 * documents it; where the two differ the source wins, and they differ once:
 *
 * ⚠ **`line.amount` is `number | null` in source** — `null` for an agent's share
 * that cannot be known yet. The page's tables never say so.
 *
 * ── Nothing here is computed ──────────────────────────────────────────────────
 * Every figure, projected ones included, is the backend's own split arithmetic.
 * The panel prints them. A dashboard that re-added the lines would be a second
 * opinion about money, and a drifted explanation does not fail — support
 * repeats it to a vendor.
 *
 * ── Every vocabulary is open ──────────────────────────────────────────────────
 * `role`, `status`, `state`, `noneReason`, `notes`, `feeSource`, `waitingOn`,
 * `outcome`, `moment` and `beneficiary.type` are typed `string`. Each has a
 * label map with a raw-text fallback below, because adding a member is an
 * additive change upstream and a closed `switch` would break on a routine
 * deploy.
 */

export interface OrderMoneySplit {
    order: {
        id: string;
        orderNumber: string;
        vendorId: string;
        /** Added by wi-admin. `null` when the directory has no name. */
        vendorName: string | null;
        customerId: string;
        currency: string;
        orderType: string;
        paymentMethod: string;
        paymentStatus: string;
        fulfillmentStatus: string;
        deliveryPayer: string;
        completedAt: string | null;
        createdAt: string | null;
    };
    /** What the customer paid (or will pay). */
    charged: {
        items: number;
        /** Customer-paid delivery charged with the order (online, or inside the COD cash). */
        delivery: number;
        /** Customer-paid delivery handed to the rider in cash on an online order. */
        deliveryInCash: number;
        total: number;
    };
    sections: MoneySplitSection[];
    totals: {
        platform: { commission: number; bargainFee: number; total: number };
        vendor: number;
        agencies: number;
        agents: number;
        customerRefunds: number;
        /** Σ reversed lines — excluded from everything above. */
        reversed: number;
    };
    reconciliation: {
        charged: number;
        distributed: number;
        /** `charged − distributed`. **0 on a normal order**, projected or allocated. */
        difference: number;
        /** `false` while any section is `none`/`unavailable` or a line is reversed. */
        complete: boolean;
    };
    /** `true` while any section is projected. */
    estimated: boolean;
    /** Days between the order completing and its money becoming withdrawable. */
    holdDays: number;
    /** The bargain-fee rate in force. */
    bargainFeePercent: number;
}

export interface MoneySplitSection {
    /** `payment` or `shipment:<id>` — stable, for a list key. */
    key: string;
    /** `payment` · `delivery` · `cash_collection`. */
    moment: string;
    source: { type: string; id: string | null };
    /** `allocated` · `projected` · `none` · `unavailable`. */
    state: string;
    /** `order_void` · `returned_without_cash` · `agency_paid_at_payment`. */
    noneReason: string | null;
    shipment: {
        id: string;
        trackingNumber: string | null;
        status: string;
        agencyId: string;
        agencyName: string | null;
        agentId: string | null;
        agentName: string | null;
    } | null;
    goods: GoodsBasis | null;
    delivery: DeliveryBasis | null;
    lines: MoneyLine[];
    notes: string[];
}

export interface MoneyLine {
    /** `bargain_fee` · `commission` · `vendor_net` · `delivery_agency` · `delivery_agent` · `delivery_refund_vendor` · `delivery_refund_customer`. */
    role: string;
    beneficiary: {
        /** `platform` · `platform_ai` · `vendor` · `agency` · `agent` · `customer`. */
        type: string;
        id: string | null;
        /** `null` for both platform accounts and, deliberately, for the customer. */
        name: string | null;
    };
    /** ⚠ `null` = an agent's share that cannot be known yet (source, not the page). */
    amount: number | null;
    /** `projected` · `held` · `released` · `reversed` · `owed`. */
    status: string;
    allocationId: string | null;
    holdReleaseAt: string | null;
    releasedAt: string | null;
    requiresCashSettlement: boolean;
    cashSettledAt: string | null;
    /** `order_not_completed` · `hold_window` · `cash_not_settled`. Several may apply. */
    waitingOn: string[];
}

export interface GoodsBasis {
    gross: number;
    bargainFee: {
        percent: number;
        amount: number;
        lines: BargainFeeLine[];
    };
    commission: {
        percent: number;
        /** `gross − bargainFee` — no commission is taken on the bargain fee. */
        base: number;
        amount: number;
    };
    /** The part of the delivery the **vendor** pays. */
    deliveryFeeCharged: number;
    codHandlingFee: number;
    vendorNet: number;
}

export interface BargainFeeLine {
    orderItemId: string;
    title: string | null;
    unitPrice: number;
    /** The vendor's minimum at checkout. `null` = not a bargainable item (fee 0). */
    floorPrice: number | null;
    quantity: number;
    uplift: number;
    fee: number;
}

export interface DeliveryBasis {
    fee: number;
    /** `vendor_approved` · `snapshot` · `formula`. */
    feeSource: string;
    /** `vendor` · `customer`. */
    payer: string;
    customerPaid: number;
    vendorBorne: number;
    /** `expected` · `delivered` · `returned`. */
    outcome: string;
    earnedFee: number;
    codHandlingFee: number;
    /** **`null` = no agent has accepted yet** — the agency line then includes the agent's share. */
    agentCut: number | null;
    agentSplit: {
        /** `percentage` · `flat` · `monthly_salary`. */
        model: string;
        percent: number | null;
        flatAmount: number | null;
    } | null;
    refundToVendor: number;
    refundToCustomer: number;
}

/**
 * Does this payload look like a split? The parts every renderer reaches into
 * are required; everything else is read defensively. Delegated, so it is
 * checked before anything renders — the same treatment `PlatformEarnings` gets.
 */
export function isOrderMoneySplit(value: unknown): value is OrderMoneySplit {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    const order = record.order as Record<string, unknown> | null | undefined;
    const totals = record.totals as Record<string, unknown> | null | undefined;
    const reconciliation = record.reconciliation as Record<string, unknown> | null | undefined;
    return (
        typeof order === 'object' &&
        order !== null &&
        typeof order.currency === 'string' &&
        Array.isArray(record.sections) &&
        typeof totals === 'object' &&
        totals !== null &&
        typeof totals.platform === 'object' &&
        totals.platform !== null &&
        typeof reconciliation === 'object' &&
        reconciliation !== null &&
        typeof reconciliation.difference === 'number'
    );
}

// ─── Labels — every one falls back to the raw value ──────────────────────────

function lookup(map: Record<string, string>, value: string | null | undefined): string {
    if (!value) return 'Unknown';
    return map[value] ?? value;
}

const MOMENT_LABELS: Record<string, string> = {
    payment: 'Payment — the items',
    delivery: 'Delivery fee',
    cash_collection: 'Cash collection',
};
export const momentLabel = (value: string | null | undefined) => lookup(MOMENT_LABELS, value);

const STATE_LABELS: Record<string, string> = {
    allocated: 'Allocated',
    projected: 'Estimate',
    none: 'Nothing to split',
    unavailable: 'Unavailable',
};
export const sectionStateLabel = (value: string | null | undefined) =>
    lookup(STATE_LABELS, value);

const NONE_REASON_LABELS: Record<string, string> = {
    order_void: 'The order was cancelled, failed or refunded before this moment.',
    returned_without_cash: 'The parcel came back and no cash was collected, so nothing is split.',
    agency_paid_at_payment:
        'An older order: the agency was paid at payment — see the payment section.',
};
export const noneReasonLabel = (value: string | null | undefined) =>
    lookup(NONE_REASON_LABELS, value);

const ROLE_LABELS: Record<string, string> = {
    bargain_fee: 'Bargain fee',
    commission: 'Commission',
    vendor_net: 'Vendor net',
    delivery_agency: 'Delivery — agency',
    delivery_agent: 'Delivery — agent',
    delivery_refund_vendor: 'Unused delivery fee back to the vendor',
    delivery_refund_customer: 'Owed back to the customer',
};
export const lineRoleLabel = (value: string | null | undefined) => lookup(ROLE_LABELS, value);

const STATUS_LABELS: Record<string, string> = {
    projected: 'Projected',
    held: 'Held',
    released: 'Released',
    reversed: 'Reversed',
    owed: 'Owed',
};
export const lineStatusLabel = (value: string | null | undefined) => lookup(STATUS_LABELS, value);

const WAIT_LABELS: Record<string, string> = {
    order_not_completed: 'Waiting for the order to complete',
    hold_window: 'In the hold window',
    cash_not_settled: 'Waiting for the cash to reach the platform',
};
export const waitLabel = (value: string | null | undefined) => lookup(WAIT_LABELS, value);

const NOTE_LABELS: Record<string, string> = {
    commission_rate_may_change:
        "Estimate: the vendor's plan rate is read again when the money moves.",
    agent_not_assigned:
        "No agent has accepted yet — the agent's share is inside the agency line.",
    vendor_net_negative:
        'The costs exceed the items. The split will refuse this order — escalate.',
    fee_not_charged_to_vendor:
        'A parcel created after payment: its fee was never deducted from the vendor.',
    legacy_agency_on_order:
        'An order paid before delivery fees were deferred: the agency was paid at payment.',
};
export const noteLabel = (value: string | null | undefined) => lookup(NOTE_LABELS, value);

/** The notes that warrant a warning rather than a footnote. */
export const WARNING_NOTES: readonly string[] = ['vendor_net_negative'];

const FEE_SOURCE_LABELS: Record<string, string> = {
    vendor_approved: 'A fee change the vendor approved',
    snapshot: 'The price at checkout (or at cash collection)',
    formula: 'Priced live — no snapshot',
};
export const feeSourceLabel = (value: string | null | undefined) =>
    lookup(FEE_SOURCE_LABELS, value);

const OUTCOME_LABELS: Record<string, string> = {
    expected: 'Not over yet — shown as if delivered',
    delivered: 'Delivered',
    returned: 'Returned',
};
export const deliveryOutcomeLabel = (value: string | null | undefined) =>
    lookup(OUTCOME_LABELS, value);

/** The two lines that are the platform's own money. */
export const PLATFORM_LINE_ROLES: readonly string[] = ['commission', 'bargain_fee'];

/** Who a line pays, in words. Platform accounts and the customer carry no name. */
export function beneficiaryLabel(beneficiary: MoneyLine['beneficiary']): string {
    if (beneficiary.type === 'platform') return 'Platform — commission';
    if (beneficiary.type === 'platform_ai') return 'Platform — bargain fee';
    if (beneficiary.type === 'customer') return 'The customer';
    const name = beneficiary.name?.trim();
    if (name) return name;
    return beneficiary.id ?? beneficiary.type;
}
