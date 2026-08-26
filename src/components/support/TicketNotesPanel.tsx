import { useState } from 'react';

import { Can } from '@/components/auth/Can';
import { AuthFormError } from '@/components/auth/AuthFormError';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncData } from '@/hooks/use-async-data';
import { notify } from '@/lib/notify';
import { createTicketNote, listTicketNotes } from '@/services/support.service';
import { NOTE_MAX_LENGTH } from '@/types/support.types';

/**
 * Internal notes on a ticket.
 *
 * ── ⚠ `isPublic` decides whether the CUSTOMER reads this ──────────────────────
 * `false` files the note private: the author, every administrator following the
 * ticket, and nobody else. `true` shows it to **every follower — which means the
 * customer**. The default is the safety property, and the control is worded so
 * the consequence is stated rather than implied.
 *
 * That default is not a nicety. **Until 2026-08-20 every note this service
 * created was filed public**: jovi-mall names the field `visibility` and its
 * schema is non-strict, so `isPublic` was stripped in transit and defaulted to
 * `'public'` — a `201`, no warning, and the customer reading staff commentary.
 * It is fixed at the gateway now, and this panel keeps saying which way the
 * switch points because the failure was silent.
 *
 * ── Administrators see everything, including private notes ────────────────────
 * On a ticket they may read. The scope runs first, so an out-of-scope ticket is
 * a `404` and no note leaves jovi-mall.
 *
 * ── A closed ticket refuses notes ─────────────────────────────────────────────
 * jovi-mall answers `409`. The form says so and hides itself rather than
 * offering a write whose only outcome is a refusal.
 *
 * ── The response is jovi-mall's own shape ─────────────────────────────────────
 * Passed through verbatim — author identity resolved, snake_case included — and
 * this repository documents no field table for it. So the rows are rendered
 * defensively from whatever arrives rather than modelled.
 */
export function TicketNotesPanel({ ticketId, closed }: { ticketId: string; closed: boolean }) {
    const [reloadToken, setReloadToken] = useState(0);
    const [content, setContent] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const notes = useAsyncData(`/support/tickets/${ticketId}/notes#${reloadToken}`, (signal) =>
        listTicketNotes(ticketId, { signal }),
    );

    const rows = normaliseNotes(notes.data);

    async function submit() {
        const trimmed = content.trim();
        if (!trimmed) return;

        setSubmitting(true);
        setFormError(null);
        try {
            await createTicketNote(ticketId, { content: trimmed, isPublic });
            notify.success(isPublic ? 'Note added, visible to the customer' : 'Private note added');
            setContent('');
            // Deliberately NOT resetting `isPublic` to whatever it was: the safe
            // value is the default, and a sticky "public" from a previous note is
            // how the next one leaks.
            setIsPublic(false);
            setReloadToken((token) => token + 1);
        } catch (error) {
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {notes.isLoading ? (
                        <InlineLoader />
                    ) : notes.error ? (
                        <ErrorState error={notes.error} onRetry={notes.reload} />
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            No notes on this ticket yet.
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {rows.map((note, index) => (
                                <li key={note.id ?? index} className="rounded-lg border px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">
                                            {note.author ?? 'Unknown author'}
                                        </span>
                                        {/*
                                          Stated on every row, not only the public
                                          ones: "private" is the reassurance, and a
                                          row with no marker reads as unknown.
                                        */}
                                        <Badge variant={note.isPublic ? 'default' : 'outline'}>
                                            {note.isPublic ? 'Customer can see this' : 'Private'}
                                        </Badge>
                                        {note.createdAt ? (
                                            <span className="text-muted-foreground text-xs">
                                                {note.createdAt}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-1 text-sm whitespace-pre-wrap">
                                        {note.content}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Can permission="support.tickets.notes.write">
                <Card>
                    <CardHeader>
                        <CardTitle>Add a note</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {closed ? (
                            <p className="text-muted-foreground text-sm">
                                This ticket is closed, and a closed ticket refuses new notes.
                                Reopen it first.
                            </p>
                        ) : (
                            <>
                                <Textarea
                                    rows={3}
                                    maxLength={NOTE_MAX_LENGTH}
                                    value={content}
                                    onChange={(event) => setContent(event.target.value)}
                                    placeholder="What a colleague picking this up needs to know"
                                    aria-label="Note"
                                />
                                <p className="text-muted-foreground text-xs">
                                    {content.trim().length}/{NOTE_MAX_LENGTH} characters. The audit
                                    trail records that a note was added and whether it was public —
                                    never the text, because the note itself is the durable record.
                                </p>

                                <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
                                    <Switch
                                        id="note-is-public"
                                        checked={isPublic}
                                        onCheckedChange={setIsPublic}
                                    />
                                    <div className="space-y-0.5">
                                        <Label htmlFor="note-is-public" className="text-sm">
                                            Show this to the customer
                                        </Label>
                                        <p className="text-muted-foreground text-xs">
                                            {isPublic
                                                ? 'Everyone following this ticket will see it, including the person who raised it.'
                                                : 'Staff only — the author and administrators following this ticket.'}
                                        </p>
                                    </div>
                                </div>

                                {formError ? <AuthFormError error={formError} /> : null}

                                <Button
                                    onClick={submit}
                                    disabled={submitting || content.trim().length === 0}
                                >
                                    {submitting ? <InlineLoader /> : null}
                                    {isPublic ? 'Post for the customer' : 'Add private note'}
                                </Button>
                            </>
                        )}
                    </CardContent>
                </Card>
            </Can>
        </div>
    );
}

interface RenderableNote {
    id?: string;
    author?: string;
    content: string;
    isPublic: boolean;
    createdAt?: string;
}

/**
 * jovi-mall's notes, passed through verbatim and undocumented in this
 * repository — so read defensively rather than modelled.
 *
 * ⚠ **The visibility field is jovi-mall's `visibility` string, not the
 * `isPublic` boolean this service accepts on the way in.** The translation
 * happens at the gateway on writes and does not happen on reads, so both spellings
 * are checked here. Defaulting to *private* when neither is present is the same
 * safety direction the write default takes.
 */
function normaliseNotes(data: unknown): RenderableNote[] {
    if (!Array.isArray(data)) return [];

    return data.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const row = raw as Record<string, unknown>;

        const content =
            typeof row.content === 'string'
                ? row.content
                : typeof row.note === 'string'
                  ? row.note
                  : '';
        if (!content) return [];

        const isPublic =
            typeof row.isPublic === 'boolean'
                ? row.isPublic
                : row.visibility === 'public'
                  ? true
                  : false;

        const author =
            typeof row.authorName === 'string'
                ? row.authorName
                : typeof row.author === 'string'
                  ? row.author
                  : typeof (row.author as { name?: unknown })?.name === 'string'
                    ? ((row.author as { name: string }).name)
                    : undefined;

        return [
            {
                id: typeof row.id === 'string' ? row.id : undefined,
                author,
                content,
                isPublic,
                createdAt:
                    typeof row.createdAt === 'string'
                        ? row.createdAt
                        : typeof row.created_at === 'string'
                          ? row.created_at
                          : undefined,
            },
        ];
    });
}
