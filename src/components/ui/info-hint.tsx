import * as React from 'react';
import { CircleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface InfoHintProps {
  /** The explanation revealed when the icon is pressed. */
  children: React.ReactNode;
  /** Accessible name for the trigger — name what it explains. */
  label?: string;
  side?: React.ComponentProps<typeof PopoverContent>['side'];
  align?: React.ComponentProps<typeof PopoverContent>['align'];
  className?: string;
}

/**
 * Press-to-reveal explanation, used in place of the helper paragraphs that used
 * to sit permanently under every label. A Popover (not a Tooltip) on purpose:
 * Radix tooltips never open on touch, so on mobile the copy would be
 * unreachable — this opens on tap and on click alike.
 */
export function InfoHint({
  children,
  label = 'More information',
  side = 'top',
  align = 'center',
  className,
}: InfoHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <CircleAlert className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A field label with its explanation folded into an info icon.
 * `htmlFor` keeps the click-to-focus association with the input.
 */
export function LabelWithHint({
  htmlFor,
  children,
  hint,
  hintLabel,
  required,
  optional,
  className,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  hintLabel?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <label
        htmlFor={htmlFor}
        className="flex select-none items-center text-sm font-medium leading-none"
      >
        {children}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </label>
      {hint && (
        <InfoHint label={hintLabel ?? `About this field`} align="start">
          {hint}
        </InfoHint>
      )}
    </div>
  );
}
