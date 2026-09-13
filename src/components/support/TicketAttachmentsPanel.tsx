import { useState } from 'react';
import {
    AlertTriangle,
    ExternalLink,
    FileQuestion,
    Images,
    Paperclip,
    Trash2,
} from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import {
    IMAGE_BOX_RATIO,
    ImageBox,
    ImageBoxFrame,
    ImageBoxNotice,
} from '@/components/files/ImageBox';
import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { TicketActorName } from '@/components/support/TicketActorName';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/notify';
import { getFile, resolveFiles } from '@/services/files.service';
import {
    attachFileToTicket,
    deleteTicketAttachment,
    listTicketAttachments,
} from '@/services/support.service';
import { ApiError } from '@/types/api.types';
import {
    FILE_RESOLVE_MAX_IDS,
    QUOTA_BLOCKED_COPY,
    isQuotaBlocked,
    isViewableImage,
    type FileDetail,
} from '@/types/files.types';
import type { TicketAttachment } from '@/types/support.types';

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
 * `support.types.ts`, and **it stays visible whichever way the picture is
 * fetched** — it is a fact about the stored file, not about how this screen
 * reads it.
 *
 * ── ⚠ Looking at one is audited, and the click is the consent ────────────────
 * Phase D shipped `<ImageBox src={row.url}>` here — the direct-render variant,
 * every picture visible on load — because **the attachment row carried no file
 * id** and the audited content route had nothing to address. That was a
 * constraint, not a choice, and it was raised as a backend ask. It landed on
 * 2026-08-26: `fileId` is now stamped onto every row by wi-admin itself.
 *
 * So this panel now works like every other image on the dashboard. Opening a
 * ticket no longer paints a customer's uploaded photographs onto the screen of
 * whoever happened to open it; each one waits for a click, and each click is
 * recorded. ⚠ **The audit row records OUR access, not the file's exposure** —
 * the URL underneath is still public and still permanent, which is why the
 * warning below did not soften by one word.
 *
 * ── ⚠ One resolve for the whole ticket, not one per row ──────────────────────
 * `ResolvedImageBox` — the component § D2 named — resolves *per box*, which is
 * a request per attachment for a description this row already carries
 * (`fileName`, `mimeType`, `fileSize` are all on it). `GET /files?ids=` exists
 * to answer a whole page at once, so the panel resolves once and hands each box
 * the `FileDetail` it needs. `ResolvedImageBox` is still right where a DTO
 * carries *only* an id; here it would be a redundant round trip per row.
 *
 * ── The delete is keyed on the attachment, not the ticket ─────────────────────
 * `DELETE /support/tickets/attachments/:attachmentId`, mirroring jovi-mall's own
 * route shape, because the attachment row is the only thing naming its ticket.
 * A `404 TICKET_NOT_FOUND` there covers both "no such attachment" and "its
 * ticket is outside your scope" — identical code, identical message, because two
 * 404s differing only in `error.code` are still an existence oracle.
 *
 * ⚠ **`row.id` and `row.fileId` are both 24-hex on the same object.** The
 * delete takes the first; everything in `/files` takes the second. Swapping them
 * resolves the wrong record rather than failing.
 */
export function TicketAttachmentsPanel({ ticketId }: { ticketId: string }) {
    const [reloadToken, setReloadToken] = useState(0);
    const [fileId, setFileId] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const attachments = useAsyncData(
        `/support/tickets/${ticketId}/attachments#${reloadToken}`,
        (signal) => listTicketAttachments(ticketId, { signal }),
    );

    const rows = attachments.data ?? [];

    /*
      ⚠ **Bounded, and the cap is reported rather than swallowed.** The list is
      unbounded on the wire and `resolveFiles` throws above its ceiling, so a
      ticket with a hundred and one attachments would take the whole panel down.
      A truncation that renders as an empty tile reads as "this file has no
      picture", which is why the notice names it instead.
    */
    const wanted = rows.map((row) => row.fileId).filter((id): id is string => Boolean(id));
    const fileIds = wanted.slice(0, FILE_RESOLVE_MAX_IDS);
    const truncated = wanted.length > fileIds.length;

    /*
      One request for the whole list — and none at all when nothing needs one,
      because `resolveFiles` answers an empty request locally rather than
      spending a round trip to be told off by a `400`.
    */
    const files = useAsyncData(`/files?ids=${fileIds.join(',')}#${reloadToken}`, (signal) =>
        resolveFiles(fileIds, { signal }),
    );

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
                            {truncated ? (
                                <p className="text-warning flex items-start gap-1.5 text-xs">
                                    <AlertTriangle
                                        className="mt-0.5 size-3.5 shrink-0"
                                        aria-hidden
                                    />
                                    <span>
                                        This ticket has more than {FILE_RESOLVE_MAX_IDS}{' '}
                                        attachments. Previews are shown for the first{' '}
                                        {FILE_RESOLVE_MAX_IDS}; every file is still listed and
                                        still reachable by its link.
                                    </span>
                                </p>
                            ) : null}

                            <ul className="space-y-2">
                                {rows.map((row) => (
                                    <li
                                        key={row.id}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    >
                                        <div className="flex min-w-0 flex-1 items-start gap-3">
                                            {isViewableImage({ mimeType: row.mimeType ?? '' }) ? (
                                                <div className="w-24 shrink-0">
                                                    <AttachmentImage
                                                        row={row}
                                                        file={
                                                            row.fileId
                                                                ? files.data?.get(row.fileId)
                                                                : undefined
                                                        }
                                                        isLoading={files.isLoading}
                                                        error={files.error}
                                                    />
                                                </div>
                                            ) : null}

                                            <div className="min-w-0 space-y-0.5">
                                                <p className="truncate text-sm font-medium">
                                                    {row.fileName ?? 'Unnamed file'}
                                                </p>
                                                <p className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-xs">
                                                    <span>{row.mimeType ?? 'unknown type'}</span>
                                                    {typeof row.fileSize === 'number' ? (
                                                        <span>· {formatBytes(row.fileSize)}</span>
                                                    ) : null}
                                                    <span>· Uploaded by</span>
                                                    {/*
                                                      ⚠ Never `uploadedByActor.name` raw. For an
                                                      administrator it is the literal "Admin", and
                                                      for a deleted profile it is the capitalised
                                                      role — see `TicketActorName`.
                                                    */}
                                                    <TicketActorName
                                                        actor={row.uploadedByActor}
                                                        role={row.uploadedByRole}
                                                    />
                                                </p>
                                                {row.url ? (
                                                    <p className="text-xs">
                                                        {/*
                                                          ⚠ Deliberately a second, labelled action
                                                          rather than the filename itself. The
                                                          picture above is the audited way to look;
                                                          this is the raw public URL, and an
                                                          operator following it should know which
                                                          of the two they are using. It stays
                                                          because a PDF or a zip has no other door
                                                          on this panel.
                                                        */}
                                                        <a
                                                            href={row.url}
                                                            target="_blank"
                                                            rel="noreferrer noopener"
                                                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 hover:underline"
                                                            aria-label={`Open ${row.fileName ?? 'this file'} by its public link, which needs no sign-in and never expires`}
                                                        >
                                                            <ExternalLink
                                                                className="size-3"
                                                                aria-hidden
                                                            />
                                                            Open the public link
                                                        </a>
                                                    </p>
                                                ) : null}
                                            </div>
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
                        {/*
                          ⚠ **Rewritten on 2026-08-27, and the old sentence was
                          true when it was written.** It said this dashboard
                          cannot upload, *"no route on this service accepts a file
                          body"* — which was the contract until BR-015. Leaving it
                          would have been the dashboard asserting something false
                          about the service, which is the failure four `InfoHint`s
                          on the order and timeline screens had already committed
                          once.
                        */}
                        <p className="text-muted-foreground text-sm">
                            Attach a file the platform already holds. Browse the administration
                            &rsquo;s own uploads, or upload one — either way the attachment is made
                            by file id, and pasting an id you were given works too.
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
                            {/*
                              ⚠ The picker fills the field rather than attaching
                              directly, and that is deliberate: the write is
                              `POST …/attachments`, a separate act from choosing,
                              and the preview below is what an operator checks
                              between the two. Attaching on selection would remove
                              the only look they get.

                              ⚠ **`requirePublicUrl` is NOT set.** This route takes
                              a `fileId`, so a file with no public address is
                              perfectly attachable here — unlike the blog, which
                              stores the URL string itself.
                            */}
                            <Button variant="outline" onClick={() => setPickerOpen(true)}>
                                <Images className="size-4" />
                                Browse media
                            </Button>
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

                        {idIsValid ? <AttachmentPreview fileId={fileId.trim()} /> : null}

                        <MediaPickerDialog
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            title="Choose a file to attach"
                            imagesOnly={false}
                            onSelect={(file) => setFileId(file.id)}
                        />
                    </CardContent>
                </Card>
            </Can>
        </div>
    );
}

/**
 * One attachment's picture, in whichever of five states it is actually in.
 *
 * ⚠ **Four of the five are not failures**, and none of them may fall back to
 * `row.url`. A silent fall-through to the direct render would put the picture on
 * screen with no audit row for reasons the operator never sees — the panel would
 * be audited on a good day and not on a bad one, which is worse than either
 * consistently. The public link is still offered beside the row, labelled, so
 * nothing is unreachable; it is just no longer the thing that happens by
 * accident.
 */
function AttachmentImage({
    row,
    file,
    isLoading,
    error,
}: {
    row: TicketAttachment;
    file: FileDetail | undefined;
    isLoading: boolean;
    error: unknown;
}) {
    const alt = row.fileName ?? 'the attachment';
    const caption = [
        row.fileName,
        row.mimeType,
        typeof row.fileSize === 'number' ? formatBytes(row.fileSize) : null,
    ]
        .filter(Boolean)
        .join(' · ');

    if (file) return <ImageBox file={file} alt={alt} caption={caption} />;

    if (isLoading) {
        return (
            <ImageBoxFrame ratio={IMAGE_BOX_RATIO}>
                <div className="flex h-full w-full items-center justify-center">
                    <InlineLoader label="Loading…" />
                </div>
            </ImageBoxFrame>
        );
    }

    if (error) {
        return (
            <ImageBoxNotice
                ratio={IMAGE_BOX_RATIO}
                tone="destructive"
                icon={AlertTriangle}
                title={resolveErrorMessage(error)}
                body={resolveErrorDetail(error) ?? 'The file itself is still listed below.'}
            />
        );
    }

    /*
      ⚠ `fileId: null` is a RACE, not missing data — the attachment was deleted
      between jovi-mall answering the list and wi-admin reading the row, so this
      row is already stale. The key is always present, so this is the only thing
      its absence can mean.
    */
    if (!row.fileId) {
        return (
            <ImageBoxNotice
                ratio={IMAGE_BOX_RATIO}
                icon={FileQuestion}
                title="Removed a moment ago"
                body="This attachment was deleted while the list was loading. Reload the ticket."
            />
        );
    }

    /*
      Asked for and not returned. ⚠ The batch form never raises `FILE_NOT_FOUND`
      — a short response IS the answer — so an id missing from the map means the
      sweep reached the file while the attachment row outlived it.
    */
    return (
        <ImageBoxNotice
            ratio={IMAGE_BOX_RATIO}
            icon={FileQuestion}
            title="This file has been cleaned up"
            body="The ticket still lists it, but the file itself is no longer stored."
        />
    );
}

/**
 * What is about to be attached, resolved before the write.
 *
 * ── Why this is worth a request ──────────────────────────────────────────────
 * The control takes a 24-hex id typed or pasted from somewhere else, and until
 * now the only way to find out whether it named the right file — or any file —
 * was to attach it and look at the list afterwards. `POST` is **delegated**, so
 * a wrong id comes back as a `PLATFORM_OPERATION_REJECTED` after the hop rather
 * than as a local `400`, and a *valid* id naming the wrong picture comes back as
 * a `201`. This turns both into something visible before the button is pressed.
 *
 * ── ⚠ Resolving on mount is correct here, and it is the only read that is ────
 * `GET /files/:fileId` is **unaudited and held by every tier**: resolving an id
 * the caller already typed discloses nothing new, which is exactly why it may
 * run without a gesture. `GET /files/:fileId/content` is neither of those
 * things, which is why the box below still waits for a click on anything
 * private. Reversing the two would file a disclosure against an operator who
 * pasted a wrong id.
 *
 * ── ⚠ A ticket attachment is public, but this control accepts ANY file id ────
 * An attachment lands in `documents/` or `images/` — public trees — so the
 * ordinary case resolves with a real `url` and renders immediately. Nothing
 * stops an operator pasting a `shipments/` or `digital/` id, which resolves with
 * `url: null` and goes through the audited content route on a click. The branch
 * is on the resolved `url`, never on an assumption about which tree the id came
 * from.
 *
 * ⚠ **It does not gate the button.** A `404` here is a strong signal and not a
 * proof: `files.resolve` is scoped, and a file this account cannot resolve is
 * not necessarily a file the platform will refuse to attach. The preview reports
 * what it found and leaves the decision where it was.
 */
function AttachmentPreview({ fileId }: { fileId: string }) {
    const file = useAsyncData(`/files/${fileId}`, (signal) => getFile(fileId, { signal }));

    if (file.isLoading) {
        return (
            <div className="rounded-lg border p-3">
                <InlineLoader label="Looking up that file…" />
            </div>
        );
    }

    if (file.error) {
        const missing = file.error instanceof ApiError && file.error.isNotFound;
        return (
            <div className="border-warning/30 bg-warning/5 rounded-lg border p-3">
                <p className="text-sm font-medium">
                    {missing ? 'No file with that id' : resolveErrorMessage(file.error)}
                </p>
                <p className="text-muted-foreground text-xs">
                    {missing
                        ? 'It may have been swept, or it may belong to a tree this account cannot resolve. Attaching it will most likely be refused by the platform.'
                        : (resolveErrorDetail(file.error) ??
                          'The attach button is still available — this check is advisory.')}
                </p>
            </div>
        );
    }

    const detail = file.data;
    if (!detail) return null;

    return (
        <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">This is what will be attached</p>

            <div className="flex flex-wrap items-start gap-3">
                <div className="w-32 shrink-0">
                    {/* Public tree → the URL the resolve already gave, shown at
                        once. Anything else → the audited route, which asks.

                        🔴 A third branch stood first here until 2026-09-09, for a
                        file blocked on its owner's storage cap, because *"the
                        content route cannot serve it either"*. It can (BR-023), so
                        a blocked file now takes the audited branch like any other
                        file without a usable URL — and `ImageBox` says why the
                        thumbnail was not simply there. */}
                    {detail.url && isViewableImage(detail) ? (
                        <ImageBox src={detail.url} alt={detail.originalName ?? 'the file'} />
                    ) : (
                        <ResolvedImageBox
                            fileId={detail.id}
                            alt={detail.originalName ?? 'the file'}
                        />
                    )}
                </div>

                <dl className="min-w-0 flex-1 space-y-0.5 text-xs">
                    <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Name</dt>
                        <dd className="min-w-0 break-words">
                            {detail.originalName ?? <NotSet />}
                        </dd>
                    </div>
                    <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Type</dt>
                        <dd>
                            {detail.mimeType || 'unknown'} · {formatBytes(detail.size)}
                        </dd>
                    </div>
                    <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Storage</dt>
                        {/*
                          ⚠ Worth showing rather than hiding. A `public` file is
                          about to become a permanent unauthenticated link on a
                          ticket; an `authorized` one is a file whose tree was
                          never meant to be attached to anything, and an operator
                          should see which they picked before they press the
                          button rather than after.

                          ⚠ **And a `quota_blocked` one is neither.** This branch
                          said "Private tree — unusual for an attachment" for it
                          until 2026-09-09, which is the worst place on the
                          dashboard to have got this wrong: it is read as a
                          confirmation, *before* Attach, and it sent an operator
                          looking for a storage-tree mistake that had not
                          happened. The file is in a public tree; its owner is
                          over a plan limit. Tested first, because the wire ranks
                          `quota_blocked` above `authorized`.

                          🔴 It then said the file *"will not display until that is
                          resolved"*, which was the same false claim in gentler
                          words — it displays through the audited route (BR-023).
                          What is actually true, and is what an operator needs
                          before pressing Attach, is that the **public link** the
                          attachment will carry does not work yet.
                        */}
                        <dd>
                            {isQuotaBlocked(detail)
                                ? `${QUOTA_BLOCKED_COPY.label} — the attachment is valid, but its public link will not work until that is resolved`
                                : detail.access === 'public'
                                  ? 'Public — a permanent link, once attached'
                                  : 'Private tree — unusual for an attachment'}
                        </dd>
                    </div>
                </dl>
            </div>
        </div>
    );
}
