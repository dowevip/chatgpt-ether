import browser from 'webextension-polyfill';

import {
  CHATGPT_CONVERSATIONS_STORAGE_KEY,
  CHATGPT_FOLDERS_STORAGE_KEY,
  listChatGPTConversations,
  listChatGPTFolders,
} from './ChatGPTConversationService';
import {
  CHATGPT_PROMPT_VAULT_STORAGE_KEY,
  listChatGPTPrompts,
} from './ChatGPTPromptVaultService';
import {
  CHATGPT_STARRED_MESSAGES_STORAGE_KEY,
  listChatGPTStarredMessages,
} from './ChatGPTStarredService';

import type { ChatGPTConversationIndex, ChatGPTFolder } from '@/core/types/conversation';
import type { ChatGPTPromptVaultItem } from '@/core/types/prompt';
import type { ChatGPTStarredMessage } from '@/core/types/starred';
import type {
  ChatGPTSyncImportOptions,
  ChatGPTSyncImportResult,
  ChatGPTSyncPayload,
  ChatGPTSyncSettings,
} from '@/core/types/sync';

export const CHATGPT_SYNC_SCHEMA_VERSION = 1;
const CHATGPT_SYNC_SOURCE = 'chatgpt-ether';
const CHATGPT_SYNC_LEGACY_SOURCE = 'chatgpt-voyager';
export const CHATGPT_SYNC_BACKUP_STORAGE_KEY = 'chatgptEther.sync.localBackup';
export const CHATGPT_SCHEMA_VERSION_STORAGE_KEY = 'chatgptEther.schemaVersion';
export const CHATGPT_TIMELINE_VISIBLE_STORAGE_KEY = 'chatgptEther.timeline.visible';
export const CHATGPT_TIMELINE_VISIBLE_LEGACY_STORAGE_KEY = 'chatgptVoyager.timeline.visible';
export const CHATGPT_TIMELINE_WIDTH_STORAGE_KEY = 'chatgptEther.timeline.width';
export const CHATGPT_TIMELINE_WIDTH_LEGACY_STORAGE_KEY = 'chatgptVoyager.timeline.width';
export const CHATGPT_TIMELINE_HEIGHT_STORAGE_KEY = 'chatgptEther.timeline.height';
export const CHATGPT_TIMELINE_HEIGHT_LEGACY_STORAGE_KEY = 'chatgptVoyager.timeline.height';
export const CHATGPT_FOLDERS_PANEL_COLLAPSED_STORAGE_KEY =
  'chatgptEther.foldersPanel.collapsed';
export const CHATGPT_FOLDERS_PANEL_COLLAPSED_LEGACY_STORAGE_KEY =
  'chatgptVoyager.foldersPanel.collapsed';

const SUSPICIOUS_TRANSCRIPT_KEYS = new Set([
  'messages',
  'body',
  'rawConversation',
  'conversationJson',
  'mapping',
  'transcript',
  'chatBody',
  'fullText',
  'assistantReplies',
  'attachments',
  'images',
  'screenshots',
  'canvas',
  'factCheckFullText',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function numberOrNow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function stringValue(value: unknown, limit = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function nullableString(value: unknown, limit = 200): string | null {
  const text = stringValue(value, limit);
  return text || null;
}

function stringArray(value: unknown, limit = 40): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, limit))
        .filter(Boolean),
    ),
  );
}

function truncateSnippet(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function sanitizePrompt(value: unknown): ChatGPTPromptVaultItem | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id, 160);
  const title = stringValue(value.title, 120);
  const content = typeof value.content === 'string' ? value.content : '';
  if (!id || !title || !content) return null;

  return {
    id,
    title,
    content,
    tags: stringArray(value.tags),
    favorite: Boolean(value.favorite),
    createdAt: numberOrNow(value.createdAt),
    updatedAt: numberOrNow(value.updatedAt),
  };
}

function sanitizeFolder(value: unknown): ChatGPTFolder | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id, 160);
  const name = stringValue(value.name, 80);
  if (!id || !name) return null;

  return {
    id,
    name,
    parentId: nullableString(value.parentId, 160),
    createdAt: numberOrNow(value.createdAt),
    updatedAt: numberOrNow(value.updatedAt),
  };
}

function sanitizeConversation(value: unknown): ChatGPTConversationIndex | null {
  if (!isRecord(value)) return null;
  const conversationId = stringValue(value.conversationId, 200);
  const title = stringValue(value.title, 240);
  const url = stringValue(value.url, 500);
  if (!conversationId || !title || !url) return null;

  return {
    conversationId,
    title,
    url,
    folderId: nullableString(value.folderId, 160),
    note: typeof value.note === 'string' ? value.note.slice(0, 2000) : '',
    createdAt: numberOrNow(value.createdAt),
    updatedAt: numberOrNow(value.updatedAt),
    lastOpenedAt: numberOrNow(value.lastOpenedAt),
  };
}

function sanitizeStarredMessage(value: unknown): ChatGPTStarredMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id, 200);
  const conversationId = stringValue(value.conversationId, 200);
  const conversationTitle = stringValue(value.conversationTitle, 240);
  const url = stringValue(value.url, 500);
  const messageAnchor = stringValue(value.messageAnchor, 300);
  const snippet = truncateSnippet(value.snippet);
  if (!id || !conversationId || !conversationTitle || !url || !messageAnchor || !snippet) {
    return null;
  }

  return {
    id,
    conversationId,
    conversationTitle,
    url,
    turnId: stringValue(value.turnId, 200) || undefined,
    messageId: stringValue(value.messageId, 200) || undefined,
    messageAnchor,
    role: 'user',
    snippet,
    fingerprint: stringValue(value.fingerprint, 120) || undefined,
    createdAt: numberOrNow(value.createdAt),
    updatedAt: numberOrNow(value.updatedAt),
  };
}

function sanitizeSettings(value: unknown): ChatGPTSyncSettings {
  if (!isRecord(value)) return {};
  return {
    timelineVisible:
      typeof value.timelineVisible === 'boolean' ? value.timelineVisible : undefined,
    timelineWidth:
      typeof value.timelineWidth === 'number' && Number.isFinite(value.timelineWidth)
        ? value.timelineWidth
        : undefined,
    timelineHeight:
      typeof value.timelineHeight === 'number' && Number.isFinite(value.timelineHeight)
        ? value.timelineHeight
        : undefined,
    collapsedFolderIds: stringArray(value.collapsedFolderIds, 160),
  };
}

function mergeById<T>(
  localItems: T[],
  incomingItems: T[],
  getId: (item: T) => string,
  getUpdatedAt: (item: T) => number | undefined,
): T[] {
  const byId = new Map<string, T>();
  for (const item of localItems) byId.set(getId(item), item);
  for (const item of incomingItems) {
    const id = getId(item);
    const existing = byId.get(id);
    if (!existing || (getUpdatedAt(item) || 0) >= (getUpdatedAt(existing) || 0)) {
      byId.set(id, item);
    }
  }
  return Array.from(byId.values());
}

function hasSuspiciousTranscriptField(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = hasSuspiciousTranscriptField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (SUSPICIOUS_TRANSCRIPT_KEYS.has(key)) return path ? `${path}.${key}` : key;
    const found = hasSuspiciousTranscriptField(child, path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

async function readSettings(): Promise<ChatGPTSyncSettings> {
  const result = await browser.storage.local.get([
    CHATGPT_TIMELINE_VISIBLE_STORAGE_KEY,
    CHATGPT_TIMELINE_VISIBLE_LEGACY_STORAGE_KEY,
    CHATGPT_TIMELINE_WIDTH_STORAGE_KEY,
    CHATGPT_TIMELINE_WIDTH_LEGACY_STORAGE_KEY,
    CHATGPT_TIMELINE_HEIGHT_STORAGE_KEY,
    CHATGPT_TIMELINE_HEIGHT_LEGACY_STORAGE_KEY,
    CHATGPT_FOLDERS_PANEL_COLLAPSED_STORAGE_KEY,
    CHATGPT_FOLDERS_PANEL_COLLAPSED_LEGACY_STORAGE_KEY,
  ]);
  const timelineVisible =
    typeof result[CHATGPT_TIMELINE_VISIBLE_STORAGE_KEY] === 'boolean'
      ? result[CHATGPT_TIMELINE_VISIBLE_STORAGE_KEY]
      : result[CHATGPT_TIMELINE_VISIBLE_LEGACY_STORAGE_KEY];
  const timelineWidth =
    typeof result[CHATGPT_TIMELINE_WIDTH_STORAGE_KEY] === 'number'
      ? result[CHATGPT_TIMELINE_WIDTH_STORAGE_KEY]
      : result[CHATGPT_TIMELINE_WIDTH_LEGACY_STORAGE_KEY];
  const timelineHeight =
    typeof result[CHATGPT_TIMELINE_HEIGHT_STORAGE_KEY] === 'number'
      ? result[CHATGPT_TIMELINE_HEIGHT_STORAGE_KEY]
      : result[CHATGPT_TIMELINE_HEIGHT_LEGACY_STORAGE_KEY];
  const collapsedFolderIds = Array.isArray(result[CHATGPT_FOLDERS_PANEL_COLLAPSED_STORAGE_KEY])
    ? result[CHATGPT_FOLDERS_PANEL_COLLAPSED_STORAGE_KEY]
    : result[CHATGPT_FOLDERS_PANEL_COLLAPSED_LEGACY_STORAGE_KEY];

  return {
    timelineVisible: typeof timelineVisible === 'boolean' ? timelineVisible : undefined,
    timelineWidth: typeof timelineWidth === 'number' ? timelineWidth : undefined,
    timelineHeight: typeof timelineHeight === 'number' ? timelineHeight : undefined,
    collapsedFolderIds: stringArray(collapsedFolderIds, 160),
  };
}

async function writeSettings(settings: ChatGPTSyncSettings): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof settings.timelineVisible === 'boolean') {
    update[CHATGPT_TIMELINE_VISIBLE_STORAGE_KEY] = settings.timelineVisible;
  }
  if (typeof settings.timelineWidth === 'number') {
    update[CHATGPT_TIMELINE_WIDTH_STORAGE_KEY] = settings.timelineWidth;
  }
  if (typeof settings.timelineHeight === 'number') {
    update[CHATGPT_TIMELINE_HEIGHT_STORAGE_KEY] = settings.timelineHeight;
  }
  if (Array.isArray(settings.collapsedFolderIds)) {
    update[CHATGPT_FOLDERS_PANEL_COLLAPSED_STORAGE_KEY] = settings.collapsedFolderIds;
  }
  if (Object.keys(update).length > 0) await browser.storage.local.set(update);
}

function sanitizePayload(payload: ChatGPTSyncPayload): ChatGPTSyncPayload {
  return {
    schemaVersion: payload.schemaVersion,
    exportedAt: payload.exportedAt,
    source: CHATGPT_SYNC_SOURCE,
    data: {
      prompts: payload.data.prompts.map(sanitizePrompt).filter(Boolean),
      folders: payload.data.folders.map(sanitizeFolder).filter(Boolean),
      conversations: payload.data.conversations.map(sanitizeConversation).filter(Boolean),
      starredMessages: payload.data.starredMessages.map(sanitizeStarredMessage).filter(Boolean),
      settings: sanitizeSettings(payload.data.settings),
      timeMetadata: {},
    },
  };
}

export function validateChatGPTSyncPayload(payload: unknown): payload is ChatGPTSyncPayload {
  if (!isRecord(payload)) throw new Error('同步数据格式无效。');
  if (typeof payload.schemaVersion !== 'number') throw new Error('缺少 schemaVersion。');
  if (payload.source !== CHATGPT_SYNC_SOURCE && payload.source !== CHATGPT_SYNC_LEGACY_SOURCE) {
    throw new Error('同步数据来源不正确。');
  }
  if (!isRecord(payload.data)) throw new Error('同步数据 data 不是对象。');

  const suspiciousField = hasSuspiciousTranscriptField(payload);
  if (suspiciousField) {
    throw new Error(`同步数据包含不允许的聊天正文字段：${suspiciousField}`);
  }

  return true;
}

export async function exportChatGPTSyncPayload(): Promise<ChatGPTSyncPayload> {
  const [prompts, folders, conversations, starredMessages, settings] = await Promise.all([
    listChatGPTPrompts(),
    listChatGPTFolders(),
    listChatGPTConversations(),
    listChatGPTStarredMessages(),
    readSettings(),
  ]);

  return {
    schemaVersion: CHATGPT_SYNC_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: CHATGPT_SYNC_SOURCE,
    data: {
      prompts,
      folders,
      conversations,
      starredMessages: starredMessages.map((message) => ({
        ...message,
        snippet: truncateSnippet(message.snippet),
      })),
      settings,
      timeMetadata: {},
    },
  };
}

async function createLocalBackup(): Promise<string> {
  const backup = await exportChatGPTSyncPayload();
  const backupKey = `${CHATGPT_SYNC_BACKUP_STORAGE_KEY}.${Date.now()}`;
  await browser.storage.local.set({ [backupKey]: backup });
  return backupKey;
}

export async function importChatGPTSyncPayload(
  payload: unknown,
  options: ChatGPTSyncImportOptions,
): Promise<ChatGPTSyncImportResult> {
  validateChatGPTSyncPayload(payload);
  const sanitized = sanitizePayload(payload);
  const mode = options.mode;
  const backupKey = mode === 'overwrite' ? await createLocalBackup() : undefined;

  const [localPrompts, localFolders, localConversations, localStarredMessages, localSettings] =
    await Promise.all([
      listChatGPTPrompts(),
      listChatGPTFolders(),
      listChatGPTConversations(),
      listChatGPTStarredMessages(),
      readSettings(),
    ]);

  const nextPrompts =
    mode === 'overwrite'
      ? sanitized.data.prompts
      : mergeById(localPrompts, sanitized.data.prompts, (item) => item.id, (item) => item.updatedAt);
  const nextFolders =
    mode === 'overwrite'
      ? sanitized.data.folders
      : mergeById(localFolders, sanitized.data.folders, (item) => item.id, (item) => item.updatedAt);
  const nextConversations =
    mode === 'overwrite'
      ? sanitized.data.conversations
      : mergeById(
          localConversations,
          sanitized.data.conversations,
          (item) => item.conversationId,
          (item) => item.updatedAt,
        );
  const nextStarredMessages =
    mode === 'overwrite'
      ? sanitized.data.starredMessages
      : mergeById(
          localStarredMessages,
          sanitized.data.starredMessages,
          (item) => item.id,
          (item) => item.updatedAt,
        );
  const nextSettings =
    mode === 'overwrite'
      ? sanitized.data.settings
      : { ...localSettings, ...sanitized.data.settings };

  await browser.storage.local.set({
    [CHATGPT_PROMPT_VAULT_STORAGE_KEY]: nextPrompts,
    [CHATGPT_FOLDERS_STORAGE_KEY]: nextFolders,
    [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations,
    [CHATGPT_STARRED_MESSAGES_STORAGE_KEY]: nextStarredMessages,
    [CHATGPT_SCHEMA_VERSION_STORAGE_KEY]: sanitized.schemaVersion,
  });
  await writeSettings(nextSettings);

  return {
    ok: true,
    mode,
    backupKey,
    restoredCounts: {
      prompts: nextPrompts.length,
      folders: nextFolders.length,
      conversations: nextConversations.length,
      starredMessages: nextStarredMessages.length,
    },
  };
}
