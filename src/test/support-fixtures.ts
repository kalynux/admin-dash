/**
 * Support-desk fixtures.
 *
 * Wire-shaped: what the service actually sends. Two shapes here are easy to get
 * wrong and are pinned deliberately.
 *
 * ⚠ **`entity.vendorId` and `entity.label` are resolved on the DETAIL only** —
 * always `null` on `GET /support/tickets`. `ticketFixture` (the queue row)
 * therefore carries them as `null` and `ticketDetailFixture` populates them, so
 * a test that renders a list row cannot accidentally pass because a fixture was
 * more generous than the endpoint.
 *
 * ⚠ **A `TicketAttachment` is NOT a `FileDetail`, and it carries TWO ids.**
 * `id` is the *attachment* row's — what the delete route takes — and `fileId`
 * is the file's, stamped on by wi-admin since 2026-08-26 and the only one
 * `/files` will resolve. Both are 24-hex and both sit on the same object, so
 * **the fixtures give them different values on purpose**: a panel that confuses
 * them fails a test rather than quietly addressing the wrong record.
 */

import type {
    Ticket,
    TicketAdminSnapshot,
    TicketAttachment,
    TicketDetail,
    TicketEntityRef,
} from '@/types/support.types';

const TICKET_ID = '66a1b2c3d4e5f60718293a4b';

export function ticketAdminSnapshotFixture(
    overrides: Partial<TicketAdminSnapshot> = {},
): TicketAdminSnapshot {
    return {
        id: '66b0000000000000000000a1',
        name: 'Solange N.',
        tier: 3,
        jobTitle: 'Support Specialist',
        department: 'Customer Care',
        // Reserved and `null` for every administrator today — the initials
        // fallback is the render, and nothing branches on this.
        avatarUrl: null,
        ...overrides,
    };
}

/** A queue row. ⚠ `entity.vendorId` / `entity.label` are `null` here, always. */
export function ticketFixture(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: TICKET_ID,
        subject: 'Parcel marked delivered but never arrived',
        type: 'DELIVERY_ISSUE',
        status: 'open',
        priority: 'high',
        priorityLocked: true,
        importance: 'normal',
        entity: {
            type: 'ORDER',
            id: '6670aabbccddeeff00112233',
            vendorId: null,
            label: null,
        },
        trackingNumber: 'JM-2026-118842',
        createdBy: {
            role: 'customer',
            userId: '665f1c2a9b3e4a91c7d2e5f0',
            administrator: null,
        },
        assignedTo: { role: 'agency', userId: '6650aa11bb22cc33dd44ee55' },
        assignment: {
            admin: ticketAdminSnapshotFixture(),
            assignedBy: ticketAdminSnapshotFixture({
                id: '66b0000000000000000000b2',
                name: 'Eric T.',
                tier: 2,
                jobTitle: 'Operations Lead',
                department: 'Operations',
            }),
            assignedAt: '2026-08-18T11:04:00.000Z',
        },
        availableActions: { claim: false, assignableTiers: [2] },
        terminalAt: null,
        createdAt: '2026-08-17T08:12:00.000Z',
        updatedAt: '2026-08-18T11:04:00.000Z',
        ...overrides,
    };
}

/**
 * `GET /support/tickets/:ticketId` — the row plus `description`, **and with
 * `entity` resolved**. Those are the only two differences.
 */
export function ticketDetailFixture(overrides: Partial<TicketDetail> = {}): TicketDetail {
    return {
        ...ticketFixture(),
        description: 'The agent marked it delivered at 14:02 but nobody was home.',
        entity: {
            type: 'ORDER',
            id: '6670aabbccddeeff00112233',
            vendorId: null,
            // The order number, which is what an operator recognises.
            label: 'ORD-2026-008841',
        },
        ...overrides,
    };
}

/**
 * A ticket about a listing — **the shape BR-016 § 7 was raised for**.
 *
 * ⚠ `vendorId` is populated here and on no other type. A product's detail route
 * needs two ids and the ticket carries one, so this is the whole of what makes
 * the link possible.
 */
export function productTicketDetailFixture(
    overrides: Partial<TicketDetail> = {},
): TicketDetail {
    return ticketDetailFixture({
        subject: 'Listing shows the wrong weight',
        entity: {
            type: 'PRODUCT',
            id: '66601122334455667788990a',
            vendorId: '6650aa11bb22cc33dd44ee55',
            label: 'Plantain — 1 kg',
        },
        ...overrides,
    });
}

/** One entity block, for the routing table's own tests. */
export function ticketEntityFixture(
    overrides: Partial<TicketEntityRef> = {},
): TicketEntityRef {
    return {
        type: 'ORDER',
        id: '6670aabbccddeeff00112233',
        vendorId: null,
        label: null,
        ...overrides,
    };
}

/**
 * An attached image.
 *
 * ⚠ `url` is a **permanent, unauthenticated** public URL — attachments land in
 * `documents/` or `images/`, both public trees. `support.md` asserted the
 * opposite until BR-012, in the reassuring direction.
 */
export function ticketAttachmentFixture(
    overrides: Partial<TicketAttachment> = {},
): TicketAttachment {
    return {
        // ⚠ The ATTACHMENT's id, and the id the delete route takes. It resolves
        // to nothing in `/files` — that is what `fileId` is for, and the two
        // differ here on purpose so a panel that confuses them fails a test.
        id: '66c1000000000000000000a1',
        fileId: '6612a4f0c1a2b3d4e5f60718',
        fileName: 'doorstep.jpg',
        fileSize: 214880,
        mimeType: 'image/jpeg',
        url: 'https://cdn.example.com/images/2026/08/doorstep.jpg',
        uploadedBy: '665f1c2a9b3e4a91c7d2e5f0',
        uploadedByRole: 'customer',
        uploadedByActor: {
            user_id: '665f1c2a9b3e4a91c7d2e5f0',
            role: 'customer',
            name: 'Amina Bekele',
            avatar: null,
        },
        createdAt: '2026-08-17T08:14:00.000Z',
        ...overrides,
    };
}

/**
 * An attachment uploaded by an administrator.
 *
 * 🔴 **`name` is the literal `"Admin"`, and that is what the wire really
 * carries** — not a placeholder invented for this fixture. jovi-mall resolves
 * the uploader against its own `admins` collection; an administrator has no row
 * there (ADR-004 D-1), so it falls back to the capitalised role and says
 * nothing about having done so. `avatar` is `null` in the same fall-through.
 */
export function ticketAdminAttachmentFixture(
    overrides: Partial<TicketAttachment> = {},
): TicketAttachment {
    return ticketAttachmentFixture({
        id: '66c1000000000000000000a3',
        fileId: '6612a4f0c1a2b3d4e5f60719',
        fileName: 'refund-authorisation.jpg',
        uploadedBy: '66aa000000000000000000ff',
        uploadedByRole: 'admin',
        uploadedByActor: {
            // ⚠ An `admin_accounts._id` out of wi-admin's database, NOT a
            // `users._id`. It routes to `/administrators/:adminId`.
            user_id: '66aa000000000000000000ff',
            role: 'admin',
            name: 'Admin',
            avatar: null,
        },
        ...overrides,
    });
}

/** A non-image attachment — the branch that gets no box. */
export function ticketPdfAttachmentFixture(
    overrides: Partial<TicketAttachment> = {},
): TicketAttachment {
    return ticketAttachmentFixture({
        id: '66c1000000000000000000a2',
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        url: 'https://cdn.example.com/documents/2026/08/receipt.pdf',
        ...overrides,
    });
}
