import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketAttachmentsPanel } from '@/components/support/TicketAttachmentsPanel';
import { heldFixture } from '@/test/fixtures';
import {
    ticketAdminAttachmentFixture,
    ticketAttachmentFixture,
    ticketPdfAttachmentFixture,
} from '@/test/support-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FileDetail } from '@/types/files.types';
import type { TicketAttachment } from '@/types/support.types';

const TICKET_ID = '66a1b2c3d4e5f60718293a4b';

/** The file behind `ticketAttachmentFixture` — ⚠ NOT that row's `id`. */
const FILE_ID = '6612a4f0c1a2b3d4e5f60718';
/** The file behind `ticketAdminAttachmentFixture`. */
const ADMIN_FILE_ID = '6612a4f0c1a2b3d4e5f60719';

/** A public-tree file, which is what a real attachment resolves to. */
const PUBLIC_FILE: FileDetail = {
    id: FILE_ID,
    key: 'images/2026/08/doorstep.jpg',
    url: 'https://cdn.example.com/images/2026/08/doorstep.jpg',
    access: 'public',
    mimeType: 'image/jpeg',
    size: 214880,
    originalName: 'doorstep.jpg',
};

const ADMIN_FILE: FileDetail = {
    ...PUBLIC_FILE,
    id: ADMIN_FILE_ID,
    key: 'images/2026/08/refund-authorisation.jpg',
    url: 'https://cdn.example.com/images/2026/08/refund-authorisation.jpg',
    originalName: 'refund-authorisation.jpg',
};

interface StubOptions {
    rows?: TicketAttachment[];
    /** `GET /files?ids=` — the panel's one resolve for the whole ticket. */
    files?: () => Response;
    /** `GET /files/:fileId` — the attach form's preview. */
    file?: () => Response;
}

function panel({
    rows = [ticketAttachmentFixture()],
    files = () => successResponse({ files: [PUBLIC_FILE] }),
    file = () => successResponse(PUBLIC_FILE),
    held = heldFixture(3),
}: StubOptions & { held?: ReadonlySet<string> } = {}) {
    const calls = stubFetch((call) => {
        // ⚠ Order matters: `/files/:id/content` and `/files/:id` both contain
        // `/files/`, and `/files?ids=` contains neither.
        if (call.url.includes('/content')) {
            return new Response('JPEGBYTES', {
                status: 200,
                headers: { 'Content-Type': 'image/jpeg' },
            });
        }
        // ⚠ Before `/files/`, which would otherwise swallow it and hand a single
        // `FileDetail` back where the picker expects an array.
        if (call.url.includes('/files/library')) {
            return successResponse([{ ...ADMIN_FILE, createdAt: '2026-08-11T09:14:00.000Z', owner: { type: 'admin', id: 'a'.repeat(24), name: 'Ada Mensah' }, usage: { referenceCount: 0, references: [] } }], {
                meta: {
                    total: 1,
                    page: 1,
                    limit: 12,
                    pages: 1,
                    referenceSampleCap: 5,
                    publicUrlsConfigured: true,
                },
            });
        }
        if (call.url.includes('/files?')) return files();
        if (call.url.includes('/files/')) return file();
        if (call.url.includes('/attachments')) return successResponse(rows);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<TicketAttachmentsPanel ticketId={TICKET_ID} />, {
        permissions: { held },
    });

    return calls;
}

describe('the attachments themselves', () => {
    /**
     * 🔴 **The load-bearing assertion in this file, and it inverts what Phase D
     * shipped.**
     *
     * That version rendered `<ImageBox src={row.url}>` — every picture visible
     * on load, no request and no audit row — because the attachment row carried
     * **no file id** and the audited content route had nothing to address. The
     * backend stamped `fileId` onto the row on 2026-08-26, so the constraint is
     * gone and this panel behaves like every other image on the dashboard:
     * nothing is fetched until an operator asks, and asking is recorded.
     *
     * ⚠ The URL underneath is still public and still permanent. The audit row
     * records **our** access, never the file's exposure — which is why the
     * warning in this panel did not soften by one word.
     */
    it('waits for a click before showing an attachment, and records the open', async () => {
        const calls = panel();

        const reveal = await screen.findByRole('button', { name: /click to view/i });
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);

        await userEvent.click(reveal);

        expect(await screen.findByRole('img', { name: /doorstep\.jpg/i })).toHaveAttribute(
            'src',
            expect.stringMatching(/^blob:/),
        );
        expect(calls.some((call) => call.url.includes(`/files/${FILE_ID}/content`))).toBe(true);
    });

    /**
     * ⚠ **One resolve for the ticket, not one per row.** `ResolvedImageBox`
     * resolves per box, which would be a request per attachment for a
     * description the row already carries. `GET /files?ids=` answers a whole
     * page at once, and both ids have to be in the *same* call for that to be
     * true — asserting "two rows, one request" is what would catch a regression
     * back to per-row resolution.
     */
    it('resolves every attachment in one request', async () => {
        const calls = panel({
            rows: [ticketAttachmentFixture(), ticketAdminAttachmentFixture()],
            files: () => successResponse({ files: [PUBLIC_FILE, ADMIN_FILE] }),
        });

        await waitFor(() =>
            expect(screen.getAllByRole('button', { name: /click to view/i })).toHaveLength(2),
        );

        const resolves = calls.filter((call) => call.url.includes('/files?'));
        expect(resolves).toHaveLength(1);
        expect(resolves[0].url).toContain(FILE_ID);
        expect(resolves[0].url).toContain(ADMIN_FILE_ID);
    });

    /**
     * ⚠ A short response **is** the answer on the batch form — it never raises
     * `FILE_NOT_FOUND` — so an id that comes back missing means the sweep
     * reached the file while the attachment row outlived it. An ordinary state,
     * and it must not fall back to `row.url`: a picture that appears only when
     * the resolve fails would be audited on a good day and not on a bad one.
     */
    it('says a swept file is gone rather than quietly using the public URL', async () => {
        const calls = panel({ files: () => successResponse({ files: [] }) });

        expect(await screen.findByText(/has been cleaned up/i)).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/content'))).toBe(false);
    });

    it('draws no box for an attachment that is not an image', async () => {
        panel({ rows: [ticketPdfAttachmentFixture()], files: () => successResponse({ files: [] }) });

        expect(await screen.findByText('receipt.pdf')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /click to view/i })).not.toBeInTheDocument();
    });

    /**
     * The raw public URL is still reachable — a PDF or a zip has no other door
     * on this panel — but it is now a **second, labelled** action rather than
     * the filename itself, so an operator can tell which of the two paths they
     * are taking.
     */
    it('offers the public link as its own labelled action', async () => {
        panel();

        const link = await screen.findByRole('link', { name: /public link/i });
        expect(link).toHaveAttribute('href', PUBLIC_FILE.url);
        expect(link).toHaveAccessibleName(/never expires/i);
    });

    /**
     * 🔴 **Must not be softened.** `support.md` asserted these links expire until
     * BR-012, and this panel repeated it — wrong in the reassuring direction,
     * which is the worst direction for a link somebody might paste into a group
     * chat. The value is `getPublicUrl(key)`: no signature, no expiry, no
     * session. ⚠ Moving the picture behind an audited click changed nothing
     * about this, which is exactly why the copy stayed.
     */
    it('still says the links are public and permanent', async () => {
        panel();

        expect(await screen.findByText(/never expire/i)).toBeInTheDocument();
        expect(screen.getByText(/shareable secret/i)).toBeInTheDocument();
    });

    it('says nothing is attached rather than drawing an empty list', async () => {
        const calls = panel({ rows: [] });

        expect(await screen.findByText(/nothing is attached/i)).toBeInTheDocument();
        // ⚠ No ids, no request: `resolveFiles` answers an empty ask locally
        // rather than spending a round trip to be told off by a `400`.
        expect(calls.some((call) => call.url.includes('/files?'))).toBe(false);
    });
});

describe('who uploaded it', () => {
    it('names the uploader instead of naming their role', async () => {
        panel();

        expect(await screen.findByText('Amina Bekele')).toBeInTheDocument();
    });

    /**
     * 🔴 **The trap this whole component exists for.** jovi-mall resolves the
     * uploader against its own collections and falls back to the capitalised
     * role when it matches nothing — and for an administrator it can *never*
     * match, because an administrator has no row in that database at all. So
     * `name` arrives as the literal `"Admin"`, which reads exactly like
     * somebody's name and is not one.
     */
    it('never prints the literal "Admin" as though it were a name', async () => {
        panel({
            rows: [ticketAdminAttachmentFixture()],
            files: () => successResponse({ files: [ADMIN_FILE] }),
        });

        expect(await screen.findByText(/an administrator/i)).toBeInTheDocument();
        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });
});

describe('the preview before the write', () => {
    /**
     * The control takes an id typed from somewhere else, and `POST` is
     * delegated — so until now a wrong id came back as a platform rejection
     * after the hop, and a *valid* id naming the wrong picture came back as a
     * `201`. The preview turns both into something visible first.
     */
    it('resolves the pasted id and shows what will be attached', async () => {
        panel();

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(await screen.findByText(/what will be attached/i)).toBeInTheDocument();
        // Asserted on the preview's own labels: the attachment row above shows
        // the same type and the same name, so a bare `image/jpeg` would match
        // whichever the DOM order happened to put first.
        expect(screen.getByText('Storage')).toBeInTheDocument();
        // ⚠ Said before the button is pressed: attaching a public file mints a
        // permanent unauthenticated link on the ticket.
        expect(screen.getByText(/permanent link/i)).toBeInTheDocument();
    });

    /**
     * ⚠ **Nothing is requested until the id is well-formed.** A 24-hex check is
     * cheap and a partial id is a `400` at the service's edge — a request worth
     * not making on every keystroke.
     */
    it('asks for nothing while the id is incomplete', async () => {
        const calls = panel();

        await screen.findByLabelText(/file id/i);
        await userEvent.type(screen.getByLabelText(/file id/i), '6612a4f0');

        expect(screen.getByText(/24 hexadecimal characters/i)).toBeInTheDocument();
        // ⚠ `/files/:id`, not `/files?ids=` — the panel's own resolve is
        // expected here and is a different endpoint.
        expect(calls.some((call) => call.url.includes('/files/'))).toBe(false);
    });

    /**
     * ⚠ A `404` is a strong signal and not a proof — `files.resolve` is scoped —
     * so the preview reports and does **not** gate the button. Refusing the
     * write on a read this client cannot fully trust would be the dashboard
     * overruling the platform.
     */
    it('reports a missing file without disabling the attach button', async () => {
        panel({ file: () => errorResponse(404, 'FILE_NOT_FOUND') });

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(await screen.findByText(/no file with that id/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /attach/i })).toBeEnabled();
    });

    /**
     * ⚠ The control accepts **any** file id, so a private-tree one is reachable
     * even though an attachment never lands in one. That branch goes through the
     * audited content route, which asks first — the click is still the consent.
     */
    it('waits for a click on a private-tree file, and says the storage is unusual', async () => {
        panel({
            rows: [],
            file: () =>
                successResponse({
                    ...PUBLIC_FILE,
                    key: 'shipments/2026/08/proof.jpg',
                    url: null,
                    access: 'authorized',
                }),
        });

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(await screen.findByText(/unusual for an attachment/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /click to view/i })).toBeInTheDocument();
    });

    /**
     * 🔴 **The worst place on the dashboard to have mislabelled this**, and the
     * reason it is asserted twice over. This box is read as a *confirmation* —
     * an operator looks at it and then presses Attach — and until 2026-09-09 a
     * file blocked on its owner's storage cap was described here as
     * *"Private tree — unusual for an attachment"*.
     *
     * That is wrong in both halves. The file is in a **public** tree, so there
     * is no storage mistake to hunt; and what is actually true — somebody is
     * over a plan limit, so this will not display until that is resolved — is the
     * one fact that would have changed what the operator did next.
     */
    it('calls a quota-blocked file blocked, not private, before Attach is pressed', async () => {
        panel({
            rows: [],
            file: () =>
                successResponse({
                    ...PUBLIC_FILE,
                    url: null,
                    access: 'quota_blocked',
                }),
        });

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(await screen.findByText(/over their storage limit/i)).toBeInTheDocument();
        expect(screen.queryByText(/unusual for an attachment/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/permanent link/i)).not.toBeInTheDocument();
    });

    /**
     * 🔴 **This test was called *"offers no audited open on a blocked file, because
     * none can succeed"* and it passed, and the reason in its name was false.**
     *
     * It is worth keeping the epitaph. The claim came from
     * [`files.md`](../../../api-doc/admin/api/files.md) — *"the content route
     * will not help you either"* — and the test proved only that the component
     * agreed with the stub, which was built from the same sentence. Measured against
     * a running service on 2026-09-09, the route answers `200` with the bytes for a
     * quota-blocked file in every tree. BR-023.
     *
     * A test name that states a *reason* is a good habit; this is what it costs when
     * the reason is taken from a document instead of a measurement.
     */
    it('offers the audited open on a blocked file, because it does succeed', async () => {
        panel({
            rows: [],
            file: () =>
                successResponse({
                    ...PUBLIC_FILE,
                    url: null,
                    access: 'quota_blocked',
                }),
        });

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(
            await screen.findByRole('button', { name: /click to view/i }),
        ).toBeInTheDocument();
        // Unchanged and still the point: attaching is legal and the id is valid.
        expect(screen.getByRole('button', { name: /attach/i })).toBeEnabled();
    });

    it('warns that the public link will not work yet, not that the file is unviewable', async () => {
        // The distinction an operator needs before pressing Attach: a ticket
        // attachment is delivered as a public URL, and *that* is what a quota block
        // withholds. The file itself is openable here and now.
        panel({
            rows: [],
            file: () =>
                successResponse({
                    ...PUBLIC_FILE,
                    url: null,
                    access: 'quota_blocked',
                }),
        });

        await userEvent.type(await screen.findByLabelText(/file id/i), FILE_ID);

        expect(await screen.findByText(/public link will not work/i)).toBeInTheDocument();
        expect(screen.queryByText(/it will not display until/i)).not.toBeInTheDocument();
    });
});

describe('what a caller without the write permission sees', () => {
    it('gets the list and no attach control at all', async () => {
        // ⚠ Explicitly narrow rather than a tier: tier 3 holds the attachment
        // write, so `heldFixture(3)` would prove nothing here.
        panel({ held: new Set(['support.tickets.attachments.read']) });

        await screen.findByText('doorstep.jpg');
        expect(screen.queryByLabelText(/file id/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });
});

describe('removing one', () => {
    it('deletes by the attachment id, not the file’s', async () => {
        let deleted: string | undefined;
        stubFetch((call) => {
            if (call.method === 'DELETE') {
                deleted = call.url;
                return successResponse(null);
            }
            if (call.url.includes('/files?')) return successResponse({ files: [PUBLIC_FILE] });
            if (call.url.includes('/files/')) return successResponse(PUBLIC_FILE);
            return successResponse([ticketAttachmentFixture()]);
        });

        renderWithProviders(<TicketAttachmentsPanel ticketId={TICKET_ID} />, {
            permissions: { held: heldFixture(3) },
        });

        await userEvent.click(await screen.findByRole('button', { name: /remove/i }));

        // jovi-mall's own route shape — the attachment row is the only thing
        // naming its ticket, so the id in the path is the attachment's.
        await waitFor(() =>
            expect(deleted).toContain('/support/tickets/attachments/66c1000000000000000000a1'),
        );
        // ⚠ The row carries BOTH ids and they are both 24-hex. Sending the file
        // id here would delete somebody else's attachment rather than fail.
        expect(deleted).not.toContain(FILE_ID);
    });
});

describe('choosing a file rather than knowing its id', () => {
    /**
     * ⚠ **The copy this form carried was true when it was written and is not
     * any more.** It said *"This dashboard cannot upload — no route on this
     * service accepts a file body"*, which was the contract until BR-015 landed
     * `POST /files/upload` on 2026-08-26. Leaving it would have been the
     * dashboard asserting something false about the service — the same failure
     * four `InfoHint`s on the order and timeline screens committed once already.
     */
    it('no longer tells the operator that uploading is impossible', async () => {
        panel();

        await screen.findByLabelText(/file id/i);
        expect(screen.queryByText(/this dashboard cannot upload/i)).not.toBeInTheDocument();
    });

    it('fills the id field from the picker rather than attaching straight away', async () => {
        /**
         * ⚠ Deliberate: the write is a separate act from the choosing, and the
         * preview below the field is what an operator checks between the two.
         * Attaching on selection would remove the only look they get.
         */
        const calls = panel({ held: new Set(['support.tickets.attachments.write', 'files.library.read', 'files.resolve', 'files.content.read']) });

        await userEvent.click(await screen.findByRole('button', { name: /browse media/i }));
        await userEvent.click(await screen.findByRole('button', { name: /refund-authorisation\.jpg/i }));

        expect(await screen.findByLabelText(/file id/i)).toHaveValue(ADMIN_FILE_ID);
        // Choosing is not writing: no `POST` went out.
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('offers any file, not only one with a public address', async () => {
        /**
         * ⚠ `POST …/attachments` takes a **`fileId`**, so a file in a private
         * tree is perfectly attachable here — unlike the blog, which stores the
         * URL string itself and cannot use one. `requirePublicUrl` is therefore
         * not set on this picker.
         */
        panel({ held: new Set(['support.tickets.attachments.write', 'files.library.read']) });

        await userEvent.click(await screen.findByRole('button', { name: /browse media/i }));

        expect(await screen.findByRole('button', { name: /refund-authorisation\.jpg/i })).toBeEnabled();
    });

    it('explains itself to Support, who may attach and may not browse', async () => {
        /**
         * ⚠ Tier 3 holds `support.tickets.attachments.write` and **neither**
         * `files.library.read` nor `files.upload` — both stop at tier 2. So the
         * operator who works tickets is exactly the one the picker cannot serve,
         * and it says so rather than rendering a grid that would 403.
         */
        const calls = panel({ held: heldFixture(3) });

        await userEvent.click(await screen.findByRole('button', { name: /browse media/i }));

        expect(
            await screen.findByText(/browsing and uploading files each need a permission/i),
        ).toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/files/library'))).toBe(false);
    });
});
