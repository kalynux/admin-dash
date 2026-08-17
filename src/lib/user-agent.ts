/**
 * A readable name for a user agent string.
 *
 * Best-effort by design and it never throws: the service stores whatever the
 * browser sent, unparsed, and the value is only ever a hint to help somebody
 * recognise a device. An unrecognised agent shows verbatim rather than becoming
 * "Unknown", which would hide the one clue there is.
 *
 * Shared by the two session lists — your own on `/dashboard/account/security`
 * and another administrator's on their detail page. They render different
 * projections of a session but the same `userAgent` field, so a second copy of
 * this would be a second set of browser patterns to keep in step.
 */
export function describeUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';

    const browser = /Edg\//.test(userAgent)
        ? 'Edge'
        : /OPR\//.test(userAgent)
          ? 'Opera'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : /Chrome\//.test(userAgent)
              ? 'Chrome'
              : /Safari\//.test(userAgent)
                ? 'Safari'
                : null;

    const platform = /Windows/.test(userAgent)
        ? 'Windows'
        : /Android/.test(userAgent)
          ? 'Android'
          : /iPhone|iPad|iOS/.test(userAgent)
            ? 'iOS'
            : /Mac OS X|Macintosh/.test(userAgent)
              ? 'macOS'
              : /Linux/.test(userAgent)
                ? 'Linux'
                : null;

    if (browser && platform) return `${browser} on ${platform}`;
    if (browser) return browser;
    if (platform) return platform;
    return userAgent.length > 48 ? `${userAgent.slice(0, 48)}…` : userAgent;
}
