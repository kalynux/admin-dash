/**
 * Rendering numbers, money and instants.
 *
 * Small on purpose. The rules that matter are the two the contract states and a
 * client is likely to get wrong.
 */

import { formatDistanceToNowStrict } from 'date-fns';

/** Thousands separators, nothing else. `8412` → `8,412`. */
export function formatCount(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat().format(value);
}

/**
 * An amount, in the account currency.
 *
 * **Never divide by 100.** The docs describe money as "the minor unit", which
 * for the default `XAF` is the same number because the franc has no
 * subdivision — a client that scales it reports every balance as one percent of
 * itself.
 *
 * `Intl` throws on a currency code it does not recognise, and the code arrives
 * from a delegated payload this service does not validate, so the failure falls
 * back to the plain number rather than taking the tile down.
 */
export function formatMoney(value: number, currency: string | null): string {
    if (!Number.isFinite(value)) return '—';
    if (!currency) return formatCount(value);

    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    } catch {
        return `${formatCount(value)} ${currency}`;
    }
}

/**
 * A file size, for the one place the service reports one — an audit export's
 * `byteSize`.
 *
 * Binary units, because that is what an operator's file manager will show them
 * for the same file, and a figure that disagrees with the one on disk invites a
 * bug report rather than confidence.
 */
export function formatBytes(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (value < 1024) return `${formatCount(value)} B`;

    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }

    // One decimal below 10 so 1.4 MB and 1.9 MB stay distinguishable; none above,
    // where the extra digit is noise.
    return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

/**
 * One megabyte, binary — 1024 x 1024.
 *
 * **Every other party to this number counts in binary**, so a decimal megabyte
 * here is wrong rather than merely a different convention: `formatBytes` above
 * divides by 1024, jovi-mall's quota validator both formats and enforces in
 * 1024s (`core/uploads/validators/user-quota.validator.ts`), its own defaults
 * are written `5 * 1024 * 1024 * 1024`, and `billing.md`'s worked plan carries
 * `maxStorageBytes: 5368709120` — 5 GiB to the byte, not 5,000,000,000.
 *
 * This constant exists because the plan form used `1_000_000` and was wrong in
 * both directions: an operator asking for 10240 MB stored 10,240,000,000 bytes
 * (9.5 GB of the 10 GB they meant), and the round trip *rewrote a correct plan
 * on every edit* — 5368709120 read back as "5369 MB" and saved back as
 * 5,369,000,000. Convert through the two functions below, never by hand.
 */
export const BYTES_PER_MEGABYTE = 1024 * 1024;

/** Bytes as whole megabytes, for a form field or a limits row. */
export function bytesToMegabytes(bytes: number): number {
    return Math.round(bytes / BYTES_PER_MEGABYTE);
}

/** Whole megabytes as bytes, for the wire. */
export function megabytesToBytes(megabytes: number): number {
    return Math.round(megabytes * BYTES_PER_MEGABYTE);
}

/**
 * A wire enum as prose. `cash_on_delivery` → `cash on delivery`.
 *
 * **Null-safe on purpose, because the contract over-promises.** Several fields
 * are declared non-optional by wi-admin's DTOs and by the endpoint pages, yet
 * arrive absent: a Mongoose `default:` applies at *write* time, so a document
 * older than the field has no value, the projection returns nothing and
 * `JSON.stringify` drops the key. `Order.paymentMethod` is the one that crashed
 * the orders list; jovi-mall's own customer read path already defends against
 * exactly it (`order.repository.ts` — `o.paymentMethod ?? 'online'`).
 *
 * Returns `null` rather than `''` so a caller has to decide what absence looks
 * like. An empty string renders as a silent gap that reads as "we know it is
 * blank" — the same class of failure as a `?? 0` over a misspelled key, which
 * this project has already shipped once.
 *
 * The value is **not** validated against any vocabulary: an unknown enum member
 * is rendered raw, because adding one is an additive backend change.
 */
export function humaniseEnum(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/_/g, ' ').trim();
    return cleaned === '' ? null : cleaned;
}

/** "2 minutes ago". Returns `null` for a null or unparseable instant. */
export function formatRelative(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return formatDistanceToNowStrict(at, { addSuffix: true });
}

/**
 * An absolute timestamp **in the operator's zone**, not the browser's.
 *
 * The same reason every date range is resolved against `admin.timezone`: an
 * operator reading a feed needs the times to line up with the day they filtered.
 */
export function formatInstantInZone(
    iso: string | null | undefined,
    timeZone: string,
): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;

    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone,
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(at);
    } catch {
        // An unusable zone is a profile data problem, not a reason to render
        // nothing — `resolveTimeZone` already guards this, so it is belt only.
        return at.toISOString();
    }
}
