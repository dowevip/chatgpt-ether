import {
  chatgptAdapter,
  getChatGPTMainScrollContainer,
  getChatGPTScrollMetrics,
  highlightChatGPTMessageElement,
  indexChatGPTMessageDom,
  locateChatGPTTimelineTarget,
  scrollChatGPTContainerBy,
  scrollChatGPTContainerToTop,
  scrollChatGPTMessageIntoView,
} from '@/core/adapters/chatgptAdapter';
import {
  listChatGPTStarredMessages,
  toggleChatGPTStarredMessage,
} from '@/core/services/ChatGPTStarredService';
import type { ChatGPTTimelineNode } from '@/core/types/timeline';

import {
  getCapturedChatGPTTimelineNodes,
  hasCapturedChatGPTConversationData,
  requestCurrentChatGPTConversationCapture,
} from './chatgptConversationCapture';

const ROOT_ID = 'cg-voyager-timeline-root';
const STYLE_ID = 'cg-voyager-timeline-style';
const STORAGE_KEY = 'chatgptVoyager.timeline.visible';
const WIDTH_STORAGE_KEY = 'chatgptVoyager.timeline.width';
const HEIGHT_STORAGE_KEY = 'chatgptVoyager.timeline.height';
const DARK_MODE_STORAGE_KEY = 'darkMode';
const PERFORMANCE_PREFIX = '[ChatGPT Voyager Performance]';
const SUMMARY_LIMIT = 60;
const SEARCH_SUMMARY_LIMIT = 80;
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const MIN_HEIGHT = 240;
const MAX_HEIGHT_RATIO = 0.9;

let started = false;
let enabled = true;
let lastUrl = '';
let nodes: ChatGPTTimelineNode[] = [];
let listEl: HTMLDivElement | null = null;
let markerEl: HTMLDivElement | null = null;
let statusEl: HTMLParagraphElement | null = null;
let hintEl: HTMLParagraphElement | null = null;
let searchInputEl: HTMLInputElement | null = null;
let searchClearButtonEl: HTMLButtonElement | null = null;
let activeAnchor: string | null = null;
let locatingAnchor: string | null = null;
let locatingText = '正在定位...';
let starredMessageKeys = new Set<string>();
let searchQuery = '';
let timelineDataState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let searchIndexState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let searchIndex: ChatGPTTimelineSearchResult[] = [];
let timelineRefreshTimer: number | null = null;
let searchIndexTimer: number | null = null;
let panelWidth = DEFAULT_WIDTH;
let panelHeight = Math.round(globalThis.innerHeight * 0.7);
let panelDarkMode = false;

type ChatGPTTimelineLocateRequest = {
  conversationId?: string;
  role?: ChatGPTTimelineNode['role'];
  turnId?: string;
  messageId?: string;
  messageAnchor?: string;
  snippet?: string;
  fingerprint?: string;
};

type ChatGPTTimelineSearchResult = ChatGPTTimelineNode & {
  resultIndex: number;
  searchText: string;
};

function performanceLog(label: string, startedAt: number, extra: Record<string, unknown> = {}): void {
  console.debug(PERFORMANCE_PREFIX, {
    label,
    durationMs: Math.round(performance.now() - startedAt),
    ...extra,
  });
}

function scheduleIdleTask(callback: () => void, timeout = 1500): void {
  const idleCallback = (
    window as typeof window & {
      requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    }
  ).requestIdleCallback;
  if (idleCallback) {
    idleCallback(() => callback(), { timeout });
    return;
  }
  window.setTimeout(callback, Math.min(timeout, 500));
}

function summarize(text: string): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > SUMMARY_LIMIT
    ? `${normalized.slice(0, SUMMARY_LIMIT - 3)}...`
    : normalized;
}

function roleLabel(role: ChatGPTTimelineNode['role']): string {
  return role === 'user' ? '用户' : '助手';
}

function searchRoleLabel(role: ChatGPTTimelineNode['role']): string {
  return role === 'user' ? '我' : '助手';
}

function normalizeSearchText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchKey(node: Partial<ChatGPTTimelineNode>): string {
  return (
    node.turnId ||
    node.messageId ||
    node.messageAnchor ||
    node.fingerprint ||
    `${node.role || 'message'}:${node.index || 0}`
  );
}

function summarizeSearchMatch(text: string, query: string): string {
  const normalized = normalizeSearchText(text);
  if (normalized.length <= SEARCH_SUMMARY_LIMIT) return normalized;

  const lowerText = normalized.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);
  if (matchIndex < 0) return `${normalized.slice(0, SEARCH_SUMMARY_LIMIT - 3)}...`;

  const context = Math.floor((SEARCH_SUMMARY_LIMIT - query.length) / 2);
  const start = Math.max(0, matchIndex - Math.max(12, context));
  const end = Math.min(normalized.length, start + SEARCH_SUMMARY_LIMIT);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${
    end < normalized.length ? '...' : ''
  }`;
}

function appendHighlightedText(parent: HTMLElement, text: string, query: string): void {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    parent.textContent = text;
    return;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parent.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
    }
    const mark = document.createElement('mark');
    mark.className = 'cg-voyager-timeline-search-mark';
    mark.textContent = text.slice(matchIndex, matchIndex + normalizedQuery.length);
    parent.appendChild(mark);
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    parent.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function getStarredKey(conversationId: string, locatorId: string): string {
  return `${conversationId}:${locatorId}`;
}

function getNodeStarredKey(node: ChatGPTTimelineNode): string | null {
  const conversationId = chatgptAdapter.getConversationId();
  if (!conversationId || !node.messageAnchor) return null;
  return getStarredKey(conversationId, node.turnId || node.messageAnchor);
}

function clampHeight(height: number): number {
  return Math.min(Math.round(window.innerHeight * MAX_HEIGHT_RATIO), Math.max(MIN_HEIGHT, height));
}

async function readEnabledFromStorage(): Promise<boolean> {
  try {
    const result = await chrome.storage?.local?.get({ [STORAGE_KEY]: true });
    return result?.[STORAGE_KEY] !== false;
  } catch {
    return true;
  }
}

async function writeEnabledToStorage(nextEnabled: boolean): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [STORAGE_KEY]: nextEnabled });
  } catch {}
}

async function readWidthFromStorage(): Promise<number> {
  try {
    const result = await chrome.storage?.local?.get({ [WIDTH_STORAGE_KEY]: DEFAULT_WIDTH });
    const value = Number(result?.[WIDTH_STORAGE_KEY]);
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number.isFinite(value) ? value : DEFAULT_WIDTH));
  } catch {
    return DEFAULT_WIDTH;
  }
}

async function writeWidthToStorage(width: number): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [WIDTH_STORAGE_KEY]: width });
  } catch {}
}

async function readHeightFromStorage(): Promise<number> {
  try {
    const result = await chrome.storage?.local?.get({ [HEIGHT_STORAGE_KEY]: panelHeight });
    const value = Number(result?.[HEIGHT_STORAGE_KEY]);
    return clampHeight(Number.isFinite(value) ? value : panelHeight);
  } catch {
    return clampHeight(panelHeight);
  }
}

async function writeHeightToStorage(height: number): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [HEIGHT_STORAGE_KEY]: height });
  } catch {}
}

function normalizeDarkModeValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return null;
}

async function readDarkModeFromStorage(): Promise<boolean> {
  try {
    const result = await chrome.storage?.local?.get({ [DARK_MODE_STORAGE_KEY]: null });
    const stored = normalizeDarkModeValue(result?.[DARK_MODE_STORAGE_KEY]);
    if (stored !== null) return stored;
  } catch {}

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyDarkModeState(): void {
  document.documentElement.classList.toggle('cg-voyager-timeline-dark', panelDarkMode);
  document
    .getElementById(ROOT_ID)
    ?.classList.toggle('cg-voyager-timeline-dark', panelDarkMode);
}

function watchDarkModeChanges(): void {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const darkModeChange = changes[DARK_MODE_STORAGE_KEY];
    if (!darkModeChange) return;

    const nextDarkMode = normalizeDarkModeValue(darkModeChange.newValue);
    if (nextDarkMode === null) return;
    panelDarkMode = nextDarkMode;
    applyDarkModeState();
  });
}

function applyPanelSize(): void {
  const root = document.getElementById(ROOT_ID);
  root?.style.setProperty('--cg-voyager-timeline-width', `${panelWidth}px`);
  root?.style.setProperty('--cg-voyager-timeline-height', `${clampHeight(panelHeight)}px`);
}

function reconcileDomMessageIds(capturedNodes: ChatGPTTimelineNode[]): void {
  const indexed = [
    ...indexChatGPTMessageDom('user', capturedNodes),
    ...indexChatGPTMessageDom('assistant', capturedNodes),
  ];
  const byTurnId = new Map(
    indexed.filter((entry) => entry.turnId).map((entry) => [entry.turnId, entry]),
  );
  const byMessageId = new Map(
    indexed.filter((entry) => entry.messageId).map((entry) => [entry.messageId, entry]),
  );
  const byFingerprint = new Map(indexed.map((entry) => [entry.fingerprint, entry]));

  for (const node of capturedNodes) {
    const matched =
      (node.turnId ? byTurnId.get(node.turnId) : undefined) ||
      (node.messageId ? byMessageId.get(node.messageId) : undefined) ||
      (node.fingerprint ? byFingerprint.get(node.fingerprint) : undefined);
    if (!matched) continue;
    node.turnId = node.turnId || matched.turnId;
    node.messageId = node.messageId || matched.messageId;
    node.messageAnchor = matched.anchor || node.messageAnchor;
  }

  const matched = indexed.filter((entry) => entry.turnId || entry.messageId).length;
  console.debug('[ChatGPT Voyager] 时间轴 DOM 映射完成', {
    matched,
    captured: capturedNodes.length,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function findRenderedIndexRange(role: ChatGPTTimelineNode['role']): { min: number; max: number } | null {
  const byTurnId = new Map(
    nodes
      .filter((node) => node.role === role && node.turnId)
      .map((node) => [node.turnId, node.index]),
  );
  const byMessageId = new Map(
    nodes
      .filter((node) => node.role === role && node.messageId)
      .map((node) => [node.messageId, node.index]),
  );
  const byFingerprint = new Map(
    nodes
      .filter((node) => node.role === role && node.fingerprint)
      .map((node) => [node.fingerprint, node.index]),
  );
  const indices: number[] = [];

  for (const domNode of indexChatGPTMessageDom(role, nodes)) {
    const index =
      (domNode.turnId && byTurnId.get(domNode.turnId)) ||
      (domNode.messageId && byMessageId.get(domNode.messageId)) ||
      (domNode.fingerprint && byFingerprint.get(domNode.fingerprint));
    if (typeof index === 'number') indices.push(index);
  }

  if (indices.length === 0) return null;
  return { min: Math.min(...indices), max: Math.max(...indices) };
}

function locateAnyTimelineNode(node: ChatGPTTimelineNode): {
  found: boolean;
  element?: HTMLElement;
  method?: string;
  domIndexCount: number;
  matchedCount: number;
} {
  return locateChatGPTTimelineTarget(node, nodes);
}

function resolveCanonicalTimelineNode(node: ChatGPTTimelineNode): ChatGPTTimelineNode {
  const canonical =
    nodes.find((item) => node.turnId && item.role === node.role && item.turnId === node.turnId) ||
    nodes.find(
      (item) => node.messageId && item.role === node.role && item.messageId === node.messageId,
    ) ||
    nodes.find(
      (item) =>
        node.messageAnchor && item.role === node.role && item.messageAnchor === node.messageAnchor,
    ) ||
    nodes.find(
      (item) => node.fingerprint && item.role === node.role && item.fingerprint === node.fingerprint,
    );

  if (!canonical) return node;

  return {
    ...node,
    ...canonical,
    searchText: node.searchText || canonical.searchText,
    summary: canonical.summary || node.summary,
  };
}

async function tryDirectLocateTimelineNode(node: ChatGPTTimelineNode): Promise<boolean> {
  const target = resolveCanonicalTimelineNode(node);
  const located = locateAnyTimelineNode(target);
  if (!located.found || !located.element) return false;

  await scrollChatGPTMessageIntoView(located.element);
  highlightChatGPTMessageElement(located.element);
  console.debug('[ChatGPT Voyager] 时间轴直接定位完成', {
    role: target.role,
    method: located.method,
    domIndexCount: located.domIndexCount,
    matchedCount: located.matchedCount,
  });
  return true;
}

async function progressiveScrollToNode(node: ChatGPTTimelineNode): Promise<boolean> {
  const target = resolveCanonicalTimelineNode(node);
  let indexed = indexChatGPTMessageDom(node.role, nodes);
  let container = getChatGPTMainScrollContainer(indexed);
  let locateResult = locateAnyTimelineNode(target);
  if (locateResult.found && locateResult.element) {
    await scrollChatGPTMessageIntoView(locateResult.element);
    highlightChatGPTMessageElement(locateResult.element);
    return true;
  }

  const visibleRange = findRenderedIndexRange(target.role);
  let direction: -1 | 1 | null = null;
  if (visibleRange && target.index > 0) {
    if (target.index < visibleRange.min) direction = -1;
    if (target.index > visibleRange.max) direction = 1;
  }

  let attempts = 0;
  const maxAttempts = 100;

  const searchStep = async (nextDirection: -1 | 1): Promise<boolean> => {
    if (statusEl) statusEl.textContent = nextDirection < 0 ? '向上查找...' : '向下查找...';
    locatingText = nextDirection < 0 ? '向上查找...' : '向下查找...';
    renderList();

    const metrics = getChatGPTScrollMetrics(container);
    const distance = Math.max(320, Math.round(metrics.clientHeight * 0.7)) * nextDirection;
    scrollChatGPTContainerBy(container, distance);
    attempts += 1;
    await wait(180);
    requestCurrentChatGPTConversationCapture();
    indexed = indexChatGPTMessageDom(target.role, nodes);
    container = getChatGPTMainScrollContainer(indexed);
    locateResult = locateAnyTimelineNode(target);
    if (locateResult.found && locateResult.element) {
      await scrollChatGPTMessageIntoView(locateResult.element);
      highlightChatGPTMessageElement(locateResult.element);
      console.debug('[ChatGPT Voyager] 时间轴渐进定位完成', {
        success: true,
        attempts,
        method: locateResult.method,
        domIndexCount: locateResult.domIndexCount,
        matchedCount: locateResult.matchedCount,
      });
      return true;
    }
    return false;
  };

  if (direction === null) {
    locatingText = '向上查找...';
    if (statusEl) statusEl.textContent = locatingText;
    scrollChatGPTContainerToTop(container);
    attempts += 1;
    await wait(200);
    indexed = indexChatGPTMessageDom(target.role, nodes);
    container = getChatGPTMainScrollContainer(indexed);
    locateResult = locateAnyTimelineNode(target);
    if (locateResult.found && locateResult.element) {
      await scrollChatGPTMessageIntoView(locateResult.element);
      highlightChatGPTMessageElement(locateResult.element);
      return true;
    }
    direction = 1;
  }

  while (attempts < maxAttempts) {
    const metrics = getChatGPTScrollMetrics(container);
    if (direction < 0 && metrics.atTop) {
      direction = 1;
    } else if (direction > 0 && metrics.atBottom) {
      direction = -1;
    }

    if (await searchStep(direction)) return true;
  }

  console.debug('[ChatGPT Voyager] 时间轴渐进定位完成', {
    success: false,
    attempts,
    container: container.debug,
  });
  return false;
}

function readTimelineNodes(): ChatGPTTimelineNode[] {
  if (!chatgptAdapter.isSupportedPage()) return [];

  const capturedNodes = getCapturedChatGPTTimelineNodes();
  if (capturedNodes.length > 0) {
    reconcileDomMessageIds(capturedNodes);
    console.debug('[ChatGPT Voyager] 时间轴使用捕获数据', {
      total: capturedNodes.length,
      user: capturedNodes.filter((node) => node.role === 'user').length,
      assistant: capturedNodes.filter((node) => node.role === 'assistant').length,
      hasConversationData: true,
    });
    return capturedNodes.map((node, index) => ({ ...node, index: index + 1 }));
  }

  const messageNodes = chatgptAdapter.getMessageNodes();
  const userCount = messageNodes.filter((node) => node.role === 'user').length;
  const assistantCount = messageNodes.filter((node) => node.role === 'assistant').length;
  console.debug('[ChatGPT Voyager] 时间轴扫描完成', {
    total: messageNodes.length,
    user: userCount,
    assistant: assistantCount,
  });

  return messageNodes.map((node, index) => ({
    index: index + 1,
    role: node.role,
    summary: summarize(node.snippet),
    turnId: (node as { turnId?: string }).turnId,
    messageAnchor: node.anchor,
    messageId: (node as { messageId?: string }).messageId,
    fingerprint: (node as { fingerprint?: string }).fingerprint,
    source: 'dom',
  }));
}

function formatMessageTimestamp(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function hasDirectTimestamp(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) =>
    child.classList.contains('cg-voyager-message-timestamp'),
  );
}

function applyChatGPTMessageTimestamps(timelineNodes: ChatGPTTimelineNode[]): void {
  const startedAt = performance.now();
  let applied = 0;
  for (const node of timelineNodes) {
    const timestamp = formatMessageTimestamp(node.createdAt || 0);
    if (!timestamp) continue;

    const located = locateChatGPTTimelineTarget(node, timelineNodes);
    const element = located.element;
    if (!located.found || !element || hasDirectTimestamp(element)) continue;

    const timestampEl = document.createElement('div');
    timestampEl.className = `cg-voyager-message-timestamp cg-voyager-message-timestamp-${node.role}`;
    timestampEl.textContent = timestamp;
    element.prepend(timestampEl);
    applied += 1;
  }
  performanceLog('正文时间戳应用耗时', startedAt, {
    applied,
    candidates: timelineNodes.filter((node) => Boolean(node.createdAt)).length,
  });
}

function readSearchCorpus(): ChatGPTTimelineSearchResult[] {
  const startedAt = performance.now();
  const byKey = new Map<string, ChatGPTTimelineSearchResult>();

  const addResult = (
    node: Omit<ChatGPTTimelineSearchResult, 'resultIndex'>,
    preferExistingOrder = true,
  ) => {
    const key = getSearchKey(node);
    const existing = byKey.get(key);
    const resultIndex = existing?.resultIndex || byKey.size + 1;
    if (existing && preferExistingOrder) {
      byKey.set(key, {
        ...existing,
        ...node,
        index: existing.index || node.index,
        resultIndex,
        searchText: node.searchText || existing.searchText,
        summary: node.summary || existing.summary,
      });
      return;
    }
    byKey.set(key, { ...node, resultIndex });
  };

  for (const node of getCapturedChatGPTTimelineNodes()) {
    addResult({
      ...node,
      searchText: normalizeSearchText(node.searchText || node.summary),
    });
  }

  const domNodes = chatgptAdapter.getMessageNodes();
  domNodes.forEach((ref, index) => {
    const extended = ref as typeof ref & {
      turnId?: string;
      messageId?: string;
      fingerprint?: string;
    };
    const searchText = normalizeSearchText(ref.element.textContent || ref.snippet);
    if (!searchText) return;
    addResult({
      index: index + 1,
      role: ref.role,
      summary: summarize(searchText),
      turnId: extended.turnId,
      messageAnchor: ref.anchor,
      messageId: extended.messageId,
      fingerprint: extended.fingerprint,
      source: 'dom',
      searchText,
    });
  });

  const results = Array.from(byKey.values()).map((result, index) => ({
    ...result,
    resultIndex: index + 1,
  }));
  performanceLog('搜索索引构建耗时', startedAt, {
    count: results.length,
    captured: getCapturedChatGPTTimelineNodes().length,
  });
  return results;
}

function getSearchResults(): ChatGPTTimelineSearchResult[] {
  const query = normalizeSearchText(searchQuery);
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  return searchIndex
    .filter((result) => result.searchText.toLowerCase().includes(lowerQuery))
    .map((result, index) => ({
      ...result,
      resultIndex: index + 1,
      summary: summarizeSearchMatch(result.searchText, query),
    }));
}

function scheduleSearchIndexBuild(delay = 250): void {
  if (searchIndexTimer !== null) {
    window.clearTimeout(searchIndexTimer);
  }
  searchIndexState = searchIndex.length > 0 ? searchIndexState : 'loading';
  searchIndexTimer = window.setTimeout(() => {
    searchIndexTimer = null;
    scheduleIdleTask(() => {
      try {
        searchIndexState = 'loading';
        searchIndex = readSearchCorpus();
        searchIndexState = 'ready';
        renderList();
      } catch {
        searchIndexState = 'error';
        renderList();
      }
    }, 1600);
  }, delay);
}

async function refreshStarredState(): Promise<void> {
  const conversationId = chatgptAdapter.getConversationId();
  if (!conversationId) {
    starredMessageKeys = new Set();
    return;
  }

  try {
    const messages = await listChatGPTStarredMessages();
    starredMessageKeys = new Set(
      messages
        .filter((message) => message.conversationId === conversationId)
        .map((message) =>
          getStarredKey(message.conversationId, message.turnId || message.messageAnchor),
        ),
    );
  } catch {
    starredMessageKeys = new Set();
  }
}

async function handleStarClick(node: ChatGPTTimelineNode): Promise<void> {
  if (node.role !== 'user') return;

  const conversationId = chatgptAdapter.getConversationId();
  if (!conversationId) {
    if (statusEl) statusEl.textContent = '当前对话无法收藏';
    return;
  }

  try {
    const result = await toggleChatGPTStarredMessage({
      conversationId,
      conversationTitle: chatgptAdapter.getConversationTitle() || '未命名对话',
      url: globalThis.location.href,
      turnId: node.turnId,
      messageId: node.messageId,
      messageAnchor: node.messageAnchor,
      role: 'user',
      snippet: node.summary,
      fingerprint: node.fingerprint,
    });
    starredMessageKeys = new Set(
      result.messages
        .filter((message) => message.conversationId === conversationId)
        .map((message) =>
          getStarredKey(message.conversationId, message.turnId || message.messageAnchor),
        ),
    );
    renderList();
    if (statusEl) statusEl.textContent = result.starred ? '已收藏' : '已取消收藏';
  } catch {
    if (statusEl) statusEl.textContent = '收藏操作失败';
  }
}

async function handleSearchResultClick(result: ChatGPTTimelineSearchResult): Promise<void> {
  locatingAnchor = result.messageAnchor;
  locatingText = '正在定位...';
  renderList();
  if (statusEl) statusEl.textContent = '正在定位搜索结果...';

  const target = resolveCanonicalTimelineNode(result);
  const scrolled = (await tryDirectLocateTimelineNode(target)) || (await progressiveScrollToNode(target));
  if (!scrolled && statusEl) {
    locatingAnchor = null;
    locatingText = '正在定位...';
    renderList();
    statusEl.textContent = '未能自动定位该搜索结果，请手动滚动到附近后再试';
    return;
  }

  activeAnchor = target.messageAnchor;
  locatingAnchor = null;
  locatingText = '正在定位...';
  renderList();
  if (statusEl) statusEl.textContent = '已定位';
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cg-voyager-timeline-root {
      position: fixed;
      top: 96px;
      right: 10px;
      z-index: 2147483000;
      width: 36px;
      --cg-voyager-timeline-width: 260px;
      --cg-voyager-timeline-height: 70vh;
      max-height: var(--cg-voyager-timeline-height);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: width 160ms ease;
      container-type: inline-size;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-hidden {
      display: none;
    }
    .cg-voyager-timeline-root:hover,
    .cg-voyager-timeline-root:focus-within,
    .cg-voyager-timeline-root.cg-voyager-timeline-expanded {
      width: var(--cg-voyager-timeline-width);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-resizing {
      width: var(--cg-voyager-timeline-width);
    }
    .cg-voyager-timeline-toggle {
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.92);
      color: #fff;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.2);
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      padding: 10px 14px;
    }
    .cg-voyager-timeline-panel {
      display: grid;
      grid-template-columns: 6px 36px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) 8px;
      position: relative;
      width: 100%;
      height: var(--cg-voyager-timeline-height);
      max-height: 90vh;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.58);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
      color: #111827;
      backdrop-filter: blur(10px);
      transition: border-radius 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }
    .cg-voyager-timeline-root:hover .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root:focus-within .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root.cg-voyager-timeline-expanded .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root.cg-voyager-timeline-resizing .cg-voyager-timeline-panel {
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
    }
    .cg-voyager-timeline-resize {
      width: 6px;
      cursor: ew-resize;
      opacity: 0;
      touch-action: none;
    }
    .cg-voyager-timeline-resize-bottom {
      grid-column: 1 / -1;
      height: 8px;
      cursor: ns-resize;
      opacity: 0;
      touch-action: none;
    }
    .cg-voyager-timeline-resize-corner {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      opacity: 0;
      touch-action: none;
    }
    .cg-voyager-timeline-root:hover .cg-voyager-timeline-resize,
    .cg-voyager-timeline-root:hover .cg-voyager-timeline-resize-bottom,
    .cg-voyager-timeline-root:hover .cg-voyager-timeline-resize-corner,
    .cg-voyager-timeline-root:focus-within .cg-voyager-timeline-resize,
    .cg-voyager-timeline-root:focus-within .cg-voyager-timeline-resize-bottom,
    .cg-voyager-timeline-root:focus-within .cg-voyager-timeline-resize-corner,
    .cg-voyager-timeline-root.cg-voyager-timeline-resizing .cg-voyager-timeline-resize {
      opacity: 1;
      background: rgba(37, 99, 235, 0.18);
    }
    .cg-voyager-timeline-rail {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 10px 0;
    }
    .cg-voyager-timeline-markers {
      display: flex;
      max-height: calc(var(--cg-voyager-timeline-height) - 20px);
      flex-direction: column;
      align-items: center;
      gap: 7px;
      overflow-y: auto;
      scrollbar-width: none;
    }
    .cg-voyager-timeline-markers::-webkit-scrollbar {
      display: none;
    }
    .cg-voyager-timeline-marker {
      width: 8px;
      height: 8px;
      min-height: 8px;
      border: 0;
      border-radius: 999px;
      background: rgba(100, 116, 139, 0.58);
      cursor: pointer;
      padding: 0;
      transition: background 120ms ease, transform 120ms ease, width 120ms ease;
    }
    .cg-voyager-timeline-marker-assistant {
      width: 14px;
      height: 3px;
      min-height: 3px;
      border-radius: 999px;
    }
    .cg-voyager-timeline-marker:hover,
    .cg-voyager-timeline-marker-active {
      background: #2563eb;
      transform: scale(1.2);
    }
    .cg-voyager-timeline-outline {
      display: flex;
      min-width: 0;
      max-height: inherit;
      flex-direction: column;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
    .cg-voyager-timeline-root:hover .cg-voyager-timeline-outline,
    .cg-voyager-timeline-root:focus-within .cg-voyager-timeline-outline,
    .cg-voyager-timeline-root.cg-voyager-timeline-expanded .cg-voyager-timeline-outline,
    .cg-voyager-timeline-root.cg-voyager-timeline-resizing .cg-voyager-timeline-outline {
      opacity: 1;
      pointer-events: auto;
    }
    .cg-voyager-timeline-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      padding: 10px 12px 8px 4px;
    }
    .cg-voyager-timeline-title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
    }
    .cg-voyager-timeline-actions {
      display: flex;
      gap: 6px;
    }
    .cg-voyager-timeline-action {
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.68);
      color: #374151;
      cursor: pointer;
      font-size: 12px;
      padding: 5px 7px;
    }
    .cg-voyager-timeline-status {
      margin: 0;
      padding: 10px 12px 4px;
      color: #6b7280;
      font-size: 12px;
    }
    .cg-voyager-timeline-hint {
      margin: 0;
      padding: 0 12px 10px;
      color: #6b7280;
      font-size: 11px;
      line-height: 1.4;
    }
    .cg-voyager-timeline-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 12px 8px;
    }
    .cg-voyager-timeline-search-input {
      min-width: 0;
      flex: 1;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.72);
      color: #111827;
      font-size: 12px;
      outline: none;
      padding: 5px 7px;
    }
    .cg-voyager-timeline-search-input:focus {
      border-color: rgba(37, 99, 235, 0.48);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
    }
    .cg-voyager-timeline-search-clear {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      font-size: 12px;
      padding: 4px 5px;
    }
    .cg-voyager-timeline-search-clear:hover {
      background: rgba(148, 163, 184, 0.14);
      color: #111827;
    }
    .cg-voyager-timeline-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-y: auto;
      padding: 0 10px 10px 0;
    }
    .cg-voyager-timeline-node {
      width: 100%;
      border: 0;
      border-left: 2px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #111827;
      cursor: pointer;
      padding: 7px 8px;
      text-align: left;
    }
    .cg-voyager-timeline-node:hover,
    .cg-voyager-timeline-node-active {
      border-left-color: #2563eb;
      background: rgba(37, 99, 235, 0.08);
    }
    .cg-voyager-timeline-node-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 5px;
      font-size: 12px;
    }
    .cg-voyager-timeline-node-index {
      color: #2563eb;
      font-weight: 700;
    }
    .cg-voyager-timeline-node-role {
      color: #6b7280;
    }
    .cg-voyager-timeline-star {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 4px;
    }
    .cg-voyager-timeline-star:hover,
    .cg-voyager-timeline-star-active {
      background: rgba(245, 158, 11, 0.12);
      color: #d97706;
    }
    .cg-voyager-timeline-node-summary {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      color: #374151;
      font-size: 12px;
      line-height: 1.45;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .cg-voyager-timeline-search-mark {
      border-radius: 3px;
      background: rgba(250, 204, 21, 0.42);
      color: inherit;
      padding: 0 1px;
    }
    .cg-voyager-message-highlight {
      outline: 2px solid rgba(37, 99, 235, 0.8) !important;
      outline-offset: 4px !important;
      border-radius: 12px !important;
      box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.16) !important;
      transition: outline-color 160ms ease, box-shadow 160ms ease;
    }
    .cg-voyager-message-timestamp {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      max-width: 100%;
      margin: 0 0 4px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.12);
      color: #6b7280;
      font-size: 11px;
      line-height: 1.2;
      padding: 2px 6px;
      pointer-events: none;
    }
    .cg-voyager-message-timestamp-assistant {
      margin-left: 0;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-panel {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(15, 23, 42, 0.54);
      color: #e5e7eb;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:hover .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:focus-within .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark.cg-voyager-timeline-expanded .cg-voyager-timeline-panel,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark.cg-voyager-timeline-resizing .cg-voyager-timeline-panel {
      border-color: rgba(148, 163, 184, 0.28);
      background: rgba(15, 23, 42, 0.9);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-header {
      border-bottom-color: rgba(148, 163, 184, 0.2);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-marker {
      background: rgba(148, 163, 184, 0.7);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-marker-assistant {
      background: rgba(100, 116, 139, 0.82);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-marker:hover,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-marker-active {
      background: #60a5fa;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-action {
      border-color: rgba(148, 163, 184, 0.28);
      background: rgba(30, 41, 59, 0.82);
      color: #e5e7eb;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-action:hover {
      background: rgba(51, 65, 85, 0.9);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-search-input {
      border-color: rgba(148, 163, 184, 0.28);
      background: rgba(30, 41, 59, 0.82);
      color: #e5e7eb;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-search-input:focus {
      border-color: rgba(96, 165, 250, 0.58);
      box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.16);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-search-clear {
      color: #94a3b8;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-search-clear:hover {
      background: rgba(148, 163, 184, 0.16);
      color: #e5e7eb;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node {
      color: #e5e7eb;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node:hover,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node-active {
      border-left-color: #60a5fa;
      background: rgba(96, 165, 250, 0.14);
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node-index {
      color: #60a5fa;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node-summary {
      color: #cbd5e1;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-status,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-hint,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-node-role {
      color: #94a3b8;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-star {
      color: #94a3b8;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-star:hover,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-star-active {
      background: rgba(245, 158, 11, 0.16);
      color: #fbbf24;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark .cg-voyager-timeline-search-mark {
      background: rgba(250, 204, 21, 0.28);
    }
    html.cg-voyager-timeline-dark .cg-voyager-message-timestamp {
      background: rgba(30, 41, 59, 0.86);
      color: #cbd5e1;
    }
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:hover .cg-voyager-timeline-resize,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:hover .cg-voyager-timeline-resize-bottom,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:hover .cg-voyager-timeline-resize-corner,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:focus-within .cg-voyager-timeline-resize,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:focus-within .cg-voyager-timeline-resize-bottom,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark:focus-within .cg-voyager-timeline-resize-corner,
    .cg-voyager-timeline-root.cg-voyager-timeline-dark.cg-voyager-timeline-resizing .cg-voyager-timeline-resize {
      background: rgba(96, 165, 250, 0.22);
    }
  `;
  document.documentElement.appendChild(style);
}

function renderList(): void {
  if (!listEl || !markerEl || !statusEl) return;

  listEl.textContent = '';
  markerEl.textContent = '';
  if (hintEl) {
    hintEl.textContent = '';
  }

  if (!chatgptAdapter.isSupportedPage()) {
    statusEl.textContent = '当前页面未识别为 ChatGPT';
    return;
  }

  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  if (normalizedSearchQuery) {
    if (searchIndexState !== 'ready') {
      statusEl.textContent =
        searchIndexState === 'error' ? '搜索索引准备失败' : '正在准备搜索索引...';
      if (hintEl) hintEl.textContent = '搜索索引会在后台完成，不影响 ChatGPT 对话正文显示。';
      scheduleSearchIndexBuild(0);
      return;
    }

    const results = getSearchResults();
    statusEl.textContent = results.length > 0 ? `找到 ${results.length} 条结果` : '未找到匹配内容';
    if (hintEl) {
      hintEl.textContent = hasCapturedChatGPTConversationData()
        ? '正在搜索当前对话。'
        : '正在搜索页面已识别内容。';
    }

    for (const result of results) {
      const item = document.createElement('div');
      item.className = [
        'cg-voyager-timeline-node',
        result.messageAnchor === activeAnchor ? 'cg-voyager-timeline-node-active' : '',
      ]
        .filter(Boolean)
        .join(' ');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.addEventListener('click', () => void handleSearchResultClick(result));
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void handleSearchResultClick(result);
      });

      const meta = document.createElement('div');
      meta.className = 'cg-voyager-timeline-node-meta';

      const index = document.createElement('span');
      index.className = 'cg-voyager-timeline-node-index';
      index.textContent = `#${result.resultIndex}`;

      const role = document.createElement('span');
      role.className = 'cg-voyager-timeline-node-role';
      role.textContent = searchRoleLabel(result.role);

      const summary = document.createElement('p');
      summary.className = 'cg-voyager-timeline-node-summary';
      if (result.messageAnchor === locatingAnchor) {
        summary.textContent = locatingText;
      } else {
        appendHighlightedText(summary, result.summary || '未识别内容', normalizedSearchQuery);
      }

      meta.append(index, role);
      item.append(meta, summary);
      listEl.appendChild(item);
    }
    return;
  }

  if (nodes.length === 0) {
    statusEl.textContent = timelineDataState === 'error' ? '时间轴加载失败' : '加载中...';
    if (hintEl) hintEl.textContent = '时间轴和搜索索引正在后台准备。';
    return;
  }

  statusEl.textContent = `共 ${nodes.length} 条消息`;
  if (hintEl) {
    hintEl.textContent = hasCapturedChatGPTConversationData()
      ? ''
      : '未捕获到完整对话数据，当前使用页面扫描结果。刷新页面后通常可获取更完整时间轴。';
  }
  for (const node of nodes) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = [
      'cg-voyager-timeline-marker',
      `cg-voyager-timeline-marker-${node.role}`,
      node.messageAnchor === activeAnchor ? 'cg-voyager-timeline-marker-active' : '',
    ]
      .filter(Boolean)
      .join(' ');
    marker.title = `${node.index}. ${roleLabel(node.role)}`;
    marker.addEventListener('click', () => void handleNodeClick(node));
    markerEl.appendChild(marker);

    const item = document.createElement('div');
    item.className = [
      'cg-voyager-timeline-node',
      node.messageAnchor === activeAnchor ? 'cg-voyager-timeline-node-active' : '',
    ]
      .filter(Boolean)
      .join(' ');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.addEventListener('click', () => void handleNodeClick(node));
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void handleNodeClick(node);
    });

    const meta = document.createElement('div');
    meta.className = 'cg-voyager-timeline-node-meta';

    const index = document.createElement('span');
    index.className = 'cg-voyager-timeline-node-index';
    index.textContent = `#${node.index}`;

    const role = document.createElement('span');
    role.className = 'cg-voyager-timeline-node-role';
    role.textContent = roleLabel(node.role);

    const summary = document.createElement('p');
    summary.className = 'cg-voyager-timeline-node-summary';
    summary.textContent =
      node.messageAnchor === locatingAnchor ? locatingText : node.summary || '未识别内容';

    meta.append(index, role);
    if (node.role === 'user') {
      const starKey = getNodeStarredKey(node);
      const isStarred = Boolean(starKey && starredMessageKeys.has(starKey));
      const star = document.createElement('button');
      star.type = 'button';
      star.className = [
        'cg-voyager-timeline-star',
        isStarred ? 'cg-voyager-timeline-star-active' : '',
      ]
        .filter(Boolean)
        .join(' ');
      star.title = isStarred ? '取消收藏' : '收藏消息';
      star.setAttribute('aria-label', isStarred ? '取消收藏' : '收藏消息');
      star.textContent = isStarred ? '★' : '☆';
      star.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleStarClick(node);
      });
      meta.appendChild(star);
    }
    item.append(meta, summary);
    listEl.appendChild(item);
  }
}

async function handleNodeClick(node: ChatGPTTimelineNode): Promise<void> {
  locatingAnchor = node.messageAnchor;
  locatingText = '正在定位...';
  renderList();
  if (statusEl) statusEl.textContent = '正在定位...';

  const scrolled = await progressiveScrollToNode(node);
  if (!scrolled && statusEl) {
    locatingAnchor = null;
    locatingText = '正在定位...';
    renderList();
    statusEl.textContent = '未能自动定位该消息，请手动滚动到附近后再试';
    return;
  }

  activeAnchor = node.messageAnchor;
  locatingAnchor = null;
  locatingText = '正在定位...';
  renderList();
  if (statusEl) statusEl.textContent = '已定位';
}

export async function scrollChatGPTTimelineToMessage(
  request: string | ChatGPTTimelineLocateRequest,
): Promise<boolean> {
  const target =
    typeof request === 'string'
      ? { messageAnchor: request }
      : {
          ...request,
          summary: request.snippet,
        };

  if (!chatgptAdapter.isSupportedPage() || (!target.turnId && !target.messageAnchor)) return false;
  if (target.conversationId && target.conversationId !== chatgptAdapter.getConversationId()) {
    return false;
  }

  if (nodes.length === 0) {
    requestCurrentChatGPTConversationCapture();
    await wait(250);
    nodes = readTimelineNodes();
    await refreshStarredState();
  }

  const node =
    nodes.find((item) => target.turnId && item.turnId === target.turnId) ||
    nodes.find((item) => target.messageId && item.messageId === target.messageId) ||
    nodes.find((item) => target.messageAnchor && item.messageAnchor === target.messageAnchor) ||
    nodes.find((item) => target.fingerprint && item.fingerprint === target.fingerprint) ||
    ({
      index: 0,
      role: target.role || 'user',
      summary: target.snippet || '',
      turnId: target.turnId,
      messageAnchor: target.messageAnchor || (target.turnId ? `chatgpt-turn:${target.turnId}` : ''),
      messageId: target.messageId,
      fingerprint: target.fingerprint,
      source: 'captured',
    } satisfies ChatGPTTimelineNode);

  const scrolled = await progressiveScrollToNode(node);
  if (scrolled) {
    activeAnchor = node.messageAnchor;
    locatingAnchor = null;
    locatingText = '正在定位...';
    renderList();
  }
  return scrolled;
}

async function refreshTimeline(requestCapture = true): Promise<void> {
  const startedAt = performance.now();
  timelineDataState = 'loading';
  renderList();
  try {
    if (requestCapture) {
      requestCurrentChatGPTConversationCapture();
      await wait(250);
    }
    nodes = readTimelineNodes();
    applyChatGPTMessageTimestamps(nodes);
    await refreshStarredState();
    timelineDataState = 'ready';
    performanceLog('时间轴数据准备耗时', startedAt, {
      nodes: nodes.length,
      captured: hasCapturedChatGPTConversationData(),
    });
    renderList();
    scheduleSearchIndexBuild(250);
  } catch {
    timelineDataState = 'error';
    renderList();
  }
}

function scheduleTimelineRefresh(requestCapture = true, delay = 600): void {
  if (timelineRefreshTimer !== null) {
    window.clearTimeout(timelineRefreshTimer);
  }
  timelineDataState = nodes.length > 0 ? timelineDataState : 'loading';
  renderList();
  timelineRefreshTimer = window.setTimeout(() => {
    timelineRefreshTimer = null;
    scheduleIdleTask(() => void refreshTimeline(requestCapture), 1800);
  }, delay);
}

function applyEnabledState(): void {
  const root = document.getElementById(ROOT_ID);
  root?.classList.toggle('cg-voyager-timeline-hidden', !enabled);
  if (enabled) scheduleTimelineRefresh(true, 900);
}

function setupResizeHandle(handle: HTMLDivElement, mode: 'width' | 'height' | 'both'): void {
  let startX = 0;
  let startY = 0;
  let startWidth = panelWidth;
  let startHeight = panelHeight;
  let resizing = false;

  const stopResize = () => {
    if (!resizing) return;
    resizing = false;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', stopResize, true);
    document.getElementById(ROOT_ID)?.classList.remove('cg-voyager-timeline-resizing');
    document.documentElement.style.userSelect = '';
    void writeWidthToStorage(panelWidth);
    void writeHeightToStorage(panelHeight);
  };

  const onMove = (event: PointerEvent) => {
    if (!resizing) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'width' || mode === 'both') {
      const delta = startX - event.clientX;
      panelWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
    }
    if (mode === 'height' || mode === 'both') {
      const delta = event.clientY - startY;
      panelHeight = clampHeight(startHeight + delta);
    }
    applyPanelSize();
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    resizing = true;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = panelWidth;
    startHeight = panelHeight;
    document.getElementById(ROOT_ID)?.classList.add('cg-voyager-timeline-resizing');
    document.documentElement.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', stopResize, true);
  });
}

export async function setChatGPTTimelineFloatingPanelVisible(nextEnabled: boolean): Promise<void> {
  enabled = nextEnabled;
  await writeEnabledToStorage(enabled);
  applyEnabledState();
}

export function isChatGPTTimelineFloatingPanelVisible(): boolean {
  return enabled;
}

function createPanel(): void {
  if (document.getElementById(ROOT_ID)) return;

  injectStyles();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'cg-voyager-timeline-root';

  const panelEl = document.createElement('div');
  panelEl.className = 'cg-voyager-timeline-panel';

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'cg-voyager-timeline-resize';

  const bottomResizeHandle = document.createElement('div');
  bottomResizeHandle.className = 'cg-voyager-timeline-resize-bottom';

  const cornerResizeHandle = document.createElement('div');
  cornerResizeHandle.className = 'cg-voyager-timeline-resize-corner';

  const rail = document.createElement('div');
  rail.className = 'cg-voyager-timeline-rail';

  markerEl = document.createElement('div');
  markerEl.className = 'cg-voyager-timeline-markers';

  const outline = document.createElement('div');
  outline.className = 'cg-voyager-timeline-outline';

  const header = document.createElement('div');
  header.className = 'cg-voyager-timeline-header';

  const title = document.createElement('p');
  title.className = 'cg-voyager-timeline-title';
  title.textContent = '时间轴';

  const actions = document.createElement('div');
  actions.className = 'cg-voyager-timeline-actions';

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'cg-voyager-timeline-action';
  refreshButton.textContent = '刷新';
  refreshButton.addEventListener('click', () => void refreshTimeline());

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'cg-voyager-timeline-action';
  closeButton.textContent = '隐藏';
  closeButton.addEventListener('click', () => void setChatGPTTimelineFloatingPanelVisible(false));

  statusEl = document.createElement('p');
  statusEl.className = 'cg-voyager-timeline-status';
  statusEl.textContent = '加载中...';

  hintEl = document.createElement('p');
  hintEl.className = 'cg-voyager-timeline-hint';
  hintEl.textContent = '';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'cg-voyager-timeline-search';

  searchInputEl = document.createElement('input');
  searchInputEl.type = 'search';
  searchInputEl.className = 'cg-voyager-timeline-search-input';
  searchInputEl.placeholder = '搜索当前对话';
  searchInputEl.autocomplete = 'off';
  searchInputEl.addEventListener('input', () => {
    searchQuery = searchInputEl?.value || '';
    if (normalizeSearchText(searchQuery) && searchIndexState !== 'ready') {
      scheduleSearchIndexBuild(0);
    }
    renderList();
  });
  searchInputEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    searchQuery = '';
    if (searchInputEl) searchInputEl.value = '';
    renderList();
  });

  searchClearButtonEl = document.createElement('button');
  searchClearButtonEl.type = 'button';
  searchClearButtonEl.className = 'cg-voyager-timeline-search-clear';
  searchClearButtonEl.textContent = '清空';
  searchClearButtonEl.addEventListener('click', () => {
    searchQuery = '';
    if (searchInputEl) {
      searchInputEl.value = '';
      searchInputEl.focus();
    }
    renderList();
  });

  listEl = document.createElement('div');
  listEl.className = 'cg-voyager-timeline-list';

  searchWrap.append(searchInputEl, searchClearButtonEl);
  actions.append(refreshButton, closeButton);
  header.append(title, actions);
  rail.appendChild(markerEl);
  outline.append(header, searchWrap, statusEl, hintEl, listEl);
  panelEl.append(resizeHandle, rail, outline, bottomResizeHandle, cornerResizeHandle);
  root.appendChild(panelEl);
  document.documentElement.appendChild(root);
  applyDarkModeState();
  applyPanelSize();
  setupResizeHandle(resizeHandle, 'width');
  setupResizeHandle(bottomResizeHandle, 'height');
  setupResizeHandle(cornerResizeHandle, 'both');
}

function watchConversationChanges(): void {
  window.setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    nodes = [];
    searchIndex = [];
    searchIndexState = 'idle';
    timelineDataState = 'loading';
    if (enabled) scheduleTimelineRefresh(true, 900);
  }, 1000);
}

export function startChatGPTTimelineFloatingPanel(): void {
  const startedAt = performance.now();
  if (started || !chatgptAdapter.isSupportedPage()) return;
  started = true;
  lastUrl = location.href;
  createPanel();
  timelineDataState = 'loading';
  renderList();
  readEnabledFromStorage().then((storedEnabled) => {
    enabled = storedEnabled;
    const root = document.getElementById(ROOT_ID);
    root?.classList.toggle('cg-voyager-timeline-hidden', !enabled);
    if (enabled) scheduleTimelineRefresh(true, 1200);
  });
  readWidthFromStorage().then((storedWidth) => {
    panelWidth = storedWidth;
    applyPanelSize();
  });
  readHeightFromStorage().then((storedHeight) => {
    panelHeight = storedHeight;
    applyPanelSize();
  });
  readDarkModeFromStorage().then((storedDarkMode) => {
    panelDarkMode = storedDarkMode;
    applyDarkModeState();
  });
  watchDarkModeChanges();
  window.addEventListener('cg-voyager-chatgpt-conversation-captured', () => {
    if (enabled) scheduleTimelineRefresh(false, 250);
    scheduleSearchIndexBuild(350);
  });
  watchConversationChanges();
  performanceLog('插件初始化耗时', startedAt, { component: 'timeline-shell' });
}
