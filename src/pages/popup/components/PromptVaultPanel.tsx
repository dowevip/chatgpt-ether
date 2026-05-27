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

async function insertPromptIntoActiveChatGPTTab(content: string): Promise<InsertPromptResponse> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const tabId = activeTab?.id;
  if (!tabId) throw new Error('没有找到当前标签页。');

  if (!activeTab.url?.startsWith('https://chatgpt.com/')) {
    throw new Error('当前页面不是 ChatGPT，无法插入。');
  }

  let response: InsertPromptResponse | undefined;
  try {
    response = (await browser.tabs.sendMessage(tabId, {
      type: 'gv.chatgpt.insertPrompt',
      payload: { content },
    })) as InsertPromptResponse | undefined;
  } catch {
    throw new Error('content script 未响应，请刷新 ChatGPT 页面后重试。');
  }

  if (!response?.ok) {
    throw new Error(response?.error || '插入失败，未收到有效结果。');
  }

  return response;
}

export function PromptVaultPanel({ onBack }: PromptVaultPanelProps) {
  const [prompts, setPrompts] = useState<ChatGPTPromptVaultItem[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listChatGPTPrompts()
      .then(setPrompts)
      .catch(() => setMessage('读取 Prompt Vault 失败。'));
  }, []);

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
      setMessage('Prompt 内容不能为空。');
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
      setMessage('已保存。');
    } catch {
      setMessage('保存失败。');
    }
  };

  const handleDelete = async (prompt: ChatGPTPromptVaultItem) => {
    if (!window.confirm(`删除 prompt「${prompt.title}」？`)) return;

    try {
      const nextPrompts = await deleteChatGPTPrompt(prompt.id);
      setPrompts(nextPrompts);
      if (draft.id === prompt.id) resetDraft();
      setMessage('已删除。');
    } catch {
      setMessage('删除失败。');
    }
  };

  const handleInsert = async (prompt: ChatGPTPromptVaultItem) => {
    try {
      const result = await insertPromptIntoActiveChatGPTTab(prompt.content);
      setMessage(`插入成功${result.method ? `（${result.method}）` : ''}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '插入失败。');
    }
  };

  const handleExport = () => {
    const payload = buildChatGPTPromptExport(prompts);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgpt-voyager-prompts-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('已导出 Prompt Vault JSON。');
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const nextPrompts = await importChatGPTPromptsFromJson(text);
      setPrompts(nextPrompts);
      setMessage('导入完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败。');
    }
  };

  return (
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">Prompt Vault</h1>
          <p className="text-muted-foreground text-xs">ChatGPT Voyager</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          返回
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardTitle className="mb-3 text-base">
            {isEditing ? '编辑 prompt' : '新建 prompt'}
          </CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="标题"
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <textarea
              value={draft.content}
              onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
              placeholder="Prompt 内容"
              rows={5}
              className="border-border bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
            />
            <input
              value={draft.tagsText}
              onChange={(event) => setDraft((prev) => ({ ...prev, tagsText: event.target.value }))}
              placeholder="标签，用逗号分隔"
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
              收藏 / 置顶
            </label>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void handleSave()}>
                保存
              </Button>
              {isEditing && (
                <Button type="button" variant="outline" size="sm" onClick={resetDraft}>
                  取消
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
              placeholder="搜索标题、内容或标签"
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleExport}>
                导出 JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                导入 JSON
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
            <p className="text-muted-foreground text-sm">暂无 prompt。</p>
          ) : (
            filteredPrompts.map((prompt) => (
              <Card key={prompt.id} className="p-3">
                <CardContent className="space-y-2 p-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {prompt.favorite ? '★ ' : ''}
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
                      插入
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
                      编辑
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
                      {prompt.favorite ? '取消收藏' : '收藏'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(prompt)}
                    >
                      删除
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
