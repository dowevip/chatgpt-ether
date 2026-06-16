import type { ActionBar as ActionBarModel, UIAction } from '@/ui/core';
import { uiTokens } from '@/ui/tokens';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function actionVariant(action: UIAction): 'default' | 'outline' | 'destructive' | 'ghost' {
  if (action.tone === 'danger') return 'ghost';
  if (action.tone === 'ghost') return 'ghost';
  if (action.tone === 'primary') return 'default';
  return 'outline';
}

type ActionBarProps = ActionBarModel & {
  className?: string;
  size?: 'sm' | 'default';
};

export function ActionBar({ actions, align = 'start', className, size = 'sm' }: ActionBarProps) {
  if (actions.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center',
        uiTokens.layout.rowGap,
        align === 'end' && 'justify-end',
        align === 'between' && 'justify-between',
        className,
      )}
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          size={size}
          variant={actionVariant(action)}
          disabled={action.disabled}
          title={action.title}
          onClick={action.onClick}
          className={action.tone === 'danger' ? 'text-destructive hover:bg-destructive/10' : undefined}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
