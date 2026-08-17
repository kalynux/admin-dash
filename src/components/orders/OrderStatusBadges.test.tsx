import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
    FulfillmentStatusBadge,
    PaymentStatusBadge,
} from '@/components/orders/OrderStatusBadges';

/**
 * A badge cannot trust its caller.
 *
 * These render outside the providers on purpose — they are pure presentation,
 * and the point of the suite is that a *missing* value degrades to a readable
 * gap instead of taking the surrounding table down with it. Before this, an
 * order written before `payment_method` existed crashed the whole orders list
 * on whichever page it landed.
 */
describe('order status badges', () => {
    it('renders a known status readably', () => {
        render(<PaymentStatusBadge status="partially_paid" />);
        expect(screen.getByText('partially paid')).toBeInTheDocument();
    });

    it('lower-cases the SCREAMING_SNAKE value but keeps the token in the title', () => {
        render(<PaymentStatusBadge status={'AWAITING_PAYMENT' as never} />);
        expect(screen.getByText('awaiting payment')).toBeInTheDocument();
        // The title carries the raw token, so the word on screen can still be
        // traced to the API, the filter and the audit trail.
        expect(screen.getByTitle('AWAITING_PAYMENT')).toBeInTheDocument();
    });

    it('renders an unrecognised status rather than blanking it', () => {
        // Adding an enum member is an additive, non-breaking backend change.
        render(<FulfillmentStatusBadge status={'invented_next_quarter' as never} />);
        expect(screen.getByText('invented next quarter')).toBeInTheDocument();
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty', ''],
    ])('does not throw when the status is %s', (_label, value) => {
        expect(() =>
            render(<PaymentStatusBadge status={value as never} />),
        ).not.toThrow();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('says Unknown rather than rendering an empty badge', () => {
        render(<FulfillmentStatusBadge status={undefined} />);
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
});
