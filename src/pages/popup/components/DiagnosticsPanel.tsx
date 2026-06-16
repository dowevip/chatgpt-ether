import React, { useEffect, useMemo, useState } from 'react';

import {
  formatChatGPTDiagnosticsText,
  getChatGPTDiagnosticsStatus,
  type ChatGPTDiagnosticsStatus,
} from '@/core/services/ChatGPTDiagnosticsService';
import { ListView, PageSection, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

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
    <Panel
      title={t('cgEntryDiagnostics')}
      subtitle={t('diagSubtitle')}
      onBack={onBack}
      backLabel={t('back')}
    >
      <PageSection
        title={t('diagRuntimeStatus')}
        description={loading ? t('diagRefreshing') : t('diagNoChatBody')}
        actions={[
          {
            id: 'refresh',
            label: t('refresh'),
            tone: 'secondary',
            disabled: loading,
            onClick: () => void refreshDiagnostics(),
          },
          {
            id: 'copy',
            label: t('copy'),
            tone: 'primary',
            disabled: !status || loading,
            onClick: () => void copyDiagnostics(),
          },
        ]}
      >
        {message && (
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{message}</p>
        )}
      </PageSection>

      <ListView
        variant="divided"
        emptyText={t('diagEmpty')}
        items={rows.map(([label, value]) => ({
          id: label,
          title: <span className={uiTokens.color.textMuted}>{label}</span>,
          meta: value,
        }))}
      />
    </Panel>
  );
}
