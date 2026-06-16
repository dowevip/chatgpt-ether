import React, { useCallback, useEffect, useState } from 'react';

import {
  accountIsolationService,
  buildScopedStorageKey,
  detectAccountPlatformFromUrl,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import { restoreBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type {
  PromptItem,
  SettingsExportPayload,
  SyncAccountScope,
  SyncMode,
  SyncPlatform,
  SyncState,
} from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { isSafari } from '@/core/utils/browser';
import {
  getTimelineHierarchyStorageKey,
  getTimelineHierarchyStorageKeysToRead,
  resolveTimelineHierarchyDataForStorageScope,
} from '@/pages/content/timeline/hierarchyStorage';
import type { TimelineHierarchyData } from '@/pages/content/timeline/hierarchyTypes';
import type { StarredMessagesData } from '@/pages/content/timeline/starredTypes';
import { ActionBar, ListView, PageSection, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { useLanguage } from '../../../contexts/LanguageContext';
import {
  mergeFolderData,
  mergePrompts,
  mergeStarredMessages,
  mergeTimelineHierarchy,
} from '../../../utils/merge';

function isFolderData(value: unknown): value is FolderData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as { folders?: unknown; folderContents?: unknown };
  return (
    Array.isArray(data.folders) &&
    typeof data.folderContents === 'object' &&
    data.folderContents !== null
  );
}

function isPromptItemArray(value: unknown): value is PromptItem[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const prompt = item as Record<string, unknown>;
      return (
        typeof prompt.id === 'string' &&
        typeof prompt.text === 'string' &&
        Array.isArray(prompt.tags) &&
        prompt.tags.every((tag) => typeof tag === 'string') &&
        typeof prompt.createdAt === 'number'
      );
    })
  );
}

function isStarredMessagesData(value: unknown): value is StarredMessagesData {
  if (typeof value !== 'object' || value === null) return false;
  if (!('messages' in value)) return false;
  const messages = (value as { messages: unknown }).messages;
  return typeof messages === 'object' && messages !== null;
}

function isTimelineHierarchyData(value: unknown): value is TimelineHierarchyData {
  if (typeof value !== 'object' || value === null) return false;
  if (!('conversations' in value)) return false;
  const conversations = (value as { conversations: unknown }).conversations;
  return typeof conversations === 'object' && conversations !== null;
}

type DownloadMode = 'merge' | 'overwrite';

type CloudSyncSettingsProps = {
  chatgptOnly?: boolean;
  onBack?: () => void;
};

function isChatGPTUrl(url: string | null | undefined): boolean {
  try {
    return new URL(url || '').hostname.toLowerCase() === 'chatgpt.com';
  } catch {
    return false;
  }
}

/**
 * CloudSyncSettings component for popup
 * Allows users to configure Google Drive sync settings
 */
export function CloudSyncSettings({ chatgptOnly = false, onBack }: CloudSyncSettingsProps = {}) {
  const { t, language } = useLanguage();
  const isSafariBrowser = isSafari();

  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE);
  const [statusMessage, setStatusMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [downloadMode, setDownloadMode] = useState<DownloadMode | null>(null);
  const [platform, setPlatform] = useState<SyncPlatform>('gemini');

  const isChineseLanguage = language.startsWith('zh');
  const safeSyncCopy = {
    authorizeGoogleDrive: isChineseLanguage ? '授权 Google Drive' : 'Authorize Google Drive',
    authorizationSucceeded: isChineseLanguage
      ? 'Google Drive 授权成功。'
      : 'Google Drive authorization succeeded.',
    authorizationFailed: isChineseLanguage
      ? 'Google Drive 授权失败。'
      : 'Google Drive authorization failed.',
    firstUseGuidance: isChineseLanguage
      ? '新设备首次使用建议先从云端拉取并合并。'
      : 'On a new device, pull from cloud and merge first.',
    uploadExistingCloudConfirm: isChineseLanguage
      ? '云端已有同步数据。当前设备数据可能不是最新，上传会更新云端数据。建议先从云端拉取并合并。是否仍要上传？'
      : 'Cloud sync data already exists. Data on this device may not be current, and uploading will update cloud data. We recommend pulling from cloud and merging first. Upload anyway?',
  };

  const getBaseFolderStorageKey = useCallback(
    (targetPlatform: SyncPlatform) =>
      targetPlatform === 'aistudio' ? StorageKeys.FOLDER_DATA_AISTUDIO : StorageKeys.FOLDER_DATA,
    [],
  );

  // Detect current platform from active tab URL
  const detectPlatform = useCallback(async (): Promise<SyncPlatform> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isChatGPTUrl(tab?.url)) return 'chatgpt';
      return detectAccountPlatformFromUrl(tab?.url ?? null);
    } catch (e) {
      console.warn('[CloudSyncSettings] Failed to detect platform:', e);
    }
    return 'gemini';
  }, []);

  const resolveCurrentPageSyncScope = useCallback(
    async (respectIsolationSetting: boolean): Promise<SyncAccountScope | null> => {
      if (respectIsolationSetting) {
        if (platform === 'chatgpt') return null;
        const isolationEnabled = await accountIsolationService.isIsolationEnabled({ platform });
        if (!isolationEnabled) {
          return null;
        }
      }

      let pageUrl = '';
      let routeUserId: string | null = null;
      let email: string | null = null;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        pageUrl = tab?.url || '';
        routeUserId = platform === 'gemini' ? extractRouteUserIdFromUrl(pageUrl) : null;

        if (tab?.id) {
          try {
            const response = (await Promise.race([
              chrome.tabs.sendMessage(tab.id, { type: 'gv.account.getContext' }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 400)),
            ])) as {
              ok?: boolean;
              context?: { routeUserId?: string | null; email?: string | null };
            };

            if (response?.ok && response.context) {
              routeUserId = response.context.routeUserId ?? routeUserId;
              email = response.context.email ?? null;
            }
          } catch {
            // Ignore content-script lookup failure; we'll resolve with URL fallback.
          }
        }
      } catch {
        // Ignore tab query failure; account service will fallback to default scope.
      }

      if (!routeUserId && !email) {
        return null;
      }

      const resolvedScope = await accountIsolationService.resolveAccountScope({
        pageUrl,
        routeUserId,
        email,
      });

      return {
        accountKey: resolvedScope.accountKey,
        accountId: resolvedScope.accountId,
        routeUserId: resolvedScope.routeUserId,
      };
    },
    [platform],
  );

  const resolveAccountSyncContext = useCallback(async (): Promise<{
    accountScope: SyncAccountScope | null;
    folderStorageKey: string;
  }> => {
    const baseFolderStorageKey = getBaseFolderStorageKey(platform);
    const accountScope = await resolveCurrentPageSyncScope(true);
    if (!accountScope) {
      return {
        accountScope: null,
        folderStorageKey: baseFolderStorageKey,
      };
    }

    return {
      accountScope,
      folderStorageKey: buildScopedStorageKey(baseFolderStorageKey, accountScope.accountKey),
    };
  }, [getBaseFolderStorageKey, platform, resolveCurrentPageSyncScope]);

  const resolveTimelineHierarchySyncContext = useCallback(async (): Promise<{
    accountScope: SyncAccountScope | null;
    storageKey: string;
  }> => {
    if (platform !== 'gemini') {
      return {
        accountScope: null,
        storageKey: StorageKeys.TIMELINE_HIERARCHY,
      };
    }

    const accountScope = await resolveCurrentPageSyncScope(false);
    return {
      accountScope,
      storageKey: getTimelineHierarchyStorageKey(accountScope?.accountKey),
    };
  }, [platform, resolveCurrentPageSyncScope]);

  // Fetch sync state and detect platform on mount
  useEffect(() => {
    const fetchState = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: chatgptOnly ? 'gv.chatgpt.sync.getState' : 'gv.sync.getState',
        });
        if (response?.ok && response.state) {
          setSyncState(response.state);
        }
      } catch (error) {
        console.error('[CloudSyncSettings] Failed to get sync state:', error);
      }
    };
    const initPlatform = async () => {
      if (chatgptOnly) {
        setPlatform('chatgpt');
        return;
      }
      const detected = await detectPlatform();
      setPlatform(detected);
      console.log('[CloudSyncSettings] Detected platform:', detected);
    };
    fetchState();
    initPlatform();
  }, [chatgptOnly, detectPlatform]);

  const refreshChatGPTSyncState = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'gv.chatgpt.sync.getState',
      })) as { ok?: boolean; state?: SyncState; error?: string } | undefined;
      if (response?.state) setSyncState(response.state);
      if (!response?.ok && response?.error) {
        setStatusMessage({
          text: t('syncRefreshFailed').replace('{error}', response.error),
          kind: 'err',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('unknownError');
      setStatusMessage({ text: t('syncRefreshFailed').replace('{error}', message), kind: 'err' });
    }
  }, [t]);

  // Format timestamp for display
  const formatLastSync = useCallback(
    (timestamp: number | null): string => {
      if (!timestamp) return t('neverSynced');
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      let timeStr: string;
      if (diffMins < 1) {
        timeStr = t('justNow');
      } else if (diffMins < 60) {
        timeStr = `${diffMins} ${t('minutesAgo')}`;
      } else if (diffHours < 24) {
        timeStr = `${diffHours} ${t('hoursAgo')}`;
      } else if (diffDays === 1) {
        timeStr = t('yesterday');
      } else {
        timeStr = date.toLocaleDateString();
      }

      return t('lastSynced').replace('{time}', timeStr);
    },
    [t],
  );

  // Format upload timestamp for display
  const formatLastUpload = useCallback(
    (timestamp: number | null): string => {
      if (!timestamp) return t('neverUploaded') || 'Never uploaded';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      let timeStr: string;
      if (diffMins < 1) {
        timeStr = t('justNow');
      } else if (diffMins < 60) {
        timeStr = `${diffMins} ${t('minutesAgo')}`;
      } else if (diffHours < 24) {
        timeStr = `${diffHours} ${t('hoursAgo')}`;
      } else if (diffDays === 1) {
        timeStr = t('yesterday');
      } else {
        timeStr = date.toLocaleDateString();
      }

      return (t('lastUploaded') || 'Uploaded {time}').replace('{time}', timeStr);
    },
    [t],
  );

  // Handle mode change
  const handleModeChange = useCallback(async (mode: SyncMode) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'gv.sync.setMode',
        payload: { mode },
      });
      if (response?.ok && response.state) {
        setSyncState(response.state);
      }
    } catch (error) {
      console.error('[CloudSyncSettings] Failed to set sync mode:', error);
    }
  }, []);

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'gv.sync.signOut' });
      if (response?.ok && response.state) {
        setSyncState(response.state);
      }
      if (platform === 'chatgpt') {
        setStatusMessage({
          text: t('syncAuthCacheCleared'),
          kind: 'ok',
        });
      }
    } catch (error) {
      console.error('[CloudSyncSettings] Sign out failed:', error);
      if (platform === 'chatgpt') {
        const message = error instanceof Error ? error.message : t('unknownError');
        setStatusMessage({
          text: t('syncClearAuthFailed').replace('{error}', message),
          kind: 'err',
        });
      }
    }
  }, [platform, t]);

  const handleAuthorizeGoogleDrive = useCallback(async () => {
    setStatusMessage(null);
    setIsAuthorizing(true);

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'gv.sync.authenticate',
        payload: { interactive: true },
      })) as { ok?: boolean; state?: SyncState; error?: string } | undefined;

      if (response?.state) setSyncState(response.state);
      if (!response?.ok) {
        throw new Error(response?.error || response?.state?.error || safeSyncCopy.authorizationFailed);
      }

      setStatusMessage({ text: safeSyncCopy.authorizationSucceeded, kind: 'ok' });
    } catch (error) {
      const message = error instanceof Error ? error.message : safeSyncCopy.authorizationFailed;
      setStatusMessage({ text: message, kind: 'err' });
    } finally {
      setIsAuthorizing(false);
    }
  }, [safeSyncCopy.authorizationFailed, safeSyncCopy.authorizationSucceeded]);

  // Handle sync now (upload current data)
  const handleSyncNow = useCallback(async () => {
    if (!syncState.isAuthenticated) {
      return;
    }

    setStatusMessage(null);

    try {
      const accountContext =
        platform === 'chatgpt' ? null : await resolveAccountSyncContext();
      const timelineHierarchyContext =
        platform === 'chatgpt' ? null : await resolveTimelineHierarchySyncContext();
      const cloudDataExists =
        platform === 'chatgpt'
          ? await googleDriveSyncService.hasChatGPTSyncData(false)
          : await googleDriveSyncService.hasCloudSyncData(
              false,
              platform,
              accountContext?.accountScope ?? null,
              timelineHierarchyContext?.accountScope ?? null,
            );

      if (cloudDataExists && !window.confirm(safeSyncCopy.uploadExistingCloudConfirm)) {
        return;
      }

      setIsUploading(true);

      if (platform === 'chatgpt') {
        const response = (await chrome.runtime.sendMessage({
          type: 'gv.chatgpt.sync.upload',
          payload: { interactive: true },
        })) as { ok?: boolean; error?: string; state?: SyncState } | undefined;

        if (response?.state) setSyncState(response.state);
        if (!response?.ok) {
          throw new Error(response?.error || response?.state?.error || t('syncUploadFailed'));
        }
        setStatusMessage({ text: t('syncUploadSuccess'), kind: 'ok' });
        return;
      }

      if (!accountContext || !timelineHierarchyContext) return;
      let accountScope = accountContext.accountScope;
      let folderStorageKey = accountContext.folderStorageKey;
      const timelineHierarchyAccountScope = timelineHierarchyContext.accountScope;

      // Get current data - prioritizing active tab content script for folders
      let folders: FolderData = { folders: [], folderContents: {} };
      let prompts: PromptItem[] = [];

      // 1. Try to get fresh folder data from active tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          // Short timeout to avoid blocking
          const response = (await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'gv.sync.requestData' }),
            new Promise((_, reject) => setTimeout(() => reject('Timeout'), 500)),
          ])) as { ok?: boolean; data?: FolderData; accountScope?: SyncAccountScope } | null;

          if (response?.ok && response.data) {
            folders = response.data;
            console.log('[CloudSyncSettings] Got fresh folder data from content script');
            if (response.accountScope) {
              accountScope = response.accountScope;
              folderStorageKey = buildScopedStorageKey(
                getBaseFolderStorageKey(platform),
                response.accountScope.accountKey,
              );
            }
          }
        }
      } catch (e) {
        console.log('[CloudSyncSettings] Tab fetch failed/skipped:', e);
      }

      // 2. Fallback to storage
      try {
        const storageResult = await chrome.storage.local.get([
          folderStorageKey,
          StorageKeys.PROMPT_ITEMS,
        ]);
        const storedFoldersValue = storageResult[folderStorageKey];
        const storedPromptsValue = storageResult[StorageKeys.PROMPT_ITEMS];

        // Only use storage folders if we didn't get them from tab
        if (
          (!folders.folders || folders.folders.length === 0) &&
          isFolderData(storedFoldersValue)
        ) {
          folders = storedFoldersValue;
          console.log(`[CloudSyncSettings] Loaded folders from ${folderStorageKey} (fallback)`);
        }

        // Prompts usually sync well to storage (only for Gemini)
        if (platform === 'gemini' && isPromptItemArray(storedPromptsValue)) {
          prompts = storedPromptsValue;
        }
      } catch (err) {
        console.error('[CloudSyncSettings] Error loading data:', err);
      }

      console.log(
        `[CloudSyncSettings] Uploading ${platform} folders:`,
        folders.folders?.length || 0,
        platform === 'gemini' ? `prompts: ${prompts.length}` : '(prompts skipped for AI Studio)',
      );

      // Upload to Google Drive with platform info
      const response = (await chrome.runtime.sendMessage({
        type: 'gv.sync.upload',
        payload: {
          folders,
          prompts,
          platform,
          accountScope,
          timelineHierarchyAccountScope,
        },
      })) as { ok?: boolean; error?: string; state?: SyncState } | undefined;

      if (response?.state) {
        setSyncState(response.state);
      }

      if (response?.ok) {
        setStatusMessage({ text: t('syncSuccess'), kind: 'ok' });
      } else {
        throw new Error(response?.error || response?.state?.error || t('syncUploadFailed'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('syncFailed');
      console.error('[CloudSyncSettings] Sync failed:', error);
      setStatusMessage({ text: t('syncError').replace('{error}', errorMessage), kind: 'err' });
    } finally {
      setIsUploading(false);
    }
  }, [
    getBaseFolderStorageKey,
    platform,
    resolveAccountSyncContext,
    resolveTimelineHierarchySyncContext,
    safeSyncCopy.uploadExistingCloudConfirm,
    syncState.isAuthenticated,
    t,
  ]);

  // Handle download from Drive (restore data) with merge as the default safe path.
  const handleDownloadFromDrive = useCallback(
    async (mode: DownloadMode = 'merge') => {
      if (
        mode === 'overwrite' &&
        !window.confirm(
          platform === 'chatgpt'
            ? t('syncOverwriteChatGPTConfirm')
            : t('syncOverwriteConfirm'),
        )
      ) {
        return;
      }

      setStatusMessage(null);
      setIsDownloading(true);
      setDownloadMode(mode);

      try {
        const accountContext = await resolveAccountSyncContext();
        if (platform === 'chatgpt') {
          const response = (await chrome.runtime.sendMessage({
            type: 'gv.chatgpt.sync.download',
            payload: { interactive: true, mode },
          })) as { ok?: boolean; error?: string; state?: SyncState } | undefined;

          if (response?.state) setSyncState(response.state);
          if (!response?.ok) {
            throw new Error(response?.error || response?.state?.error || t('syncDownloadFailed'));
          }
          setStatusMessage({
            text:
              mode === 'overwrite'
                ? t('syncOverwriteSuccess')
                : t('syncMergeSuccess'),
            kind: 'ok',
          });
          return;
        }

        const timelineHierarchyContext = await resolveTimelineHierarchySyncContext();
        let accountScope = accountContext.accountScope;
        let folderStorageKey = accountContext.folderStorageKey;
        const timelineHierarchyAccountScope = timelineHierarchyContext.accountScope;
        const timelineHierarchyStorageKey = timelineHierarchyContext.storageKey;

        // Download from Google Drive (platform-specific)
        const response = (await chrome.runtime.sendMessage({
          type: 'gv.sync.download',
          payload: { platform, accountScope, timelineHierarchyAccountScope },
        })) as
          | {
              ok?: boolean;
              error?: string;
              state?: SyncState;
              data?: {
                folders?: { data?: FolderData };
                prompts?: { items?: PromptItem[] };
                settings?: SettingsExportPayload;
                starred?: { data?: StarredMessagesData };
                timelineHierarchy?: { data?: TimelineHierarchyData };
              } | null;
            }
          | undefined;

        if (response?.state) {
          setSyncState(response.state);
        }

        if (!response?.ok) {
          throw new Error(response?.error || response?.state?.error || t('syncDownloadFailed'));
        }

        if (!response.data) {
          setStatusMessage({ text: t('syncNoData'), kind: 'err' });
          setIsDownloading(false);
          return;
        }

        // Get current local data for merging - prioritize Content Script
        let localFolders: FolderData = { folders: [], folderContents: {} };
        let localPrompts: PromptItem[] = [];
        let localTimelineHierarchy: TimelineHierarchyData = { conversations: {} };

        // 1. Try to get fresh folder data from active tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          console.log('[CloudSyncSettings] Active tab:', tab?.id, tab?.url);
          if (tab?.id) {
            const tabResponse = (await Promise.race([
              chrome.tabs.sendMessage(tab.id, { type: 'gv.sync.requestData' }),
              new Promise((_, reject) => setTimeout(() => reject('Timeout after 2s'), 2000)),
            ])) as { ok?: boolean; data?: FolderData; accountScope?: SyncAccountScope } | null;

            console.log('[CloudSyncSettings] Tab response:', tabResponse);
            if (tabResponse?.ok && tabResponse.data) {
              localFolders = tabResponse.data;
              console.log(
                '[CloudSyncSettings] Got fresh folder data from content script:',
                'folders:',
                localFolders.folders?.length,
                'folderContents keys:',
                Object.keys(localFolders.folderContents || {}).length,
              );
              if (tabResponse.accountScope) {
                accountScope = tabResponse.accountScope;
                folderStorageKey = buildScopedStorageKey(
                  getBaseFolderStorageKey(platform),
                  tabResponse.accountScope.accountKey,
                );
              }
            }
          }
        } catch (e) {
          console.warn('[CloudSyncSettings] Tab fetch failed/skipped:', e);
        }

        // 2. Fallback to storage
        try {
          const storageResult = await chrome.storage.local.get([
            folderStorageKey,
            StorageKeys.PROMPT_ITEMS,
            ...getTimelineHierarchyStorageKeysToRead(timelineHierarchyAccountScope?.accountKey),
          ]);
          const storedFoldersValue = storageResult[folderStorageKey];
          const storedPromptsValue = storageResult[StorageKeys.PROMPT_ITEMS];

          // Only use storage folders if we didn't get them from tab
          if (
            (!localFolders.folders || localFolders.folders.length === 0) &&
            isFolderData(storedFoldersValue)
          ) {
            localFolders = storedFoldersValue;
            console.log(`[CloudSyncSettings] Loaded folders from ${folderStorageKey} (fallback)`);
          }

          // Prompts only for Gemini platform
          if (platform === 'gemini' && isPromptItemArray(storedPromptsValue)) {
            localPrompts = storedPromptsValue;
          }

          if (platform === 'gemini') {
            const resolvedHierarchy = resolveTimelineHierarchyDataForStorageScope(
              storageResult as Record<string, unknown>,
              timelineHierarchyAccountScope?.accountKey,
              timelineHierarchyAccountScope?.routeUserId ?? null,
            );
            if (isTimelineHierarchyData(resolvedHierarchy)) {
              localTimelineHierarchy = resolvedHierarchy;
            }
          }
        } catch (err) {
          console.error('[CloudSyncSettings] Error loading local data for merge:', err);
        }

        // Sync payloads contain feature-specific export payloads from Google Drive files.
        const {
          folders: cloudFoldersPayload,
          prompts: cloudPromptsPayload,
          settings: cloudSettingsPayload,
          starred: cloudStarredPayload,
          timelineHierarchy: cloudTimelineHierarchyPayload,
        } = response.data;
        const cloudFolderDataRaw = cloudFoldersPayload?.data;
        const hasCloudFolderData = isFolderData(cloudFolderDataRaw);
        const cloudFolderData = hasCloudFolderData
          ? cloudFolderDataRaw
          : { folders: [], folderContents: {} };
        const cloudPromptItems = cloudPromptsPayload?.items || [];
        const cloudStarredData: StarredMessagesData = cloudStarredPayload?.data || { messages: {} };
        const cloudTimelineHierarchyData: TimelineHierarchyData =
          cloudTimelineHierarchyPayload?.data || { conversations: {} };

        console.log('[CloudSyncSettings] === MERGE DEBUG ===');
        console.log('[CloudSyncSettings] Local folders count:', localFolders.folders?.length || 0);
        console.log(
          '[CloudSyncSettings] Local folderContents:',
          JSON.stringify(Object.keys(localFolders.folderContents || {})),
        );
        console.log(
          '[CloudSyncSettings] Cloud folders count:',
          cloudFolderData.folders?.length || 0,
        );
        console.log(
          '[CloudSyncSettings] Cloud folderContents:',
          JSON.stringify(Object.keys(cloudFolderData.folderContents || {})),
        );
        console.log(
          '[CloudSyncSettings] Cloud starred conversations:',
          Object.keys(cloudStarredData.messages || {}).length,
        );
        console.log(
          '[CloudSyncSettings] Cloud hierarchy conversations:',
          Object.keys(cloudTimelineHierarchyData.conversations || {}).length,
        );

        // Get local starred messages for merge
        let localStarred: StarredMessagesData = { messages: {} };
        try {
          const starredResult = await chrome.storage.local.get(['geminiTimelineStarredMessages']);
          if (isStarredMessagesData(starredResult.geminiTimelineStarredMessages)) {
            localStarred = starredResult.geminiTimelineStarredMessages;
          }
        } catch (err) {
          console.warn('[CloudSyncSettings] Could not get local starred messages:', err);
        }

        const shouldOverwrite = mode === 'overwrite';
        if (shouldOverwrite && !hasCloudFolderData) {
          setStatusMessage({ text: t('syncOverwriteMissingFolders'), kind: 'err' });
          setIsDownloading(false);
          return;
        }

        const nextFolders = shouldOverwrite
          ? cloudFolderData
          : mergeFolderData(localFolders, cloudFolderData);
        const nextPrompts = shouldOverwrite
          ? cloudPromptItems
          : mergePrompts(localPrompts, cloudPromptItems);
        const nextStarred = shouldOverwrite
          ? cloudStarredData
          : mergeStarredMessages(localStarred, cloudStarredData);
        const nextTimelineHierarchy = shouldOverwrite
          ? cloudTimelineHierarchyData
          : mergeTimelineHierarchy(localTimelineHierarchy, cloudTimelineHierarchyData);
        await restoreBackupableSyncSettings(cloudSettingsPayload?.data);

        console.log(
          '[CloudSyncSettings] Resolved folders count:',
          nextFolders.folders?.length || 0,
        );
        console.log(
          '[CloudSyncSettings] Resolved folderContents:',
          JSON.stringify(Object.keys(nextFolders.folderContents || {})),
        );
        console.log(
          '[CloudSyncSettings] Resolved starred conversations:',
          Object.keys(nextStarred.messages || {}).length,
        );
        console.log(
          '[CloudSyncSettings] Resolved hierarchy conversations:',
          Object.keys(nextTimelineHierarchy.conversations || {}).length,
        );
        console.log('[CloudSyncSettings] === END MERGE DEBUG ===');

        // Save merged data to storage (platform-specific storage key for folders)
        const storageUpdate: Record<string, unknown> = {
          [folderStorageKey]: nextFolders,
        };

        // Only save prompts and starred for Gemini platform
        if (platform === 'gemini') {
          storageUpdate[StorageKeys.PROMPT_ITEMS] = nextPrompts;
          storageUpdate.geminiTimelineStarredMessages = nextStarred;
          storageUpdate[timelineHierarchyStorageKey] = nextTimelineHierarchy;
        }

        await chrome.storage.local.set(storageUpdate);

        // Notify content script to reload folders
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            await chrome.tabs.sendMessage(tab.id, { type: 'gv.folders.reload' });
            console.log('[CloudSyncSettings] Sent reload message to content script');
          }
        } catch (err) {
          console.warn('[CloudSyncSettings] Could not notify content script:', err);
        }

        setStatusMessage({ text: t('syncSuccess'), kind: 'ok' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('syncDownloadFailed');
        console.error('[CloudSyncSettings] Download failed:', error);
        setStatusMessage({ text: t('syncError').replace('{error}', errorMessage), kind: 'err' });
      } finally {
        setIsDownloading(false);
        setDownloadMode(null);
      }
    },
    [
      getBaseFolderStorageKey,
      platform,
      resolveAccountSyncContext,
      resolveTimelineHierarchySyncContext,
      t,
    ],
  );

  // Clear status message after 3 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const formatChatGPTTime = useCallback((timestamp: number | null): string => {
    if (!timestamp) return t('never');
    return new Date(timestamp).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [t]);

  // Don't render on Safari
  if (isSafariBrowser) return null;

  if (chatgptOnly) {
    const busy = isAuthorizing || isUploading || isDownloading || syncState.isSyncing;

    return (
      <Panel title={t('syncTitle')} subtitle={t('syncSubtitle')} onBack={onBack} backLabel={t('back')}>
        <PageSection title={t('syncStatus')}>
          <ListView
            variant="divided"
            emptyText="-"
            items={[
              {
                id: 'auth',
                title: <span className={uiTokens.color.textMuted}>{t('syncGoogleDriveAuthStatus')}</span>,
                meta: syncState.isAuthenticated ? t('syncAuthorized') : t('syncUnauthorized'),
              },
              {
                id: 'syncing',
                title: <span className={uiTokens.color.textMuted}>{t('syncCurrentlySyncing')}</span>,
                meta: syncState.isSyncing ? t('yes') : t('no'),
              },
              {
                id: 'last-upload',
                title: <span className={uiTokens.color.textMuted}>{t('syncLastUploadTime')}</span>,
                meta: formatChatGPTTime(syncState.lastUploadTimeChatGPT),
              },
              {
                id: 'last-sync',
                title: <span className={uiTokens.color.textMuted}>{t('syncLastSyncTime')}</span>,
                meta: formatChatGPTTime(syncState.lastSyncTimeChatGPT),
              },
              {
                id: 'error',
                title: <span className={uiTokens.color.textMuted}>{t('syncRecentError')}</span>,
                meta: syncState.error || t('none'),
              },
            ]}
          />
        </PageSection>

        <PageSection>
          {!syncState.isAuthenticated ? (
            <ActionBar
              actions={[
                {
                  id: 'authorize',
                  label: safeSyncCopy.authorizeGoogleDrive,
                  tone: 'primary',
                  disabled: busy,
                  onClick: handleAuthorizeGoogleDrive,
                },
                {
                  id: 'refresh',
                  label: t('syncRefreshStatus'),
                  tone: 'secondary',
                  disabled: busy,
                  onClick: () => void refreshChatGPTSyncState(),
                },
              ]}
            />
          ) : (
            <>
              <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
                {safeSyncCopy.firstUseGuidance}
              </p>
              <ActionBar
                actions={[
                  {
                    id: 'upload',
                    label: isUploading ? t('syncUploading') : t('syncUploadToCloud'),
                    tone: 'secondary',
                    disabled: busy,
                    onClick: handleSyncNow,
                  },
                  {
                    id: 'download',
                    label: downloadMode === 'merge' ? t('syncDownloading') : t('syncDownloadMerge'),
                    tone: 'primary',
                    disabled: busy,
                    onClick: () => handleDownloadFromDrive('merge'),
                  },
                  {
                    id: 'auth',
                    label: t('syncClearAuthReauth'),
                    tone: 'secondary',
                    disabled: busy,
                    onClick: handleSignOut,
                  },
                  {
                    id: 'refresh',
                    label: t('syncRefreshStatus'),
                    tone: 'secondary',
                    disabled: busy,
                    onClick: () => void refreshChatGPTSyncState(),
                  },
                ]}
              />
            </>
          )}
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
            {t('syncPrivacyNote')}
          </p>
          {statusMessage && (
            <p
              className={cn(
                'text-center',
                uiTokens.typography.caption,
                statusMessage.kind === 'err' ? 'text-destructive' : uiTokens.color.text,
              )}
            >
              {statusMessage.text}
            </p>
          )}
        </PageSection>
      </Panel>
    );
  }

  return (
    <Card className="p-4 transition-all hover:shadow-md">
      <CardTitle className="mb-4">{t('cloudSync')}</CardTitle>
      <CardContent className="space-y-4 p-0">
        {/* Description */}
        <p className="text-muted-foreground text-xs">{t('cloudSyncDescription')}</p>

        {/* Sync Mode Toggle */}
        <div>
          <Label className="mb-2 block text-sm font-medium">{t('syncMode')}</Label>
          <div className="bg-secondary/60 relative grid grid-cols-2 gap-1 rounded-xl p-1">
            <div
              className="bg-primary pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg shadow-sm transition-all duration-300 ease-out"
              style={{
                left: syncState.mode === 'disabled' ? '4px' : 'calc(50% + 2px)',
              }}
            />
            <button
              className={`relative z-10 rounded-lg px-2 py-2 text-xs font-bold transition-all duration-200 ${
                syncState.mode === 'disabled'
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleModeChange('disabled')}
            >
              {t('syncModeDisabled')}
            </button>
            <button
              className={`relative z-10 rounded-lg px-2 py-2 text-xs font-bold transition-all duration-200 ${
                syncState.mode === 'manual'
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleModeChange('manual')}
            >
              {t('syncModeManual')}
            </button>
          </div>
        </div>

        {/* Sync Actions - Only show if not disabled */}
        {syncState.mode !== 'disabled' && (
          <>
            {!syncState.isAuthenticated ? (
              <div className="grid gap-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleAuthorizeGoogleDrive}
                  disabled={isAuthorizing || isUploading || isDownloading || syncState.isSyncing}
                >
                  {safeSyncCopy.authorizeGoogleDrive}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">{safeSyncCopy.firstUseGuidance}</p>
            {/* Upload/Download Buttons */}
            <div className="grid gap-2">
              {/* Upload Button (Local → Drive) */}
              <Button
                variant="outline"
                size="sm"
                className="group hover:border-primary/50 w-full"
                onClick={handleSyncNow}
                disabled={isUploading || isDownloading}
              >
                <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                  {isUploading ? (
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                  )}
                  {t('syncUpload')}
                </span>
              </Button>

              <div className="grid grid-cols-2 gap-2">
                {/* Sync Button (Drive → Local) */}
                <Button
                  variant="outline"
                  size="sm"
                  className="group hover:border-primary/50"
                  onClick={() => handleDownloadFromDrive('merge')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                    {downloadMode === 'merge' ? (
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 4v6h6M23 20v-6h-6" />
                        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                      </svg>
                    )}
                    {t('syncMerge')}
                  </span>
                </Button>

                {/* Overwrite Button (Drive → Local, destructive) */}
                <Button
                  variant="outline"
                  size="sm"
                  className="group hover:border-destructive/50"
                  onClick={() => handleDownloadFromDrive('overwrite')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                    {downloadMode === 'overwrite' ? (
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 12h18" />
                        <path d="M12 3v18" />
                      </svg>
                    )}
                    {t('syncOverwrite')}
                  </span>
                </Button>
              </div>
            </div>

            {/* Platform Indicator & Sync Times */}
            <div className="text-muted-foreground space-y-0.5 text-center text-xs">
              <p className="text-foreground/70 font-medium">
                {platform === 'chatgpt'
                  ? 'ChatGPT以太'
                  : platform === 'aistudio'
                    ? '📊 AI Studio'
                    : '✨ Gemini'}
              </p>
              <p>
                ↑{' '}
                {formatLastUpload(
                  platform === 'chatgpt'
                    ? syncState.lastUploadTimeChatGPT
                    : platform === 'aistudio'
                      ? syncState.lastUploadTimeAIStudio
                      : syncState.lastUploadTime,
                )}
              </p>
              <p>
                ↓{' '}
                {formatLastSync(
                  platform === 'chatgpt'
                    ? syncState.lastSyncTimeChatGPT
                    : platform === 'aistudio'
                      ? syncState.lastSyncTimeAIStudio
                      : syncState.lastSyncTime,
                )}
              </p>
            </div>

            {/* Sign Out Button - Only show if authenticated */}
            {syncState.isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive w-full text-xs"
                onClick={handleSignOut}
              >
                {t('signOut')}
              </Button>
            )}
              </>
            )}
          </>
        )}

        {/* Status Message */}
        {statusMessage && (
          <p
            className={`text-center text-xs ${
              statusMessage.kind === 'ok' ? 'text-foreground' : 'text-destructive'
            }`}
          >
            {statusMessage.text}
          </p>
        )}

        {/* Error Display */}
        {syncState.error && !statusMessage && (
          <p className="text-destructive text-center text-xs">
            {t('syncError').replace('{error}', syncState.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
