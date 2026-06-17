import { chatgptAdapter, insertPromptIntoChatGPTInput } from '@/core/adapters/chatgptAdapter';
import { startChatGPTTimeContextInjection } from '@/core/services/ChatGPTTimeContextService';
import {
  hasValidExtensionContext,
  isExtensionContextInvalidatedError,
} from '@/core/utils/extensionContext';

import {
  getCapturedChatGPTTimelineNodes,
  hasCapturedChatGPTConversationData,
  requestCurrentChatGPTConversationCapture,
  startChatGPTConversationCapture,
} from './chatgptConversationCapture';
import { startChatGPTFloatingQuickAccess } from './floatingQuickAccess';
import {
  isChatGPTTimelineFloatingPanelVisible,
  scrollChatGPTTimelineToMessage,
  setChatGPTTimelineFloatingPanelVisible,
  startChatGPTTimelineFloatingPanel,
} from './timelineFloatingPanel';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
});

let chatgptTimeContextCleanup: (() => void) | null = null;
let chatgptStatusListenerRegistered = false;

type ChatGPTPageStatus = {
  isChatGPTPage: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  totalMessageCount: number;
};

function getChatGPTPageStatus(): ChatGPTPageStatus {
  const userMessageCount = chatgptAdapter.getUserMessageNodes().length;
  const assistantMessageCount = chatgptAdapter.getAssistantMessageNodes().length;

  return {
    isChatGPTPage: chatgptAdapter.isSupportedPage(),
    conversationId: chatgptAdapter.getConversationId(),
    conversationTitle: chatgptAdapter.getConversationTitle(),
    userMessageCount,
    assistantMessageCount,
    totalMessageCount: userMessageCount + assistantMessageCount,
  };
}

function summarizeChatGPTTimelineMessage(snippet: string): string {
  const normalized = String(snippet || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}

function getChatGPTTimelineSnapshot() {
  if (!chatgptAdapter.isSupportedPage()) {
    return {
      isChatGPTPage: false,
      nodes: [],
    };
  }

  const capturedNodes = getCapturedChatGPTTimelineNodes();
  requestCurrentChatGPTConversationCapture();
  if (capturedNodes.length > 0) {
    const userCount = capturedNodes.filter((node) => node.role === 'user').length;
    const assistantCount = capturedNodes.filter((node) => node.role === 'assistant').length;
    console.debug('[ChatGPT Ether Timeline] Popup 时间轴使用捕获数据', {
      total: capturedNodes.length,
      user: userCount,
      assistant: assistantCount,
      hasConversationData: true,
    });
    return {
      isChatGPTPage: true,
      nodes: capturedNodes,
      source: 'captured' as const,
      captured: true,
    };
  }

  const messageNodes = chatgptAdapter.getMessageNodes();
  const userCount = messageNodes.filter((node) => node.role === 'user').length;
  const assistantCount = messageNodes.filter((node) => node.role === 'assistant').length;
  console.debug('[ChatGPT Ether Timeline] Popup 时间轴扫描完成', {
    total: messageNodes.length,
    user: userCount,
    assistant: assistantCount,
  });

  return {
    isChatGPTPage: true,
    nodes: messageNodes.map((node, index) => ({
      index: index + 1,
      role: node.role,
      summary: summarizeChatGPTTimelineMessage(node.snippet),
      snippet: node.snippet,
      roleIndex: (node as { roleIndex?: number }).roleIndex,
      domIndexGlobal: (node as { domIndexGlobal?: number }).domIndexGlobal,
      turnId: (node as { turnId?: string }).turnId,
      messageAnchor: node.anchor,
      fingerprint: (node as { fingerprint?: string }).fingerprint,
      messageId: (node as { messageId?: string }).messageId,
      source: 'dom' as const,
    })),
    source: 'dom' as const,
    captured: hasCapturedChatGPTConversationData(),
  };
}

function registerChatGPTStatusListener(): void {
  if (chatgptStatusListenerRegistered) return;
  chatgptStatusListenerRegistered = true;

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'gv.chatgpt.getStatus' || message?.type === 'gv.page.getStatus') {
      sendResponse({ ok: true, data: getChatGPTPageStatus() });
      return false;
    }

    if (message?.type === 'gv.chatgpt.timeline.get') {
      sendResponse({ ok: true, data: getChatGPTTimelineSnapshot() });
      return false;
    }

    if (message?.type === 'gv.chatgpt.timeline.scroll') {
      const payload = message?.payload || {};
      const messageAnchor = typeof payload.messageAnchor === 'string' ? payload.messageAnchor : '';
      const locateRequest = {
        conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : '',
        role: payload.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        turnId: typeof payload.turnId === 'string' ? payload.turnId : undefined,
        messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
        messageAnchor,
        snippet: typeof payload.snippet === 'string' ? payload.snippet : undefined,
        fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : undefined,
        roleIndex: typeof payload.roleIndex === 'number' ? payload.roleIndex : undefined,
        domIndexGlobal:
          typeof payload.domIndexGlobal === 'number' ? payload.domIndexGlobal : undefined,
      };
      void scrollChatGPTTimelineToMessage(locateRequest)
        .then((scrolled) =>
          sendResponse({
            ok: true,
            scrolled,
            error: scrolled ? undefined : '未能自动定位收藏消息',
          }),
        )
        .catch(() => sendResponse({ ok: false, scrolled: false, error: '定位请求处理失败' }));
      return true;
    }

    if (message?.type === 'gv.chatgpt.timeline.visibility.get') {
      sendResponse({
        ok: true,
        data: {
          isChatGPTPage: chatgptAdapter.isSupportedPage(),
          visible: isChatGPTTimelineFloatingPanelVisible(),
        },
      });
      return false;
    }

    if (message?.type === 'gv.chatgpt.timeline.visibility.set') {
      const visible = message?.payload?.visible !== false;
      setChatGPTTimelineFloatingPanelVisible(visible)
        .then(() =>
          sendResponse({
            ok: true,
            data: { isChatGPTPage: chatgptAdapter.isSupportedPage(), visible },
          }),
        )
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === 'gv.chatgpt.insertPrompt') {
      const content = typeof message?.payload?.content === 'string' ? message.payload.content : '';
      console.debug('[ChatGPT Ether] insertPrompt message received', {
        contentLength: content.length,
        url: location.href,
      });
      if (!content.trim()) {
        sendResponse({ ok: false, error: 'Prompt 内容为空。' });
        return false;
      }

      try {
        const result = insertPromptIntoChatGPTInput(content);
        console.debug('[ChatGPT Ether] insertPrompt result', {
          ok: result.ok,
          method: result.method,
          error: result.error,
          debug: result.debug,
        });
        sendResponse(result);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '插入失败。',
          debug: {
            url: location.href,
            activeElement: document.activeElement?.tagName.toLowerCase() || null,
            contentLength: content.length,
          },
        });
      }
      return false;
    }

    return false;
  });
}

function initializeChatGPT(): void {
  registerChatGPTStatusListener();
  startChatGPTConversationCapture();
  startChatGPTTimelineFloatingPanel();
  startChatGPTFloatingQuickAccess();
  if (!chatgptTimeContextCleanup) {
    chatgptTimeContextCleanup = startChatGPTTimeContextInjection({
      getTimelineNodes: getCapturedChatGPTTimelineNodes,
    });
  }
  console.log('[ChatGPT Ether] ChatGPT page status detected:', getChatGPTPageStatus());
}

(function () {
  try {
    if (!hasValidExtensionContext()) return;

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionContextInvalidatedError(event.reason)) {
        event.preventDefault();
      }
    };
    const onWindowError = (event: ErrorEvent) => {
      if (isExtensionContextInvalidatedError(event.error ?? event.message)) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onWindowError);

    if (location.hostname.toLowerCase() === 'chatgpt.com') {
      initializeChatGPT();
    }

    window.addEventListener('beforeunload', () => {
      try {
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
        window.removeEventListener('error', onWindowError);
        if (chatgptTimeContextCleanup) {
          chatgptTimeContextCleanup();
          chatgptTimeContextCleanup = null;
        }
      } catch (e) {
        if (isExtensionContextInvalidatedError(e)) {
          return;
        }
        console.error('[ChatGPT Ether] Cleanup error:', e);
      }
    });
  } catch (e) {
    if (isExtensionContextInvalidatedError(e)) {
      return;
    }
    console.error('[ChatGPT Ether] Fatal initialization error:', e);
  }
})();
