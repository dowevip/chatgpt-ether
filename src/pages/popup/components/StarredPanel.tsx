import React, { useEffect, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  listChatGPTStarredMessages,
  removeChatGPTStarredMessage,
} from '@/core/services/ChatGPTStarredService';
import type { ChatGPTStarredMessage } from '@/core/types/starred';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';

type StarredPanelProps = {
  onBack: () => void;
};

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function isSameConversation(url: string | undefined, conversationId: string): boolean {
  return Boolean(url?.startsWith('https://chatgpt.com/')) && url?.includes(`/c/${conversationId}`);
}

export function StarredPanel({ onBack }: StarredPanelProps) {
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
    reload().catch(() => setStatus('读取收藏消息失败。'));
  }, []);

  const handleRemove = async (id: string) => {
    try {
      setMessages(await removeChatGPTStarredMessage(id));
      setStatus('已取消收藏。');
    } catch {
      setStatus('取消收藏失败。');
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

    return { located: false, error: lastError || '未能自动定位' };
  };

  const handleOpen = async (message: ChatGPTStarredMessage) => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) {
        setStatus('未找到当前标签页。');
        return;
      }

      if (isSameConversation(tab.url, message.conversationId)) {
        setMessageStatus(message.id, '正在定位收藏消息...');
        const result = await locateMessageWithRetries(tab.id, message);
        setMessageStatus(message.id, result.located ? '已定位' : result.error || '未能自动定位');
        return;
      }

      setMessageStatus(message.id, '正在打开对话...');
      await browser.tabs.update(tab.id, { url: message.url });
      await waitForTabComplete(tab.id);
      setMessageStatus(message.id, '正在定位收藏消息...');
      const result = await locateMessageWithRetries(tab.id, message);
      setMessageStatus(
        message.id,
        result.located ? '已定位' : '已打开对应对话，但未能自动定位收藏消息，请稍后再点一次跳转。',
      );
    } catch {
      setMessageStatus(message.id, '跳转失败，请确认当前 ChatGPT 页面已加载。');
    }
  };

  return (
    <div className="w-[360px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">收藏消息</h1>
          <p className="text-muted-foreground text-xs">只保存用户发言摘要和定位信息。</p>
        </div>
        <Button type="button" onClick={onBack} variant="outline" className="px-3 py-1.5 text-xs">
          返回
        </Button>
      </div>

      {status && <p className="text-muted-foreground mb-3 text-xs">{status}</p>}

      <div className="space-y-2">
        {messages.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-4 text-sm">
              暂无收藏消息。可在右侧时间轴节点上点击星标收藏。
            </CardContent>
          </Card>
        ) : (
          messages.map((message) => (
            <Card key={message.id}>
              <CardContent className="space-y-2 p-3">
                <div>
                  <CardTitle className="truncate text-sm">{message.conversationTitle}</CardTitle>
                  <p className="text-muted-foreground mt-1 text-xs">{message.snippet || '-'}</p>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  收藏时间：{formatTime(message.createdAt)}
                </p>
                {messageStatuses[message.id] && (
                  <p className="text-muted-foreground text-[11px]">{messageStatuses[message.id]}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleOpen(message)}
                    className="px-3 py-1.5 text-xs"
                  >
                    打开 / 跳转
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleRemove(message.id)}
                    className="px-3 py-1.5 text-xs"
                  >
                    取消收藏
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
