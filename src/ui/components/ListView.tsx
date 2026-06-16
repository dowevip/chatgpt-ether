import type { ListView as ListViewModel } from '@/ui/core';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

import { ActionBar } from './ActionBar';

type ListViewProps = ListViewModel & {
  className?: string;
};

export function ListView({ items, emptyText, variant = 'cards', className }: ListViewProps) {
  if (items.length === 0) {
    return <p className={cn(uiTokens.color.textMuted, uiTokens.typography.body)}>{emptyText}</p>;
  }

  return (
    <div
      className={cn(
        'space-y-1.5',
        variant === 'divided' && 'divide-y',
        variant === 'divided' && uiTokens.color.borderSubtle,
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            variant === 'cards' && 'rounded-lg border px-3 py-2.5',
            variant === 'cards' && uiTokens.color.border,
            variant === 'divided' && 'py-2 first:pt-0 last:pb-0',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className={cn('truncate font-medium', uiTokens.typography.body)}>
                {item.title}
              </div>
              {item.subtitle && (
                <div className={cn('mt-1', uiTokens.color.textMuted, uiTokens.typography.caption)}>
                  {item.subtitle}
                </div>
              )}
            </div>
            {item.meta && (
              <div className={cn('shrink-0', uiTokens.color.textMuted, uiTokens.typography.caption)}>
                {item.meta}
              </div>
            )}
          </div>
          {item.body && <div className="mt-2">{item.body}</div>}
          {item.actions && item.actions.length > 0 && (
            <ActionBar actions={item.actions} className="mt-2 opacity-80" />
          )}
        </div>
      ))}
    </div>
  );
}
