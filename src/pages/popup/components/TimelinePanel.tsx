import React, { useEffect, useState } from 'react';

import {
  getCurrentChatGPTTimeline,
  scrollToChatGPTTimelineMessage,
} from '@/core/services/ChatGPTTimelineService';
import type { ChatGPTTimelineNode, ChatGPTTimelineSnapshot } from '@/core/types/timeline';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
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
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">{t('cgEntryTimeline')}</h1>
          <p className="text-muted-foreground text-xs">{t('timelineSubtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('back')}
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardContent className="flex items-center justify-between gap-3 p-0">
            <div>
              <CardTitle className="text-base">{t('timelineBasic')}</CardTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                {loading
                  ? t('timelineRefreshing')
                  : t('timelineMessageTotal').replace('{count}', String(timeline?.nodes.length || 0))}
              </p>
            </div>
            <Button type="button" size="sm" disabled={loading} onClick={() => void refreshTimeline()}>
              {t('timelineRefresh')}
            </Button>
          </CardContent>
        </Card>

        {message && <p className="text-muted-foreground text-xs">{message}</p>}

        {timeline && !timeline.isChatGPTPage && (
          <p className="text-muted-foreground text-sm">{t('cgStatusNotChatGPT')}</p>
        )}

        {timeline?.isChatGPTPage && timeline.nodes.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('timelineNoMessages')}</p>
        )}

        {timeline?.isChatGPTPage && timeline.nodes.length > 0 && (
          <div className="space-y-2">
            {timeline.nodes.map((node) => (
              <button
                key={node.messageAnchor}
                type="button"
                onClick={() => void handleScrollToNode(node)}
                className="border-border bg-background hover:bg-secondary/60 w-full rounded-md border px-3 py-2 text-left text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-primary font-semibold">#{node.index}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {node.role === 'user' ? t('roleUser') : t('roleAssistant')}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs">{node.summary || t('emptyMessage')}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
