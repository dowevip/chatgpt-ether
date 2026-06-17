import React, { useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  createChatGPTFolder,
  deleteChatGPTConversation,
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
import { cn } from '@/lib/utils';
import { ActionBar, PageSection, Panel, SelectField, TextAreaField, TextField } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';

import { Button } from '../../../components/ui/button';
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

const COLLAPSED_FOLDERS_STORAGE_KEY = 'chatgptEther.foldersPanel.collapsed';

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

function folderMatchesQuery(
  folder: ChatGPTFolder,
  folders: ChatGPTFolder[],
  query: string,
): boolean {
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
  const [showConversationSearch, setShowConversationSearch] = useState(false);
  const [folderMoveQueries, setFolderMoveQueries] = useState<Record<string, string>>({});
  const [expandedConversationIds, setExpandedConversationIds] = useState<Record<string, boolean>>(
    {},
  );
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
      conversations.filter((conversation) =>
        matchesConversationQuery(conversation, conversationQuery),
      ),
    [conversations, conversationQuery],
  );

  const currentIndexedConversation = useMemo(() => {
    if (!currentConversation) return null;
    return (
      conversations.find(
        (conversation) => conversation.conversationId === currentConversation.conversationId,
      ) || null
    );
  }, [conversations, currentConversation]);

  const folderConversationCounts = useMemo(
    () =>
      conversations.reduce<Record<string, number>>((counts, conversation) => {
        const key = conversation.folderId || '__uncategorized__';
        return { ...counts, [key]: (counts[key] || 0) + 1 };
      }, {}),
    [conversations],
  );

  const conversationsByFolderId = useMemo(
    () =>
      conversations.reduce<Record<string, ChatGPTConversationIndex[]>>((groups, conversation) => {
        const key = conversation.folderId || '__uncategorized__';
        return {
          ...groups,
          [key]: [...(groups[key] || []), conversation],
        };
      }, {}),
    [conversations],
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

  const handleDeleteConversation = async (conversation: ChatGPTConversationIndex) => {
    if (
      !window.confirm(t('foldersConversationDeleteConfirm').replace('{name}', conversation.title))
    ) {
      return;
    }

    try {
      setConversations(await deleteChatGPTConversation(conversation.conversationId));
      setMessage(t('foldersConversationDeleted'));
    } catch {
      setMessage(t('foldersConversationDeleteFailed'));
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

  const toggleConversationExpanded = (conversationId: string) => {
    setExpandedConversationIds((prev) => ({ ...prev, [conversationId]: !prev[conversationId] }));
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

  const renderConversationItem = (conversation: ChatGPTConversationIndex, nested = false) => {
    const isExpanded = Boolean(expandedConversationIds[conversation.conversationId]);

    return (
      <div
        key={conversation.conversationId}
        className={cn(
          uiTokens.color.border,
          uiTokens.radius.control,
          'border p-3',
          nested && uiTokens.color.surfaceMuted,
        )}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => void handleOpenConversation(conversation.url)}
            className={cn(
              uiTokens.color.textStrong,
              'min-w-0 flex-1 truncate text-left text-sm font-semibold',
            )}
            title={conversation.title}
          >
            {conversation.title}
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => toggleConversationExpanded(conversation.conversationId)}
          >
            {isExpanded ? t('foldersHideDetails') : t('foldersDetails')}
          </Button>
        </div>
        <div className={cn(uiTokens.color.textMuted, 'mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs')}>
          <span>
            {folderName(conversation.folderId, folders, {
              uncategorized: t('foldersUncategorized'),
              unknownFolder: t('foldersUnknownFolder'),
            })}
          </span>
          <span>{formatTime(conversation.updatedAt)}</span>
        </div>
        {conversation.note && !isExpanded && (
          <p className="mt-2 line-clamp-2 text-xs whitespace-pre-wrap">{conversation.note}</p>
        )}

        {isExpanded && (
          <div className={cn(uiTokens.radius.control, 'mt-3 space-y-2 border border-dashed p-2')}>
            <TextAreaField
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
              className="text-xs"
            />
            <TextField
              value={folderMoveQueries[conversation.conversationId] || ''}
              onChange={(event) =>
                setFolderMoveQueries((prev) => ({
                  ...prev,
                  [conversation.conversationId]: event.target.value,
                }))
              }
              placeholder={t('foldersSearchFolderPlaceholder')}
              className="text-xs"
            />
            <SelectField
              value={conversation.folderId || ''}
              onChange={(event) => void handleMove(conversation.conversationId, event.target.value)}
            >
              <option value="">{t('foldersUncategorized')}</option>
              {getMoveFolderOptions(conversation.conversationId).map((option) => (
                <option key={option.folder.id} value={option.folder.id}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <ActionBar
              actions={[
                {
                  id: 'open',
                  label: t('foldersOpenConversation'),
                  tone: 'primary',
                  onClick: () => void handleOpenConversation(conversation.url),
                },
                {
                  id: 'delete',
                  label: t('delete'),
                  tone: 'danger',
                  onClick: () => void handleDeleteConversation(conversation),
                },
              ]}
            />
          </div>
        )}
      </div>
    );
  };

  const renderChildFolder = (folder: ChatGPTFolder) => {
    const folderConversations = conversationsByFolderId[folder.id] || [];

    return (
      <div key={folder.id} className="space-y-2">
        {editingFolderId === folder.id ? (
          <div className={cn(uiTokens.radius.control, uiTokens.color.border, 'space-y-2 border p-2')}>
            <TextField
              value={editingFolderName}
              onChange={(event) => setEditingFolderName(event.target.value)}
            />
            <ActionBar
              actions={[
                { id: 'save', label: t('save'), tone: 'primary', onClick: () => void handleRenameFolder() },
                { id: 'cancel', label: t('cancel'), tone: 'secondary', onClick: () => setEditingFolderId(null) },
              ]}
            />
          </div>
        ) : (
          <div className={cn(uiTokens.radius.control, uiTokens.color.border, 'border px-2 py-2')}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleFolderCollapsed(folder.id)}
                className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}
                title={collapsedFolderIds[folder.id] ? t('expand') : t('collapse')}
              >
                {collapsedFolderIds[folder.id] ? '▶' : '▼'}
              </button>
              <span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span>
              <span className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}>
                {folderConversationCounts[folder.id] || 0}
              </span>
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
            {!collapsedFolderIds[folder.id] && (
              <div className="mt-2 space-y-2 pl-5">
                {folderConversations.length === 0 ? (
                  <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                    {t('foldersNoConversationsInFolder')}
                  </p>
                ) : (
                  folderConversations.map((conversation) =>
                    renderConversationItem(conversation, true),
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderRootFolder = (folder: ChatGPTFolder) => {
    const childFolders = childFoldersByParentId[folder.id] || [];
    const folderConversations = conversationsByFolderId[folder.id] || [];

    return (
      <div key={folder.id} className={cn(uiTokens.color.border, uiTokens.radius.control, 'border px-3 py-2 text-sm')}>
        {editingFolderId === folder.id ? (
          <div className="space-y-2">
            <TextField
              value={editingFolderName}
              onChange={(event) => setEditingFolderName(event.target.value)}
            />
            <ActionBar
              actions={[
                { id: 'save', label: t('save'), tone: 'primary', onClick: () => void handleRenameFolder() },
                { id: 'cancel', label: t('cancel'), tone: 'secondary', onClick: () => setEditingFolderId(null) },
              ]}
            />
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleFolderCollapsed(folder.id)}
                className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}
                title={collapsedFolderIds[folder.id] ? t('expand') : t('collapse')}
              >
                {collapsedFolderIds[folder.id] ? '▶' : '▼'}
              </button>
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}>
                {folderConversationCounts[folder.id] || 0}
              </span>
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

            {!collapsedFolderIds[folder.id] && (
              <div className={cn(uiTokens.color.borderSubtle, 'mt-2 space-y-2 border-l pl-4')}>
                {childFolders.map(renderChildFolder)}
                {folderConversations.map((conversation) =>
                  renderConversationItem(conversation, true),
                )}
                {childFolders.length === 0 && folderConversations.length === 0 && (
                  <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                    {t('foldersNoConversationsInFolder')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const uncategorizedConversations = conversationsByFolderId.__uncategorized__ || [];
  const isSearching = showConversationSearch && conversationQuery.trim().length > 0;

  return (
    <Panel
      title={t('cgEntryFolders')}
      subtitle={t('foldersPanelSubtitle')}
      onBack={onBack}
      backLabel={t('back')}
    >
        <PageSection title={t('foldersCurrentConversation')}>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {currentConversation?.title || t('foldersCurrentNotChatGPT')}
              </p>
              {currentIndexedConversation && (
                <p className={cn(uiTokens.color.textMuted, 'mt-1 text-xs')}>
                  {t('foldersCurrentFolder').replace(
                    '{name}',
                    folderName(currentIndexedConversation.folderId, folders, {
                      uncategorized: t('foldersUncategorized'),
                      unknownFolder: t('foldersUnknownFolder'),
                    }),
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <ActionBar
                actions={[
                  {
                    id: 'save-current',
                    label: currentIndexedConversation
                      ? t('foldersCurrentSavedBadge')
                      : t('foldersSaveCurrent'),
                    tone: 'primary',
                    disabled: !canSaveCurrent,
                    onClick: () => void handleSaveCurrent(),
                  },
                ]}
              />
              {currentIndexedConversation && (
                <SelectField
                  value={currentIndexedConversation.folderId || ''}
                  onChange={(event) =>
                    void handleMove(currentIndexedConversation.conversationId, event.target.value)
                  }
                  className="min-w-0 flex-1"
                >
                  <option value="">{t('foldersUncategorized')}</option>
                  {folderOptions.map((option) => (
                    <option key={option.folder.id} value={option.folder.id}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
            {message && <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>{message}</p>}
        </PageSection>

        <PageSection
          title={t('foldersFolderList')}
          actions={[
            {
              id: 'search',
              label: '🔍',
              tone: 'secondary',
              title: t('foldersSearchConversationPlaceholder'),
              onClick: () => {
                setShowConversationSearch((value) => !value);
                if (showConversationSearch) setConversationQuery('');
              },
            },
          ]}
          description={t('foldersConversationCount').replace('{count}', String(conversations.length))}
        >
            {showConversationSearch && (
              <TextField
                value={conversationQuery}
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder={t('foldersSearchConversationPlaceholder')}
              />
            )}

            <div className={cn(uiTokens.radius.control, 'space-y-2 border border-dashed p-2')}>
              <TextField
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder={t('foldersNamePlaceholder')}
              />
              <div className="flex gap-2">
                <SelectField
                  value={newFolderParentId}
                  onChange={(event) => setNewFolderParentId(event.target.value)}
                  className="min-w-0 flex-1"
                >
                  <option value="">{t('foldersCreateAsRoot')}</option>
                  {rootFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {t('foldersParentFolder').replace('{name}', folder.name)}
                    </option>
                  ))}
                </SelectField>
                <ActionBar
                  actions={[
                    {
                      id: 'create',
                      label: t('foldersQuickCreate'),
                      tone: 'primary',
                      onClick: () => void handleCreateFolder(),
                    },
                  ]}
                />
              </div>
            </div>

            {isSearching ? (
              <div className="space-y-2">
                <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                  {t('foldersSearchResults').replace(
                    '{count}',
                    String(filteredConversations.length),
                  )}
                </p>
                {filteredConversations.length === 0 ? (
                  <p className={cn(uiTokens.color.textMuted, uiTokens.typography.body)}>
                    {t('foldersNoSavedConversations')}
                  </p>
                ) : (
                  filteredConversations.map((conversation) => renderConversationItem(conversation))
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className={cn(uiTokens.color.border, uiTokens.radius.control, 'border px-3 py-2 text-sm')}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleFolderCollapsed('__uncategorized__')}
                      className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}
                      title={collapsedFolderIds.__uncategorized__ ? t('expand') : t('collapse')}
                    >
                      {collapsedFolderIds.__uncategorized__ ? '▶' : '▼'}
                    </button>
                    <span className="min-w-0 flex-1 truncate">{t('foldersUncategorized')}</span>
                    <span className={cn(uiTokens.color.textMuted, 'shrink-0 text-xs')}>
                      {folderConversationCounts.__uncategorized__ || 0}
                    </span>
                  </div>
                  {!collapsedFolderIds.__uncategorized__ && (
                    <div className="mt-2 space-y-2 pl-5">
                      {uncategorizedConversations.length === 0 ? (
                        <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                          {t('foldersNoConversationsInFolder')}
                        </p>
                      ) : (
                        uncategorizedConversations.map((conversation) =>
                          renderConversationItem(conversation, true),
                        )
                      )}
                    </div>
                  )}
                </div>

                {rootFolders.length === 0 ? (
                  <p className={cn(uiTokens.color.textMuted, uiTokens.typography.body)}>{t('foldersEmpty')}</p>
                ) : (
                  rootFolders.map(renderRootFolder)
                )}
              </div>
            )}
        </PageSection>
    </Panel>
  );
}
