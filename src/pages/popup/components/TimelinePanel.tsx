import React, { useEffect, useState } from 'react';

import {
  getCurrentChatGPTTimeline,
  scrollToChatGPTTimelineMessage,
} from '@/core/services/ChatGPTTimelineService';
import type { ChatGPTTimelineNode, ChatGPTTimelineSnapshot } from '@/core/types/timeline';
import { ListView, PageSection, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

import { useLanguage } from '../../../contexts/LanguageContext';

type TimelinePanelProps = {
  onBack: () => void;
};

export function TimelinePanel({ onBack }: TimelinePanelProps) {
  const { t } = useLanguage();
  const [timeline, setTimeline] = useState<ChatGPTTimelineSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshTimeline = async () => {
    setLoading(true);
    setMessage(null);

    try {
      setTimeline(await getCurrentChatGPTTimeline());
    } catch {
      setTimeline({ isChatGPTPage: false, nodes: [] });
      setMessage(t('timelineLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshTimeline();
  }, []);

  const handleScrollToNode = async (node: ChatGPTTimelineNode) => {
    try {
      const scrolled = await scrollToChatGPTTimelineMessage(node.messageAnchor);
      setMessage(scrolled ? null : t('timelineMessageNotFound'));
    } catch {
      setMessage(t('timelineJumpFailed'));
    }
  };

  return (
    <Panel
      title={t('cgEntryTimeline')}
      subtitle={t('timelineSubtitle')}
      onBack={onBack}
      backLabel={t('back')}
    >
      <PageSection
        title={t('timelineBasic')}
        description={
          loading
            ? t('timelineRefreshing')
            : t('timelineMessageTotal').replace('{count}', String(timeline?.nodes.length || 0))
        }
        actions={[
          {
            id: 'refresh',
            label: t('timelineRefresh'),
            tone: 'primary',
            disabled: loading,
            onClick: () => void refreshTimeline(),
          },
        ]}
      >
        {message && (
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{message}</p>
        )}
        {timeline && !timeline.isChatGPTPage && (
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.body)}>
            {t('cgStatusNotChatGPT')}
          </p>
        )}
      </PageSection>

      <ListView
        emptyText={timeline?.isChatGPTPage ? t('timelineNoMessages') : t('cgStatusNotChatGPT')}
        items={(timeline?.isChatGPTPage ? timeline.nodes : []).map((node) => ({
          id: node.messageAnchor,
          title: `#${node.index}`,
          meta: node.role === 'user' ? t('roleUser') : t('roleAssistant'),
          subtitle: node.summary || t('emptyMessage'),
          actions: [
            {
              id: 'jump',
              label: t('jump'),
              tone: 'secondary',
              onClick: () => void handleScrollToNode(node),
            },
          ],
        }))}
      />
    </Panel>
  );
}
