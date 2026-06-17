import browser from 'webextension-polyfill';

import type { ChatGPTPromptVaultExport, ChatGPTPromptVaultItem } from '@/core/types/prompt';

export const CHATGPT_PROMPT_VAULT_STORAGE_KEY = 'chatgptEther.prompts';
export const CHATGPT_PROMPT_VAULT_LEGACY_STORAGE_KEY = 'chatgptVoyager.prompts';

type PromptInput = {
  id?: string;
  title: string;
  content: string;
  tags: string[];
  favorite: boolean;
};

function now(): number {
  return Date.now();
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40)),
    ),
  );
}

function createId(): string {
  const random =
    globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cgv_prompt_${random}`;
}

function isPromptLike(value: unknown): value is Partial<ChatGPTPromptVaultItem> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.title === 'string' && typeof record.content === 'string';
}

function sanitizePrompt(
  value: Partial<ChatGPTPromptVaultItem>,
  fallbackId?: string,
): ChatGPTPromptVaultItem {
  const timestamp = now();
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : timestamp;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : timestamp;

  return {
    id:
      typeof value.id === 'string' && value.id.trim() ? value.id.trim() : fallbackId || createId(),
    title:
      String(value.title || '')
        .trim()
        .slice(0, 120) || 'Untitled prompt',
    content: String(value.content || ''),
    tags: normalizeTags(value.tags),
    favorite: Boolean(value.favorite),
    createdAt,
    updatedAt,
  };
}

function sortPrompts(prompts: ChatGPTPromptVaultItem[]): ChatGPTPromptVaultItem[] {
  return [...prompts].sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    return right.updatedAt - left.updatedAt;
  });
}

export async function listChatGPTPrompts(): Promise<ChatGPTPromptVaultItem[]> {
  const result = await browser.storage.local.get([
    CHATGPT_PROMPT_VAULT_STORAGE_KEY,
    CHATGPT_PROMPT_VAULT_LEGACY_STORAGE_KEY,
  ]);
  const currentRaw = result[CHATGPT_PROMPT_VAULT_STORAGE_KEY];
  const legacyRaw = result[CHATGPT_PROMPT_VAULT_LEGACY_STORAGE_KEY];
  const raw = Array.isArray(currentRaw) ? currentRaw : legacyRaw;
  if (!Array.isArray(raw)) return [];

  const prompts = sortPrompts(raw.filter(isPromptLike).map((item) => sanitizePrompt(item)));
  if (!Array.isArray(currentRaw) && Array.isArray(legacyRaw)) {
    await browser.storage.local.set({ [CHATGPT_PROMPT_VAULT_STORAGE_KEY]: prompts });
    await browser.storage.local.remove(CHATGPT_PROMPT_VAULT_LEGACY_STORAGE_KEY);
  }
  return prompts;
}

export async function saveChatGPTPrompt(input: PromptInput): Promise<ChatGPTPromptVaultItem[]> {
  const prompts = await listChatGPTPrompts();
  const timestamp = now();
  const existing = input.id ? prompts.find((prompt) => prompt.id === input.id) : undefined;
  const nextPrompt: ChatGPTPromptVaultItem = {
    id: existing?.id || input.id || createId(),
    title: input.title.trim().slice(0, 120) || 'Untitled prompt',
    content: input.content,
    tags: normalizeTags(input.tags),
    favorite: input.favorite,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  const nextPrompts = existing
    ? prompts.map((prompt) => (prompt.id === existing.id ? nextPrompt : prompt))
    : [nextPrompt, ...prompts];

  await browser.storage.local.set({ [CHATGPT_PROMPT_VAULT_STORAGE_KEY]: sortPrompts(nextPrompts) });
  return sortPrompts(nextPrompts);
}

export async function deleteChatGPTPrompt(id: string): Promise<ChatGPTPromptVaultItem[]> {
  const prompts = await listChatGPTPrompts();
  const nextPrompts = prompts.filter((prompt) => prompt.id !== id);
  await browser.storage.local.set({ [CHATGPT_PROMPT_VAULT_STORAGE_KEY]: nextPrompts });
  return nextPrompts;
}

export function buildChatGPTPromptExport(
  prompts: ChatGPTPromptVaultItem[],
): ChatGPTPromptVaultExport {
  return {
    format: 'chatgpt-ether.prompt-vault.v1',
    exportedAt: new Date().toISOString(),
    prompts: sortPrompts(prompts),
  };
}

export async function importChatGPTPromptsFromJson(
  jsonText: string,
): Promise<ChatGPTPromptVaultItem[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  const promptList = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.prompts)
      ? ((parsed as Record<string, unknown>).prompts as unknown[])
      : null;

  if (!promptList) {
    throw new Error('Prompt list not found.');
  }

  const existing = await listChatGPTPrompts();
  const usedIds = new Set(existing.map((prompt) => prompt.id));
  const imported: ChatGPTPromptVaultItem[] = [];

  for (const item of promptList) {
    if (!isPromptLike(item)) continue;
    const prompt = sanitizePrompt(item);
    if (usedIds.has(prompt.id)) {
      prompt.id = createId();
    }
    prompt.updatedAt = now();
    usedIds.add(prompt.id);
    imported.push(prompt);
  }

  if (imported.length === 0) {
    throw new Error('No valid prompts found.');
  }

  const nextPrompts = sortPrompts([...imported, ...existing]);
  await browser.storage.local.set({ [CHATGPT_PROMPT_VAULT_STORAGE_KEY]: nextPrompts });
  return nextPrompts;
}
