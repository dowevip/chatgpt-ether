import type { Panel as PanelModel } from '@/ui/core';
import { uiTokens } from '@/ui/tokens';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ActionBar } from './ActionBar';

type PanelProps = PanelModel & {
  className?: string;
};

export function Panel({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  headerAccessory,
  actions = [],
  children,
  className,
}: PanelProps) {
  return (
    <div className={cn(uiTokens.color.app, uiTokens.layout.popupWidth, 'overflow-hidden', className)}>
      <div
        className={cn(
          'flex items-start justify-between border-b px-5 py-3.5',
          uiTokens.color.borderSubtle,
        )}
      >
        <div className="min-w-0">
          <h1 className={cn(uiTokens.color.textStrong, uiTokens.typography.title)}>{title}</h1>
          {subtitle && (
            <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerAccessory}
          <ActionBar actions={actions} align="end" />
          {onBack && (
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              {backLabel}
            </Button>
          )}
        </div>
      </div>
      <div
        className={cn(
          'flex flex-col overflow-y-auto',
          uiTokens.layout.panelMaxHeight,
          uiTokens.layout.pagePadding,
          uiTokens.layout.sectionGap,
        )}
      >
        {children}
      </div>
    </div>
  );
}
