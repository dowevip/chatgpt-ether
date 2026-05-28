import { hashString } from '@/core/utils/hash';

import type { ConversationInfo, MessageNodeRef, MessageRole, PageAdapter } from './types';

const CHATGPT_HOSTS = new Set(['chatgpt.com']);

const CHATGPT_TURN_SELECTORS = [
  'article[data-testid^="conversation-turn-"]',
  '[data-testid^="conversation-turn-"]',
  '[data-testid*="conversation-turn"]',
  '[data-testid*="message"]',
  '[data-message-author-role="user"]',
  '[data-message-author-role="assistant"]',
  '[data-message-author-role]',
  '.markdown',
  '.prose',
  'article',
];

const CHATGPT_TITLE_SELECTORS = [
  '[data-testid="conversation-title"]',
  '[aria-label="Conversation title"]',
  '[data-testid="chat-title"]',
];

const CHATGPT_INPUT_SELECTORS = [
  'textarea#prompt-textarea',
  'textarea[data-testid="prompt-textarea"]',
  '#prompt-textarea[contenteditable="true"]',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
  '[role="textbox"][contenteditable="true"]',
  '[contenteditable="true"].ProseMirror',
  'div[contenteditable="true"]',
  '[role="textbox"]',
];

const CHATGPT_MESSAGE_ANCHOR_ATTR = 'data-cg-voyager-anchor';
const CHATGPT_MESSAGE_ID_ATTR = 'data-cg-voyager-message-id';
const CHATGPT_MESSAGE_FINGERPRINT_ATTR = 'data-cg-voyager-fingerprint';
const CHATGPT_MESSAGE_INDEX_ATTR = 'data-cg-voyager-index';

type ChatGPTInsertMethod = 'textarea' | 'contenteditable' | 'fallback';

export type ChatGPTInsertPromptResult = {
  ok: boolean;
  method?: ChatGPTInsertMethod;
  message?: string;
  error?: string;
  debug?: {
    url: string;
    candidateCount: number;
    activeElement: string | null;
    inputTag?: string;
    inputId?: string;
    inputRole?: string | null;
    inputContentEditable?: string;
    contentLength: number;
  };
};

export type ChatGPTTimelineTarget = {
  index?: number;
  messageAnchor: string;
  messageId?: string;
  fingerprint?: string;
  summary?: string;
};

export type ChatGPTDomUserMessageIndexEntry = {
  element: HTMLElement;
  anchor: string;
  messageId?: string;
  fingerprint: string;
  index: number;
  normalizedText: string;
  snippet: string;
};

export type ChatGPTScrollContainerInfo = {
  element: HTMLElement;
  debug: {
    tagName: string;
    className: string;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  };
};

export type ChatGPTLocateResult = {
  found: boolean;
  method?: 'messageId' | 'anchor' | 'fingerprint' | 'text' | 'index';
  element?: HTMLElement;
  domIndexCount: number;
  matchedCount: number;
};

function getCurrentUrl(): string {
  return typeof location === 'undefined' ? '' : location.href;
}

function getCurrentHostname(): string {
  return typeof location === 'undefined' ? '' : location.hostname.toLowerCase();
}

function getSafeDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

function normalizeSnippet(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function normalizeMessageText(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classNameSummary(element: Element | null): string {
  if (!element || typeof element.className !== 'string') return '';
  return element.className.trim().split(/\s+/).slice(0, 4).join(' ');
}

function extractConversationIdFromChatGPTUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/c\/([^/?#]+)/);
    return match?.[1] || null;
  } catch {
    const match = String(input || '').match(/\/c\/([^/?#]+)/);
    return match?.[1] || null;
  }
}

function stripChatGPTTitleSuffix(title: string): string {
  return title
    .replace(/\s*[-|]\s*ChatGPT\s*$/i, '')
    .replace(/^ChatGPT\s*[-|]\s*/i, '')
    .trim();
}

function isUsableConversationTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;

  return !['chatgpt', 'chattrail', 'chatgpt voyager', 'chatgpt voyager 自用版'].includes(
    normalized,
  );
}

function queryFirst(selectors: string[]): HTMLElement | null {
  const doc = getSafeDocument();
  if (!doc) return null;

  for (const selector of selectors) {
    try {
      const found = doc.querySelector<HTMLElement>(selector);
      if (found) return found;
    } catch {}
  }

  return null;
}

function describeElement(element: Element | null): string | null {
  if (!element) return null;
  const id = element.id ? `#${element.id}` : '';
  const className =
    typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : '';
  return `${element.tagName.toLowerCase()}${id}${className}`;
}

function getInputCandidates(): HTMLElement[] {
  const doc = getSafeDocument();
  if (!doc) return [];

  const candidates: HTMLElement[] = [];
  for (const selector of CHATGPT_INPUT_SELECTORS) {
    try {
      candidates.push(...Array.from(doc.querySelectorAll<HTMLElement>(selector)));
    } catch {}
  }

  return uniqueElements(candidates).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      style.display === 'none' ||
      style.visibility === 'hidden'
    ) {
      return false;
    }

    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
    if (element.isContentEditable) return element.getAttribute('aria-disabled') !== 'true';
    return false;
  });
}

function buildInsertDebug(
  content: string,
  input?: HTMLElement | null,
): ChatGPTInsertPromptResult['debug'] {
  return {
    url: getCurrentUrl(),
    candidateCount: getInputCandidates().length,
    activeElement: describeElement(getSafeDocument()?.activeElement ?? null),
    inputTag: input?.tagName.toLowerCase(),
    inputId: input?.id,
    inputRole: input?.getAttribute('role'),
    inputContentEditable: input?.getAttribute('contenteditable') ?? undefined,
    contentLength: content.length,
  };
}

function dispatchInputEvents(element: HTMLElement, content: string): void {
  const inputEvents: Array<Event | InputEvent> = [];

  try {
    inputEvents.push(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: content,
        inputType: 'insertText',
      }),
    );
  } catch {
    inputEvents.push(new Event('beforeinput', { bubbles: true, cancelable: true }));
  }

  try {
    inputEvents.push(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: content,
        inputType: 'insertText',
      }),
    );
  } catch {
    inputEvents.push(new Event('input', { bubbles: true, cancelable: true }));
  }

  inputEvents.push(new Event('change', { bubbles: true, cancelable: true }));

  for (const event of inputEvents) {
    try {
      element.dispatchEvent(event);
    } catch {}
  }
}

function setTextAreaValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.value = value;
}

export function insertPromptIntoChatGPTInput(content: string): ChatGPTInsertPromptResult {
  console.debug('[ChatGPT Voyager] insertPrompt requested', { contentLength: content.length });

  if (!chatgptAdapter.isSupportedPage()) {
    return {
      ok: false,
      error: '当前页面不是 ChatGPT。',
      debug: buildInsertDebug(content),
    };
  }

  const input = chatgptAdapter.getInputElement();
  if (!input) {
    return {
      ok: false,
      error: '没有找到 ChatGPT 输入框。',
      debug: buildInsertDebug(content),
    };
  }

  input.focus();

  if (input instanceof HTMLTextAreaElement) {
    setTextAreaValue(input, content);
    input.setSelectionRange(content.length, content.length);
    dispatchInputEvents(input, content);
    return {
      ok: true,
      method: 'textarea',
      message: 'Prompt inserted into textarea.',
      debug: buildInsertDebug(content, input),
    };
  }

  if (input.isContentEditable) {
    let method: ChatGPTInsertMethod = 'contenteditable';
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = document.execCommand('insertText', false, content);
      if (!inserted) {
        method = 'fallback';
        input.textContent = content;
      }
    } catch (error) {
      method = 'fallback';
      console.debug('[ChatGPT Voyager] contenteditable insertText fallback', {
        contentLength: content.length,
        error,
      });
      input.textContent = content;
    }

    dispatchInputEvents(input, content);

    const insertedText = input.textContent || '';
    if (!insertedText.trim()) {
      return {
        ok: false,
        error: '插入后输入框仍为空。',
        debug: buildInsertDebug(content, input),
      };
    }

    return {
      ok: true,
      method,
      message: 'Prompt inserted into contenteditable input.',
      debug: buildInsertDebug(content, input),
    };
  }

  return {
    ok: false,
    error: 'ChatGPT 输入框暂不支持写入。',
    debug: buildInsertDebug(content, input),
  };
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(elements));
}

function uniqueMessageElements(elements: HTMLElement[]): HTMLElement[] {
  const unique = uniqueElements(elements);
  return unique.filter((element, index) => {
    const duplicateContainer = unique.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other !== element &&
        other.contains(element) &&
        getRoleFromElement(other) === getRoleFromElement(element),
    );
    return !duplicateContainer;
  });
}

function closestArticleOrSelf(element: HTMLElement): HTMLElement {
  return (
    element.closest<HTMLElement>('article[data-testid^="conversation-turn-"]') ||
    element.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ||
    element.closest<HTMLElement>('article') ||
    element.closest<HTMLElement>('[data-message-author-role]') ||
    element
  );
}

function getRoleFromElement(element: HTMLElement): MessageRole | null {
  const closestAuthor = element.closest<HTMLElement>('[data-message-author-role]');
  const authorRole =
    element.getAttribute('data-message-author-role') ||
    closestAuthor?.getAttribute('data-message-author-role') ||
    element
      .querySelector<HTMLElement>('[data-message-author-role]')
      ?.getAttribute('data-message-author-role');

  if (authorRole === 'user') return 'user';
  if (authorRole === 'assistant') return 'assistant';

  const testId = (
    element.getAttribute('data-testid') ||
    element.querySelector<HTMLElement>('[data-testid]')?.getAttribute('data-testid') ||
    ''
  ).toLowerCase();

  if (testId.includes('user')) return 'user';
  if (testId.includes('assistant')) return 'assistant';

  const aria = (
    element.getAttribute('aria-label') ||
    element.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label') ||
    ''
  ).toLowerCase();

  if (aria.includes('user') || aria.includes('you')) return 'user';
  if (aria.includes('assistant') || aria.includes('chatgpt')) return 'assistant';

  return null;
}

function getTurnElementsByRole(role: MessageRole): HTMLElement[] {
  const doc = getSafeDocument();
  if (!doc) return [];

  const matches: HTMLElement[] = [];

  for (const selector of CHATGPT_TURN_SELECTORS) {
    try {
      for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
        const resolvedRole = getRoleFromElement(element);
        if (resolvedRole === role) matches.push(closestArticleOrSelf(element));
      }
    } catch {}
  }

  return uniqueMessageElements(matches).filter((element) => normalizeSnippet(element.textContent));
}

function sortByDocumentPosition(nodes: MessageNodeRef[]): MessageNodeRef[] {
  return [...nodes].sort((left, right) => {
    if (left.element === right.element) return 0;
    const position = left.element.compareDocumentPosition(right.element);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function findMessageElementByAnchor(anchor: string): HTMLElement | null {
  const doc = getSafeDocument();
  if (!doc) return null;

  return (
    Array.from(doc.querySelectorAll<HTMLElement>(`[${CHATGPT_MESSAGE_ANCHOR_ATTR}]`)).find(
      (element) => element.getAttribute(CHATGPT_MESSAGE_ANCHOR_ATTR) === anchor,
    ) || null
  );
}

function findMessageElementByAttribute(attribute: string, value: string): HTMLElement | null {
  const doc = getSafeDocument();
  if (!doc || !value) return null;

  return (
    Array.from(doc.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === value,
    ) || null
  );
}

function getMessageIdFromElement(element: HTMLElement): string | undefined {
  return (
    element.getAttribute(CHATGPT_MESSAGE_ID_ATTR) ||
    element.getAttribute('data-message-id') ||
    element.getAttribute('data-turn-id') ||
    element.querySelector<HTMLElement>('[data-message-id]')?.getAttribute('data-message-id') ||
    element.querySelector<HTMLElement>('[data-turn-id]')?.getAttribute('data-turn-id') ||
    undefined
  );
}

function fingerprintText(text: string): string {
  const normalized = normalizeMessageText(text).slice(0, 160).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseCapturedAnchor(anchor: string): { messageId?: string; fingerprint?: string } {
  if (!anchor.startsWith('chatgpt-captured:')) return {};
  const [, messageId, fingerprint] = anchor.split(':');
  return {
    messageId: messageId && messageId !== 'no-message-id' ? messageId : undefined,
    fingerprint,
  };
}

function getCapturedNodeLookup(capturedNodes: ChatGPTTimelineTarget[] = []): {
  byFingerprint: Map<string, ChatGPTTimelineTarget>;
  byMessageId: Map<string, ChatGPTTimelineTarget>;
} {
  const byFingerprint = new Map<string, ChatGPTTimelineTarget>();
  const byMessageId = new Map<string, ChatGPTTimelineTarget>();

  for (const node of capturedNodes) {
    if (node.fingerprint) byFingerprint.set(node.fingerprint, node);
    if (node.messageId) byMessageId.set(node.messageId, node);
  }

  return { byFingerprint, byMessageId };
}

export function indexChatGPTUserMessageDom(
  capturedNodes: ChatGPTTimelineTarget[] = [],
): ChatGPTDomUserMessageIndexEntry[] {
  const { byFingerprint, byMessageId } = getCapturedNodeLookup(capturedNodes);
  const entries = sortByDocumentPosition(
    getTurnElementsByRole('user').map((element, index) => ({
      element,
      role: 'user' as const,
      anchor: '',
      snippet: normalizeSnippet(element.textContent),
      index,
    })),
  );

  const indexed = entries
    .map((node, index) => {
      const normalizedText = normalizeMessageText(node.element.textContent);
      const fingerprint = fingerprintText(normalizedText);
      const messageId = getMessageIdFromElement(node.element);
      const captured =
        (messageId ? byMessageId.get(messageId) : undefined) || byFingerprint.get(fingerprint);
      const anchor =
        captured?.messageAnchor || node.element.getAttribute(CHATGPT_MESSAGE_ANCHOR_ATTR) || '';
      const finalAnchor =
        anchor || `chatgpt:user:${hashString(messageId || fingerprint || String(index))}:${index}`;
      const finalMessageId = messageId || captured?.messageId;

      node.element.setAttribute(CHATGPT_MESSAGE_INDEX_ATTR, String(index + 1));
      node.element.setAttribute(CHATGPT_MESSAGE_FINGERPRINT_ATTR, fingerprint);
      node.element.setAttribute(CHATGPT_MESSAGE_ANCHOR_ATTR, finalAnchor);
      if (finalMessageId) node.element.setAttribute(CHATGPT_MESSAGE_ID_ATTR, finalMessageId);

      return {
        element: node.element,
        anchor: finalAnchor,
        messageId: finalMessageId,
        fingerprint,
        index: index + 1,
        normalizedText,
        snippet: normalizeSnippet(normalizedText),
      };
    })
    .filter((entry) => entry.normalizedText);

  console.debug('[ChatGPT Voyager] DOM 用户消息索引完成', {
    domUserMessages: indexed.length,
    matched: indexed.filter((entry) => entry.messageId || byFingerprint.has(entry.fingerprint))
      .length,
  });

  return indexed;
}

function isScrollableElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  return (
    (overflowY === 'auto' || overflowY === 'scroll') &&
    element.scrollHeight > element.clientHeight + 24
  );
}

function getScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let parent = element.parentElement;
  while (parent && parent !== document.body.parentElement) {
    if (isScrollableElement(parent)) ancestors.push(parent);
    parent = parent.parentElement;
  }
  return ancestors;
}

function scrollContainerDebug(element: HTMLElement): ChatGPTScrollContainerInfo['debug'] {
  return {
    tagName: element.tagName.toLowerCase(),
    className: classNameSummary(element),
    scrollTop: Math.round(element.scrollTop),
    scrollHeight: Math.round(element.scrollHeight),
    clientHeight: Math.round(element.clientHeight),
  };
}

export function getChatGPTMainScrollContainer(
  entries: ChatGPTDomUserMessageIndexEntry[] = indexChatGPTUserMessageDom(),
): ChatGPTScrollContainerInfo {
  const doc = getSafeDocument();
  const candidates: HTMLElement[] = [];
  const scrollingElement = doc?.scrollingElement;
  if (scrollingElement instanceof HTMLElement) candidates.push(scrollingElement);

  for (const selector of ['main', '[role="main"]']) {
    try {
      candidates.push(...Array.from(document.querySelectorAll<HTMLElement>(selector)));
    } catch {}
  }

  for (const entry of entries) {
    candidates.push(...getScrollableAncestors(entry.element));
  }

  try {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (isScrollableElement(element)) candidates.push(element);
    }
  } catch {}

  const uniqueCandidates = uniqueElements(candidates).filter((candidate) => {
    if (candidate.scrollHeight <= candidate.clientHeight + 24) return false;
    if (entries.length === 0) return true;
    return entries.some(
      (entry) => candidate === entry.element || candidate.contains(entry.element),
    );
  });

  const element =
    uniqueCandidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0] ||
    (scrollingElement instanceof HTMLElement ? scrollingElement : document.documentElement);
  const debug = scrollContainerDebug(element);
  console.debug('[ChatGPT Voyager] 时间轴滚动容器', debug);
  return { element, debug };
}

export function getChatGPTScrollMetrics(container: ChatGPTScrollContainerInfo): {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  atTop: boolean;
  atBottom: boolean;
} {
  const { element } = container;
  const scrollTop = element.scrollTop;
  const scrollHeight = element.scrollHeight;
  const clientHeight = element.clientHeight || window.innerHeight;
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    atTop: scrollTop <= 2,
    atBottom: scrollTop + clientHeight >= scrollHeight - 2,
  };
}

export function scrollChatGPTContainerBy(
  container: ChatGPTScrollContainerInfo,
  delta: number,
): void {
  container.element.scrollBy({ top: delta, behavior: 'auto' });
}

export function scrollChatGPTContainerToTop(container: ChatGPTScrollContainerInfo): void {
  container.element.scrollTo({ top: 0, behavior: 'auto' });
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(
    left
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
  const rightTokens = new Set(
    right
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function targetText(target: ChatGPTTimelineTarget): string {
  return normalizeMessageText(target.summary || '').replace(/\.\.\.$/, '');
}

export function locateChatGPTUserTimelineTarget(
  target: ChatGPTTimelineTarget,
  capturedNodes: ChatGPTTimelineTarget[] = [],
): ChatGPTLocateResult {
  const entries = indexChatGPTUserMessageDom(capturedNodes);
  const targetNormalized = targetText(target);
  const targetFingerprint =
    target.fingerprint || (targetNormalized ? fingerprintText(targetNormalized) : '');
  let matchedCount = 0;

  if (target.messageId) {
    const found = entries.find((entry) => entry.messageId === target.messageId);
    if (found)
      return {
        found: true,
        method: 'messageId',
        element: found.element,
        domIndexCount: entries.length,
        matchedCount: 1,
      };
  }

  const byAnchor = entries.find((entry) => entry.anchor === target.messageAnchor);
  if (byAnchor)
    return {
      found: true,
      method: 'anchor',
      element: byAnchor.element,
      domIndexCount: entries.length,
      matchedCount: 1,
    };

  if (targetFingerprint) {
    const byFingerprint = entries.find((entry) => entry.fingerprint === targetFingerprint);
    if (byFingerprint) {
      return {
        found: true,
        method: 'fingerprint',
        element: byFingerprint.element,
        domIndexCount: entries.length,
        matchedCount: 1,
      };
    }
  }

  if (targetNormalized) {
    const textMatches = entries
      .map((entry) => {
        const contains =
          entry.normalizedText.includes(targetNormalized) ||
          targetNormalized.includes(entry.normalizedText);
        const similarity = textSimilarity(targetNormalized, entry.normalizedText);
        return { entry, score: contains ? 1 : similarity };
      })
      .filter((item) => item.score >= 0.6)
      .sort((left, right) => right.score - left.score);
    matchedCount = textMatches.length;
    if (textMatches[0]) {
      return {
        found: true,
        method: textMatches[0].score === 1 ? 'text' : 'fingerprint',
        element: textMatches[0].entry.element,
        domIndexCount: entries.length,
        matchedCount,
      };
    }
  }

  if (typeof target.index === 'number') {
    const byIndex = entries.find((entry) => entry.index === target.index);
    if (byIndex) {
      return {
        found: true,
        method: 'index',
        element: byIndex.element,
        domIndexCount: entries.length,
        matchedCount: 1,
      };
    }
  }

  return { found: false, domIndexCount: entries.length, matchedCount };
}

export function highlightChatGPTMessageElement(element: HTMLElement): void {
  element.classList.add('cg-voyager-message-highlight');
  window.setTimeout(() => element.classList.remove('cg-voyager-message-highlight'), 1500);
}

export function scrollChatGPTMessageIntoView(element: HTMLElement): void {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export const chatgptAdapter: PageAdapter = {
  platform: 'chatgpt',

  isSupportedPage(): boolean {
    return CHATGPT_HOSTS.has(getCurrentHostname());
  },

  getConversationId(): string | null {
    return extractConversationIdFromChatGPTUrl(getCurrentUrl());
  },

  getConversationTitle(): string | null {
    const documentTitle = normalizeSnippet(getSafeDocument()?.title);
    const cleanedDocumentTitle = documentTitle ? stripChatGPTTitleSuffix(documentTitle) : '';
    if (isUsableConversationTitle(cleanedDocumentTitle)) return cleanedDocumentTitle;

    const titleEl = queryFirst(CHATGPT_TITLE_SELECTORS);
    const cleanedDomTitle = stripChatGPTTitleSuffix(normalizeSnippet(titleEl?.textContent));
    return isUsableConversationTitle(cleanedDomTitle) ? cleanedDomTitle : null;
  },

  getConversationInfo(): ConversationInfo {
    return {
      platform: this.platform,
      conversationId: this.getConversationId(),
      title: this.getConversationTitle(),
      url: getCurrentUrl(),
    };
  },

  getUserMessageNodes(): HTMLElement[] {
    return getTurnElementsByRole('user');
  },

  getAssistantMessageNodes(): HTMLElement[] {
    return getTurnElementsByRole('assistant');
  },

  getMessageNodes(): MessageNodeRef[] {
    const userNodes = indexChatGPTUserMessageDom().map((entry) => ({
      element: entry.element,
      role: 'user' as const,
      anchor: entry.anchor,
      snippet: entry.snippet,
      messageId: entry.messageId,
      fingerprint: entry.fingerprint,
    }));
    const assistantNodes = this.getAssistantMessageNodes().map((element, index) => ({
      element,
      role: 'assistant' as const,
      anchor: this.buildMessageAnchor(element, index, 'assistant'),
      snippet: normalizeSnippet(element.textContent),
      messageId: getMessageIdFromElement(element),
      fingerprint: element.getAttribute(CHATGPT_MESSAGE_FINGERPRINT_ATTR) || undefined,
    }));

    return sortByDocumentPosition([...userNodes, ...assistantNodes]);
  },

  getInputElement(): HTMLElement | null {
    return getInputCandidates()[0] || null;
  },

  getAssistantActionArea(_messageElement: HTMLElement): HTMLElement | null {
    return null;
  },

  scrollToMessage(anchor: string): boolean {
    const captured = parseCapturedAnchor(anchor);
    const result = locateChatGPTUserTimelineTarget({
      messageAnchor: anchor,
      messageId: captured.messageId,
      fingerprint: captured.fingerprint,
    });
    if (!result.found || !result.element) {
      console.debug('[ChatGPT Voyager] 时间轴定位结果', {
        found: false,
        domIndexCount: result.domIndexCount,
        matchedCount: result.matchedCount,
        url: getCurrentUrl(),
      });
      return false;
    }

    scrollChatGPTMessageIntoView(result.element);
    highlightChatGPTMessageElement(result.element);
    console.debug('[ChatGPT Voyager] 时间轴定位结果', {
      found: true,
      method: result.method,
      domIndexCount: result.domIndexCount,
      matchedCount: result.matchedCount,
    });
    return true;
  },

  buildMessageAnchor(messageElement: HTMLElement, index: number, role: MessageRole): string {
    const existingAnchor = messageElement.getAttribute(CHATGPT_MESSAGE_ANCHOR_ATTR);
    if (existingAnchor) return existingAnchor;

    const messageId = getMessageIdFromElement(messageElement);
    const fingerprint = fingerprintText(messageElement.textContent || '');
    const explicitId = messageElement.id || messageElement.getAttribute('data-testid') || messageId;
    const basis = explicitId || fingerprint || String(index);
    const anchor = `chatgpt:${role}:${hashString(basis)}:${index}`;
    if (messageId) messageElement.setAttribute(CHATGPT_MESSAGE_ID_ATTR, messageId);
    messageElement.setAttribute(CHATGPT_MESSAGE_FINGERPRINT_ATTR, fingerprint);
    messageElement.setAttribute(CHATGPT_MESSAGE_ANCHOR_ATTR, anchor);
    return anchor;
  },
};
