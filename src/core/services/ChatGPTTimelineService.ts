import browser from 'webextension-polyfill';

import type { ChatGPTTimelineSnapshot } from '@/core/types/timeline';

type TimelineResponse = {
  ok?: boolean;
  data?: ChatGPTTimelineSnapshot;
};

type TimelineVisibilityResponse = {
  ok?: boolean;
  data?: {
    isChatGPTPage: boolean;
    visible: boolean;
  };
};

type ChatGPTTimelineLocatePayload = {
  conversationId?: string;
  turnId?: string;
  messageId?: string;
  messageAnchor: string;
  snippet?: string;
  fingerprint?: string;
};

const EMPTY_TIMELINE: ChatGPTTimelineSnapshot = {
  isChatGPTPage: false,
  nodes: [],
};

async function getActiveTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || null;
}

export async function getCurrentChatGPTTimeline(): Promise<ChatGPTTimelineSnapshot> {
  const tabId = await getActiveTabId();
  if (!tabId) return EMPTY_TIMELINE;

  const response = (await browser.tabs.sendMessage(tabId, {
    type: 'gv.chatgpt.timeline.get',
  })) as TimelineResponse | undefined;

  if (!response?.ok || !response.data) return EMPTY_TIMELINE;
  return response.data;
}

export async function scrollToChatGPTTimelineMessage(
  target: string | ChatGPTTimelineLocatePayload,
): Promise<boolean> {
  const tabId = await getActiveTabId();
  if (!tabId) return false;
  const payload = typeof target === 'string' ? { messageAnchor: target } : target;

  const response = (await browser.tabs.sendMessage(tabId, {
    type: 'gv.chatgpt.timeline.scroll',
    payload,
  })) as { ok?: boolean; scrolled?: boolean } | undefined;

  return Boolean(response?.ok && response.scrolled);
}

export async function getChatGPTPageTimelineVisibility(): Promise<{
  isChatGPTPage: boolean;
  visible: boolean;
}> {
  const tabId = await getActiveTabId();
  if (!tabId) return { isChatGPTPage: false, visible: false };

  const response = (await browser.tabs.sendMessage(tabId, {
    type: 'gv.chatgpt.timeline.visibility.get',
  })) as TimelineVisibilityResponse | undefined;

  return {
    isChatGPTPage: Boolean(response?.ok && response.data?.isChatGPTPage),
    visible: response?.data?.visible !== false,
  };
}

export async function setChatGPTPageTimelineVisibility(visible: boolean): Promise<{
  isChatGPTPage: boolean;
  visible: boolean;
}> {
  const tabId = await getActiveTabId();
  if (!tabId) return { isChatGPTPage: false, visible: false };

  const response = (await browser.tabs.sendMessage(tabId, {
    type: 'gv.chatgpt.timeline.visibility.set',
    payload: { visible },
  })) as TimelineVisibilityResponse | undefined;

  return {
    isChatGPTPage: Boolean(response?.ok && response.data?.isChatGPTPage),
    visible: response?.data?.visible === true,
  };
}
