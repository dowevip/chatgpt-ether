import browser from 'webextension-polyfill';

import type { ChatGPTStarredMessage, ChatGPTStarredMessageInput } from '@/core/types/starred';

export const CHATGPT_STARRED_MESSAGES_STORAGE_KEY = 'chatgptEther.starredMessages';

function now(): number {
  return Date.now();
}

function createId(): string {
  const random =
    globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cgv_starred_${random}`;
}

function normalizeSnippet(snippet: string): string {
  const normalized = String(snippet || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
}

function isStarredMessage(value: unknown): value is ChatGPTStarredMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.conversationId === 'string' &&
    typeof record.conversationTitle === 'string' &&
    typeof record.url === 'string' &&
    typeof record.messageAnchor === 'string' &&
    record.role === 'user' &&
    typeof record.snippet === 'string'
  );
}

function matchesMessage(item: ChatGPTStarredMessage, input: ChatGPTStarredMessageInput): boolean {
  if (item.conversationId !== input.conversationId) return false;
  if (input.turnId && item.turnId === input.turnId) return true;
  if (input.messageId && item.messageId === input.messageId) return true;
  if (input.fingerprint && item.fingerprint === input.fingerprint) return true;
  return item.messageAnchor === input.messageAnchor;
}

function sortStarredMessages(items: ChatGPTStarredMessage[]): ChatGPTStarredMessage[] {
  return [...items].sort((left, right) => right.createdAt - left.createdAt);
}

export async function listChatGPTStarredMessages(): Promise<ChatGPTStarredMessage[]> {
  const result = await browser.storage.local.get([CHATGPT_STARRED_MESSAGES_STORAGE_KEY]);
  const currentRaw = result[CHATGPT_STARRED_MESSAGES_STORAGE_KEY];
  const raw = currentRaw;
  if (!Array.isArray(raw)) return [];

  const messages = sortStarredMessages(
    raw.filter(isStarredMessage).map((item) => ({
      ...item,
      turnId: typeof item.turnId === 'string' ? item.turnId : undefined,
      fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : undefined,
      snippet: normalizeSnippet(item.snippet),
    })),
  );
  return messages;
}

export async function toggleChatGPTStarredMessage(
  input: ChatGPTStarredMessageInput,
): Promise<{ starred: boolean; messages: ChatGPTStarredMessage[] }> {
  const messages = await listChatGPTStarredMessages();
  const existing = messages.find((item) => matchesMessage(item, input));

  if (existing) {
    const nextMessages = messages.filter((item) => item.id !== existing.id);
    await browser.storage.local.set({ [CHATGPT_STARRED_MESSAGES_STORAGE_KEY]: nextMessages });
    return { starred: false, messages: nextMessages };
  }

  const timestamp = now();
  const nextMessage: ChatGPTStarredMessage = {
    id: createId(),
    conversationId: input.conversationId,
    conversationTitle: input.conversationTitle.trim() || '未命名对话',
    url: input.url,
    turnId: input.turnId,
    messageId: input.messageId,
    messageAnchor: input.messageAnchor,
    role: 'user',
    snippet: normalizeSnippet(input.snippet),
    fingerprint: input.fingerprint,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextMessages = sortStarredMessages([nextMessage, ...messages]);
  await browser.storage.local.set({ [CHATGPT_STARRED_MESSAGES_STORAGE_KEY]: nextMessages });
  return { starred: true, messages: nextMessages };
}

export async function removeChatGPTStarredMessage(id: string): Promise<ChatGPTStarredMessage[]> {
  const messages = await listChatGPTStarredMessages();
  const nextMessages = messages.filter((item) => item.id !== id);
  await browser.storage.local.set({ [CHATGPT_STARRED_MESSAGES_STORAGE_KEY]: nextMessages });
  return nextMessages;
}
