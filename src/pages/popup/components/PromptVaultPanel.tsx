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
import { cn } from '@/lib/utils';
import { ActionBar, ListView, PageSection, Panel, TextAreaField, TextField } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';

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
    <Panel
      title={t('cgEntryPromptVault')}
      subtitle={t('extName')}
      onBack={onBack}
      backLabel={t('back')}
    >
      <PageSection title={isEditing ? t('pvEditPrompt') : t('pvNewPrompt')}>
        <TextField
          value={draft.title}
          onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
          placeholder={t('pvTitlePlaceholder')}
        />
        <TextAreaField
          value={draft.content}
          onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
          placeholder={t('pvContentPlaceholder')}
          rows={5}
        />
        <TextField
          value={draft.tagsText}
          onChange={(event) => setDraft((prev) => ({ ...prev, tagsText: event.target.value }))}
          placeholder={t('pvTagsPlaceholder')}
        />
        <label className={cn('flex items-center gap-2', uiTokens.typography.body)}>
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) => setDraft((prev) => ({ ...prev, favorite: event.target.checked }))}
          />
          {t('pvFavoritePinned')}
        </label>
        <ActionBar
          actions={[
            { id: 'save', label: t('save'), tone: 'primary', onClick: () => void handleSave() },
            ...(isEditing
              ? [
                  {
                    id: 'cancel',
                    label: t('cancel'),
                    tone: 'secondary' as const,
                    onClick: resetDraft,
                  },
                ]
              : []),
          ]}
        />
      </PageSection>

      <PageSection>
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('pvSearchPlaceholder')}
        />
        <ActionBar
          actions={[
            { id: 'export', label: t('pvExportJson'), tone: 'secondary', onClick: handleExport },
            {
              id: 'import',
              label: t('pvImportJson'),
              tone: 'secondary',
              onClick: () => fileInputRef.current?.click(),
            },
          ]}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleImportFile(event)}
        />
        {message && (
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{message}</p>
        )}
      </PageSection>

      <ListView
        emptyText={t('pvNoMatches')}
        items={filteredPrompts.map((prompt) => ({
          id: prompt.id,
          title: `${prompt.favorite ? '★ ' : ''}${prompt.title}`,
          subtitle: <span className="line-clamp-2">{prompt.content}</span>,
          body:
            prompt.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {prompt.tags.map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      uiTokens.color.surfaceMuted,
                      uiTokens.radius.control,
                      'px-1.5 py-0.5 text-[11px]',
                    )}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null,
          actions: [
            {
              id: 'insert',
              label: t('insert'),
              tone: 'primary',
              onClick: () => void handleInsert(prompt),
            },
            {
              id: 'edit',
              label: t('edit'),
              tone: 'secondary',
              onClick: () => {
                setDraft(toDraft(prompt));
                setIsEditing(true);
              },
            },
            {
              id: 'favorite',
              label: prompt.favorite ? t('unfavorite') : t('favorite'),
              tone: 'secondary',
              onClick: () =>
                void saveChatGPTPrompt({ ...prompt, favorite: !prompt.favorite }).then(setPrompts),
            },
            {
              id: 'delete',
              label: t('delete'),
              tone: 'danger',
              onClick: () => void handleDelete(prompt),
            },
          ],
        }))}
      />
    </Panel>
  );
}
