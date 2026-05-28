import React, { useEffect, useMemo, useState } from 'react';

import {
  formatChatGPTDiagnosticsText,
  getChatGPTDiagnosticsStatus,
  type ChatGPTDiagnosticsStatus,
} from '@/core/services/ChatGPTDiagnosticsService';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { useLanguage } from '../../../contexts/LanguageContext';

type DiagnosticsPanelProps = {
  onBack: () => void;
};

function valueText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export function DiagnosticsPanel({ onBack }: DiagnosticsPanelProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ChatGPTDiagnosticsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      status
        ? [
            [t('cgIsChatGPTPage'), status.isChatGPTPage ? t('yes') : t('no')],
            ['conversationId', valueText(status.conversationId)],
            [t('cgConversationTitle'), valueText(status.conversationTitle)],
            [t('cgTotalMessageCount'), String(status.totalMessageCount)],
            [t('cgUserMessageCount'), String(status.userMessageCount)],
            [t('cgAssistantMessageCount'), String(status.assistantMessageCount)],
            [t('diagTimelineVisible'), status.timelineVisible ? t('yes') : t('no')],
            [t('diagTimelineNodeCount'), String(status.timelineNodeCount)],
            [t('diagStarredMessageCount'), String(status.starredMessageCount)],
            [t('diagCurrentConversationSaved'), status.currentConversationSaved ? t('yes') : t('no')],
            ['schemaVersion', status.schemaVersion || t('notSet')],
            [t('diagExtensionVersion'), status.extensionVersion],
            [
              t('syncGoogleDriveAuthStatus'),
              status.googleDriveAuthStatus === '未启用'
                ? t('syncDisabled')
                : status.googleDriveAuthStatus,
            ],
            [
              t('syncLastSyncTime'),
              status.lastSyncTime === '未同步' ? t('notSynced') : status.lastSyncTime,
            ],
            [t('syncRecentError'), status.recentSyncError === '无' ? t('none') : status.recentSyncError],
          ]
        : [],
    [status, t],
  );

  const refreshDiagnostics = async () => {
    setLoading(true);
    setMessage(null);
    try {
      setStatus(await getChatGPTDiagnosticsStatus());
    } catch {
      setMessage(t('diagLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const copyDiagnostics = async () => {
    if (!status) return;
    try {
      const text =
        t('diagTitle') +
        '\n' +
        rows.map(([label, value]) => `${label}: ${value}`).join('\n');
      await navigator.clipboard.writeText(text || formatChatGPTDiagnosticsText(status));
      setMessage(t('diagCopied'));
    } catch {
      setMessage(t('copyFailedRefresh'));
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  return (
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">{t('cgEntryDiagnostics')}</h1>
          <p className="text-muted-foreground text-xs">{t('diagSubtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('back')}
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardContent className="flex items-center justify-between gap-3 p-0">
            <div>
              <CardTitle className="text-base">{t('diagRuntimeStatus')}</CardTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                {loading ? t('diagRefreshing') : t('diagNoChatBody')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void refreshDiagnostics()}
              >
                {t('refresh')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!status || loading}
                onClick={() => void copyDiagnostics()}
              >
                {t('copy')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {message && <p className="text-muted-foreground text-xs">{message}</p>}

        <Card className="p-4">
          <CardContent className="space-y-2 p-0">
            {rows.length === 0 && (
              <p className="text-muted-foreground text-sm">{t('diagEmpty')}</p>
            )}
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className="min-w-0 truncate text-right font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
