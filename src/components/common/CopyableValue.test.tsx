import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '@/test/utils';

/**
 * The operator ask behind this component: any phone number, email or id shown
 * *as a value with no link* must be copyable. `CopyableId` was already that for
 * ids; this generalises it without generalising the one thing that is specific
 * to ids — the head-and-tail shortening.
 *
 * So the assertions worth writing are the ones that pin the differences between
 * the variants, and the three rules the plan is explicit about: no `mailto:` or
 * `tel:`, truncation for ids only, and a copy failure that is reported rather
 * than swallowed.
 */

const ID = '665f1c2a9b3e4a91c7d2e5f0';
const EMAIL = 'operations.desk+billing@a-rather-long-vendor-domain.example';
const PHONE = '+237 6 77 12 34 56';
/** A gateway reference: opaque and long, but not an ObjectId. */
const REFERENCE = 'MTN-MOMO-2026-08-25-0000917342';

/**
 * ⚠ **`delayDuration={0}` is load-bearing, not tidiness.**
 *
 * Radix opens a tooltip 700 ms after the pointer arrives. The refusal below is
 * only ever *reported* inside the tooltip, so asserting it means waiting out
 * that delay — and `findBy*` gives up after 1 s by default. That margin is
 * comfortable when the file runs alone and gone when 129 files are competing
 * for the machine, which is precisely the failure this repository already
 * writes down about `testTimeout`: **a timeout that only fires under contention
 * measures the machine, not the code.** Removing the delay removes the race
 * rather than widening the window it fits through.
 */
function renderValue(ui: ReactElement, { route }: { route?: string } = {}) {
    return renderWithProviders(
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>,
        { route },
    );
}

/** jsdom has no clipboard; every test decides what `writeText` does. */
function stubClipboard(impl: () => Promise<void>) {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true,
    });
    return writeText;
}

/** Reports where the router currently is, so "did not navigate" is an assertion. */
function LocationProbe() {
    const { pathname } = useLocation();
    return <span data-testid="pathname">{pathname}</span>;
}

beforeEach(() => {
    stubClipboard(() => Promise.resolve());
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('what each variant displays', () => {
    it('keeps both ends of an id, never a bare prefix', () => {
        // ObjectIds share a leading timestamp, so two ids minted in the same
        // second are identical for the first several characters. Truncating from
        // the left alone would render half a page of rows as the same string.
        renderValue(<CopyableValue variant="id" value={ID} label="order ID" />);

        expect(screen.getByTitle(ID)).toHaveTextContent('665f1c…e5f0');
    });

    it('shows an id whole when asked', () => {
        renderValue(<CopyableValue variant="id" value={ID} label="order ID" truncate={false} />);

        expect(screen.getByTitle(ID)).toHaveTextContent(ID);
    });

    it('never shortens an email, however long it is', () => {
        // An email has no shared prefix and no redundant middle, so shortening
        // one hides it and buys nothing.
        renderValue(<CopyableValue variant="email" value={EMAIL} label="contact email" />);

        expect(screen.getByTitle(EMAIL)).toHaveTextContent(EMAIL);
    });

    it('never shortens a phone number', () => {
        renderValue(<CopyableValue variant="phone" value={PHONE} label="contact phone" />);

        expect(screen.getByTitle(PHONE)).toHaveTextContent(PHONE);
    });

    it('never shortens a plain value', () => {
        // A gateway reference is as long as an ObjectId and just as opaque, but
        // it is not one: it has to survive character for character.
        renderValue(<CopyableValue variant="plain" value={REFERENCE} label="payment reference" />);

        expect(screen.getByTitle(REFERENCE)).toHaveTextContent(REFERENCE);
    });

    it('carries the full value in the title however little of it is shown', () => {
        renderValue(
            <>
                <CopyableValue variant="id" value={ID} label="order ID" />
                <CopyableValue variant="email" value={EMAIL} label="contact email" />
            </>,
        );

        expect(screen.getByTitle(ID)).toHaveTextContent('665f1c…e5f0');
        expect(screen.getByTitle(EMAIL)).toBeInTheDocument();
    });

    it('renders an id in mono and contact details in the surrounding type', () => {
        renderValue(
            <>
                <CopyableValue variant="id" value={ID} label="order ID" />
                <CopyableValue variant="email" value={EMAIL} label="contact email" />
                <CopyableValue variant="phone" value={PHONE} label="contact phone" />
            </>,
        );

        expect(screen.getByTitle(ID)).toHaveClass('font-mono');
        expect(screen.getByTitle(EMAIL)).not.toHaveClass('font-mono');
        expect(screen.getByTitle(PHONE)).not.toHaveClass('font-mono');
    });

    it('takes mono where the default is wrong, without taking truncation with it', () => {
        renderValue(
            <CopyableValue variant="plain" value={REFERENCE} label="payment reference" mono />,
        );

        const shown = screen.getByTitle(REFERENCE);
        expect(shown).toHaveClass('font-mono');
        expect(shown).toHaveTextContent(REFERENCE);
    });

    it('stays selectable in one gesture, whatever the clipboard can do', () => {
        // Half an ObjectId is worse than none, and a double-click stops at the
        // first non-word character — the `@` in an email, the space in a phone
        // number.
        renderValue(<CopyableValue variant="email" value={EMAIL} label="contact email" />);

        expect(screen.getByTitle(EMAIL)).toHaveClass('select-all');
    });

    it('renders an explicit gap for an absent value, not an empty box', () => {
        renderValue(<CopyableValue variant="phone" value={null} label="contact phone" />);

        expect(screen.getByText('Not set')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('treats an empty string as absent as well', () => {
        // The service returns `null` for absent data rather than `''`, but a
        // client-side `?? ''` is one keystroke away and an empty copy button is
        // worse than a stated gap.
        renderValue(<CopyableValue variant="email" value="" label="contact email" />);

        expect(screen.getByText('Not set')).toBeInTheDocument();
    });

    it('names the subject in the button, since a row can carry several', () => {
        renderValue(<CopyableValue variant="email" value={EMAIL} label="contact email" />);

        expect(screen.getByRole('button', { name: 'Copy contact email' })).toBeInTheDocument();
    });
});

describe('a value, not a redirect', () => {
    it('emits no mailto: for an email', () => {
        // The ask is explicit that these are values with no redirect link: half
        // of them sit inside a table row that is itself a link, and handing a
        // click to a mail client changes what the row does.
        const { container } = renderValue(
            <CopyableValue variant="email" value={EMAIL} label="contact email" />,
        );

        expect(container.querySelector('a')).toBeNull();
        expect(container.querySelector('[href^="mailto:"]')).toBeNull();
    });

    it('emits no tel: for a phone number', () => {
        const { container } = renderValue(
            <CopyableValue variant="phone" value={PHONE} label="contact phone" />,
        );

        expect(container.querySelector('a')).toBeNull();
        expect(container.querySelector('[href^="tel:"]')).toBeNull();
    });

    it('links to the dashboard when told to, and to nowhere else', () => {
        // `to` is the one route to a link, and it goes where the dashboard says
        // — never to a scheme derived from the variant.
        renderValue(
            <CopyableValue
                variant="email"
                value={EMAIL}
                label="contact email"
                to="/dashboard/users/665f1c2a9b3e4a91c7d2e5f0"
            />,
        );

        expect(screen.getByRole('link')).toHaveAttribute(
            'href',
            '/dashboard/users/665f1c2a9b3e4a91c7d2e5f0',
        );
        expect(screen.getByRole('button', { name: 'Copy contact email' })).toBeInTheDocument();
    });
});

describe('copying', () => {
    it('copies the full value, not the truncated display', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderValue(<CopyableValue variant="id" value={ID} label="order ID" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(writeText).toHaveBeenCalledWith(ID);
    });

    it('copies an email and a phone number exactly as given', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderValue(
            <>
                <CopyableValue variant="email" value={EMAIL} label="contact email" />
                <CopyableValue variant="phone" value={PHONE} label="contact phone" />
            </>,
        );

        await userEvent.click(screen.getByRole('button', { name: 'Copy contact email' }));
        await userEvent.click(screen.getByRole('button', { name: 'Copy contact phone' }));

        expect(writeText).toHaveBeenNthCalledWith(1, EMAIL);
        expect(writeText).toHaveBeenNthCalledWith(2, PHONE);
    });

    it('confirms afterwards, in the accessible name as well as the icon', async () => {
        renderValue(<CopyableValue variant="phone" value={PHONE} label="contact phone" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy contact phone' }));

        expect(
            await screen.findByRole('button', { name: 'contact phone copied' }),
        ).toBeInTheDocument();
    });

    it('reports a refused clipboard rather than swallowing it', async () => {
        // A non-secure origin, an unfocused document or a denied permission.
        // Silence here reads as a broken button; the message names the way out,
        // which is the value sitting on screen and selectable.
        // ⚠ The direct API, not `userEvent.setup()`: setting up an instance
        // installs user-event's *own* `navigator.clipboard`, which resolves —
        // the refusal this test is about would be quietly replaced by a success.
        //
        // ⚠ **Asserted on the announcement, not on the tooltip, and that is the
        // point rather than a convenience.** Radix suppresses re-opening a
        // tooltip on hover after a click on the same trigger, so hovering back
        // over the button an operator has just pressed shows nothing — this
        // test hovered and passed only when it won a race. The fix was in the
        // component: the refusal is announced as well as tooltipped, because a
        // failure reachable only by hover is unreachable on touch and silent to
        // a screen reader.
        stubClipboard(() => Promise.reject(new Error('denied')));
        renderValue(<CopyableValue variant="email" value={EMAIL} label="contact email" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy contact email' }));

        expect(await screen.findByRole('status')).toHaveTextContent(
            'Could not copy — select it instead',
        );
        expect(screen.getByTitle(EMAIL)).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'contact email copied' }),
        ).not.toBeInTheDocument();
    });

    it('survives a browser with no clipboard object at all', async () => {
        // On a plain-HTTP origin `navigator.clipboard` is undefined rather than a
        // method that rejects, so an unguarded call throws a TypeError.
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        renderValue(<CopyableValue variant="phone" value={PHONE} label="contact phone" />);

        await userEvent.click(screen.getByRole('button', { name: 'Copy contact phone' }));

        expect(screen.getByTitle(PHONE)).toBeInTheDocument();
    });

    it('does not navigate when the copy button sits inside a link', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderValue(
            <>
                <CopyableValue
                    variant="id"
                    value={ID}
                    label="order ID"
                    to={`/dashboard/orders/${ID}`}
                />
                <LocationProbe />
            </>,
            { route: '/dashboard/orders' },
        );

        await userEvent.click(screen.getByRole('button', { name: 'Copy order ID' }));

        expect(writeText).toHaveBeenCalledWith(ID);
        expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard/orders');
    });

    it('still navigates when the link itself is clicked', async () => {
        // The control for the test above: without it, "did not navigate" would
        // pass just as well against a component that never links at all.
        renderValue(
            <>
                <CopyableValue
                    variant="id"
                    value={ID}
                    label="order ID"
                    to={`/dashboard/orders/${ID}`}
                />
                <LocationProbe />
            </>,
            { route: '/dashboard/orders' },
        );

        await userEvent.click(screen.getByRole('link'));

        expect(screen.getByTestId('pathname')).toHaveTextContent(`/dashboard/orders/${ID}`);
    });
});

describe('CopyableId, unchanged', () => {
    // Twenty-one files import it. It is now `CopyableValue`'s `id` variant under
    // its original name, and these assertions are the contract those call sites
    // were written against — they are duplicated from `CopyableId.test.tsx` on
    // purpose, so a change to the alias fails here too.

    it('still shortens head and tail by default', () => {
        renderValue(<CopyableId value={ID} label="order ID" />);

        expect(screen.getByTitle(ID)).toHaveTextContent('665f1c…e5f0');
        expect(screen.getByTitle(ID)).toHaveClass('font-mono');
    });

    it('still shows the value whole when asked', () => {
        renderValue(<CopyableId value={ID} label="order ID" truncate={false} />);

        expect(screen.getByTitle(ID)).toHaveTextContent(ID);
    });

    it('still renders an explicit gap for an absent id', () => {
        renderValue(<CopyableId value={null} label="order ID" />);

        expect(screen.getByText('Not set')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('still links, names the subject and copies the whole id', async () => {
        const writeText = stubClipboard(() => Promise.resolve());
        renderValue(
            <CopyableId value={ID} label="vendor ID" to={`/dashboard/vendors/${ID}`} />,
        );

        expect(screen.getByRole('link')).toHaveAttribute('href', `/dashboard/vendors/${ID}`);

        await userEvent.click(screen.getByRole('button', { name: 'Copy vendor ID' }));

        expect(writeText).toHaveBeenCalledWith(ID);
    });
});
