import { MapPin } from 'lucide-react';
import type { MouseEvent } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A coordinate pair, handed to Google Maps in a small window.
 *
 * The URL itself is built by [`lib/geo`](../../lib/geo.ts) — the GeoJSON
 * inversion lives there, tested, and must not be re-derived at a call site.
 * This component is only the affordance.
 *
 * ── It is a real link that *prefers* to be a popup ────────────────────────────
 * The element is an `<a href>`, always. The click handler tries
 * `window.open` with popup geometry and calls `preventDefault()` **only when a
 * window actually came back** — so a blocked popup falls through to the
 * anchor's own navigation and the operator still gets their map. There is no
 * "please allow popups" dead end, and no branch where pressing the button does
 * nothing.
 *
 * Modified clicks (⌘/Ctrl/Shift/middle) are left entirely alone: an operator
 * asking for a background tab has asked for a background tab.
 *
 * ── One window, reused ────────────────────────────────────────────────────────
 * The window name is a constant, so a second click steers the window that is
 * already open rather than stacking another. That matters most on the shipment
 * trail, where the affordance sits on every row of a table that can hold
 * thousands.
 *
 * ── What Google learns ────────────────────────────────────────────────────────
 * The coordinates, because they are the URL. Nothing else worth having: the
 * browser default `strict-origin-when-cross-origin` sends this dashboard's
 * *origin* and not the path, so the agent or shipment id in the address bar
 * does not travel. The anchor additionally carries `rel="noreferrer"`, which
 * drops even the origin on the fallback path. `opener` is severed either way,
 * so the opened page cannot navigate this one.
 *
 * ⚠ **This is a disclosure and every call site treats it as one.** It renders
 * only behind whatever gate the coordinates themselves sit behind — the
 * last-known reveal, the audited live-position reveal, the audited trail — and
 * never on its own.
 */

/** Constant, so repeat clicks reuse one window instead of stacking them. */
const POPUP_NAME = 'wi-admin-map';
const POPUP_WIDTH = 980;
const POPUP_HEIGHT = 720;

/**
 * Popup geometry, centred on the screen the browser reports.
 *
 * ⚠ **`noopener` is deliberately absent from this string.** Passing it makes
 * `window.open` return `null` in every browser, which is indistinguishable from
 * a blocked popup — the fallback would then fire *as well*, opening the map
 * twice. `opener` is severed on the returned handle instead.
 */
function popupFeatures(): string {
    const screenWidth = window.screen?.width ?? POPUP_WIDTH;
    const screenHeight = window.screen?.height ?? POPUP_HEIGHT;
    const left = Math.max(0, Math.round((screenWidth - POPUP_WIDTH) / 2));
    const top = Math.max(0, Math.round((screenHeight - POPUP_HEIGHT) / 2));
    return `popup=1,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
}

interface OpenInGoogleMapsProps {
    /**
     * A URL from `lib/geo`. **`null` renders nothing** — that is the normal
     * answer for a pair that is not a place, and a dead button would be worse
     * than no button.
     */
    url: string | null;
    /**
     * The visible text, and the accessible name when `iconOnly`. Name the
     * point, not the act — "Open this point in Google Maps" beats "Open" on a
     * screen carrying forty of them.
     */
    label?: string;
    /** Icon alone, for a table cell. The label becomes the accessible name. */
    iconOnly?: boolean;
    className?: string;
}

export function OpenInGoogleMaps({
    url,
    label = 'Open in Google Maps',
    iconOnly = false,
    className,
}: OpenInGoogleMapsProps) {
    // Bound to a `const` so the narrowing survives into the click handler — a
    // parameter binding would need a non-null assertion there instead.
    const target = url;
    if (target === null) return null;

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        // Somebody upstream already decided what this click does.
        if (event.defaultPrevented) return;
        // A modified click is an explicit request for the browser's own
        // behaviour — new tab, new window, background tab. Do not intercept it.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;

        const popup = window.open(target, POPUP_NAME, popupFeatures());
        // Blocked, or an environment without popups. Say nothing and let the
        // anchor navigate — the operator gets a tab instead of a window, which
        // is a worse shape and a fine outcome.
        if (!popup) return;

        try {
            // Severed here rather than via the `noopener` feature, which would
            // have cost us the handle we are testing above.
            popup.opener = null;
        } catch {
            // Cross-origin refusals are possible and are not worth a failure:
            // the window is open, which is what was asked for.
        }
        popup.focus?.();
        event.preventDefault();
    };

    return (
        <a
            href={target}
            target="_blank"
            // `noreferrer` on the fallback path drops even the origin. It also
            // implies `noopener`, which is what we want for a plain navigation.
            rel="noreferrer noopener"
            onClick={handleClick}
            aria-label={iconOnly ? label : undefined}
            title={iconOnly ? label : undefined}
            className={cn(
                buttonVariants({ variant: 'outline', size: iconOnly ? 'icon-sm' : 'sm' }),
                className,
            )}
        >
            <MapPin className="size-4" />
            {iconOnly ? null : label}
        </a>
    );
}
