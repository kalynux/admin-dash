import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/ui/input';
import { renderWithProviders } from '@/test/utils';

describe('FormField', () => {
    it('labels the control it wraps', () => {
        renderWithProviders(
            <FormField id="reason" label="Reason">
                {(field) => <Input {...field} />}
            </FormField>,
        );

        expect(screen.getByLabelText('Reason')).toBeInTheDocument();
    });

    it('describes the control by its hint when there is no error', () => {
        renderWithProviders(
            <FormField id="reason" label="Reason" hint="Write it for someone reading later.">
                {(field) => <Input {...field} />}
            </FormField>,
        );

        expect(screen.getByLabelText('Reason')).toHaveAccessibleDescription(
            'Write it for someone reading later.',
        );
    });

    it('describes the control by its error, and marks it invalid', () => {
        renderWithProviders(
            <FormField
                id="reason"
                label="Reason"
                hint="Write it for someone reading later."
                error="A reason is required to suspend an account"
            >
                {(field) => <Input {...field} />}
            </FormField>,
        );

        const control = screen.getByLabelText('Reason');
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(control).toHaveAccessibleDescription(
            'A reason is required to suspend an account',
        );
    });

    it('replaces the hint rather than stacking the two', () => {
        renderWithProviders(
            <FormField id="reason" label="Reason" hint="Standing guidance." error="Too short">
                {(field) => <Input {...field} />}
            </FormField>,
        );

        expect(screen.queryByText('Standing guidance.')).not.toBeInTheDocument();
    });

    it('announces the error when it appears, not only on focus', () => {
        renderWithProviders(
            <FormField id="reason" label="Reason" error="Too short">
                {(field) => <Input {...field} />}
            </FormField>,
        );

        // `aria-describedby` is read on focus; a submit that bounces while focus
        // is on the button is otherwise silent.
        expect(screen.getByRole('alert')).toHaveTextContent('Too short');
    });

    it('leaves the control undescribed when there is nothing to say', () => {
        renderWithProviders(
            <FormField id="reason" label="Reason">
                {(field) => <Input {...field} />}
            </FormField>,
        );

        // Not an empty string: a dangling `aria-describedby` names an element
        // that does not exist, which is worse than no attribute at all.
        expect(screen.getByLabelText('Reason')).not.toHaveAttribute('aria-describedby');
    });
});
