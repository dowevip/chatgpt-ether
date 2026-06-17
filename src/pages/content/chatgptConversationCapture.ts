import type { ChatGPTTimelineNode } from '@/core/types/timeline';

type CapturedPayload = {
  conversationId: string | null;
  url: string;
  nodes: Array<{
    conversationId: string | null;
    turnId?: string;
    messageId?: string;
    parentId?: string | null;
    role: 'user' | 'assistant';
    summary: string;
    searchText?: string;
    fingerprint: string;
    createdAt?: number | null;
    order: number;
  }>;
};

let currentConversationId: string | null = null;
let capturedNodes: ChatGPTTimelineNode[] = [];
let capturedUrl = '';
let listenerStarted = false;
const PERFORMANCE_PREFIX = '[ChatGPT Ether Performance]';
const CHATGPT_CAPTURE_SOURCE = 'chatgpt-ether';

function performanceLog(label: string, startedAt: number, extra: Record<string, unknown> = {}): void {
  console.debug(PERFORMANCE_PREFIX, {
    label,
    durationMs: Math.round(performance.now() - startedAt),
    ...extra,
  });
}

function getConversationIdFromUrl(url = location.href): string | null {
  const match = url.match(/\/c\/([^/?#]+)/);
  return match?.[1] || null;
}

function normalizeConversationState(): void {
  const nextConversationId = getConversationIdFromUrl();
  if (nextConversationId === currentConversationId) return;
  currentConversationId = nextConversationId;
  capturedNodes = [];
  capturedUrl = location.href;
}

function toTimelineNodes(payload: CapturedPayload): ChatGPTTimelineNode[] {
  const startedAt = performance.now();
  const sorted = [...payload.nodes].sort((left, right) => {
    const leftTime = typeof left.createdAt === 'number' ? left.createdAt : Number.POSITIVE_INFINITY;
    const rightTime =
      typeof right.createdAt === 'number' ? right.createdAt : Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.order - right.order;
  });

  const nextNodes = sorted.map((node, index) => ({
    index: index + 1,
    role: node.role,
    summary: node.summary,
    searchText: node.searchText,
    turnId: node.turnId || node.messageId,
    messageAnchor: `chatgpt-captured:${node.role}:${node.messageId || 'no-message-id'}:${node.fingerprint}`,
    messageId: node.messageId,
    parentId: node.parentId ?? null,
    createdAt: node.createdAt ?? null,
    fingerprint: node.fingerprint,
    source: 'captured',
  }));
  performanceLog('conversation 捕获入内存耗时', startedAt, {
    total: nextNodes.length,
    user: nextNodes.filter((node) => node.role === 'user').length,
    assistant: nextNodes.filter((node) => node.role === 'assistant').length,
  });
  return nextNodes;
}

export function startChatGPTConversationCapture(): void {
  if (listenerStarted) return;
  listenerStarted = true;
  currentConversationId = getConversationIdFromUrl();
  capturedUrl = location.href;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { type?: string; source?: string; payload?: CapturedPayload };
    if (
      data?.type !== 'cg-voyager-chatgpt-conversation-captured' ||
      data.source !== CHATGPT_CAPTURE_SOURCE ||
      !data.payload
    ) {
      return;
    }

    normalizeConversationState();
    const payloadConversationId =
      data.payload.conversationId || getConversationIdFromUrl(data.payload.url);
    if (
      payloadConversationId &&
      currentConversationId &&
      payloadConversationId !== currentConversationId
    ) {
      return;
    }

    const nextNodes = toTimelineNodes(data.payload);
    if (nextNodes.length === 0) return;
    capturedNodes = nextNodes;
    capturedUrl = data.payload.url;
    window.dispatchEvent(new CustomEvent('cg-voyager-chatgpt-conversation-captured'));
  });

  window.setInterval(normalizeConversationState, 1000);
}

export function requestCurrentChatGPTConversationCapture(): void {
  window.postMessage(
    {
      type: 'cg-voyager-chatgpt-fetch-current-conversation',
      source: CHATGPT_CAPTURE_SOURCE,
    },
    window.location.origin,
  );
}

export function getCapturedChatGPTTimelineNodes(): ChatGPTTimelineNode[] {
  normalizeConversationState();
  return capturedNodes;
}

export function hasCapturedChatGPTConversationData(): boolean {
  normalizeConversationState();
  return capturedNodes.length > 0;
}

export function getCapturedChatGPTConversationDebug(): {
  count: number;
  url: string;
  conversationId: string | null;
} {
  normalizeConversationState();
  return {
    count: capturedNodes.length,
    url: capturedUrl,
    conversationId: currentConversationId,
  };
}
