import React, { useEffect, useMemo, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  buildChatGPTPromptExport,
  deleteChatGPTPrompt,
  importChatGPTPromptsFromJson,
  listChatGPTPrompts,
  saveChatGPTPrompt,
} from '@/core/services/ChatGPTPromptVaultService';
import type { ChatGPTPromptVaultItem } from '@/core/types/prompt';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { useLanguage } from '../../../contexts/LanguageContext';

type PromptVaultPanelProps = {
  onBack: () => void;
};

type DraftState = {
  id?: string;
  title: string;
  content: string;
  tagsText: string;
  favorite: boolean;
};

const EMPTY_DRAFT: DraftState = {
  title: '',
  content: '',
  tagsText: '',
  favorite: false,
};

function toDraft(prompt: ChatGPTPromptVaultItem): DraftState {
  return {
    id: prompt.id,
    title: prompt.title,
    content: prompt.content,
    tagsText: prompt.tags.join(', '),
    favorite: prompt.favorite,
  };
}

function parseTags(tagsText: string): string[] {
  return Array.from(
    new Set(
      tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function matchesQuery(prompt: ChatGPTPromptVaultItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [prompt.title, prompt.content, ...prompt.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

type InsertPromptResponse = {
  ok?: boolean;
  method?: string;
  message?: string;
  error?: string;
};

type InsertPromptMessages = {
  noCurrentTab: string;
  notChatGPTPage: string;
  contentScriptNoResponse: string;
  invalidInsertResult: string;
};

async function insertPromptIntoActiveChatGPTTab(
  content: string,
  messages: InsertPromptMessages,
): Promise<InsertPromptResponse> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const tabId = activeTab?.id;
  if (!tabId) throw new Error(messages.noCurrentTab);

  if (!activeTab.url?.startsWith('https://chatgpt.com/')) {
    throw new Error(messages.notChatGPTPage);
  }

  let response: InsertPromptResponse | undefined;
  try {
    response = (await browser.tabs.sendMessage(tabId, {
      type: 'gv.chatgpt.insertPrompt',
      payload: { content },
    })) as InsertPromptResponse | undefined;
  } catch {
    throw new Error(messages.contentScriptNoResponse);
  }

  if (!response?.ok) {
    throw new Error(response?.error || messages.invalidInsertResult);
  }

  return response;
}

export function PromptVaultPanel({ onBack }: PromptVaultPanelProps) {
  const { t } = useLanguage();
  const [prompts, setPrompts] = useState<ChatGPTPromptVaultItem[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listChatGPTPrompts()
      .then(setPrompts)
      .catch(() => setMessage(t('pvLoadFailed')));
  }, [t]);

  const filteredPrompts = useMemo(
    () => prompts.filter((prompt) => matchesQuery(prompt, query)),
    [prompts, query],
  );

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!draft.content.trim()) {
      setMessage(t('pvContentRequired'));
      return;
    }

    try {
      const nextPrompts = await saveChatGPTPrompt({
        id: draft.id,
        title: draft.title,
        content: draft.content,
        tags: parseTags(draft.tagsText),
        favorite: draft.favorite,
      });
      setPrompts(nextPrompts);
      resetDraft();
      setMessage(t('saved'));
    } catch {
      setMessage(t('saveFailed'));
    }
  };

  const handleDelete = async (prompt: ChatGPTPromptVaultItem) => {
    if (!window.confirm(t('pvDeleteConfirm').replace('{title}', prompt.title))) return;

    try {
      const nextPrompts = await deleteChatGPTPrompt(prompt.id);
      setPrompts(nextPrompts);
      if (draft.id === prompt.id) resetDraft();
      setMessage(t('deleted'));
    } catch {
      setMessage(t('deleteFailed'));
    }
  };

  const handleInsert = async (prompt: ChatGPTPromptVaultItem) => {
    try {
      const result = await insertPromptIntoActiveChatGPTTab(prompt.content, {
        noCurrentTab: t('pvNoCurrentTab'),
        notChatGPTPage: t('pvNotChatGPTPage'),
        contentScriptNoResponse: t('pvContentScriptNoResponse'),
        invalidInsertResult: t('pvInvalidInsertResult'),
      });
      setMessage(
        result.method
          ? t('pvInsertSuccessWithMethod').replace('{method}', result.method)
          : t('pvInsertSuccess'),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('pvInsertFailed'));
    }
  };

  const handleExport = () => {
    const payload = buildChatGPTPromptExport(prompts);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgpt-ether-prompts-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(t('pvExported'));
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const nextPrompts = await importChatGPTPromptsFromJson(text);
      setPrompts(nextPrompts);
      setMessage(t('pvImported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('pvImportFailed'));
    }
  };

  return (
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">{t('cgEntryPromptVault')}</h1>
          <p className="text-muted-foreground text-xs">{t('extName')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('back')}
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardTitle className="mb-3 text-base">
            {isEditing ? t('pvEditPrompt') : t('pvNewPrompt')}
          </CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder={t('pvTitlePlaceholder')}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <textarea
              value={draft.content}
              onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
              placeholder={t('pvContentPlaceholder')}
              rows={5}
              className="border-border bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
            />
            <input
              value={draft.tagsText}
              onChange={(event) => setDraft((prev) => ({ ...prev, tagsText: event.target.value }))}
              placeholder={t('pvTagsPlaceholder')}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.favorite}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, favorite: event.target.checked }))
                }
              />
              {t('pvFavoritePinned')}
            </label>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void handleSave()}>
                {t('save')}
              </Button>
              {isEditing && (
                <Button type="button" variant="outline" size="sm" onClick={resetDraft}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardContent className="space-y-3 p-0">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('pvSearchPlaceholder')}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleExport}>
                {t('pvExportJson')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('pvImportJson')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void handleImportFile(event)}
              />
            </div>
            {message && <p className="text-muted-foreground text-xs">{message}</p>}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {filteredPrompts.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('pvNoMatches')}</p>
          ) : (
            filteredPrompts.map((prompt) => (
              <Card key={prompt.id} className="p-3">
                <CardContent className="space-y-2 p-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {prompt.favorite ? 'â˜?' : ''}
                        {prompt.title}
                      </p>
                      <p className="text-muted-foreground line-clamp-2 text-xs">{prompt.content}</p>
                    </div>
                  </div>
                  {prompt.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {prompt.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[11px]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void handleInsert(prompt)}>
                      {t('insert')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft(toDraft(prompt));
                        setIsEditing(true);
                      }}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void saveChatGPTPrompt({
                          ...prompt,
                          favorite: !prompt.favorite,
                        }).then(setPrompts)
                      }
                    >
                      {prompt.favorite ? t('unfavorite') : t('favorite')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(prompt)}
                    >
                      {t('delete')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
