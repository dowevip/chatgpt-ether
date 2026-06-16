import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full border px-3 py-1.5 text-[13px] outline-none',
        uiTokens.color.input,
        uiTokens.radius.control,
        uiTokens.color.focus,
        className,
      )}
      {...props}
    />
  );
}

export function TextAreaField({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-y border px-3 py-2 text-[13px] outline-none',
        uiTokens.color.input,
        uiTokens.radius.control,
        uiTokens.color.focus,
        className,
      )}
      {...props}
    />
  );
}

export function SelectField({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full border px-2 py-1 text-xs outline-none',
        uiTokens.color.input,
        uiTokens.radius.control,
        uiTokens.color.focus,
        className,
      )}
      {...props}
    />
  );
}
