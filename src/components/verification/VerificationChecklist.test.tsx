import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { VerificationChecklist } from '@/components/verification/VerificationChecklist';
import { buildChecks, estimateVerdict } from '@/lib/verification-review';
import {
    agentVerificationFixture,
    kycFileFixture,
    verificationDocumentsFixture,
} from '@/test/verification-fixtures';
import { renderWithProviders, stubFetch } from '@/test/utils';

const SKETCH_LABEL = 'Hand-drawn sketch of the home location';

/** A one-pixel PNG, so the reveal has real bytes to wrap in an object URL. */
function pngResponse(type = 'image/png') {
    return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type }), {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': '4' },
    });
}

function renderChecklist(sketchMime: string) {
    const record = agentVerificationFixture({
        documents: verificationDocumentsFixture({
            homeAddressSketches: [
                kycFileFixture({
                    id: '66f0000000000000000000b1',
                    mimeType: sketchMime,
                    originalName: 'plan-maison',
                }),
            ],
        }),
    });

    const checks = buildChecks('agent', record);
    renderWithProviders(
        <VerificationChecklist checks={checks} estimate={estimateVerdict(checks)} />,
        { permissions: { held: new Set(['files.content.read', 'agents.read']) } },
    );
}

describe('opening a home-address sketch', () => {
    /**
     * ⚠ **The reported symptom was "the card disappears as if it was deleted".**
     * Every state in `ImageBox` draws inside `ImageBoxFrame`, so nothing should
     * ever vanish — this pins that the row survives the click whatever comes
     * back, which is the part the report said was broken.
     */
    it('reveals the image and keeps the row', async () => {
        stubFetch(() => pngResponse());
        renderChecklist('image/png');

        expect(await screen.findByText(SKETCH_LABEL)).toBeInTheDocument();

        await userEvent.click(
            await screen.findByRole('button', { name: new RegExp(`click to view.*${SKETCH_LABEL}`, 'i') }),
        );

        expect(await screen.findByRole('img', { name: SKETCH_LABEL })).toBeInTheDocument();
        // The label is still there — the row did not vanish.
        expect(screen.getByText(SKETCH_LABEL)).toBeInTheDocument();
    });

    /**
     * ⚠ **A sketch is as likely to be a PDF as a photograph** — the contract's
     * own example puts `application/pdf` in `homeAddressSketches`. That routes
     * to `FileViewer` rather than `ImageBox`, and it must still say something
     * rather than leaving an empty space where the evidence was.
     */
    it('says a PDF sketch cannot be drawn, rather than rendering nothing', async () => {
        stubFetch(() => pngResponse('application/pdf'));
        renderChecklist('application/pdf');

        expect(await screen.findByText(SKETCH_LABEL)).toBeInTheDocument();

        await userEvent.click(await screen.findByRole('button', { name: /open the file/i }));

        expect(await screen.findByText(/is not something this screen can display/i)).toBeInTheDocument();
        expect(screen.getByText(SKETCH_LABEL)).toBeInTheDocument();
    });
});

/**
 * ⚠ **`unavailable` and `missing` are different facts and must stay different
 * words.** `null` means this screen could not read the record — not loaded,
 * refused, or the request failed. Rendering that as *"Not supplied"* would tell
 * the reviewer the applicant sent nothing, and the drafted rejection goes to the
 * applicant. This assertion used to live on the review dialog; it moved here
 * with the checklist.
 */
describe('an unreadable record', () => {
    it('says the evidence was not readable, never that it was not supplied', () => {
        const checks = buildChecks('agent', null);
        renderWithProviders(
            <VerificationChecklist checks={checks} estimate={estimateVerdict(checks, null)} />,
            { permissions: { held: new Set(['files.content.read', 'agents.read']) } },
        );

        expect(screen.getAllByText('Not readable').length).toBeGreaterThan(0);
        expect(screen.queryByText('Not supplied')).not.toBeInTheDocument();
    });
});

/**
 * 🔴 **The regression this guards vanished a card in front of an operator, and
 * no test in jsdom can see it.** The sketch slot is a flex row; `ImageBox` draws
 * into an `AspectRatio` whose height is `padding-bottom: 75%` — a percentage of
 * its own width. Give the flex item no definite width and that resolves to zero,
 * so the box is zero wide and therefore zero tall.
 *
 * It only appeared **after** the reveal, because `RevealedImage` adds a plain
 * wrapper `<div>` that the placeholder does not have, which is what turns the
 * flex item from `ImageBoxFrame` (`w-full max-w-[16rem]`) into an unsized box.
 *
 * ⚠ **jsdom computes no layout**, so the collapse itself is untestable here —
 * every assertion about it would pass on the broken code. What is testable is
 * the *cause*: the wrapper carrying a definite width. That is why this asserts a
 * class name, which is otherwise a thing worth avoiding.
 */
describe('the sketch row survives being opened', () => {
    it('gives every box a definite width, not just a max-width', async () => {
        stubFetch(() => pngResponse());
        renderChecklist('image/png');

        const open = await screen.findByRole('button', {
            name: new RegExp(`click to view.*${SKETCH_LABEL}`, 'i'),
        });

        // `w-64` is definite; `max-w-*` alone is not, and that was the bug. The
        // pairing with the flex row is the whole fix, so assert both.
        const box = open.closest('div.w-64');
        expect(box, 'the definite-width wrapper around each sketch').not.toBeNull();
        expect(box!.parentElement?.className, 'the flex row').toMatch(/flex-wrap/);
    });
});
