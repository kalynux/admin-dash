/**
 * Environment configuration.
 *
 * Every `import.meta.env` read in the application goes through this module, so
 * there is one place that says what the app expects and one place to change when
 * a variable is renamed.
 *
 * Only `VITE_`-prefixed variables reach the browser bundle.
 */

/** wi-admin's documented default listen address (api-doc/admin/api/README.md). */
const DEFAULT_API_BASE_URL = 'http://localhost:8033/api/v1';

const DEFAULT_APP_NAME = 'WiMall Admin';

/**
 * How often the inbox badge re-reads `GET /notifications/unread-count`.
 *
 * **The contract names no interval** — it is gap D12 in
 * `api-doc/admin/dashboard/BACKEND-INTEGRATION-MATRIX.md`, left to the client. One minute:
 * long enough that a parked tab is not making hundreds of requests an hour, short
 * enough that a badge is not stale news. There is no realtime transport on this
 * platform (no WebSocket, no SSE), so polling is the only mechanism available.
 */
const DEFAULT_NOTIFICATIONS_POLL_MS = 60_000;

/** Below this it is chatter rather than a poll, whatever the environment says. */
const MIN_NOTIFICATIONS_POLL_MS = 10_000;

function readString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

function readInterval(raw: unknown, fallback: number, minimum: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

/** Drop a trailing slash so `${base}${path}` never produces a double slash. */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

const apiBaseUrl = stripTrailingSlash(
  readString(import.meta.env.VITE_API_BASE_URL, DEFAULT_API_BASE_URL),
);

/**
 * The health probes are mounted **unversioned** at `/health`, deliberately — a
 * probe URL is infrastructure and must not move when `/api/v1` becomes
 * `/api/v2`. So they cannot be reached by appending to the versioned base, and
 * the version segment is stripped instead of assuming an origin.
 */
const healthBaseUrl = apiBaseUrl.replace(/\/api\/v\d+$/, '');

export const env = {
  /** e.g. `http://localhost:8033/api/v1` — no trailing slash. */
  apiBaseUrl,
  /** e.g. `http://localhost:8033` — the origin the `/health/*` probes sit on. */
  healthBaseUrl,
  appName: readString(import.meta.env.VITE_APP_NAME, DEFAULT_APP_NAME),
  /** Inbox badge poll interval, in milliseconds. See the note above. */
  notificationsPollMs: readInterval(
    import.meta.env.VITE_NOTIFICATIONS_POLL_MS,
    DEFAULT_NOTIFICATIONS_POLL_MS,
    MIN_NOTIFICATIONS_POLL_MS,
  ),
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;

/**
 * A misconfigured base URL fails at the first request with an opaque network
 * error, which is a slow way to learn about a typo. Say it once, at boot.
 *
 * This warns rather than throws: pointing at a proxy or a deployed host is a
 * legitimate thing to do, and refusing to start would make that impossible.
 */
export function warnOnSuspectConfig(): void {
  if (!env.isDev) return;

  if (!/^https?:\/\//.test(env.apiBaseUrl)) {
    console.warn(
      `[config] VITE_API_BASE_URL does not look like an absolute URL: "${env.apiBaseUrl}"`,
    );
  }

  if (!/\/api\/v\d+$/.test(env.apiBaseUrl)) {
    console.warn(
      `[config] VITE_API_BASE_URL usually ends in /api/v1 — got "${env.apiBaseUrl}". ` +
        'Every documented path is relative to the versioned base.',
    );
  }
}
