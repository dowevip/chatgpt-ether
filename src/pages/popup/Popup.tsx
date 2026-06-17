import React, { useCallback, useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  getChatGPTPageTimelineVisibility,
  setChatGPTPageTimelineVisibility,
} from '@/core/services/ChatGPTTimelineService';
import { cn } from '@/lib/utils';
import { ListView, PageSection, Panel } from '@/ui/components';
import { uiTokens } from '@/ui/tokens';

import { DarkModeToggle } from '../../components/DarkModeToggle';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button } from '../../components/ui/button';
import { useLanguage } from '../../contexts/LanguageContext';
import { CloudSyncSettings } from './components/CloudSyncSettings';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { FoldersPanel } from './components/FoldersPanel';
import { PromptVaultPanel } from './components/PromptVaultPanel';
import { StarredPanel } from './components/StarredPanel';

type ChatGPTPageStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  totalMessageCount: number;
};

type ChatGPTDashboardState = {
  loading: boolean;
  checked: boolean;
  status: ChatGPTPageStatus | null;
  error: string | null;
};

type PopupPanel = 'dashboard' | 'promptVault' | 'folders' | 'starred' | 'sync' | 'diagnostics';

const EMPTY_CHATGPT_DASHBOARD_STATE: ChatGPTDashboardState = {
  loading: false,
  checked: false,
  status: null,
  error: null,
};

const PANEL_QUERY_MAP: Record<string, PopupPanel> = {
  promptVault: 'promptVault',
  folders: 'folders',
  starred: 'starred',
  sync: 'sync',
  diagnostics: 'diagnostics',
};

export function Popup() {
  const { t, language, setLanguage } = useLanguage();
  const [activePanel, setActivePanel] = useState<PopupPanel>(() => {
    const panel = new URLSearchParams(window.location.search).get('panel') ?? '';
    return PANEL_QUERY_MAP[panel] ?? 'dashboard';
  });
  const [chatgptDashboard, setChatgptDashboard] = useState<ChatGPTDashboardState>(
    EMPTY_CHATGPT_DASHBOARD_STATE,
  );
  const [pageTimelineVisible, setPageTimelineVisible] = useState(true);
  const [pageTimelineMessage, setPageTimelineMessage] = useState<string | null>(null);

  const chatgptStatus = chatgptDashboard.status;

  const refreshChatGPTDashboard = useCallback(async () => {
    setChatgptDashboard((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;

      if (!tabId) {
        setChatgptDashboard({
          loading: false,
          checked: true,
          status: null,
          error: t('cgStatusNotChatGPT'),
        });
        return;
      }

      const response = (await browser.tabs.sendMessage(tabId, {
        type: 'gv.chatgpt.getStatus',
      })) as { ok?: boolean; data?: ChatGPTPageStatus } | undefined;

      setChatgptDashboard({
        loading: false,
        checked: true,
        status: response?.ok && response.data?.isChatGPTPage ? response.data : null,
        error: null,
      });
    } catch {
      setChatgptDashboard({
        loading: false,
        checked: true,
        status: null,
        error: null,
      });
    }
  }, [t]);

  const refreshPageTimelineVisibility = useCallback(async () => {
    try {
      const visibility = await getChatGPTPageTimelineVisibility();
      setPageTimelineVisible(visibility.visible);
      setPageTimelineMessage(visibility.isChatGPTPage ? null : t('cgStatusNotChatGPT'));
    } catch {
      setPageTimelineMessage(t('cgStatusNotChatGPT'));
    }
  }, [t]);

  const handleTogglePageTimeline = useCallback(async () => {
    if (!chatgptStatus?.isChatGPTPage) {
      setPageTimelineMessage(t('cgStatusNotChatGPT'));
      return;
    }

    try {
      const next = await setChatGPTPageTimelineVisibility(!pageTimelineVisible);
      setPageTimelineVisible(next.visible);
      setPageTimelineMessage(next.isChatGPTPage ? null : t('cgStatusNotChatGPT'));
    } catch {
      setPageTimelineMessage(t('cgTimelineToggleFailed'));
    }
  }, [chatgptStatus?.isChatGPTPage, pageTimelineVisible, t]);

  useEffect(() => {
    if (language !== 'zh' && language !== 'en') {
      void setLanguage('en');
    }
  }, [language, setLanguage]);

  useEffect(() => {
    void refreshChatGPTDashboard();
    void refreshPageTimelineVisibility();
  }, [refreshChatGPTDashboard, refreshPageTimelineVisibility]);

  const dashboardEntryActions = useMemo(
    () => [
      {
        id: 'promptVault',
        label: t('cgEntryPromptVault'),
        disabled: false,
        onClick: () => setActivePanel('promptVault'),
      },
      {
        id: 'folders',
        label: t('cgEntryFolders'),
        disabled: false,
        onClick: () => setActivePanel('folders'),
      },
      {
        id: 'timeline',
        label: pageTimelineVisible ? t('cgHidePageTimeline') : t('cgShowPageTimeline'),
        disabled: !chatgptStatus?.isChatGPTPage,
        onClick: () => void handleTogglePageTimeline(),
      },
      {
        id: 'starred',
        label: t('cgEntryStarred'),
        disabled: false,
        onClick: () => setActivePanel('starred'),
      },
      {
        id: 'sync',
        label: t('cgEntrySync'),
        disabled: false,
        onClick: () => setActivePanel('sync'),
      },
      {
        id: 'diagnostics',
        label: t('cgEntryDiagnostics'),
        disabled: false,
        onClick: () => setActivePanel('diagnostics'),
      },
    ],
    [chatgptStatus?.isChatGPTPage, handleTogglePageTimeline, pageTimelineVisible, t],
  );

  if (activePanel === 'promptVault') {
    return <PromptVaultPanel onBack={() => setActivePanel('dashboard')} />;
  }

  if (activePanel === 'folders') {
    return (
      <FoldersPanel currentStatus={chatgptStatus} onBack={() => setActivePanel('dashboard')} />
    );
  }

  if (activePanel === 'starred') {
    return <StarredPanel onBack={() => setActivePanel('dashboard')} />;
  }

  if (activePanel === 'sync') {
    return <CloudSyncSettings chatgptOnly onBack={() => setActivePanel('dashboard')} />;
  }

  if (activePanel === 'diagnostics') {
    return <DiagnosticsPanel onBack={() => setActivePanel('dashboard')} />;
  }

  return (
    <Panel
      title={t('extName')}
      headerAccessory={
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <DarkModeToggle />
        </div>
      }
    >
      <PageSection
        title={t('cgHomeTitle')}
        actions={[
          {
            id: 'refresh',
            label: t('cgRefreshCurrentConversation'),
            tone: 'primary',
            disabled: chatgptDashboard.loading,
            onClick: () => void refreshChatGPTDashboard(),
          },
        ]}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{t('cgCurrentPageStatus')}</p>
            <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
              {chatgptDashboard.loading
                ? t('cgReadingCurrentTab')
                : chatgptStatus?.isChatGPTPage
                  ? t('cgStatusRecognized')
                  : t('cgStatusNotChatGPT')}
            </p>
          </div>
        </div>

        {chatgptDashboard.error && (
          <p className={cn(uiTokens.color.textDanger, uiTokens.typography.caption)}>
            {chatgptDashboard.error}
          </p>
        )}

        <ListView
          variant="divided"
          emptyText="-"
          items={[
            {
              id: 'is-chatgpt',
              title: <span className={uiTokens.color.textMuted}>{t('cgIsChatGPTPage')}</span>,
              meta: chatgptStatus?.isChatGPTPage ? t('yes') : t('no'),
            },
            {
              id: 'conversation-id',
              title: <span className={uiTokens.color.textMuted}>{t('cgConversationId')}</span>,
              meta: (
                <span className={cn('max-w-[180px] truncate', uiTokens.typography.mono)}>
                  {chatgptStatus?.conversationId || '-'}
                </span>
              ),
            },
            {
              id: 'conversation-title',
              title: <span className={uiTokens.color.textMuted}>{t('cgConversationTitle')}</span>,
              meta: chatgptStatus?.conversationTitle || '-',
            },
            {
              id: 'user-count',
              title: <span className={uiTokens.color.textMuted}>{t('cgUserMessageCount')}</span>,
              meta: chatgptStatus?.userMessageCount ?? '-',
            },
            {
              id: 'assistant-count',
              title: (
                <span className={uiTokens.color.textMuted}>{t('cgAssistantMessageCount')}</span>
              ),
              meta: chatgptStatus?.assistantMessageCount ?? '-',
            },
            {
              id: 'total-count',
              title: <span className={uiTokens.color.textMuted}>{t('cgTotalMessageCount')}</span>,
              meta: chatgptStatus?.totalMessageCount ?? '-',
            },
          ]}
        />

        <div className="grid grid-cols-2 gap-2">
          {dashboardEntryActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              disabled={action.disabled}
              onClick={action.onClick}
              className="h-9 justify-center px-3 text-[13px]"
            >
              {action.label}
            </Button>
          ))}
        </div>

        {pageTimelineMessage && (
          <p className={cn(uiTokens.color.textMuted, uiTokens.typography.caption)}>
            {pageTimelineMessage}
          </p>
        )}
      </PageSection>
    </Panel>
  );
}

export default Popup;
