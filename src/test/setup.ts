import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { resetSessionListeners } from '@/lib/session-events';
import { __resetPasswordPolicyWarning } from '@/lib/password-policy';
import { __resetRuntimeI18n } from '@/i18n';
import { __resetTranslatorWarnings } from '@/i18n/translator';
import { __resetApiClientState } from '@/services/api';

/**
 * How long `input-otp`'s uncancellable timers need to drain.
 *
 * It schedules **three** on every value or focus change — `setTimeout(fn, 0)`,
 * `(fn, 10)` and `(fn, 50)` — from a `useEffect` that **returns no cleanup
 * function**. Unmounting therefore does not cancel them, and each one calls
 * `setState` when it fires.
 *
 * 🔴 **This is why CI can go red with every test passing.** On a slow runner the
 * 10 ms and 50 ms timers land *after* vitest has torn jsdom down; React then
 * reads `window` inside `resolveUpdatePriority` and throws
 * `ReferenceError: window is not defined` as an **uncaught exception**. Vitest
 * reports `2488 passed (2488)` and exits **1**. It cost a green `main` and a red
 * `production` on the *same commit* — see the run for 9de0277.
 *
 * ⚠ **Do not "fix" this with `dangerouslyIgnoreUnhandledErrors`.** That would
 * silence every post-teardown throw in the suite, including the ones that mean
 * something. Letting the timers expire while jsdom is still alive is the narrow
 * fix: they call `setState` on an unmounted tree, which React 19 ignores.
 */
const OTP_TIMER_DRAIN_MS = 60;

afterEach(async () => {
    /*
      Read BEFORE `cleanup()` — afterwards the tree is gone and there is nothing
      left to detect. Gated on the field actually having been rendered because
      60 ms on all 2488 tests would add about two and a half minutes to the suite
      to serve the handful that mount an OTP input.
    */
    const hadOtpField = document.querySelector('[data-input-otp]') !== null;

    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Module-level state that would otherwise leak between cases: a subscriber
    // left over from an unmounted provider, an in-flight refresh flag stuck true,
    // and the once-per-session dev warning.
    resetSessionListeners();
    __resetApiClientState();
    __resetPasswordPolicyWarning();
    // A test that mounts a French provider would otherwise leave the non-React
    // snapshot in French for every later file sharing this worker.
    __resetRuntimeI18n();
    __resetTranslatorWarnings();
    // Cookies persist across cases in jsdom otherwise, and the CSRF tests would
    // start passing for the wrong reason.
    for (const entry of document.cookie.split('; ')) {
        const name = entry.split('=')[0];
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }

    // Last, so the timers drain against a document this hook has finished with.
    if (hadOtpField) {
        await new Promise((resolve) => setTimeout(resolve, OTP_TIMER_DRAIN_MS));
    }
});

// jsdom implements neither, and the shell reads both on first render.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
    window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// `input-otp` polls this on a timer to spot a password manager's badge
// overlapping the field. jsdom has no layout, so it does not implement it — and
// because the poll outlives the test, the rejection surfaces as an unhandled
// error rather than a failure. Returning null reads as "nothing is on top".
if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
}

/**
 * The Pointer Events API, enough of it for Radix.
 *
 * jsdom implements none of these three. `Select`, `DropdownMenu` and every other
 * Radix component built on `Popper` calls them while opening, and the throw
 * happens inside the library's own handler — so the symptom is not an error but a
 * listbox that never appears and a `getByRole('option')` that cannot find
 * anything. Every filtered list from Phase 5 onwards is a `Select`, so this
 * belongs here rather than in one test file.
 */
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
}

// Radix scrolls the highlighted option into view on open. jsdom has no layout and
// no implementation, and the exception lands in the same place.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

/**
 * Object URLs, which jsdom does not implement at all.
 *
 * `getFileContent` and `FileViewer` are built on them: `GET /files/:fileId/content`
 * answers with bytes rather than a URL, because the request needs the session and
 * an `<img>` tag cannot carry one — so the only way to render a delivery proof is
 * to wrap the blob.
 *
 * ⚠ **`revokeObjectURL` is counted, not just swallowed.** The handle leaks for the
 * lifetime of the document otherwise, and on a busy shipment queue that is an
 * operator's whole session holding every proof photo they have opened. A stub that
 * silently did nothing would let a missing revoke pass every test, so the pairing
 * is observable: `__objectUrls` holds the ones still live.
 */
const liveObjectUrls = new Set<string>();
let objectUrlSeq = 0;

if (!URL.createObjectURL) {
    URL.createObjectURL = (() => {
        objectUrlSeq += 1;
        const handle = `blob:http://localhost/test-object-url-${objectUrlSeq}`;
        liveObjectUrls.add(handle);
        return handle;
    }) as typeof URL.createObjectURL;

    URL.revokeObjectURL = ((handle: string) => {
        liveObjectUrls.delete(handle);
    }) as typeof URL.revokeObjectURL;
}

/** The object URLs created and not yet revoked. Assert against it in a test. */
export function __liveObjectUrls(): string[] {
    return [...liveObjectUrls];
}

afterEach(() => {
    liveObjectUrls.clear();
});
