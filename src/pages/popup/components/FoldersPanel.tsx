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
import { useLanguage } from '../../../contexts/LanguageContext';

type ChatGPTPageStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
};

type FoldersPanelProps = {
  currentStatus: ChatGPTPageStatus | null;
  onBack: () => void;
};

const COLLAPSED_FOLDERS_STORAGE_KEY = 'chatgptVoyager.foldersPanel.collapsed';

function folderName(
  folderId: string | null,
  folders: ChatGPTFolder[],
  labels: { uncategorized: string; unknownFolder: string },
): string {
  if (!folderId) return labels.uncategorized;
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return labels.unknownFolder;

  const parent = folder.parentId ? folders.find((item) => item.id === folder.parentId) : null;
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
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

function folderMatchesQuery(folder: ChatGPTFolder, folders: ChatGPTFolder[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const parent = folder.parentId ? folders.find((item) => item.id === folder.parentId) : null;
  return [folder.name, parent?.name || ''].join(' ').toLowerCase().includes(normalized);
}

export function FoldersPanel({ currentStatus, onBack }: FoldersPanelProps) {
  const { t } = useLanguage();
  const [folders, setFolders] = useState<ChatGPTFolder[]>([]);
  const [conversations, setConversations] = useState<ChatGPTConversationIndex[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [folderFilterId, setFolderFilterId] = useState('');
  const [folderMoveQueries, setFolderMoveQueries] = useState<Record<string, string>>({});
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [message, setMessage] = useState<string | null>(null);

  const canSaveCurrent =
    Boolean(currentStatus?.isChatGPTPage) && Boolean(currentStatus?.conversationId);

  const currentConversation = useMemo(() => {
    if (!currentStatus?.conversationId) return null;

    return {
      conversationId: currentStatus.conversationId,
      title: currentStatus.conversationTitle || t('foldersUntitledConversation'),
      url: `https://chatgpt.com/c/${currentStatus.conversationId}`,
    };
  }, [currentStatus, t]);

  const reload = async () => {
    const [nextFolders, nextConversations] = await Promise.all([
      listChatGPTFolders(),
      listChatGPTConversations(),
    ]);
    setFolders(nextFolders);
    setConversations(nextConversations);
  };

  useEffect(() => {
    reload().catch(() => setMessage(t('foldersLoadFailed')));
  }, [t]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify(collapsedFolderIds));
  }, [collapsedFolderIds]);

  useEffect(() => {
    if (!currentConversation) return;

    syncChatGPTConversationTitle(currentConversation)
      .then(setConversations)
      .catch(() => setMessage(t('foldersTitleSyncFailed')));
  }, [currentConversation, t]);

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

  const rootFolders = useMemo(() => folders.filter((folder) => !folder.parentId), [folders]);

  const childFoldersByParentId = useMemo(
    () =>
      folders.reduce<Record<string, ChatGPTFolder[]>>((groups, folder) => {
        if (!folder.parentId) return groups;
        return {
          ...groups,
          [folder.parentId]: [...(groups[folder.parentId] || []), folder],
        };
      }, {}),
    [folders],
  );

  const folderOptions = useMemo(
    () =>
      rootFolders.flatMap((folder) => [
        { folder, label: folder.name },
        ...(childFoldersByParentId[folder.id] || []).map((childFolder) => ({
          folder: childFolder,
          label: `　${childFolder.name}`,
        })),
      ]),
    [childFoldersByParentId, rootFolders],
  );

  const getMoveFolderOptions = (conversationId: string) => {
    const query = (folderMoveQueries[conversationId] || '').trim().toLowerCase();
    return folderOptions.filter((option) => folderMatchesQuery(option.folder, folders, query));
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setMessage(t('foldersNameRequired'));
      return;
    }

    try {
      setFolders(await createChatGPTFolder(newFolderName, newFolderParentId || null));
      setNewFolderName('');
      setNewFolderParentId('');
      setMessage(newFolderParentId ? t('foldersChildCreated') : t('foldersCreated'));
    } catch {
      setMessage(t('foldersCreateFailed'));
    }
  };

  const handleSaveCurrent = async () => {
    if (!currentConversation) {
      setMessage(t('foldersCurrentNotSaveable'));
      return;
    }

    try {
      setConversations(await saveCurrentChatGPTConversation(currentConversation));
      setMessage(t('foldersCurrentSaved'));
    } catch {
      setMessage(t('foldersCurrentSaveFailed'));
    }
  };

  const handleMove = async (conversationId: string, folderId: string) => {
    try {
      setConversations(await moveChatGPTConversationToFolder(conversationId, folderId || null));
      setMessage(t('foldersConversationMoved'));
    } catch {
      setMessage(t('foldersConversationMoveFailed'));
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
      setMessage(t('foldersRenamed'));
    } catch {
      setMessage(t('foldersRenameFailed'));
    }
  };

  const handleDeleteFolder = async (folder: ChatGPTFolder) => {
    const childCount = childFoldersByParentId[folder.id]?.length || 0;
    const message = childCount
      ? t('foldersDeleteWithChildrenConfirm')
          .replace('{name}', folder.name)
          .replace('{count}', String(childCount))
      : t('foldersDeleteConfirm').replace('{name}', folder.name);
    if (!window.confirm(message)) return;

    try {
      const next = await deleteChatGPTFolder(folder.id);
      setFolders(next.folders);
      setConversations(next.conversations);
      setMessage(t('foldersDeleted'));
    } catch {
      setMessage(t('foldersDeleteFailed'));
    }
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleUpdateNote = async (conversationId: string, note: string) => {
    try {
      setConversations(await updateChatGPTConversationNote(conversationId, note));
      setMessage(t('foldersNoteSaved'));
    } catch {
      setMessage(t('foldersNoteSaveFailed'));
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
          <h1 className="text-primary text-xl font-bold">{t('cgEntryFolders')}</h1>
          <p className="text-muted-foreground text-xs">{t('foldersSavedConversations')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('back')}
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardTitle className="mb-3 text-base">{t('foldersNewFolder')}</CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder={t('foldersNamePlaceholder')}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={newFolderParentId}
              onChange={(event) => setNewFolderParentId(event.target.value)}
              className="border-border bg-background w-full rounded-md border px-2 py-1 text-xs"
            >
              <option value="">{t('foldersCreateAsRoot')}</option>
              {rootFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {t('foldersParentFolder').replace('{name}', folder.name)}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" onClick={() => void handleCreateFolder()}>
              {newFolderParentId ? t('foldersCreateChild') : t('foldersCreateRoot')}
            </Button>
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">{t('foldersCurrentConversation')}</CardTitle>
          <CardContent className="space-y-2 p-0 text-sm">
            <p className="text-muted-foreground truncate">
              {currentConversation?.title || t('foldersCurrentNotChatGPT')}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!canSaveCurrent}
              onClick={() => void handleSaveCurrent()}
            >
              {t('foldersSaveCurrent')}
            </Button>
            {message && <p className="text-muted-foreground text-xs">{message}</p>}
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">{t('foldersFolderList')}</CardTitle>
          <CardContent className="space-y-2 p-0">
            {folders.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('foldersEmpty')}</p>
            ) : (
              rootFolders.map((folder) => (
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
                          {t('save')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingFolderId(null)}
                        >
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleFolderCollapsed(folder.id)}
                          className="text-muted-foreground shrink-0 text-xs"
                          title={collapsedFolderIds[folder.id] ? t('expand') : t('collapse')}
                        >
                          {collapsedFolderIds[folder.id] ? '▶' : '▼'}
                        </button>
                        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartRename(folder)}
                          >
                            {t('rename')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDeleteFolder(folder)}
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      </div>

                      {!collapsedFolderIds[folder.id] && (
                        <div className="border-border/60 mt-2 space-y-2 border-l pl-4">
                          {(childFoldersByParentId[folder.id] || []).map((childFolder) => (
                            <div key={childFolder.id}>
                              {editingFolderId === childFolder.id ? (
                                <div className="space-y-2">
                                  <input
                                    value={editingFolderName}
                                    onChange={(event) => setEditingFolderName(event.target.value)}
                                    className="border-border bg-background w-full rounded-md border px-2 py-1 text-sm"
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => void handleRenameFolder()}
                                    >
                                      {t('save')}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setEditingFolderId(null)}
                                    >
                                      {t('cancel')}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{childFolder.name}</span>
                                  <div className="flex shrink-0 gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartRename(childFolder)}
                                    >
                                      {t('rename')}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => void handleDeleteFolder(childFolder)}
                                    >
                                      {t('delete')}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="p-4">
          <CardTitle className="mb-3 text-base">{t('foldersSavedConversations')}</CardTitle>
          <CardContent className="space-y-3 p-0">
            <input
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
              placeholder={t('foldersSearchConversationPlaceholder')}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <select
              value={folderFilterId}
              onChange={(event) => setFolderFilterId(event.target.value)}
              className="border-border bg-background w-full rounded-md border px-2 py-1 text-xs"
            >
              <option value="">{t('foldersAllFolders')}</option>
              <option value="__uncategorized__">{t('foldersUncategorized')}</option>
              {folderOptions.map((option) => (
                <option key={option.folder.id} value={option.folder.id}>
                  {option.label}
                </option>
              ))}
            </select>

            {filteredConversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('foldersNoSavedConversations')}</p>
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
                    {t('foldersCurrentFolder').replace(
                      '{name}',
                      folderName(conversation.folderId, folders, {
                        uncategorized: t('foldersUncategorized'),
                        unknownFolder: t('foldersUnknownFolder'),
                      }),
                    )}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('foldersUpdatedAt').replace('{time}', formatTime(conversation.updatedAt))}
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
                    placeholder={t('foldersNotePlaceholder')}
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
                    placeholder={t('foldersSearchFolderPlaceholder')}
                    className="border-border bg-background mt-2 w-full rounded-md border px-2 py-1 text-xs"
                  />
                  <select
                    value={conversation.folderId || ''}
                    onChange={(event) =>
                      void handleMove(conversation.conversationId, event.target.value)
                    }
                    className="border-border bg-background mt-2 w-full rounded-md border px-2 py-1 text-xs"
                  >
                    <option value="">{t('foldersUncategorized')}</option>
                    {getMoveFolderOptions(conversation.conversationId).map((option) => (
                      <option key={option.folder.id} value={option.folder.id}>
                        {option.label}
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
