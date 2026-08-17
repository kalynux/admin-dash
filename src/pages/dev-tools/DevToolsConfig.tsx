import { EyeOff, RotateCw } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { REDACTED, isCredentialKey } from '@/lib/audit-redaction';
import { scrubJson, scrubText, scrubbedText } from '@/lib/scrub-secrets';
import { getExposedConfig, getPlatformConfig } from '@/services/system.service';
import { CONFIG_SET_NOTE } from '@/types/system.types';

/**
 * One configuration entry.
 *
 * ── Every value on this screen passes through here ────────────────────────────
 * Which is why the scrub lives at this one point rather than at the four call
 * sites: wi-admin's keys, the platform's keys and the derived `wiring` block all
 * render through `ConfigRow`, so a value that ever slips past an allowlist is
 * caught wherever it came from.
 *
 * ── Both a name test and a value test, because they fail differently ──────────
 * The **name** test is `isCredentialKey`, the same predicate the audit trail
 * uses — a key called `SMTP_PASSWORD` is withheld whole, without the dashboard
 * having to recognise the shape of what is in it. The **value** test is the
 * scrubber, for the key whose name looks innocent.
 *
 * ⚠ If either fires, that is a **backend finding, not routine masking**. ADR-015
 * D-4 makes the whitelist the control and the `FORBIDDEN_CONFIG_TOKEN` regex the
 * backstop, both asserted at boot in both services — so a credential arriving
 * here means one of those failed, and the copy says so rather than quietly
 * tidying it away.
 */
function ConfigRow({
    name,
    value,
    set,
}: {
    name: string;
    value: string | number | boolean | null;
    set?: boolean;
}) {
    const nameIsCredentialShaped = isCredentialKey(name);

    /**
     * `ADMIN_DASHBOARD_ORIGINS` arrives **comma-joined**, not as an array — the service renders
     * anything non-scalar with `String()` so the wire shape stays flat. Split for display only;
     * typing it as an array would put `.map` on a string.
     */
    const parts = typeof value === 'string' && value.includes(',') ? value.split(',') : null;
    const scrubbed = value === null ? null : scrubText(String(value));

    return (
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 text-xs">
            <span className="text-muted-foreground min-w-0 font-mono break-all">{name}</span>
            <span className="min-w-0 text-right break-all">
                {value === null ? (
                    <span className="text-muted-foreground">
                        {set === false ? 'not set' : '—'}
                    </span>
                ) : nameIsCredentialShaped ? (
                    <span className="font-mono">{REDACTED}</span>
                ) : parts ? (
                    <span className="flex flex-wrap justify-end gap-1">
                        {parts.map((part) => (
                            <Badge
                                key={part}
                                variant="outline"
                                className="font-mono text-[10px] font-normal"
                            >
                                {scrubbedText(part.trim())}
                            </Badge>
                        ))}
                    </span>
                ) : (
                    <span className="font-mono">{scrubbed?.text}</span>
                )}
                {nameIsCredentialShaped ? (
                    <ConfigLeakNotice reason="its name is credential-shaped" />
                ) : scrubbed && scrubbed.matched.length > 0 ? (
                    <ConfigLeakNotice reason="its value looked like a credential" />
                ) : null}
            </span>
        </div>
    );
}

/**
 * Deliberately worded as a defect report rather than as reassurance — see the
 * `ConfigRow` header. An operator seeing this should file it upstream.
 */
function ConfigLeakNotice({ reason }: { reason: string }) {
    return (
        <span className="text-warning mt-1 flex items-start justify-end gap-1.5 text-[11px]">
            <EyeOff className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
                Withheld by this dashboard because {reason}. Both services assert a config
                allowlist at boot, so this should not be reachable — worth reporting.
            </span>
        </span>
    );
}

/**
 * Runtime configuration, for both services.
 *
 * ── Two endpoints, two different shapes ──────────────────────────────────────
 * wi-admin's own answers an **array of `{key, value}`** — despite `system.md` documenting a flat
 * object keyed by name, which is why `getExposedConfig` normalises both. The platform's answers
 * `{service, entries: [{key, value, set}], wiring, note}`. They are not interchangeable and a
 * single renderer over both would drop `set`.
 *
 * ── `set: false` is not `value: null` ────────────────────────────────────────
 * There is no central validated config object on the platform; almost every key has a
 * compiled-in default applied by its own module. A bare null would read as "this sweep has no
 * schedule" when it means "the default applies". So the two reads are complementary: **this
 * screen says what has been configured, System › Workers says what is in force.**
 *
 * ── Why no URL appears anywhere ──────────────────────────────────────────────
 * Every `*_URL` and `*_URI` is withheld by an allowlist checked at boot: they carry a password in
 * userinfo in any real deployment. The gap that would leave — "is the dispatcher pointed at
 * anything" — is filled by the derived `wiring` block instead, every field of which is a
 * predicate that cannot carry a credential by construction.
 */
export function DevToolsConfig() {
    const { token, refresh } = useRefreshToken();

    const own = useAsyncData(`/system/config#${token}`, (signal) => getExposedConfig({ signal }));
    const platform = useAsyncData(`/system/platform/config#${token}`, (signal) =>
        getPlatformConfig({ signal }),
    );

    return (
        <PageContainer
            title="Configuration"
            description="What each service has been configured with — from a whitelist, never a spread of the environment."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">wi-admin</CardTitle>
                        <CardDescription>
                            This service's own. A key whose name looks credential-shaped stops it
                            from starting, so nothing secret can appear here by accident.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DataState isLoading={own.isLoading} error={own.error} onRetry={own.reload}>
                            <div className="divide-border divide-y rounded-md border">
                                {(own.data ?? []).map((entry) => (
                                    <ConfigRow
                                        key={entry.key}
                                        name={entry.key}
                                        value={entry.value}
                                    />
                                ))}
                            </div>
                        </DataState>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {platform.data?.service ?? 'Platform'}
                        </CardTitle>
                        <CardDescription>
                            The platform's, with its own allowlist and its own boot assertion.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DataState
                            isLoading={platform.isLoading}
                            error={platform.error}
                            onRetry={platform.reload}
                        >
                            {platform.data ? (
                                <div className="space-y-3">
                                    <div className="divide-border divide-y rounded-md border">
                                        {platform.data.entries.map((entry) => (
                                            <ConfigRow
                                                key={entry.key}
                                                name={entry.key}
                                                value={entry.value}
                                                set={entry.set}
                                            />
                                        ))}
                                    </div>

                                    <div className="space-y-1">
                                        <p className="text-sm font-medium">Wiring</p>
                                        <div className="divide-border divide-y rounded-md border">
                                            {Object.entries(platform.data.wiring).map(
                                                ([key, value]) => (
                                                    <ConfigRow
                                                        key={key}
                                                        name={key}
                                                        value={
                                                            typeof value === 'string' ||
                                                            typeof value === 'number' ||
                                                            typeof value === 'boolean'
                                                                ? value
                                                                : // A nested wiring value gets the
                                                                  // key net too — `ConfigRow`'s own
                                                                  // name test only sees the outer
                                                                  // key, not the ones inside.
                                                                  scrubJson(value, 0).text
                                                        }
                                                    />
                                                ),
                                            )}
                                        </div>
                                        <p className="text-muted-foreground text-xs">
                                            No URL or URI is exposed by either service — they carry
                                            a password in userinfo in any real deployment. This
                                            block is derived instead, and cannot carry one.
                                        </p>
                                    </div>

                                    {platform.data.note ? (
                                        <p className="text-muted-foreground text-xs">
                                            {platform.data.note}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </DataState>
                    </CardContent>
                </Card>
            </div>

            <p className="text-muted-foreground text-xs">{CONFIG_SET_NOTE}</p>
        </PageContainer>
    );
}
