import { useEffect, useState } from 'react';
import { Images, Paperclip, Plus, Trash2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { InlineLoader } from '@/components/common/Loading';
import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { humaniseEnum } from '@/lib/format';
import { notify } from '@/lib/notify';
import { createTicket, lookupTicketOrders, lookupTicketProducts } from '@/services/support.service';
import {
    ENTITY_TYPE_WITHOUT_ID,
    TICKET_ATTACHMENT_MAX,
    TICKET_DESCRIPTION_MAX,
    TICKET_ENTITY_TYPES,
    TICKET_IMPORTANCES,
    TICKET_SUBJECT_MAX,
    TICKET_TYPES,
    type TicketEntityType,
    type TicketImportance,
    type TicketType,
} from '@/types/support.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `POST /support/tickets` — open a ticket on somebody's behalf.
 *
 * ── ⚠ The pickers are hard-coded, and the filters deliberately are not ────────
 * `type`, `importance` and `entityType` are **jovi-mall's** vocabularies; no
 * endpoint enumerates them and none should, because a route on wi-admin
 * publishing them would be wi-admin taking ownership of a list it does not own.
 * They are mirrored in `support.types.ts` and pinned by
 * `support-vocabularies.test.ts`.
 *
 * The asymmetry with `TicketsList`, which keeps free-text filters, is the point:
 * a **filter** against a stale list matches nothing *while looking correct*,
 * whereas a **create** against a stale list is refused with a reason an operator
 * can read. Only the second failure is recoverable, so only the second gets a
 * picker.
 *
 * ── ⚠ `entityId` is required unless the entity type is `OTHER` ───────────────
 * **wi-admin does not enforce this** — it arrives as a
 * `PLATFORM_OPERATION_REJECTED` after the hop. So it is enforced here, where the
 * operator can still fix it without a round trip.
 *
 * ── ⚠ The creating administrator is NOT in the body ──────────────────────────
 * It is read from the caller's own `admin_accounts` row and sent to jovi-mall as
 * a snapshot, so "opened by" renders to the customer as a person. A
 * client-supplied name would let an administrator record somebody else as
 * handling a ticket; a client-supplied tier would decide who may subsequently
 * see it.
 *
 * ── ⚠ The response is jovi-mall's raw shape, not ours ────────────────────────
 * `createTicket` returns `unknown` deliberately. The caller re-reads through
 * `getTicket` rather than rendering what the create returned.
 *
 * ── Attachments are file IDS, not uploads ─────────────────────────────────────
 * wi-admin accepts no multipart body on any route. Upload against the platform
 * first, then name the id here. Five at most.
 */
export function CreateTicketDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}) {
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState<TicketType>('GENERAL_SUPPORT');
    const [importance, setImportance] = useState<TicketImportance>('medium');
    const [entityType, setEntityType] = useState<TicketEntityType>(ENTITY_TYPE_WITHOUT_ID);
    const [entityId, setEntityId] = useState('');
    const [trackingNumber, setTrackingNumber] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [attachmentDraft, setAttachmentDraft] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);

    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const needsEntityId = entityType !== ENTITY_TYPE_WITHOUT_ID;

    const canSubmit =
        subject.trim().length > 0 &&
        description.trim().length > 0 &&
        (!needsEntityId || entityId.trim().length > 0) &&
        !busy;

    async function submit() {
        setBusy(true);
        setFormError(null);
        try {
            await createTicket({
                subject: subject.trim(),
                description: description.trim(),
                type,
                importance,
                entityType,
                // Omitted rather than sent empty when the type is `OTHER`: the
                // field is optional and an empty string is not "no value".
                ...(needsEntityId ? { entityId: entityId.trim() } : {}),
                ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
                ...(attachments.length > 0 ? { attachments } : {}),
            });
            notify.success('Ticket opened');
            onOpenChange(false);
            onCreated();
        } catch (error) {
            // No special-casing of the platform rejection: `notify.apiError`
            // already renders `details.platformCode`, which is the only handle on
            // *why* a delegated write was refused, and the vocabularies here are
            // pinned so a bad enum is not the likely cause.
            setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Open a ticket</DialogTitle>
                    <DialogDescription>
                        On somebody&rsquo;s behalf. It is recorded as opened by you, by name — the
                        customer sees a person rather than a placeholder.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="ticket-subject">Subject</Label>
                        <Input
                            id="ticket-subject"
                            value={subject}
                            maxLength={TICKET_SUBJECT_MAX}
                            onChange={(event) => setSubject(event.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="ticket-description">What happened</Label>
                        <Textarea
                            id="ticket-description"
                            value={description}
                            rows={4}
                            maxLength={TICKET_DESCRIPTION_MAX}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">
                            {description.length} of {TICKET_DESCRIPTION_MAX} characters.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ticket-type">Type</Label>
                            <Select
                                value={type}
                                onValueChange={(next) => setType(next as TicketType)}
                            >
                                <SelectTrigger id="ticket-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-72">
                                    {TICKET_TYPES.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {humaniseEnum(value)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="ticket-importance">Importance</Label>
                            <Select
                                value={importance}
                                onValueChange={(next) => setImportance(next as TicketImportance)}
                            >
                                <SelectTrigger id="ticket-importance">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TICKET_IMPORTANCES.map((value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {value}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/*
                              ⚠ Importance is the requester's view and is
                              immutable; priority is the desk's and is not set
                              here at all. Saying so stops an operator reaching
                              for this to escalate something.
                            */}
                            <p className="text-muted-foreground text-xs">
                                How urgent the requester considers it. It cannot be changed
                                afterwards — the desk&rsquo;s own priority is set on the ticket.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ticket-entity-type">What it is about</Label>
                            <Select
                                value={entityType}
                                onValueChange={(next) => {
                                    setEntityType(next as TicketEntityType);
                                    // Clearing on the switch to `OTHER` so a
                                    // stale id cannot be sent with a type that
                                    // does not take one.
                                    if (next === ENTITY_TYPE_WITHOUT_ID) setEntityId('');
                                }}
                            >
                                <SelectTrigger id="ticket-entity-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-72">
                                    {TICKET_ENTITY_TYPES.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {humaniseEnum(value)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/*
                          Only rendered when the type needs one. `OTHER` is the
                          one entity type jovi-mall accepts without an id, so
                          showing an empty required field there would invent a
                          rule the API does not have.
                        */}
                        {needsEntityId ? (
                            <EntityIdField
                                entityType={entityType}
                                value={entityId}
                                onChange={setEntityId}
                            />
                        ) : null}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="ticket-tracking">Tracking number (optional)</Label>
                        <Input
                            id="ticket-tracking"
                            value={trackingNumber}
                            onChange={(event) => setTrackingNumber(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="ticket-attachment">Attachments (optional)</Label>
                        <p className="text-muted-foreground text-xs">
                            {/*
                              🔴 This said *"no route on this service accepts a file
                              body"*, which was the contract until BR-015 landed
                              `POST /files/upload` on 2026-08-26. The attachment is
                              still made **by file id** — that part never changed —
                              but the id can now be produced here rather than
                              having to come from somewhere else.
                            */}
                            File ids, not the files themselves. Browse the administration&rsquo;s
                            own uploads or upload one, or paste an id you were given.{' '}
                            {TICKET_ATTACHMENT_MAX} at most.
                        </p>
                        <div className="flex gap-2">
                            <Input
                                id="ticket-attachment"
                                value={attachmentDraft}
                                onChange={(event) => setAttachmentDraft(event.target.value)}
                                placeholder="6612a4f0c1a2b3d4e5f60718"
                                className="font-mono text-xs"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={attachments.length >= TICKET_ATTACHMENT_MAX}
                            />
                            {/*
                              ⚠ Fills the draft field rather than attaching, so the
                              id is checked against the list's ceiling and its
                              duplicate rule by the one button that owns them.
                              ⚠ No `requirePublicUrl`: a ticket attachment is a
                              `fileId`, so a private-tree file is perfectly usable.
                            */}
                            <Button
                                type="button"
                                variant="outline"
                                disabled={attachments.length >= TICKET_ATTACHMENT_MAX}
                                onClick={() => setPickerOpen(true)}
                            >
                                <Images className="size-4" />
                                Browse
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    !OBJECT_ID.test(attachmentDraft.trim()) ||
                                    attachments.length >= TICKET_ATTACHMENT_MAX ||
                                    attachments.includes(attachmentDraft.trim())
                                }
                                onClick={() => {
                                    setAttachments((current) => [
                                        ...current,
                                        attachmentDraft.trim(),
                                    ]);
                                    setAttachmentDraft('');
                                }}
                            >
                                <Paperclip className="size-4" />
                                Attach
                            </Button>
                        </div>
                        <MediaPickerDialog
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            title="Choose a file to attach"
                            imagesOnly={false}
                            onSelect={(file) => setAttachmentDraft(file.id)}
                        />
                        {attachmentDraft.length > 0 && !OBJECT_ID.test(attachmentDraft.trim()) ? (
                            <p className="text-destructive text-xs">
                                A file id is 24 hexadecimal characters.
                            </p>
                        ) : null}
                        {attachments.length > 0 ? (
                            <ul className="space-y-1">
                                {attachments.map((id) => (
                                    <li
                                        key={id}
                                        className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                                    >
                                        {/*
                                          A staged attachment is a *render*, not
                                          an input — the field above is the input,
                                          and this row is the 24-hex file id as
                                          committed. It is the one value on this
                                          form an operator has a reason to take
                                          back out: checking a file id against the
                                          files screen is how they confirm they
                                          attached the right thing.

                                          ⚠ `truncate={false}` although it is a
                                          real ObjectId. Shortening the middle is
                                          right where an id merely labels a row;
                                          here the whole point of the row is to
                                          show what was pasted, and hiding twelve
                                          characters of it defeats the check.
                                        */}
                                        <CopyableValue
                                            value={id}
                                            label="file ID"
                                            truncate={false}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Remove ${id}`}
                                            onClick={() =>
                                                setAttachments((current) =>
                                                    current.filter((existing) => existing !== id),
                                                )
                                            }
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={submit} disabled={!canSubmit}>
                        {busy ? <InlineLoader /> : <Plus className="size-4" />}
                        Open the ticket
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * The id of the thing the ticket is about.
 *
 * ⚠ **Required for every entity type except `OTHER`**, and wi-admin does not
 * check it — so this field is the only thing between the operator and a
 * platform rejection after the hop.
 *
 * ── The type-ahead covers two of the eleven types, and says so ────────────────
 * `support.reference.read` looks up **orders and products, and nothing else**.
 * For the other nine the id is typed. Both lookups return jovi-mall's raw shape,
 * which this repository does not carry a type for — the rows are read
 * defensively for an id and a label rather than being typed into a shape that
 * would be a guess.
 */
function EntityIdField({
    entityType,
    value,
    onChange,
}: {
    entityType: TicketEntityType;
    value: string;
    onChange: (next: string) => void;
}) {
    const [fetched, setFetched] = useState<{ id: string; label: string }[]>([]);
    const [looking, setLooking] = useState(false);

    const lookupFor =
        entityType === 'ORDER'
            ? lookupTicketOrders
            : entityType === 'PRODUCT'
              ? lookupTicketProducts
              : null;

    // Derived rather than cleared in the effect: for the nine types with no
    // lookup there is simply nothing to offer, and saying so at render is both
    // truer and cheaper than a state write that has to chase the prop.
    const options = lookupFor ? fetched : [];

    useEffect(() => {
        if (!lookupFor) return;

        const controller = new AbortController();
        // Debounced: the field is typed into, and the lookup is a delegated hop.
        const timer = setTimeout(() => {
            setLooking(true);
            lookupFor(value.trim() || undefined, { signal: controller.signal })
                .then((result) => setFetched(readRows(result)))
                // A failed lookup is not a failed form — the id can still be
                // typed, so the type-ahead degrades to a plain field.
                .catch(() => setFetched([]))
                .finally(() => setLooking(false));
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [lookupFor, value]);

    return (
        <div className="space-y-1.5">
            <Label htmlFor="ticket-entity-id">
                {humaniseEnum(entityType)} id
            </Label>
            <Input
                id="ticket-entity-id"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                list={lookupFor ? 'ticket-entity-options' : undefined}
                placeholder="6612a4f0c1a2b3d4e5f60718"
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
            />
            {lookupFor ? (
                <datalist id="ticket-entity-options">
                    {options.map((option) => (
                        <option key={option.id} value={option.id}>
                            {option.label}
                        </option>
                    ))}
                </datalist>
            ) : null}
            <p className="text-muted-foreground text-xs">
                {lookupFor
                    ? looking
                        ? 'Looking…'
                        : 'Start typing to search, or paste the id.'
                    : 'Required for this kind of ticket — only orders and products can be searched, so paste the id.'}
            </p>
        </div>
    );
}

/**
 * Pull `{ id, label }` out of jovi-mall's raw lookup response.
 *
 * ⚠ **Read defensively rather than typed**, because the shape is jovi-mall's and
 * this repository carries no contract for it — which is exactly why
 * `lookupTicketOrders` returns `unknown`. Anything unrecognised yields no
 * options, and the field stays usable as a plain id box.
 */
function readRows(result: unknown): { id: string; label: string }[] {
    const rows = Array.isArray(result)
        ? result
        : typeof result === 'object' && result !== null && Array.isArray((result as { data?: unknown }).data)
          ? ((result as { data: unknown[] }).data)
          : [];

    return rows.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return [];
        const record = row as Record<string, unknown>;
        const id = record.id ?? record._id;
        if (typeof id !== 'string') return [];

        const label = [record.reference, record.orderNumber, record.name, record.title]
            .find((candidate): candidate is string => typeof candidate === 'string');

        return [{ id, label: label ?? id }];
    });
}
