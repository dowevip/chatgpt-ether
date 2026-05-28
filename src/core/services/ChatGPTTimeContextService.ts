import {
  chatgptAdapter,
  getChatGPTInputText,
  replaceChatGPTInputText,
} from '@/core/adapters/chatgptAdapter';
import type {
  ChatGPTTimeContextInjectionOptions,
  ChatGPTTimeContextInjectionResult,
} from '@/core/types/timeContext';
import type { ChatGPTTimelineNode } from '@/core/types/timeline';

const TIME_CONTEXT_PREFIX = '[时间上下文：';
const DEFAULT_TIME_CONTEXT_THRESHOLD_MS = 6 * 60 * 60 * 1000;

let cleanupTimeContextListeners: (() => void) | null = null;
const lastInjectedAtByConversation = new Map<string, number>();

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
}

function getLastInteractionAt(nodes: ChatGPTTimelineNode[]): number | null {
  let latest: number | null = null;

  for (const node of nodes) {
    if (node.role !== 'user' && node.role !== 'assistant') continue;
    const timestamp = normalizeTimestamp(node.createdAt);
    if (!timestamp) continue;
    if (!latest || timestamp > latest) latest = timestamp;
  }

  return latest;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatElapsed(elapsedMs: number): string {
  const days = Math.floor(elapsedMs / 86_400_000);
  if (days >= 1) return `${days} 天`;
  const hours = Math.max(1, Math.ceil(elapsedMs / 3_600_000));
  return `${hours} 小时`;
}

function buildTimeContext(elapsedMs: number): string {
  return `[时间上下文：今天是 ${formatLocalDate(
    new Date(),
  )}，距离本对话上次互动已过去 ${formatElapsed(elapsedMs)}。请基于此前对话继续回答。]`;
}

function getConversationKey(): string {
  return chatgptAdapter.getConversationId() || location.href;
}

function isLikelySendButton(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target.closest('button') : null;
  if (!element) return false;

  const testId = element.getAttribute('data-testid') || '';
  const ariaLabel = element.getAttribute('aria-label') || '';
  const text = element.textContent || '';

  return (
    /send/i.test(testId) ||
    /send|发送/i.test(ariaLabel) ||
    /send|发送/.test(text) ||
    element.id === 'composer-submit-button'
  );
}

function shouldIgnoreEnter(event: KeyboardEvent): boolean {
  return (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.isComposing ||
    event.defaultPrevented ||
    !(event.target instanceof HTMLElement)
  );
}

function isInsideChatGPTInput(target: EventTarget | null): boolean {
  const input = chatgptAdapter.getInputElement();
  return Boolean(input && target instanceof Node && input.contains(target));
}

export function injectChatGPTTimeContextIfNeeded(
  options: ChatGPTTimeContextInjectionOptions,
): ChatGPTTimeContextInjectionResult {
  if (!chatgptAdapter.isSupportedPage()) {
    return { injected: false, reason: 'not-chatgpt', lastInteractionAt: null, elapsedMs: null };
  }

  const input = chatgptAdapter.getInputElement();
  if (!input) {
    return { injected: false, reason: 'input-not-found', lastInteractionAt: null, elapsedMs: null };
  }

  const originalText = getChatGPTInputText(input).trim();
  if (!originalText) {
    return { injected: false, reason: 'empty-input', lastInteractionAt: null, elapsedMs: null };
  }

  if (originalText.startsWith(TIME_CONTEXT_PREFIX)) {
    return {
      injected: false,
      reason: 'already-has-context',
      lastInteractionAt: null,
      elapsedMs: null,
    };
  }

  const nodes = options.getTimelineNodes();
  const lastInteractionAt = getLastInteractionAt(nodes);
  if (!lastInteractionAt) {
    return { injected: false, reason: 'no-timestamp', lastInteractionAt: null, elapsedMs: null };
  }

  const now = Date.now();
  const elapsedMs = now - lastInteractionAt;
  if (elapsedMs <= DEFAULT_TIME_CONTEXT_THRESHOLD_MS) {
    return { injected: false, reason: 'below-threshold', lastInteractionAt, elapsedMs };
  }

  const conversationKey = getConversationKey();
  const lastInjectedAt = lastInjectedAtByConversation.get(conversationKey);
  if (lastInjectedAt && lastInteractionAt <= lastInjectedAt) {
    return { injected: false, reason: 'already-injected-for-gap', lastInteractionAt, elapsedMs };
  }

  const nextText = `${buildTimeContext(elapsedMs)}\n\n${originalText}`;
  const result = replaceChatGPTInputText(nextText);
  if (!result.ok) {
    return { injected: false, reason: result.error || 'insert-failed', lastInteractionAt, elapsedMs };
  }

  lastInjectedAtByConversation.set(conversationKey, now);
  console.debug('[ChatGPT Voyager] 时间上下文已注入', {
    conversationId: chatgptAdapter.getConversationId(),
    elapsedHours: Math.round(elapsedMs / 3_600_000),
    nodeCount: nodes.length,
  });

  return { injected: true, reason: 'injected', lastInteractionAt, elapsedMs };
}

export function startChatGPTTimeContextInjection(
  options: ChatGPTTimeContextInjectionOptions,
): () => void {
  cleanupTimeContextListeners?.();

  const handleClick = (event: MouseEvent) => {
    if (!isLikelySendButton(event.target)) return;
    injectChatGPTTimeContextIfNeeded(options);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (shouldIgnoreEnter(event)) return;
    if (!isInsideChatGPTInput(event.target)) return;
    injectChatGPTTimeContextIfNeeded(options);
  };

  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);

  cleanupTimeContextListeners = () => {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    cleanupTimeContextListeners = null;
  };

  return cleanupTimeContextListeners;
}
