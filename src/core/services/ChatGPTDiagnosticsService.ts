import browser from 'webextension-polyfill';

import { listChatGPTConversations } from './ChatGPTConversationService';
import { listChatGPTStarredMessages } from './ChatGPTStarredService';
import {
  getChatGPTPageTimelineVisibility,
  getCurrentChatGPTTimeline,
} from './ChatGPTTimelineService';

const CHATGPT_SCHEMA_VERSION_STORAGE_KEY = 'chatgptEther.schemaVersion';
const CHATGPT_SCHEMA_VERSION_LEGACY_STORAGE_KEY = 'chatgptVoyager.schemaVersion';

export type ChatGPTDiagnosticsStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  totalMessageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  timelineVisible: boolean;
  timelineNodeCount: number;
  starredMessageCount: number;
  currentConversationSaved: boolean;
  schemaVersion: string | null;
  extensionVersion: string;
  googleDriveAuthStatus: '未启用';
  lastSyncTime: '未同步';
  recentSyncError: '无';
};

type ChatGPTPageStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  totalMessageCount: number;
};

async function getActiveTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || null;
}

async function readCurrentPageStatus(): Promise<ChatGPTPageStatus | null> {
  const tabId = await getActiveTabId();
  if (!tabId) return null;

  const response = (await browser.tabs.sendMessage(tabId, {
    type: 'gv.chatgpt.getStatus',
  })) as { ok?: boolean; data?: ChatGPTPageStatus } | undefined;

  return response?.ok && response.data ? response.data : null;
}

function readExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || '未知';
  } catch {
    return '未知';
  }
}

async function readSchemaVersion(): Promise<string | null> {
  const result = await browser.storage.local.get([
    CHATGPT_SCHEMA_VERSION_STORAGE_KEY,
    CHATGPT_SCHEMA_VERSION_LEGACY_STORAGE_KEY,
  ]);
  const current = result[CHATGPT_SCHEMA_VERSION_STORAGE_KEY];
  const legacy = result[CHATGPT_SCHEMA_VERSION_LEGACY_STORAGE_KEY];
  const value = typeof current === 'string' ? current : legacy;
  if (typeof current !== 'string' && typeof legacy === 'string') {
    await browser.storage.local.set({ [CHATGPT_SCHEMA_VERSION_STORAGE_KEY]: legacy });
    await browser.storage.local.remove(CHATGPT_SCHEMA_VERSION_LEGACY_STORAGE_KEY);
  }
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function getChatGPTDiagnosticsStatus(): Promise<ChatGPTDiagnosticsStatus> {
  const [pageStatus, timelineVisibility, timeline, starredMessages, conversations, schemaVersion] =
    await Promise.all([
      readCurrentPageStatus().catch(() => null),
      getChatGPTPageTimelineVisibility().catch(() => ({ isChatGPTPage: false, visible: false })),
      getCurrentChatGPTTimeline().catch(() => ({ isChatGPTPage: false, nodes: [] })),
      listChatGPTStarredMessages().catch(() => []),
      listChatGPTConversations().catch(() => []),
      readSchemaVersion().catch(() => null),
    ]);

  const conversationId = pageStatus?.conversationId || null;

  return {
    isChatGPTPage: Boolean(pageStatus?.isChatGPTPage),
    conversationId,
    conversationTitle: pageStatus?.conversationTitle || null,
    totalMessageCount: pageStatus?.totalMessageCount || 0,
    userMessageCount: pageStatus?.userMessageCount || 0,
    assistantMessageCount: pageStatus?.assistantMessageCount || 0,
    timelineVisible: Boolean(timelineVisibility.isChatGPTPage && timelineVisibility.visible),
    timelineNodeCount: timeline.isChatGPTPage ? timeline.nodes.length : 0,
    starredMessageCount: starredMessages.length,
    currentConversationSaved: Boolean(
      conversationId &&
        conversations.some((conversation) => conversation.conversationId === conversationId),
    ),
    schemaVersion,
    extensionVersion: readExtensionVersion(),
    googleDriveAuthStatus: '未启用',
    lastSyncTime: '未同步',
    recentSyncError: '无',
  };
}

export function formatChatGPTDiagnosticsText(status: ChatGPTDiagnosticsStatus): string {
  return [
    'ChatGPT以太 诊断信息',
    `当前页面是否识别为 ChatGPT：${status.isChatGPTPage ? '是' : '否'}`,
    `conversationId：${status.conversationId || '-'}`,
    `当前对话标题：${status.conversationTitle || '-'}`,
    `当前消息节点数量：${status.totalMessageCount}`,
    `用户消息数量：${status.userMessageCount}`,
    `助手消息数量：${status.assistantMessageCount}`,
    `当前时间轴是否显示：${status.timelineVisible ? '是' : '否'}`,
    `时间轴节点数量：${status.timelineNodeCount}`,
    `收藏消息数量：${status.starredMessageCount}`,
    `当前对话是否已保存到对话索引：${status.currentConversationSaved ? '是' : '否'}`,
    `本地 schemaVersion：${status.schemaVersion || '未设置'}`,
    `插件版本号：${status.extensionVersion}`,
    `Google Drive 授权状态：${status.googleDriveAuthStatus}`,
    `上次同步时间：${status.lastSyncTime}`,
    `最近同步错误：${status.recentSyncError}`,
  ].join('\n');
}
