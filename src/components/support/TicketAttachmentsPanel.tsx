import { useState } from 'react';
import { Paperclip, Trash2 } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    attachFileToTicket,
    deleteTicketAttachment,
    listTicketAttachments,
} from '@/services/support.service';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * A ticket's attachments.
 *
 * ── ⚠ There is no upload here, and there cannot be ────────────────────────────
 * **wi-admin accepts no multipart body on any route.** The upload happens
 * against jovi-mall, and this endpoint attaches the resulting file id. So the
 * control is an id field, not a file picker, and the copy says why rather than
 * leaving an operator hunting for a missing button.
 *
 * ── 🔴 A support attachment URL is public AND permanent ───────────────────────
 * They land in `documents/` or `images/` — **public** storage trees — so unlike
 * a delivery-proof photo they resolve with a real URL, and anyone holding that
 * URL can open it, with no session, for as long as the file exists.
 *
 * ⚠ **This panel used to tell the operator those links expire.** `support.md`
 * asserted it and this copy repeated it; the backend checked the source at
 * BR-012 and the value is `getPublicUrl(key)` — no signature, no expiry. The
 * wording was wrong in the reassuring direction, which is the worst direction
 * for a link somebody might paste into a group chat. Corrected here and in
 * `support.types.ts`.
 *
 * ── The delete is keyed on the attachment, not the ticket ─────────────────────
 * `DELETE /support/tickets/attachments/:attachmentId`, mirroring jovi-mall's own
 * route shape, because the attachment row is the only thing naming its ticket.
 * A `404 TICKET_NOT_FOUND` there covers both "no such attachment" and "its
 * ticket is outside your scope" — identical code, identical message, because two
 * 404s differing only in `error.code` are still an existence oracle.
 */
export function TicketAttachmentsPanel({ ticketId }: { ticketId: string }) {
    const [reloadToken, setReloadToken] = useState(0);
    const [fileId, setFileId] = useState('');
    const [busy, setBusy] = useState(false);

    const attachments = useAsyncData(
        `/support/tickets/${ticketId}/attachments#${reloadToken}`,
        (signal) => listTicketAttachments(ticketId, { signal }),
    );

    const rows = attachments.data ?? [];
    const idIsValid = OBJECT_ID.test(fileId.trim());

    async function attach() {
        if (!idIsValid) return;
        setBusy(true);
        try {
            await attachFileToTicket(ticketId, { fileId: fileId.trim() });
            notify.success('File attached');
            setFileId('');
            setReloadToken((token) => token + 1);
        } catch (error) {
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    async function remove(attachmentId: string) {
        setBusy(true);
        try {
            await deleteTicketAttachment(attachmentId);
            notify.success('Attachment removed');
            setReloadToken((token) => token + 1);
        } catch (error) {
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Attachments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {attachments.isLoading ? (
                        <InlineLoader />
                    ) : attachments.error ? (
                        <ErrorState error={attachments.error} onRetry={attachments.reload} />
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Nothing is attached.</p>
                    ) : (
                        <>
                            <ul className="space-y-2">
                                {rows.map((row) => (
                                    <li
                                        key={row.id}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    >
                                        <div className="min-w-0 space-y-0.5">
                                            <p className="truncate text-sm font-medium">
                                                {row.url ? (
                                                    <a
                                                        href={row.url}
                                                        target="_blank"
                                                        rel="noreferrer noopener"
                                                        className="hover:underline"
                                                    >
                                                        {row.fileName ?? 'Unnamed file'}
                                                    </a>
                                                ) : (
                                                    (row.fileName ?? 'Unnamed file')
                                                )}
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                {row.mimeType ?? 'unknown type'}
                                                {typeof row.fileSize === 'number'
                                                    ? ` · ${formatBytes(row.fileSize)}`
                                                    : ''}
                                                {row.uploadedByRole
                                                    ? ` · from the ${row.uploadedByRole}`
                                                    : ''}
                                            </p>
                                        </div>

                                        <Can permission="support.tickets.attachments.write">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={busy}
                                                onClick={() => remove(row.id)}
                                            >
                                                <Trash2 className="size-4" />
                                                Remove
                                            </Button>
                                        </Can>
                                    </li>
                                ))}
                            </ul>

                            <p className="text-muted-foreground text-xs">
                                Support attachments live in a public storage tree, so these links
                                need no sign-in and{' '}
                                <strong className="font-medium">never expire</strong> — anyone they
                                reach can open the file for as long as it exists. Treat one as a
                                shareable secret rather than a link, and keep it out of any channel
                                that outlives the ticket.
                            </p>
                        </>
                    )}
                </CardContent>
            </Card>

            <Can permission="support.tickets.attachments.write">
                <Card>
                    <CardHeader>
                        <CardTitle>Attach a file</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-muted-foreground text-sm">
                            This dashboard cannot upload — no route on this service accepts a file
                            body. Upload against the platform first, then attach the id it
                            returned.
                        </p>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="attach-file-id">File id</Label>
                                <Input
                                    id="attach-file-id"
                                    value={fileId}
                                    onChange={(event) => setFileId(event.target.value)}
                                    placeholder="6612a4f0c1a2b3d4e5f60718"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-72"
                                />
                            </div>
                            <Button onClick={attach} disabled={busy || !idIsValid}>
                                <Paperclip className="size-4" />
                                Attach
                            </Button>
                        </div>
                        {fileId.length > 0 && !idIsValid ? (
                            <p className="text-destructive text-xs">
                                A file id is 24 hexadecimal characters.
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            </Can>
        </div>
    );
}
