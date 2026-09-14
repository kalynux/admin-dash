import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeleteFileDialog, type DeletableFile } from '@/components/files/DeleteFileDialog';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';

const FILE_ID = '6612a4f0c1a2b3d4e5f60718';

function deletableFile(overrides: Partial<DeletableFile> = {}): DeletableFile {
    return {
        id: FILE_ID,
        originalName: 'shop-logo.png',
        mimeType: 'image/webp',
        size: 40_318,
        ownerType: 'vendor',
        ...overrides,
    };
}

function renderDialog(file: DeletableFile = deletableFile()) {
    const onDeleted = vi.fn();
    const calls = stubFetch(() => successResponse({ id: file.id, deleted: true }));

    // No permission state: the dialog gates nothing itself — `files.delete` and
    // tier 1 are checked by whoever offers the affordance that opens it.
    renderWithProviders(
        <DeleteFileDialog file={file} open onOpenChange={() => {}} onDeleted={onDeleted} />,
        {},
    );

    return { calls, onDeleted };
}

describe('what the operator is asked for', () => {
    it('asks for the word, not for the id', async () => {
        renderDialog();

        expect(screen.getByPlaceholderText('delete')).toBeInTheDocument();
        // The id is still on screen — it is the one handle the audit row keeps —
        // but it is there to copy, not to retype past the button.
        expect(screen.queryByPlaceholderText(FILE_ID)).not.toBeInTheDocument();
    });

    it('keeps the button disabled until the word is typed', async () => {
        renderDialog();

        const confirm = screen.getByRole('button', { name: /delete permanently/i });
        expect(confirm).toBeDisabled();

        await userEvent.type(screen.getByPlaceholderText('delete'), 'delete');
        expect(confirm).toBeEnabled();
    });

    it('will not take the file id as the confirmation', async () => {
        // The point of the change: a value copied off the line above proves
        // dexterity, not intent. Pasting the id must not arm the button.
        renderDialog();

        await userEvent.type(screen.getByPlaceholderText('delete'), FILE_ID);

        expect(screen.getByRole('button', { name: /delete permanently/i })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent(/type delete/i);
    });

    it('accepts the word however it was capitalised', async () => {
        // A statement of intent, not a password. Refusing `Delete` teaches
        // people that the box is finicky, which is how they stop reading it.
        renderDialog();

        await userEvent.type(screen.getByPlaceholderText('delete'), '  DeLeTe  ');

        expect(screen.getByRole('button', { name: /delete permanently/i })).toBeEnabled();
    });
});

describe('what goes on the wire', () => {
    /**
     * ⚠ The two confirmations are not the same thing and must not be collapsed.
     * The **body** still has to carry `confirmFileId` equal to the path id byte
     * for byte — wi-admin refuses it otherwise with
     * `400 FILE_DELETE_NOT_CONFIRMED` — and that value comes from the record,
     * never from what was typed.
     */
    it('still sends confirmFileId, taken from the file rather than from the box', async () => {
        const { calls, onDeleted } = renderDialog();

        await userEvent.type(screen.getByPlaceholderText('delete'), 'delete');
        await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toContain(`/files/${FILE_ID}/permanent`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ confirmFileId: FILE_ID });
        expect(onDeleted).toHaveBeenCalled();
    });
});

describe('a file something still points at', () => {
    it('names the count and changes the button, before anything is typed', () => {
        renderDialog(deletableFile({ referenceCount: 3 }));

        expect(screen.getByText(/3 live records still point at this file/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete anyway/i })).toBeInTheDocument();
    });

    /** ⚠ `undefined` is "this screen does not carry the count", never "nothing points at it". */
    it('stays quiet when the caller cannot know the count', () => {
        renderDialog(deletableFile());

        expect(screen.queryByText(/still points? at this file/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
    });
});
