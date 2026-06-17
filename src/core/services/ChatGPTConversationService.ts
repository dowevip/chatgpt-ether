import browser from 'webextension-polyfill';

import type { ChatGPTConversationIndex, ChatGPTFolder } from '@/core/types/conversation';

export const CHATGPT_FOLDERS_STORAGE_KEY = 'chatgptEther.folders';
export const CHATGPT_CONVERSATIONS_STORAGE_KEY = 'chatgptEther.conversations';
export const CHATGPT_FOLDERS_LEGACY_STORAGE_KEY = 'chatgptVoyager.folders';
export const CHATGPT_CONVERSATIONS_LEGACY_STORAGE_KEY = 'chatgptVoyager.conversations';

export type CurrentChatGPTConversationInput = {
  conversationId: string;
  title: string;
  url: string;
};

function now(): number {
  return Date.now();
}

function createId(prefix: string): string {
  const random =
    globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function isFolder(value: unknown): value is ChatGPTFolder {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}

function isConversation(value: unknown): value is ChatGPTConversationIndex {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.conversationId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.url === 'string'
  );
}

async function readMigratedArray<T>(
  storageKey: string,
  legacyStorageKey: string,
): Promise<unknown[]> {
  const result = await browser.storage.local.get([storageKey, legacyStorageKey]);
  const currentRaw = result[storageKey];
  const legacyRaw = result[legacyStorageKey];
  const raw = Array.isArray(currentRaw) ? currentRaw : legacyRaw;
  if (!Array.isArray(raw)) return [];

  if (!Array.isArray(currentRaw) && Array.isArray(legacyRaw)) {
    await browser.storage.local.set({ [storageKey]: legacyRaw });
    await browser.storage.local.remove(legacyStorageKey);
  }

  return raw;
}

export async function listChatGPTFolders(): Promise<ChatGPTFolder[]> {
  const raw = await readMigratedArray(
    CHATGPT_FOLDERS_STORAGE_KEY,
    CHATGPT_FOLDERS_LEGACY_STORAGE_KEY,
  );

  return raw
    .filter(isFolder)
    .map((folder) => ({ ...folder, parentId: folder.parentId || null }))
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function createChatGPTFolder(
  name: string,
  parentId: string | null = null,
): Promise<ChatGPTFolder[]> {
  const folders = await listChatGPTFolders();
  const parentFolder = parentId ? folders.find((folder) => folder.id === parentId) : null;
  if (parentId && (!parentFolder || parentFolder.parentId)) {
    throw new Error('Subfolders can only be created under top-level folders.');
  }

  const timestamp = now();
  const folder: ChatGPTFolder = {
    id: createId('cgv_folder'),
    name: name.trim().slice(0, 80) || 'Untitled folder',
    parentId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextFolders = [...folders, folder];
  await browser.storage.local.set({ [CHATGPT_FOLDERS_STORAGE_KEY]: nextFolders });
  return nextFolders;
}

export async function renameChatGPTFolder(
  folderId: string,
  name: string,
): Promise<ChatGPTFolder[]> {
  const folders = await listChatGPTFolders();
  const timestamp = now();
  const nextFolders = folders.map((folder) =>
    folder.id === folderId
      ? { ...folder, name: name.trim().slice(0, 80) || folder.name, updatedAt: timestamp }
      : folder,
  );
  await browser.storage.local.set({ [CHATGPT_FOLDERS_STORAGE_KEY]: nextFolders });
  return nextFolders;
}

export async function deleteChatGPTFolder(folderId: string): Promise<{
  folders: ChatGPTFolder[];
  conversations: ChatGPTConversationIndex[];
}> {
  const [folders, conversations] = await Promise.all([
    listChatGPTFolders(),
    listChatGPTConversations(),
  ]);
  const timestamp = now();
  const deletedFolderIds = new Set([
    folderId,
    ...folders.filter((folder) => folder.parentId === folderId).map((folder) => folder.id),
  ]);
  const nextFolders = folders.filter((folder) => !deletedFolderIds.has(folder.id));
  const nextConversations = conversations.map((conversation) =>
    conversation.folderId && deletedFolderIds.has(conversation.folderId)
      ? { ...conversation, folderId: null, updatedAt: timestamp }
      : conversation,
  );

  await browser.storage.local.set({
    [CHATGPT_FOLDERS_STORAGE_KEY]: nextFolders,
    [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations,
  });

  return { folders: nextFolders, conversations: nextConversations };
}

export async function listChatGPTConversations(): Promise<ChatGPTConversationIndex[]> {
  const raw = await readMigratedArray(
    CHATGPT_CONVERSATIONS_STORAGE_KEY,
    CHATGPT_CONVERSATIONS_LEGACY_STORAGE_KEY,
  );

  return raw.filter(isConversation).sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export async function saveCurrentChatGPTConversation(
  input: CurrentChatGPTConversationInput,
): Promise<ChatGPTConversationIndex[]> {
  const conversations = await listChatGPTConversations();
  const timestamp = now();
  const existing = conversations.find(
    (conversation) => conversation.conversationId === input.conversationId,
  );
  const nextConversation: ChatGPTConversationIndex = {
    conversationId: input.conversationId,
    title: input.title.trim() || 'Untitled conversation',
    url: input.url,
    folderId: existing?.folderId || null,
    note: existing?.note || '',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
  const nextConversations = existing
    ? conversations.map((conversation) =>
        conversation.conversationId === input.conversationId ? nextConversation : conversation,
      )
    : [nextConversation, ...conversations];

  await browser.storage.local.set({ [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations });
  return listChatGPTConversations();
}

export async function deleteChatGPTConversation(
  conversationId: string,
): Promise<ChatGPTConversationIndex[]> {
  const conversations = await listChatGPTConversations();
  const nextConversations = conversations.filter(
    (conversation) => conversation.conversationId !== conversationId,
  );

  await browser.storage.local.set({ [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations });
  return listChatGPTConversations();
}

export async function moveChatGPTConversationToFolder(
  conversationId: string,
  folderId: string | null,
): Promise<ChatGPTConversationIndex[]> {
  const [folders, conversations] = await Promise.all([
    listChatGPTFolders(),
    listChatGPTConversations(),
  ]);
  if (folderId && !folders.some((folder) => folder.id === folderId)) {
    throw new Error('Folder does not exist.');
  }

  const timestamp = now();
  const nextConversations = conversations.map((conversation) =>
    conversation.conversationId === conversationId
      ? { ...conversation, folderId, updatedAt: timestamp }
      : conversation,
  );

  await browser.storage.local.set({ [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations });
  return listChatGPTConversations();
}

export async function updateChatGPTConversationNote(
  conversationId: string,
  note: string,
): Promise<ChatGPTConversationIndex[]> {
  const conversations = await listChatGPTConversations();
  const timestamp = now();
  const nextConversations = conversations.map((conversation) =>
    conversation.conversationId === conversationId
      ? { ...conversation, note, updatedAt: timestamp }
      : conversation,
  );

  await browser.storage.local.set({ [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations });
  return listChatGPTConversations();
}

export async function syncChatGPTConversationTitle(
  input: CurrentChatGPTConversationInput,
): Promise<ChatGPTConversationIndex[]> {
  const conversations = await listChatGPTConversations();
  const existing = conversations.find(
    (conversation) => conversation.conversationId === input.conversationId,
  );

  if (!existing || existing.title === input.title.trim()) {
    return conversations;
  }

  const timestamp = now();
  const nextConversations = conversations.map((conversation) =>
    conversation.conversationId === input.conversationId
      ? {
          ...conversation,
          title: input.title.trim() || conversation.title,
          url: input.url,
          updatedAt: timestamp,
        }
      : conversation,
  );

  await browser.storage.local.set({ [CHATGPT_CONVERSATIONS_STORAGE_KEY]: nextConversations });
  return listChatGPTConversations();
}
