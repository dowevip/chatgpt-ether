import React, { useEffect, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  listChatGPTStarredMessages,
  removeChatGPTStarredMessage,
} from '@/core/services/ChatGPTStarredService';
import type { ChatGPTStarredMessage } from '@/core/types/starred';
import { ListView, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

import { useLanguage } from '../../../contexts/LanguageContext';

type StarredPanelProps = {
  onBack: () => void;
};

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function isSameConversation(url: string | undefined, conversationId: string): boolean {
  return Boolean(url?.startsWith('https://chatgpt.com/')) && Boolean(url?.includes(`/c/${conversationId}`));
}

export function StarredPanel({ onBack }: StarredPanelProps) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<ChatGPTStarredMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [messageStatuses, setMessageStatuses] = useState<Record<string, string>>({});

  const setMessageStatus = (messageId: string, nextStatus: string) => {
    setMessageStatuses((prev) => ({ ...prev, [messageId]: nextStatus }));
  };

  const reload = async () => {
    setMessages(await listChatGPTStarredMessages());
  };

  useEffect(() => {
    reload().catch(() => setStatus(t('starredLoadFailed')));
  }, [t]);

  const handleRemove = async (id: string) => {
    try {
      setMessages(await removeChatGPTStarredMessage(id));
      setStatus(t('starredRemoved'));
    } catch {
      setStatus(t('starredRemoveFailed'));
    }
  };

  const buildLocatePayload = (message: ChatGPTStarredMessage) => ({
    conversationId: message.conversationId,
    turnId: message.turnId,
    messageId: message.messageId,
    messageAnchor: message.messageAnchor,
    snippet: message.snippet,
    fingerprint: message.fingerprint,
  });

  const waitForTabComplete = async (tabId: number): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === 'complete') return;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  };

  const locateMessageWithRetries = async (
    tabId: number,
    message: ChatGPTStarredMessage,
  ): Promise<{ located: boolean; error?: string }> => {
    const payload = buildLocatePayload(message);
    let lastError = '';

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = (await browser.tabs.sendMessage(tabId, {
          type: 'gv.chatgpt.timeline.scroll',
          payload,
        })) as { ok?: boolean; scrolled?: boolean; error?: string } | undefined;

        if (response?.ok && response.scrolled) return { located: true };
        if (response?.error) lastError = response.error;
      } catch {
        // Content script may not be ready immediately after ChatGPT navigation.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }

    return { located: false, error: lastError || t('starredLocateFailed') };
  };

  const handleOpen = async (message: ChatGPTStarredMessage) => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) {
        setStatus(t('pvNoCurrentTab'));
        return;
      }

      if (isSameConversation(tab.url, message.conversationId)) {
        setMessageStatus(message.id, t('starredLocating'));
        const result = await locateMessageWithRetries(tab.id, message);
        setMessageStatus(message.id, result.located ? t('starredLocated') : result.error || t('starredLocateFailed'));
        return;
      }

      setMessageStatus(message.id, t('starredOpeningConversation'));
      await browser.tabs.update(tab.id, { url: message.url });
      await waitForTabComplete(tab.id);
      setMessageStatus(message.id, t('starredLocating'));
      const result = await locateMessageWithRetries(tab.id, message);
      setMessageStatus(
        message.id,
        result.located ? t('starredLocated') : t('starredOpenedButLocateFailed'),
      );
    } catch {
      setMessageStatus(message.id, t('starredJumpFailed'));
    }
  };

  return (
    <Panel
      title={t('cgEntryStarred')}
      subtitle={t('starredSubtitle')}
      onBack={onBack}
      backLabel={t('back')}
    >
      {status && <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{status}</p>}
      <ListView
        emptyText={t('starredEmpty')}
        items={messages.map((message) => ({
          id: message.id,
          title: message.conversationTitle,
          subtitle: message.snippet || '-',
          meta: t('starredCreatedAt').replace('{time}', formatTime(message.createdAt)),
          body: messageStatuses[message.id] ? (
            <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
              {messageStatuses[message.id]}
            </p>
          ) : null,
          actions: [
            {
              id: 'open',
              label: t('starredOpenJump'),
              tone: 'primary',
              onClick: () => void handleOpen(message),
            },
            {
              id: 'remove',
              label: t('starredRemove'),
              tone: 'danger',
              onClick: () => void handleRemove(message.id),
            },
          ],
        }))}
      />
    </Panel>
  );
}
