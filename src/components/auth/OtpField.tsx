import { useEffect, useRef } from 'react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';

interface OtpFieldProps {
    value: string;
    onChange: (value: string) => void;
    /** Called once the sixth digit lands. */
    onComplete: (value: string) => void;
    disabled?: boolean;
    label?: string;
    autoFocus?: boolean;
}

/**
 * The six-digit authenticator code.
 *
 * Auto-submits on the last digit, because retyping six digits that expire in
 * thirty seconds and then reaching for a button is a real source of failed
 * attempts — and failed attempts here count toward the account lockout.
 *
 * The completion callback is fired from an effect and guarded against re-entry:
 * `input-otp` can re-emit a full value on a re-render, and a second submit would
 * spend a second attempt against that same lockout.
 */
export function OtpField({
    value,
    onChange,
    onComplete,
    disabled,
    label = 'Authentication code',
    autoFocus = true,
}: OtpFieldProps) {
    const submittedFor = useRef<string | null>(null);

    useEffect(() => {
        if (value.length !== 6) {
            // A new attempt has begun — let the next full value through.
            submittedFor.current = null;
            return;
        }
        if (submittedFor.current === value) return;
        submittedFor.current = value;
        onComplete(value);
    }, [value, onComplete]);

    return (
        <div className="space-y-2">
            <Label htmlFor="otp-code">{label}</Label>
            <InputOTP
                id="otp-code"
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={value}
                onChange={onChange}
                disabled={disabled}
                autoFocus={autoFocus}
                containerClassName="justify-center"
                aria-label={label}
            >
                <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                </InputOTPGroup>
            </InputOTP>
        </div>
    );
}
