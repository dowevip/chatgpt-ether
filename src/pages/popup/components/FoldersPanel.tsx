import React, { useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  createChatGPTFolder,
  deleteChatGPTFolder,
  listChatGPTConversations,
  listChatGPTFolders,
  moveChatGPTConversationToFolder,
  renameChatGPTFolder,
  saveCurrentChatGPTConversation,
  syncChatGPTConversationTitle,
  updateChatGPTConversationNote,
} from '@/core/services/ChatGPTConversationService';
import type { ChatGPTConversationIndex, ChatGPTFolder } from '@/core/types/conversation';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';

type ChatGPTPageStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
};

type FoldersPanelProps = {
  currentStatus: ChatGPTPageStatus | null;
  onBack: () => void;
};

function folderName(folderId: string | null, folders: ChatGPTFolder[]): string {
  if (!folderId) return '未分类';
  return folders.find((folder) => folder.id === folderId)?.name || '未知文件夹';
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function matchesConversationQuery(conversation: ChatGPTConversationIndex, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [conversation.title, conversation.note, conversation.url]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

export function FoldersPanel({ currentStatus, onBack }: FoldersPanelProps) {
  const [folders, setFolders] = useState<ChatGPTFolder[]>([]);
  const [conversations, setConversations] = useState<ChatGPTConversationIndex[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [folderFilterId, setFolderFilterId] = useState('');
  const [folderMoveQueries, setFolderMoveQueries] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canSaveCurrent =
    Boolean(currentStatus?.isChatGPTPage) && Boolean(currentStatus?.conversationId);

  const currentConversation = useMemo(() => {
    if (!currentStatus?.conversationId) return null;

    return {
      conversationId: currentStatus.conversationId,
      title: currentStatus.conversationTitle || 'Untitled conversation',
      url: `https://chatgpt.com/c/${currentStatus.conversationId}`,
    };
  }, [currentStatus]);

  const reload = async () => {
    const [nextFolders, nextConversations] = await Promise.all([
      listChatGPTFolders(),
      listChatGPTConversations(),
    ]);
    setFolders(nextFolders);
    setConversations(nextConversations);
  };

  useEffect(() => {
    reload().catch(() => setMessage('读取文件夹数据失败。'));
  }, []);

  useEffect(() => {
    if (!currentConversation) return;

    syncChatGPTConversationTitle(currentConversation)
      .then(setConversations)
      .catch(() => setMessage('同步当前对话标题失败。'));
  }, [currentConversation]);

  const filteredConversations = useMemo(
    () =>
      conversations.filter((conversation) => {
        const matchesFolder = folderFilterId
          ? folderFilterId === '__uncategorized__'
            ? !conversation.folderId
            : conversation.folderId === folderFilterId
          : true;
        return matchesFolder && matchesConversationQuery(conversation, conversationQuery);
      }),
    [conversations, conversationQuery, folderFilterId],
  );

  const getMoveFolderOptions = (conversationId: string) => {
    const query = (folderMoveQueries[conversationId] || '').trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => folder.name.toLowerCase().includes(query));
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setMessage('请输入文件夹名称。');
      return;
    }

    try {
      setFolders(await createChatGPTFolder(newFolderName));
      setNewFolderName('');
      setMessage('文件夹已创建。');
    } catch {
      setMessage('创建文件夹失败。');
    }
  };

  const handleSaveCurrent = async () => {
    if (!currentConversation) {
      setMessage('当前页面不是可保存的 ChatGPT 对话。');
      return;
    }

    try {
      setConversations(await saveCurrentChatGPTConversation(currentConversation));
      setMessage('当前对话已保存到索引。');
    } catch {
      setMessage('保存当前对话失败。');
    }
  };

  const handleMove = async (conversationId: string, folderId: string) => {
    try {
      setConversations(await moveChatGPTConversationToFolder(conversationId, folderId || null));
      setMessage('对话已移动。');
    } catch {
      setMessage('移动对话失败。');
    }
  };

  const handleStartRename = (folder: ChatGPTFolder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleRenameFolder = async () => {
    if (!editingFolderId) return;

    try {
      setFolders(await renameChatGPTFolder(editingFolderId, editingFolderName));
      setEditingFolderId(null);
      setEditingFolderName('');
      setMessage('文件夹已重命名。');
    } catch {
      setMessage('重命名文件夹失败。');
    }
  };

  const handleDeleteFolder = async (folder: ChatGPTFolder) => {
    if (!window.confirm(`删除文件夹「${folder.name}」？其中对话会移回未分类。`)) return;

    try {
      const next = await deleteChatGPTFolder(folder.id);
      setFolders(next.folders);
      setConversations(next.conversations);
      setMessage('文件夹已删除，对话已移回未分类。');
    } catch {
      setMessage('删除文件夹失败。');
    }
  };

  const handleUpdateNote = async (conversationId: string, note: string) => {
    try {
      setConversations(await updateChatGPTConversationNote(conversationId, note));
      setMessage('备注已保存。');
    } catch {
      setMessage('保存备注失败。');
    }
  };

  const handleOpenConversation = async (url: string) => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      await browser.tabs.update(tabId, { url });
    }
  };

  return (
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">Folders</h1>
          <p className="text-muted-foreground text-xs">Conversation Index</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          返回
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardTitle className="mb-3 text-base">新建文件夹</CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="文件夹名称"
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button type="button" size="sm" onClick={() => void handleCreateFolder()}>
              新建一级文件夹
            </Button>
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">当前对话</CardTitle>
          <CardContent className="space-y-2 p-0 text-sm">
            <p className="text-muted-foreground truncate">
              {currentConversation?.title || '当前页面未识别为 ChatGPT 对话'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!canSaveCurrent}
              onClick={() => void handleSaveCurrent()}
            >
              保存当前 ChatGPT 对话到索引
            </Button>
            {message && <p className="text-muted-foreground text-xs">{message}</p>}
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">文件夹列表</CardTitle>
          <CardContent className="space-y-2 p-0">
            {folders.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无文件夹。</p>
            ) : (
              folders.map((folder) => (
                <div key={folder.id} className="border-border rounded-md border px-3 py-2 text-sm">
                  {editingFolderId === folder.id ? (
                    <div className="space-y-2">
                      <input
                        value={editingFolderName}
                        onChange={(event) => setEditingFolderName(event.target.value)}
                        className="border-border bg-background w-full rounded-md border px-2 py-1 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => void handleRenameFolder()}>
                          保存
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingFolderId(null)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{folder.name}</span>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartRename(folder)}
                        >
                          重命名
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDeleteFolder(folder)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">已索引对话</CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
              placeholder="搜索标题、备注或 URL"
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={folderFilterId}
              onChange={(event) => setFolderFilterId(event.target.value)}
              className="border-border bg-background w-full rounded-md border px-2 py-1 text-xs"
            >
              <option value="">全部文件夹</option>
              <option value="__uncategorized__">未分类</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>

            {filteredConversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无已索引对话。</p>
            ) : (
              filteredConversations.map((conversation) => (
                <div
                  key={conversation.conversationId}
                  className="border-border rounded-md border p-3"
                >
                  <button
                    type="button"
                    onClick={() => void handleOpenConversation(conversation.url)}
                    className="text-primary w-full truncate text-left text-sm font-semibold"
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                  <p className="text-muted-foreground mt-1 text-xs">
                    当前文件夹：{folderName(conversation.folderId, folders)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    更新时间：{formatTime(conversation.updatedAt)}
                  </p>
                  {conversation.note && (
                    <p className="mt-2 text-xs whitespace-pre-wrap">{conversation.note}</p>
                  )}
                  <textarea
                    value={conversation.note}
                    onChange={(event) =>
                      setConversations((prev) =>
                        prev.map((item) =>
                          item.conversationId === conversation.conversationId
                            ? { ...item, note: event.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={(event) =>
                      void handleUpdateNote(conversation.conversationId, event.target.value)
                    }
                    placeholder="备注"
                    rows={2}
                    className="border-border bg-background mt-2 w-full resize-y rounded-md border px-2 py-1 text-xs"
                  />
                  <input
                    value={folderMoveQueries[conversation.conversationId] || ''}
                    onChange={(event) =>
                      setFolderMoveQueries((prev) => ({
                        ...prev,
                        [conversation.conversationId]: event.target.value,
                      }))
                    }
                    placeholder="搜索文件夹"
                    className="border-border bg-background mt-2 w-full rounded-md border px-2 py-1 text-xs"
                  />
                  <select
                    value={conversation.folderId || ''}
                    onChange={(event) =>
                      void handleMove(conversation.conversationId, event.target.value)
                    }
                    className="border-border bg-background mt-2 w-full rounded-md border px-2 py-1 text-xs"
                  >
                    <option value="">未分类</option>
                    {getMoveFolderOptions(conversation.conversationId).map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
