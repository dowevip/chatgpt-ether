import React, { useCallback, useEffect, useState } from 'react';

import type { SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { ActionBar, ListView, PageSection, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';
import { cn } from '@/lib/utils';

import { useLanguage } from '../../../contexts/LanguageContext';

type CloudSyncSettingsProps = {
  chatgptOnly?: boolean;
  onBack?: () => void;
};

type DownloadMode = 'merge' | 'overwrite';

export function CloudSyncSettings({ onBack }: CloudSyncSettingsProps = {}) {
  const { t, language } = useLanguage();
  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE);
  const [statusMessage, setStatusMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadMode, setDownloadMode] = useState<DownloadMode | null>(null);

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
  };

  const refreshChatGPTSyncState = useCallback(async () => {
    setIsRefreshing(true);
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
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void refreshChatGPTSyncState();
  }, [refreshChatGPTSyncState]);

  useEffect(() => {
    if (!statusMessage) return undefined;
    const timer = setTimeout(() => setStatusMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const formatChatGPTTime = useCallback(
    (timestamp: number | null): string => {
      if (!timestamp) return t('never');
      return new Date(timestamp).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [t],
  );

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

  const handleSignOut = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({ type: 'gv.sync.signOut' })) as
        | { ok?: boolean; state?: SyncState; error?: string }
        | undefined;

      if (response?.state) setSyncState(response.state);
      setStatusMessage({
        text: response?.ok ? t('syncAuthCacheCleared') : response?.error || t('syncClearAuthFailed'),
        kind: response?.ok ? 'ok' : 'err',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('unknownError');
      setStatusMessage({
        text: t('syncClearAuthFailed').replace('{error}', message),
        kind: 'err',
      });
    }
  }, [t]);

  const handleSyncNow = useCallback(async () => {
    if (!syncState.isAuthenticated) return;

    setStatusMessage(null);
    setIsUploading(true);

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'gv.chatgpt.sync.upload',
        payload: { interactive: true },
      })) as { ok?: boolean; error?: string; state?: SyncState } | undefined;

      if (response?.state) setSyncState(response.state);
      if (!response?.ok) {
        throw new Error(response?.error || response?.state?.error || t('syncUploadFailed'));
      }
      setStatusMessage({ text: t('syncUploadSuccess'), kind: 'ok' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      setStatusMessage({ text: t('syncError').replace('{error}', errorMessage), kind: 'err' });
    } finally {
      setIsUploading(false);
    }
  }, [syncState.isAuthenticated, t]);

  const handleDownloadFromDrive = useCallback(
    async (mode: DownloadMode) => {
      if (!syncState.isAuthenticated) return;

      setStatusMessage(null);
      setIsDownloading(true);
      setDownloadMode(mode);

      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'gv.chatgpt.sync.download',
          payload: { interactive: true, mode },
        })) as { ok?: boolean; error?: string; state?: SyncState } | undefined;

        if (response?.state) setSyncState(response.state);
        if (!response?.ok) {
          throw new Error(response?.error || response?.state?.error || t('syncDownloadFailed'));
        }
        setStatusMessage({
          text: mode === 'overwrite' ? t('syncOverwriteSuccess') : t('syncDownloadMergeSuccess'),
          kind: 'ok',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('unknownError');
        setStatusMessage({ text: t('syncError').replace('{error}', errorMessage), kind: 'err' });
      } finally {
        setIsDownloading(false);
        setDownloadMode(null);
      }
    },
    [syncState.isAuthenticated, t],
  );

  const isSyncingNow =
    isAuthorizing || isUploading || isDownloading || isRefreshing || syncState.isSyncing;
  const busy = isSyncingNow;

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
              meta: isSyncingNow ? t('yes') : t('no'),
            },
            {
              id: 'last-upload',
              title: <span className={uiTokens.color.textMuted}>{t('syncLastUploadTime')}</span>,
              meta: formatChatGPTTime(
                syncState.cloudUploadTimeChatGPT ?? syncState.lastUploadTimeChatGPT,
              ),
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
