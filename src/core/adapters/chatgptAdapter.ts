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
  const normalized = normalizeSnippet(text).toLowerCase();
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
    const userNodes = this.getUserMessageNodes().map((element, index) => ({
      element,
      role: 'user' as const,
      anchor: this.buildMessageAnchor(element, index, 'user'),
      snippet: normalizeSnippet(element.textContent),
      messageId: getMessageIdFromElement(element),
      fingerprint: element.getAttribute(CHATGPT_MESSAGE_FINGERPRINT_ATTR) || undefined,
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
    if (captured.messageId) {
      const messageElement = findMessageElementByAttribute(CHATGPT_MESSAGE_ID_ATTR, captured.messageId);
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.debug('[ChatGPT Voyager] 时间轴定位结果', { found: true, method: 'messageId' });
        return true;
      }
    }

    const anchoredElement = findMessageElementByAnchor(anchor);
    if (anchoredElement) {
      anchoredElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      console.debug('[ChatGPT Voyager] 时间轴定位结果', { found: true, method: 'anchor' });
      return true;
    }

    const currentNodes = this.getMessageNodes();
    const retryByMessageId = captured.messageId
      ? findMessageElementByAttribute(CHATGPT_MESSAGE_ID_ATTR, captured.messageId)
      : null;
    if (retryByMessageId) {
      retryByMessageId.scrollIntoView({ behavior: 'smooth', block: 'center' });
      console.debug('[ChatGPT Voyager] 时间轴定位结果', { found: true, method: 'messageIdRetry' });
      return true;
    }

    const retryByAnchor = findMessageElementByAnchor(anchor);
    if (retryByAnchor) {
      retryByAnchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      console.debug('[ChatGPT Voyager] 时间轴定位结果', { found: true, method: 'anchorRetry' });
      return true;
    }

    if (captured.fingerprint) {
      const fingerprintElement = findMessageElementByAttribute(
        CHATGPT_MESSAGE_FINGERPRINT_ATTR,
        captured.fingerprint,
      );
      if (fingerprintElement) {
        fingerprintElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.debug('[ChatGPT Voyager] 时间轴定位结果', { found: true, method: 'fingerprint' });
        return true;
      }
    }

    const message = currentNodes.find((node) => node.anchor === anchor);
    if (!message) {
      console.debug('[ChatGPT Voyager] 时间轴定位结果', {
        found: false,
        anchor,
        messageCount: currentNodes.length,
        url: getCurrentUrl(),
      });
      return false;
    }

    message.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
