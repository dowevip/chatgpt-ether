import type { PageSection as PageSectionModel } from '@/ui/core';
import { uiTokens } from '@/ui/tokens';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { ActionBar } from './ActionBar';

type PageSectionProps = PageSectionModel & {
  className?: string;
};

export function PageSection({
  title,
  description,
  actions = [],
  children,
  className,
}: PageSectionProps) {
  return (
    <Card className={cn('p-3.5', className)}>
      {(title || actions.length > 0) && (
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <CardTitle className={uiTokens.typography.sectionTitle}>{title}</CardTitle>}
            {description && (
              <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                {description}
              </p>
            )}
          </div>
          <ActionBar actions={actions} align="end" />
        </div>
      )}
      <CardContent className="space-y-3 p-0">{children}</CardContent>
    </Card>
  );
}
