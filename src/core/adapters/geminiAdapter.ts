import {
  buildConversationIdFromUrl,
  extractConversationIdFromUrl,
} from '@/core/utils/conversationIdentity';
import {
  combineSelectors,
  getAssistantTurnSelectors,
  getUserTurnSelectors,
} from '@/core/utils/selectors';
import { hashString } from '@/core/utils/hash';

import type { ConversationInfo, MessageNodeRef, MessageRole, PageAdapter } from './types';

const GEMINI_HOSTS = new Set(['gemini.google.com', 'business.gemini.google']);

const GEMINI_TITLE_SELECTORS = [
  '.conversation-title-container [data-test-id="conversation-title"]',
  'top-bar-actions [data-test-id="conversation-title"]',
  '.top-bar-actions [data-test-id="conversation-title"]',
  '[data-test-id="conversation-title"]',
];

const GEMINI_INPUT_SELECTORS = [
  'main rich-textarea [contenteditable="true"]',
  'rich-textarea [contenteditable="true"]',
  'rich-textarea',
  '[aria-label*="Enter a prompt"]',
  '[aria-label*="prompt"]',
  '[contenteditable="true"][aria-label]',
];

const GEMINI_ACTION_AREA_SELECTORS = [
  '[data-test-id="response-actions"]',
  '.response-container-footer',
  '.model-response-footer',
  '.actions-container',
];

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

function queryAll(selectors: string[]): HTMLElement[] {
  const doc = getSafeDocument();
  if (!doc) return [];

  try {
    return Array.from(doc.querySelectorAll<HTMLElement>(combineSelectors(selectors)));
  } catch {
    return [];
  }
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

function sortByDocumentPosition(nodes: MessageNodeRef[]): MessageNodeRef[] {
  return [...nodes].sort((left, right) => {
    if (left.element === right.element) return 0;
    const position = left.element.compareDocumentPosition(right.element);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

export const geminiAdapter: PageAdapter = {
  platform: 'gemini',

  isSupportedPage(): boolean {
    return GEMINI_HOSTS.has(getCurrentHostname());
  },

  getConversationId(): string | null {
    const url = getCurrentUrl();
    const routeId = extractConversationIdFromUrl(url);
    return routeId ? `gemini:conv:${routeId}` : buildConversationIdFromUrl(url);
  },

  getConversationTitle(): string | null {
    const titleEl = queryFirst(GEMINI_TITLE_SELECTORS);
    const title = normalizeSnippet(titleEl?.textContent);
    if (title) return title;

    const documentTitle = normalizeSnippet(getSafeDocument()?.title);
    return documentTitle || null;
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
    return queryAll(getUserTurnSelectors());
  },

  getAssistantMessageNodes(): HTMLElement[] {
    return queryAll(getAssistantTurnSelectors());
  },

  getMessageNodes(): MessageNodeRef[] {
    const userNodes = this.getUserMessageNodes().map((element, index) => ({
      element,
      role: 'user' as const,
      anchor: this.buildMessageAnchor(element, index, 'user'),
      snippet: normalizeSnippet(element.textContent),
    }));
    const assistantNodes = this.getAssistantMessageNodes().map((element, index) => ({
      element,
      role: 'assistant' as const,
      anchor: this.buildMessageAnchor(element, index, 'assistant'),
      snippet: normalizeSnippet(element.textContent),
    }));

    return sortByDocumentPosition([...userNodes, ...assistantNodes]);
  },

  getInputElement(): HTMLElement | null {
    return queryFirst(GEMINI_INPUT_SELECTORS);
  },

  getAssistantActionArea(messageElement: HTMLElement): HTMLElement | null {
    for (const selector of GEMINI_ACTION_AREA_SELECTORS) {
      const local = messageElement.querySelector<HTMLElement>(selector);
      if (local) return local;
    }

    let cursor: HTMLElement | null = messageElement;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      const siblingActionArea = cursor.parentElement?.querySelector<HTMLElement>(
        GEMINI_ACTION_AREA_SELECTORS.join(','),
      );
      if (siblingActionArea) return siblingActionArea;
      cursor = cursor.parentElement;
    }

    return null;
  },

  scrollToMessage(anchor: string): boolean {
    const message = this.getMessageNodes().find((node) => node.anchor === anchor);
    if (!message) return false;

    message.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  },

  buildMessageAnchor(messageElement: HTMLElement, index: number, role: MessageRole): string {
    const explicitId =
      messageElement.id ||
      messageElement.getAttribute('data-turn-id') ||
      messageElement.getAttribute('data-message-id') ||
      messageElement.getAttribute('data-testid') ||
      messageElement.getAttribute('data-test-id');
    const basis = explicitId || normalizeSnippet(messageElement.textContent) || String(index);
    return `gemini:${role}:${index}:${hashString(basis)}`;
  },
};
