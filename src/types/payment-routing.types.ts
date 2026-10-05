/**
 * `GET` / `PUT /dev-tools/payments` — the payment-routing switch (jovi-mall ADR-A08).
 *
 * Which **aggregator** moves the money (NotchPay, My-CoolPay, Stripe; later Campay and
 * Flutterwave) is chosen by an administrator at runtime; which **provider** the customer pays
 * with (`MTN` · `ORANGE` · `MOOV` · `CARD`) is the customer's. This is the one administrator
 * surface that names aggregators.
 *
 * Contract: [dev-tools.md § GET /dev-tools/payments](../../api-doc/admin/api/dev-tools.md), the
 * [brief](../../api-doc/admin/FRONTEND-CHANGELOG-payment-providers.md), and jovi-mall's
 * [routing.md](../../api-doc/jovi-mall/payments/routing.md) for the rules the screen explains.
 *
 * ── Every vocabulary here is OPEN ────────────────────────────────────────────
 * Aggregator names, provider names and issue codes are all typed `string`, never a union.
 * jovi-mall adds rules (`NO_MOBILE_PROVIDER_ENABLED` arrived during the build) and aggregators
 * (Campay) with no dashboard release, so a closed union here would be a second list that drifts —
 * and a closed `switch` over it breaks on a routine deploy. Render an unknown value by its name,
 * an unknown issue by its `message`.
 *
 * ── Two shapes were taken from SOURCE, not from the page ─────────────────────
 * `dev-tools.md` shows `effectiveProviders` as *"jovi-mall's shape, passed through"* and
 * `capabilities` as `{ "…": "…" }`. Both come from jovi-mall's
 * `payments/domain/payment-routing.ts` (`EffectiveProvider[]`) and `gateway.interface.ts`
 * (`GatewayCapabilities`), and wi-admin types both as `unknown`. So they are read defensively
 * here: a missing or malformed value renders as "not reported", never as a crash.
 */

import { ApiError } from '@/types/api.types';

// ─── Providers ────────────────────────────────────────────────────────────────

/**
 * jovi-mall's catalogue, **in its order** — the order of `/api/payments/options`. Used only to
 * *sort* what the settings carry; a provider the settings name that is not here is still
 * rendered, after these.
 */
export const PAYMENT_PROVIDER_ORDER = ['MTN', 'ORANGE', 'MOOV', 'CARD'] as const;

/**
 * Is this a mobile-money provider?
 *
 * `CARD` is the one provider of kind `CARD` in the catalogue; every other one is
 * `MOBILE_MONEY`. An unknown future provider is treated as mobile, and that errs in the safe
 * direction: the only thing this decides is whether switching everything off earns the louder
 * confirmation, and a needless extra confirmation costs a click.
 */
export function isMobileProvider(provider: string): boolean {
    return provider !== 'CARD';
}

// ─── The read ─────────────────────────────────────────────────────────────────

export const PAYMENT_STATS_WINDOWS = ['24h', '7d'] as const;
export type PaymentStatsWindow = (typeof PAYMENT_STATS_WINDOWS)[number];

/** The camelCase settings view. `updatedAt` / `updatedBy` / `reason` are `null` on the defaults. */
export interface PaymentSettingsView {
    collectionAggregator: string;
    payoutAggregator: string;
    stripeEnabled: boolean;
    /**
     * The refund transfer fee, **in percent** (2026-10-05, R-3): 0–20, default 2,
     * decimals allowed. Never taken off a card refund, and it changes NEW refund
     * requests only — a request freezes its own `feeRate`. ⚠ **Absent** against a
     * jovi-mall older than the refund flow; the field is then not offered.
     */
    refundFeePercent?: number;
    /** A known provider **missing** from this map is treated as disabled (routing.md). */
    providers: Record<string, { enabled: boolean }>;
    /** Compare-and-set counter. **`0` means no document yet** — the platform is on its defaults. */
    version: number;
    updatedAt: string | null;
    updatedBy: { id: string; name: string } | null;
    reason: string | null;
}

/** One hard error or soft warning. `code` is an **open** set — render an unknown one by `message`. */
export interface PaymentSettingsIssue {
    code: string;
    message: string;
    provider?: string;
    aggregator?: string;
}

/** One provider an aggregator can collect, and how. From `GatewayCapabilities.collect`. */
export interface ProviderCollectCapability {
    /** `PUSH` · `OTP` · `CARD_ELEMENT` · `REDIRECT` — open. */
    flow: string;
    requires: string[];
}

export interface PaymentAggregator {
    name: string;
    /** Credentials present. **Only a configured aggregator may be offered as a switch target.** */
    configured: boolean;
    /** jovi-mall's `GatewayCapabilities`; typed `unknown` upstream — read with {@link collectCapabilities}. */
    capabilities: unknown;
    /** Has a `createPayout` at all (today only NotchPay). */
    payoutImplemented: boolean;
    /** Can send right now — an env flag and an IP allowlist, so a runtime fact. */
    payoutAvailable: boolean;
    refundAvailable: boolean;
    activeForCollections: boolean;
    activeForPayouts: boolean;
}

/** One provider that routes right now, with the aggregator that carries it. */
export interface EffectiveProvider {
    provider: string;
    aggregator: string;
    capability: ProviderCollectCapability | null;
}

export interface GatewaySourceStats {
    /** `payments` · `plan_purchases` · `credit_topups` — open. */
    source: string;
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
    stuckPending: number;
    settleP50Seconds: number | null;
    settleP90Seconds: number | null;
    lastSuccessAt: string | null;
}

export interface GatewayOutcomeSummary {
    gateway: string;
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
    /** Pending **and** older than `stuckPendingAfterMinutes`: a settlement that never came. */
    stuckPending: number;
    /** Over decided rows only. ⚠ **`null` means nothing was decided — not 0%.** */
    successRate: number | null;
    /** ⚠ **`null` means none IN THE WINDOW — not "never".** */
    lastSuccessAt: string | null;
    sources: GatewaySourceStats[];
}

export interface PaymentRoutingStats {
    window: PaymentStatsWindow;
    since: string;
    stuckPendingAfterMinutes: number;
    gateways: GatewayOutcomeSummary[];
}

export interface PaymentRouting {
    /**
     * **`false` when jovi-mall predates payment routing** — `settings` is then `null`,
     * `aggregators` and `warnings` empty, and `stats` still real. Render *"deploy jovi-mall
     * first"*, never an empty configuration.
     */
    platformSupported: boolean;
    settings: PaymentSettingsView | null;
    aggregators: PaymentAggregator[];
    /** `EffectiveProvider[]` from jovi-mall; `null` when the platform is too old. Read with {@link readEffectiveProviders}. */
    effectiveProviders: unknown;
    /** **Payments are broken NOW** — the red banner. Always present. */
    errors: PaymentSettingsIssue[];
    /** Soft, standing problems. ⚠ **`[]` while `errors` is non-empty — "not checked", not "none".** */
    warnings: PaymentSettingsIssue[];
    stats: PaymentRoutingStats;
}

/**
 * The providers that route right now, or `null` when the platform did not say.
 *
 * `null` and `[]` are different answers: `[]` is a valid, alarming one — *nothing can be paid
 * online* — while `null` means an older platform sent no list.
 */
export function readEffectiveProviders(value: unknown): EffectiveProvider[] | null {
    if (!Array.isArray(value)) return null;
    return value
        .filter(
            (entry): entry is Record<string, unknown> =>
                typeof entry === 'object' && entry !== null && typeof entry.provider === 'string',
        )
        .map((entry) => ({
            provider: entry.provider as string,
            aggregator: typeof entry.aggregator === 'string' ? entry.aggregator : '',
            capability: readCapability(entry.capability),
        }));
}

function readCapability(value: unknown): ProviderCollectCapability | null {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.flow !== 'string') return null;
    return {
        flow: record.flow,
        requires: Array.isArray(record.requires)
            ? record.requires.filter((item): item is string => typeof item === 'string')
            : [],
    };
}

/**
 * What an aggregator can collect, as `[provider, capability]` pairs in catalogue order.
 * An absent key means *cannot collect it*. Empty when the platform reported nothing readable.
 */
export function collectCapabilities(
    capabilities: unknown,
): Array<[string, ProviderCollectCapability]> {
    if (typeof capabilities !== 'object' || capabilities === null) return [];
    const collect = (capabilities as Record<string, unknown>).collect;
    if (typeof collect !== 'object' || collect === null) return [];
    const pairs: Array<[string, ProviderCollectCapability]> = [];
    for (const [provider, raw] of Object.entries(collect)) {
        const capability = readCapability(raw);
        if (capability) pairs.push([provider, capability]);
    }
    return sortProviders(pairs.map(([provider]) => provider)).map(
        (provider) => pairs.find(([name]) => name === provider)!,
    );
}

/** Catalogue order first, then any provider the catalogue does not know, alphabetically. */
export function sortProviders(names: readonly string[]): string[] {
    const known = PAYMENT_PROVIDER_ORDER.filter((name) => names.includes(name));
    const unknown = names
        .filter((name) => !(PAYMENT_PROVIDER_ORDER as readonly string[]).includes(name))
        .sort();
    return [...known, ...unknown];
}

/** Every provider to show a toggle for: the catalogue plus anything the settings name. */
export function providerNames(settings: PaymentSettingsView): string[] {
    return sortProviders([
        ...new Set([...PAYMENT_PROVIDER_ORDER, ...Object.keys(settings.providers)]),
    ]);
}

/** A provider missing from the map is disabled — routing.md, not a guess. */
export function isProviderEnabled(settings: PaymentSettingsView, provider: string): boolean {
    return settings.providers[provider]?.enabled === true;
}

// ─── The write ────────────────────────────────────────────────────────────────

/** `reason` bounds on `PUT /dev-tools/payments`. */
export const PAYMENT_SETTINGS_REASON_MIN = 10;
export const PAYMENT_SETTINGS_REASON_MAX = 500;

/** What the operator has chosen on screen, before it is reduced to a patch. */
export interface PaymentSettingsDraft {
    collectionAggregator: string;
    payoutAggregator: string;
    stripeEnabled: boolean;
    providers: Record<string, boolean>;
    /**
     * The refund fee as TYPED — a string, so a half-typed `2.` is not lost to a
     * number round-trip. `''` when the platform does not offer the setting.
     */
    refundFeePercent: string;
}

/** `refundFeePercent` bounds on `PUT /dev-tools/payments`. */
export const REFUND_FEE_PERCENT_MIN = 0;
export const REFUND_FEE_PERCENT_MAX = 20;

/** The typed fee as a number, or `null` when it is not a percentage the route accepts. */
export function parseRefundFeePercent(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return parsed >= REFUND_FEE_PERCENT_MIN && parsed <= REFUND_FEE_PERCENT_MAX ? parsed : null;
}

/** The field's error, or `null`. Only asked when the platform offers the setting. */
export function refundFeePercentError(
    settings: PaymentSettingsView,
    draft: PaymentSettingsDraft,
): string | null {
    if (settings.refundFeePercent === undefined) return null;
    return parseRefundFeePercent(draft.refundFeePercent) === null
        ? `A percentage from ${REFUND_FEE_PERCENT_MIN} to ${REFUND_FEE_PERCENT_MAX}, e.g. 2 or 1.5`
        : null;
}

/** The changeable part of the body. `expectedVersion` and `reason` are added at send time. */
export interface PaymentSettingsPatch {
    collectionAggregator?: string;
    payoutAggregator?: string;
    stripeEnabled?: boolean;
    providers?: Record<string, { enabled: boolean }>;
    /** 0–20, percent. Sent only when it changed. */
    refundFeePercent?: number;
}

/** The body is `.strict()`: any other key — an old client's `gateway`, say — is a `400`. */
export interface SetPaymentSettingsBody extends PaymentSettingsPatch {
    expectedVersion: number;
    reason: string;
}

export interface SetPaymentSettingsResult {
    previous: PaymentSettingsView;
    settings: PaymentSettingsView;
    /** Top-level keys whose value differs. **`[]` means nothing changed**, not "switched". */
    changed: string[];
    /** Soft rules; the write **was accepted**. Show every one. */
    warnings: PaymentSettingsIssue[];
    /** Every server follows within this many seconds. */
    convergenceSeconds: number;
}

export function draftFromSettings(settings: PaymentSettingsView): PaymentSettingsDraft {
    return {
        collectionAggregator: settings.collectionAggregator,
        payoutAggregator: settings.payoutAggregator,
        stripeEnabled: settings.stripeEnabled,
        providers: Object.fromEntries(
            providerNames(settings).map((name) => [name, isProviderEnabled(settings, name)]),
        ),
        refundFeePercent:
            settings.refundFeePercent === undefined ? '' : String(settings.refundFeePercent),
    };
}

/**
 * The patch that turns `settings` into `draft` — **only what changed**, and `providers`
 * partial per provider, because the server merges it per provider.
 *
 * `null` when nothing changed. Sending the whole state instead would make every save look like
 * a switch in the audit row's `changed`, and would overwrite a second operator's provider change
 * that this screen merely displayed.
 */
export function buildSettingsPatch(
    settings: PaymentSettingsView,
    draft: PaymentSettingsDraft,
): PaymentSettingsPatch | null {
    const patch: PaymentSettingsPatch = {};
    if (draft.collectionAggregator !== settings.collectionAggregator) {
        patch.collectionAggregator = draft.collectionAggregator;
    }
    if (draft.payoutAggregator !== settings.payoutAggregator) {
        patch.payoutAggregator = draft.payoutAggregator;
    }
    if (draft.stripeEnabled !== settings.stripeEnabled) {
        patch.stripeEnabled = draft.stripeEnabled;
    }
    const providers: Record<string, { enabled: boolean }> = {};
    for (const [name, enabled] of Object.entries(draft.providers)) {
        if (enabled !== isProviderEnabled(settings, name)) providers[name] = { enabled };
    }
    if (Object.keys(providers).length > 0) patch.providers = providers;
    // Only when the platform offers it, the typed value is valid, and it moved. An
    // invalid value is not dropped silently — `refundFeePercentError` blocks Save.
    if (settings.refundFeePercent !== undefined) {
        const fee = parseRefundFeePercent(draft.refundFeePercent);
        if (fee !== null && fee !== settings.refundFeePercent) patch.refundFeePercent = fee;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

/** Does this patch move money to a different aggregator? That earns its own confirmation. */
export function switchesAggregator(patch: PaymentSettingsPatch): boolean {
    return patch.collectionAggregator !== undefined || patch.payoutAggregator !== undefined;
}

/**
 * Does saving this draft leave **no** mobile provider enabled, where at least one was?
 *
 * That is the deliberate *"stop taking mobile money"* lever: allowed, answered with the warning
 * `NO_MOBILE_PROVIDER_ENABLED`, and every app then shows "online payment unavailable" unless
 * cards are on. The brief asks for its own, louder confirmation.
 */
export function turnsOffEveryMobileProvider(
    settings: PaymentSettingsView,
    draft: PaymentSettingsDraft,
): boolean {
    const mobile = Object.keys(draft.providers).filter(isMobileProvider);
    const wasOn = mobile.some((name) => isProviderEnabled(settings, name));
    const nowOn = mobile.some((name) => draft.providers[name]);
    return wasOn && !nowOn;
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

/*
 * All three arrive as `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in
 * `details.platformCode` — a branch on `error.code` never fires for any of them.
 */
export const PAYMENT_SETTINGS_VERSION_CONFLICT = 'PAYMENT_SETTINGS_VERSION_CONFLICT';
export const PAYMENT_SETTINGS_INVALID = 'PAYMENT_SETTINGS_INVALID';

export type PaymentSettingsRefusal =
    /** `409` — someone else saved first. Reload, look again; **never auto-retry**. */
    | { kind: 'version-conflict' }
    /** `422` — a hard rule broke. Nothing was written. `issues` may be empty if `details` was withheld. */
    | { kind: 'invalid'; issues: PaymentSettingsIssue[] }
    /** `422 NOT_FOUND` + `platformSupported: false` — jovi-mall predates routing. Nothing switched. */
    | { kind: 'platform-too-old' };

/** Which of the three documented refusals this is, or `null` for anything else. */
export function classifyPaymentSettingsRefusal(error: unknown): PaymentSettingsRefusal | null {
    if (!(error instanceof ApiError) || !error.isPlatformRejection) return null;
    if (error.platformCode === PAYMENT_SETTINGS_VERSION_CONFLICT) return { kind: 'version-conflict' };
    if (error.platformCode === PAYMENT_SETTINGS_INVALID) {
        return { kind: 'invalid', issues: readIssues(error.details?.errors) };
    }
    if (error.details?.platformSupported === false) return { kind: 'platform-too-old' };
    return null;
}

/** An open list: keeps every well-formed item, unknown codes included. */
export function readIssues(value: unknown): PaymentSettingsIssue[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(
            (item): item is Record<string, unknown> =>
                typeof item === 'object' &&
                item !== null &&
                typeof item.code === 'string' &&
                typeof item.message === 'string',
        )
        .map((item) => ({
            code: item.code as string,
            message: item.message as string,
            ...(typeof item.provider === 'string' ? { provider: item.provider } : {}),
            ...(typeof item.aggregator === 'string' ? { aggregator: item.aggregator } : {}),
        }));
}

// ─── Which control an issue concerns ──────────────────────────────────────────

export type IssueTarget =
    | { kind: 'collectionAggregator' }
    | { kind: 'payoutAggregator' }
    | { kind: 'stripe' }
    | { kind: 'provider'; provider: string };

/**
 * The control that fixes this issue, so the screen can say so beside it — or `null`, and the
 * issue is still shown in its class's list by its `message`.
 *
 * ⚠ **A hint, never a gate.** Read from the code's documented prefix and the issue's own
 * `provider`; an unknown code with neither simply has no target. Nothing on the screen is
 * enabled, hidden or refused on the strength of this.
 */
export function issueTarget(issue: PaymentSettingsIssue): IssueTarget | null {
    if (issue.code.startsWith('COLLECTION_AGGREGATOR_')) return { kind: 'collectionAggregator' };
    if (issue.code.startsWith('PAYOUT_')) return { kind: 'payoutAggregator' };
    if (issue.code.startsWith('STRIPE_')) return { kind: 'stripe' };
    if (issue.provider) return { kind: 'provider', provider: issue.provider };
    return null;
}

export function issueTargetLabel(target: IssueTarget): string {
    switch (target.kind) {
        case 'collectionAggregator':
            return 'Collection aggregator';
        case 'payoutAggregator':
            return 'Payout aggregator';
        case 'stripe':
            return 'Stripe';
        case 'provider':
            return `${target.provider} switch`;
    }
}

export function issuesFor(
    issues: readonly PaymentSettingsIssue[],
    matches: (target: IssueTarget) => boolean,
): PaymentSettingsIssue[] {
    return issues.filter((issue) => {
        const target = issueTarget(issue);
        return target !== null && matches(target);
    });
}

// ─── Reading the stats ────────────────────────────────────────────────────────

/** `0.944` → `94.4%`; **`null` → `null`**, which the screen words as "nothing decided", never 0%. */
export function formatSuccessRate(rate: number | null): string | null {
    if (rate === null) return null;
    return `${(rate * 100).toFixed(1)}%`;
}

/** Settle-time seconds, human-sized. `null` stays `null`. */
export function formatSettleSeconds(seconds: number | null): string | null {
    if (seconds === null) return null;
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toFixed(1)} h`;
}

// ─── The payout's aggregator ──────────────────────────────────────────────────

/**
 * Which aggregator sent (or is sending) a payout, **with the legacy default applied**.
 *
 * `transferGateway` is stamped at the first transfer attempt and passed through raw, so the
 * dashboard does the defaulting (brief § 3): a `null` on a payout that **was sent** means
 * **NotchPay** — every payout before this change went through it. A `null` on one never
 * attempted means no aggregator has been chosen yet.
 *
 * "Was sent" is read from the payout itself: a gateway transfer ref was issued, or the status is
 * one only a gateway attempt produces (`processing`, `failed`). A `paid` payout with no ref was
 * **recorded by hand** (mark-paid) and went through no aggregator at all — so it gets `null`,
 * not NotchPay.
 */
export function payoutTransferGateway(payout: {
    transferGateway?: string | null;
    transferGatewayRef: string | null;
    status: string;
}): { gateway: string; inferred: boolean } | null {
    if (payout.transferGateway) return { gateway: payout.transferGateway, inferred: false };
    const attempted =
        payout.transferGatewayRef !== null ||
        payout.status === 'processing' ||
        payout.status === 'failed';
    return attempted ? { gateway: LEGACY_PAYOUT_AGGREGATOR, inferred: true } : null;
}

/** The only payout aggregator before payment routing existed. */
export const LEGACY_PAYOUT_AGGREGATOR = 'NOTCHPAY';
