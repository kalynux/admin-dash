import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImageLightbox, type LightboxImage } from '@/components/files/ImageLightbox';
import { renderWithProviders } from '@/test/utils';

const ONE: LightboxImage[] = [
    { src: 'blob:http://localhost/proof', alt: 'Delivery proof', caption: 'image/jpeg · 210 KB' },
];

const GALLERY: LightboxImage[] = [
    { src: 'blob:http://localhost/one', alt: 'Front of the parcel' },
    { src: 'blob:http://localhost/two', alt: 'Back of the parcel' },
    { src: 'blob:http://localhost/three', alt: 'The doorway' },
];

function open(images: LightboxImage[], startIndex = 0, onOpenChange = vi.fn()) {
    renderWithProviders(
        <ImageLightbox images={images} startIndex={startIndex} open onOpenChange={onOpenChange} />,
    );
    return onOpenChange;
}

describe('the full-screen viewer', () => {
    it('has a real accessible name', async () => {
        // Radix warns without a `DialogTitle`, and a dialog with no name is
        // announced as "dialog" and nothing else. The design has no room for a
        // heading over a full-bleed image, so it is hidden visually rather than
        // omitted.
        open(ONE);

        expect(await screen.findByRole('dialog')).toHaveAccessibleName('Delivery proof');
    });

    it('closes on Escape', async () => {
        /**
         * ⚠ **Radix's behaviour, asserted rather than reimplemented.** `Dialog`
         * already closes on `Escape`, traps focus and restores it on the way
         * out. A hand-rolled key handler would be a second implementation of a
         * working one, and the two would disagree the first time either was
         * changed. This test exists to notice if that ever stops being true —
         * not to describe code of ours.
         */
        const onOpenChange = open(ONE);
        await screen.findByRole('dialog');

        await userEvent.keyboard('{Escape}');

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('offers no arrows for a single image', async () => {
        // A single-image caller passes a list of one and gets no gallery chrome.
        open(ONE);
        await screen.findByRole('dialog');

        expect(screen.queryByRole('button', { name: /next image/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /previous image/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/1 of 1/)).not.toBeInTheDocument();
    });
});

describe('a gallery', () => {
    it('starts on the image that was clicked', async () => {
        open(GALLERY, 1);

        expect(await screen.findByRole('img', { name: 'Back of the parcel' })).toBeInTheDocument();
        expect(screen.getByText('2 of 3')).toBeInTheDocument();
    });

    it('moves with the arrow keys', async () => {
        open(GALLERY, 0);
        await screen.findByRole('dialog');

        await userEvent.keyboard('{ArrowRight}');
        expect(await screen.findByRole('img', { name: 'Back of the parcel' })).toBeInTheDocument();

        await userEvent.keyboard('{ArrowLeft}');
        expect(await screen.findByRole('img', { name: 'Front of the parcel' })).toBeInTheDocument();
    });

    it('wraps at both ends rather than dead-ending', async () => {
        // Three images and a left arrow on the first one: the alternative is a
        // control that looks live and does nothing.
        open(GALLERY, 0);
        await screen.findByRole('dialog');

        await userEvent.click(screen.getByRole('button', { name: /previous image/i }));

        expect(await screen.findByRole('img', { name: 'The doorway' })).toBeInTheDocument();
        expect(screen.getByText('3 of 3')).toBeInTheDocument();
    });

    it('resets the zoom when it moves, because this is a different picture', async () => {
        open(GALLERY, 0);
        await screen.findByRole('dialog');

        await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
        expect(screen.getByText('150%')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /next image/i }));

        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});

describe('zoom', () => {
    it('magnifies and restores', async () => {
        open(ONE);
        await screen.findByRole('dialog');

        expect(screen.getByText('100%')).toBeInTheDocument();
        // Nothing to zoom out of, and nothing to reset, at the fit size.
        expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /reset zoom/i })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));

        expect(screen.getByText('150%')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Delivery proof' })).toHaveStyle({
            transform: 'translate(0px, 0px) scale(1.5)',
        });

        await userEvent.click(screen.getByRole('button', { name: /reset zoom/i }));

        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});
