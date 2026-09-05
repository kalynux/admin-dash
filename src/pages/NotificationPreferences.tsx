import { useMemo, useState } from 'react';
import { Info, Save } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { notify } from '@/lib/notify';
import {
    getNotificationPreferences,
    updateNotificationPreferences,
} from '@/services/notifications.service';
import type {
    DeclaredNotificationType,
    NotificationPreference,
    NotificationPreferenceOverrides,
} from '@/types/notifications.types';

/**
 * `/dashboard/account/notifications` — which events raise a notification for me.
 *
 * ── Permission-free, and that is the contract's decision ──────────────────────
 * Both routes are declared *self*: they act on the caller's own identity and
 * check nothing. The reasoning is worth keeping: *"gating an administrator's own
 * configuration behind a level permission would stop a Support administrator
 * configuring theirs, and a preference nobody can set is not a preference."*
 *
 * It is emphatically **not** `notifications.manage`. That permission is
 * catalogued with no endpoint and reads "configure which events raise an
 * administrator alert" — service-wide by its wording, where this is
 * per-administrator. A global switch over the source registry is the natural
 * thing to put behind it later.
 *
 * ── The three states, and why the third one has to exist ──────────────────────
 * An override is `true`, `false`, or **absent**. Without a way to send "absent"
 * the only way to stop overriding a type is to override it to whatever the
 * catalog's default happens to be today — which silently stops tracking the
 * catalog, so a later change to the default never reaches you. `null` in the
 * patch body is that third state.
 *
 * ── Read `overridden`, never value equality ───────────────────────────────────
 * `enabled === defaultEnabled` does **not** imply `overridden === false`. An
 * explicit override can agree with the catalog today and keep the old value when
 * the catalog moves. So the control's state comes from `overridden` alone.
 *
 * ── This is the one audited write on the surface ──────────────────────────────
 * `notifications.preferences.update_self`. The five inbox-hygiene routes record
 * nothing, because a read receipt says somebody looked; durable configuration
 * that changes what the service does in future is on the other side of that line.
 */

/** What a row's control can be set to. `default` is the absence of an override. */
type Choice = 'on' | 'off' | 'default';

const CHOICE_LABELS: Record<Choice, string> = {
    on: 'On',
    off: 'Off',
    default: 'Follow default',
};

/** The stored state of a row, before the operator has touched anything. */
function choiceOf(preference: NotificationPreference): Choice {
    if (!preference.overridden) return 'default';
    return preference.enabled ? 'on' : 'off';
}

/** A choice as the wire value. `default` is `null` — *remove the override*. */
function overrideOf(choice: Choice): boolean | null {
    if (choice === 'default') return null;
    return choice === 'on';
}

export function NotificationPreferences() {
    const read = useAsyncData('/notifications/preferences', (signal) =>
        getNotificationPreferences({ signal }),
    );

    /**
     * Only the rows the operator actually changed.
     *
     * A key absent from the patch means "leave whatever it had", so this map is
     * the patch. Sending the full list instead would convert every untouched
     * default-tracking row into an explicit override — the exact thing the third
     * state exists to avoid.
     */
    const [touched, setTouched] = useState<Partial<Record<string, Choice>>>({});
    const [isSaving, setIsSaving] = useState(false);
    /** The server's own sentence from the last save. It is asked to be shown. */
    const [savedMessage, setSavedMessage] = useState<string | null>(null);

    const preferences = useMemo(() => read.data ?? [], [read.data]);
    const changedCount = Object.keys(touched).length;

    function choose(type: string, next: Choice, stored: Choice) {
        setTouched((current) => {
            const draft = { ...current };
            // Setting a row back to what it already was is not a change, and
            // leaving it in would send an override the operator did not ask for.
            if (next === stored) delete draft[type];
            else draft[type] = next;
            return draft;
        });
    }

    async function save() {
        setIsSaving(true);
        try {
            const overrides: NotificationPreferenceOverrides = {};
            for (const [type, choice] of Object.entries(touched)) {
                if (!choice) continue;
                overrides[type as DeclaredNotificationType] = overrideOf(choice);
            }

            const result = await updateNotificationPreferences(overrides);

            setSavedMessage(result.message ?? null);
            setTouched({});
            // Refetch rather than adopting the response, so one source of truth
            // renders the list — the house rule every write on this dashboard
            // follows. The response is authoritative too, but two paths into the
            // same state is how they drift.
            read.reload();

            notify.success(result.message ?? 'Preferences saved');
        } catch (caught) {
            notify.apiError(caught);
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <PageContainer
            title="Notification preferences"
            description="Which platform events raise a notification for you. These are yours alone — they change nothing for anybody else."
            actions={
                <Button
                    size="sm"
                    onClick={() => void save()}
                    disabled={isSaving || changedCount === 0}
                >
                    <Save className="size-4" />
                    {changedCount === 0
                        ? 'Save'
                        : `Save ${changedCount} change${changedCount === 1 ? '' : 's'}`}
                </Button>
            }
        >
            {/*
              The contract's instruction about this is one word — "Show it." The
              obvious reading of muting a type is "this cleans up my inbox", and
              it is wrong: preferences are applied when a notification is fanned
              out, so muting stops the next one and touches nothing already
              delivered.
            */}
            <Alert>
                <Info className="size-4" />
                <AlertTitle>Preferences apply from now on</AlertTitle>
                <AlertDescription>
                    Turning a notification off stops the next one being raised. It does not remove
                    anything already in your inbox, and it never affects the thing the notification
                    was about — archive those from the inbox instead.
                </AlertDescription>
            </Alert>

            {savedMessage ? (
                <Alert>
                    <Info className="size-4" />
                    <AlertDescription>{savedMessage}</AlertDescription>
                </Alert>
            ) : null}

            <DataState
                isLoading={read.isLoading}
                error={read.error}
                isEmpty={preferences.length === 0}
                onRetry={read.reload}
                loading={<ListSkeleton rows={6} />}
                empty={
                    <EmptyState
                        title="No preferences to set"
                        description="The service reports no configurable notification types."
                    />
                }
            >
                <div className="divide-y overflow-hidden rounded-lg border">
                    {preferences.map((preference) => {
                        const stored = choiceOf(preference);
                        const current = touched[preference.type] ?? stored;
                        const isChanged = current !== stored;

                        return (
                            <div
                                key={preference.type}
                                className="flex flex-wrap items-start justify-between gap-4 p-4"
                            >
                                <div className="min-w-0 flex-1 space-y-1">
                                    <p className="text-sm font-medium">{preference.summary}</p>
                                    {/*
                                      Mono because it is machine vocabulary, not
                                      because it is a value: `type` is the same
                                      closed string the inbox offers as a filter
                                      option, and it names a *kind* of
                                      notification rather than identifying any
                                      row. Nothing downstream takes it as input,
                                      so it stays plain text.
                                    */}
                                    <p className="text-muted-foreground font-mono text-xs">
                                        {preference.type}
                                    </p>
                                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                                        {/* Raw, never switched on. */}
                                        <Badge
                                            variant="outline"
                                            className="text-[10px] font-normal"
                                        >
                                            {preference.severity}
                                        </Badge>
                                        <span>
                                            Default: {preference.defaultEnabled ? 'on' : 'off'}
                                        </span>
                                        {/*
                                          Shown from `overridden`, not from
                                          `enabled !== defaultEnabled` — the two
                                          are independent, and an override that
                                          agrees with today's default is still an
                                          override that will not follow it.
                                        */}
                                        {preference.overridden ? (
                                            <Badge
                                                variant="secondary"
                                                className="text-[10px] font-normal"
                                            >
                                                overridden
                                            </Badge>
                                        ) : null}
                                        {isChanged ? (
                                            <span className="text-foreground font-medium">
                                                unsaved
                                            </span>
                                        ) : null}
                                    </div>
                                </div>

                                <Select
                                    value={current}
                                    onValueChange={(value) =>
                                        choose(preference.type, value as Choice, stored)
                                    }
                                >
                                    <SelectTrigger
                                        className="h-9 w-44 shrink-0"
                                        aria-label={preference.type}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="on">{CHOICE_LABELS.on}</SelectItem>
                                        <SelectItem value="off">{CHOICE_LABELS.off}</SelectItem>
                                        <SelectItem value="default">
                                            {CHOICE_LABELS.default} (
                                            {preference.defaultEnabled ? 'on' : 'off'})
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        );
                    })}
                </div>
            </DataState>
        </PageContainer>
    );
}
