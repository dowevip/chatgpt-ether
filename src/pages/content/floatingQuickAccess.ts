import {
  highlightChatGPTMessageElement,
  insertPromptIntoChatGPTInput,
  locateMessageTurn,
  scrollChatGPTMessageIntoView,
} from '@/core/adapters/chatgptAdapter';

import {
  isChatGPTTimelineFloatingPanelVisible,
  setChatGPTTimelineFloatingPanelVisible,
} from './timelineFloatingPanel';

const ROOT_ID = 'cg-voyager-quick-access-root';
const PANEL_ID = 'cg-voyager-quick-module';
const STYLE_ID = 'cg-voyager-quick-access-style';
const POSITION_STORAGE_KEY = 'chatgptVoyager.quickAccess.position';
const PANEL_POSITION_STORAGE_KEY = 'chatgptVoyager.quickAccess.panelPosition';
const DARK_MODE_STORAGE_KEY = 'darkMode';
const PROMPTS_STORAGE_KEY = 'chatgptVoyager.prompts';
const FOLDERS_STORAGE_KEY = 'chatgptVoyager.folders';
const CONVERSATIONS_STORAGE_KEY = 'chatgptVoyager.conversations';
const STARRED_STORAGE_KEY = 'chatgptVoyager.starredMessages';
const DRAG_THRESHOLD = 4;
const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 600;

type FloatingPosition = {
  left: number;
  top: number;
};

type QuickPanelTarget = 'promptVault' | 'folders' | 'starred';

type PromptItem = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  favorite?: boolean;
  updatedAt?: number;
};

type FolderItem = {
  id: string;
  name: string;
  parentId?: string | null;
};

type ConversationItem = {
  conversationId: string;
  title: string;
  url: string;
  folderId?: string | null;
  note?: string;
  updatedAt?: number;
  lastOpenedAt?: number;
};

type StarredItem = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  url: string;
  turnId?: string;
  messageId?: string;
  messageAnchor?: string;
  fingerprint?: string;
  snippet: string;
  createdAt: number;
};

let started = false;
let buttonEl: HTMLButtonElement | null = null;
let toastEl: HTMLDivElement | null = null;
let rootEl: HTMLDivElement | null = null;
let panelEl: HTMLDivElement | null = null;
let panelBodyEl: HTMLDivElement | null = null;
let panelStatusEl: HTMLDivElement | null = null;
let position: FloatingPosition | null = null;
let panelPosition: FloatingPosition | null = null;
let panelOpen = false;
let activePanel: QuickPanelTarget = 'promptVault';
let draggedDuringPointer = false;
let toastTimer: number | null = null;

function isChatGPTPage(): boolean {
  return location.hostname === 'chatgpt.com';
}

function getDefaultPosition(): FloatingPosition {
  return {
    left: Math.max(12, window.innerWidth - 72),
    top: Math.max(120, Math.round(window.innerHeight * 0.62)),
  };
}

function getDefaultPanelPosition(): FloatingPosition {
  return {
    left: Math.max(16, window.innerWidth - PANEL_WIDTH - 88),
    top: Math.max(88, Math.round((window.innerHeight - PANEL_HEIGHT) / 2)),
  };
}

function clampPosition(next: FloatingPosition): FloatingPosition {
  const rootRect = rootEl?.getBoundingClientRect();
  const width = rootRect?.width || 44;
  const height = rootRect?.height || 44;
  return {
    left: Math.min(Math.max(8, next.left), Math.max(8, window.innerWidth - width - 8)),
    top: Math.min(Math.max(72, next.top), Math.max(72, window.innerHeight - height - 96)),
  };
}

function clampPanelPosition(next: FloatingPosition): FloatingPosition {
  return {
    left: Math.min(Math.max(12, next.left), Math.max(12, window.innerWidth - PANEL_WIDTH - 12)),
    top: Math.min(Math.max(72, next.top), Math.max(72, window.innerHeight - PANEL_HEIGHT - 24)),
  };
}

function applyPosition(): void {
  if (!rootEl || !position) return;
  const next = clampPosition(position);
  position = next;
  rootEl.style.left = `${next.left}px`;
  rootEl.style.top = `${next.top}px`;
}

function applyPanelPosition(): void {
  if (!panelEl || !panelPosition) return;
  const next = clampPanelPosition(panelPosition);
  panelPosition = next;
  panelEl.style.left = `${next.left}px`;
  panelEl.style.top = `${next.top}px`;
}

async function readPosition(): Promise<FloatingPosition> {
  try {
    const result = await chrome.storage?.local?.get({ [POSITION_STORAGE_KEY]: null });
    const saved = result?.[POSITION_STORAGE_KEY] as Partial<FloatingPosition> | null;
    if (typeof saved?.left === 'number' && typeof saved?.top === 'number') {
      return clampPosition(saved as FloatingPosition);
    }
  } catch {}
  return getDefaultPosition();
}

async function readPanelPosition(): Promise<FloatingPosition> {
  try {
    const result = await chrome.storage?.local?.get({ [PANEL_POSITION_STORAGE_KEY]: null });
    const saved = result?.[PANEL_POSITION_STORAGE_KEY] as Partial<FloatingPosition> | null;
    if (typeof saved?.left === 'number' && typeof saved?.top === 'number') {
      return clampPanelPosition(saved as FloatingPosition);
    }
  } catch {}
  return getDefaultPanelPosition();
}

async function writePosition(next: FloatingPosition): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [POSITION_STORAGE_KEY]: clampPosition(next) });
  } catch {}
}

async function writePanelPosition(next: FloatingPosition): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [PANEL_POSITION_STORAGE_KEY]: clampPanelPosition(next) });
  } catch {}
}

async function readDarkMode(): Promise<boolean> {
  try {
    const result = await chrome.storage?.local?.get({ [DARK_MODE_STORAGE_KEY]: false });
    return result?.[DARK_MODE_STORAGE_KEY] === true;
  } catch {
    return false;
  }
}

function applyDarkMode(enabled: boolean): void {
  rootEl?.classList.toggle('cg-voyager-quick-access-dark', enabled);
  panelEl?.classList.toggle('cg-voyager-quick-module-dark', enabled);
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cg-voyager-quick-access-root {
      position: fixed;
      z-index: 2147483000;
      width: 44px;
      height: 44px;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124;
    }
    .cg-voyager-quick-access-button {
      width: 44px;
      height: 44px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.94);
      color: #047857;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
      cursor: grab;
      display: grid;
      place-items: center;
      font-size: 18px;
      font-weight: 800;
      user-select: none;
      backdrop-filter: blur(12px);
      transition:
        transform 140ms ease,
        box-shadow 140ms ease,
        background 140ms ease;
    }
    .cg-voyager-quick-access-button:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.22);
    }
    .cg-voyager-quick-access-button:active {
      cursor: grabbing;
      transform: scale(0.98);
    }
    .cg-voyager-quick-module {
      position: fixed;
      z-index: 2147482999;
      width: ${PANEL_WIDTH}px;
      height: ${PANEL_HEIGHT}px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
      display: none;
      overflow: hidden;
      backdrop-filter: blur(14px);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124;
    }
    .cg-voyager-quick-module-open {
      display: flex;
      flex-direction: column;
    }
    .cg-voyager-quick-module-header {
      min-height: 48px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: rgba(248, 250, 252, 0.9);
    }
    .cg-voyager-quick-module-grip {
      width: 26px;
      height: 30px;
      border: 0;
      background: transparent;
      color: #64748b;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
      user-select: none;
    }
    .cg-voyager-quick-module-grip:active {
      cursor: grabbing;
    }
    .cg-voyager-quick-module-title {
      font-size: 14px;
      font-weight: 750;
      color: #047857;
      margin-right: auto;
      white-space: nowrap;
    }
    .cg-voyager-quick-module-tabs {
      display: flex;
      gap: 4px;
    }
    .cg-voyager-quick-module-tab,
    .cg-voyager-quick-module-close,
    .cg-voyager-quick-module-action,
    .cg-voyager-quick-module-link {
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.3;
    }
    .cg-voyager-quick-module-tab {
      background: transparent;
      color: #475569;
      padding: 6px 8px;
    }
    .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-tab:hover {
      background: rgba(5, 150, 105, 0.1);
      color: #047857;
    }
    .cg-voyager-quick-module-close {
      width: 28px;
      height: 28px;
      background: transparent;
      color: #64748b;
      font-size: 18px;
    }
    .cg-voyager-quick-module-close:hover {
      background: rgba(15, 23, 42, 0.08);
      color: #0f172a;
    }
    .cg-voyager-quick-module-toolbar {
      display: flex;
      gap: 8px;
      padding: 10px 12px 0;
    }
    .cg-voyager-quick-module-search {
      flex: 1;
      height: 34px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 9px;
      background: #fff;
      color: #202124;
      outline: none;
      padding: 0 10px;
      font-size: 12px;
    }
    .cg-voyager-quick-module-body {
      flex: 1;
      overflow: auto;
      padding: 10px 12px 12px;
    }
    .cg-voyager-quick-module-status {
      min-height: 24px;
      border-top: 1px solid rgba(15, 23, 42, 0.08);
      padding: 6px 12px;
      color: #64748b;
      font-size: 11px;
      background: rgba(248, 250, 252, 0.88);
    }
    .cg-voyager-quick-module-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cg-voyager-quick-module-item {
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.82);
    }
    .cg-voyager-quick-module-item-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .cg-voyager-quick-module-item-meta,
    .cg-voyager-quick-module-item-preview {
      color: #64748b;
      font-size: 11px;
      line-height: 1.45;
      word-break: break-word;
    }
    .cg-voyager-quick-module-item-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .cg-voyager-quick-module-action {
      background: #047857;
      color: #fff;
      padding: 6px 10px;
    }
    .cg-voyager-quick-module-action:hover {
      background: #065f46;
    }
    .cg-voyager-quick-module-link {
      background: rgba(15, 23, 42, 0.06);
      color: #334155;
      padding: 6px 10px;
    }
    .cg-voyager-quick-module-link:hover {
      background: rgba(15, 23, 42, 0.1);
    }
    .cg-voyager-quick-module-delete {
      background: rgba(220, 38, 38, 0.08);
      color: #b91c1c;
      padding: 6px 10px;
    }
    .cg-voyager-quick-module-delete:hover {
      background: rgba(220, 38, 38, 0.14);
    }
    .cg-voyager-quick-module-empty {
      border: 1px dashed rgba(15, 23, 42, 0.16);
      border-radius: 10px;
      padding: 20px 12px;
      color: #64748b;
      font-size: 12px;
      text-align: center;
    }
    .cg-voyager-quick-access-toast {
      position: absolute;
      right: 0;
      bottom: 52px;
      width: 220px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.98);
      color: #202124;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
      padding: 10px 12px;
      display: none;
      font-size: 12px;
      line-height: 1.45;
      backdrop-filter: blur(14px);
    }
    .cg-voyager-quick-access-root.cg-voyager-quick-access-toast-open .cg-voyager-quick-access-toast {
      display: block;
    }
    .cg-voyager-quick-access-dark {
      color: #f8fafc;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(20, 24, 31, 0.96);
      color: #7dd3fc;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
    }
    .cg-voyager-quick-module-dark {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(20, 24, 31, 0.98);
      color: #f8fafc;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-header,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-status {
      border-color: rgba(148, 163, 184, 0.18);
      background: rgba(15, 23, 42, 0.82);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-title,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab:hover {
      color: #7dd3fc;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab {
      color: #cbd5e1;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab:hover {
      background: rgba(125, 211, 252, 0.12);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-search {
      border-color: rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item {
      border-color: rgba(148, 163, 184, 0.18);
      background: rgba(15, 23, 42, 0.78);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-title {
      color: #f8fafc;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-meta,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-preview,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-empty,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-status {
      color: #94a3b8;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-link,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-close {
      background: rgba(148, 163, 184, 0.12);
      color: #e2e8f0;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-delete {
      background: rgba(248, 113, 113, 0.12);
      color: #fca5a5;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-toast {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(20, 24, 31, 0.96);
      color: #f8fafc;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
    }
  `;
  document.documentElement.appendChild(style);
}

function setPanelOpen(nextOpen: boolean, target: QuickPanelTarget = activePanel): void {
  panelOpen = nextOpen;
  activePanel = target;
  panelEl?.classList.toggle('cg-voyager-quick-module-open', panelOpen);
  if (panelOpen) {
    void renderActivePanel();
  }
}

async function toggleTimelineVisibility(): Promise<void> {
  const nextVisible = !isChatGPTTimelineFloatingPanelVisible();
  await setChatGPTTimelineFloatingPanelVisible(nextVisible);
  setStatus(nextVisible ? '页面时间轴已显示。' : '页面时间轴已隐藏。');
}

function showTemporaryMessage(message: string): void {
  if (!toastEl || !rootEl) return;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastEl.textContent = message;
  rootEl.classList.add('cg-voyager-quick-access-toast-open');
  toastTimer = window.setTimeout(() => {
    rootEl?.classList.remove('cg-voyager-quick-access-toast-open');
    toastTimer = null;
  }, 3600);
}

function setStatus(message: string): void {
  if (panelStatusEl) panelStatusEl.textContent = message;
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (typeof text === 'string') element.textContent = text;
  return element;
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortText(value: unknown, limit: number): string {
  const text = normalizeText(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function getCurrentConversationId(): string | null {
  try {
    return new URL(location.href).pathname.match(/\/c\/([^/?#]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

async function readStorageArray<T>(key: string): Promise<T[]> {
  try {
    const result = await chrome.storage?.local?.get({ [key]: [] });
    const value = result?.[key];
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function createSearchInput(
  placeholder: string,
  onInput: (query: string) => void,
): HTMLInputElement {
  const input = createEl('input', 'cg-voyager-quick-module-search') as HTMLInputElement;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

function resetPanelContent(): void {
  if (!panelBodyEl) return;
  panelBodyEl.textContent = '';
  setStatus('');
}

function appendEmpty(message: string): void {
  panelBodyEl?.append(createEl('div', 'cg-voyager-quick-module-empty', message));
}

async function renderPromptVaultPanel(query = ''): Promise<void> {
  resetPanelContent();
  if (!panelBodyEl) return;

  const toolbar = createEl('div', 'cg-voyager-quick-module-toolbar');
  const list = createEl('div', 'cg-voyager-quick-module-section');
  const searchInput = createSearchInput(
    '搜索提示词',
    (nextQuery) => void renderPromptVaultPanel(nextQuery),
  );
  searchInput.value = query;
  toolbar.append(searchInput);
  panelBodyEl.append(toolbar, list);

  const prompts = await readStorageArray<PromptItem>(PROMPTS_STORAGE_KEY);
  const normalizedQuery = normalizeText(query).toLowerCase();
  const filtered = prompts
    .filter((prompt) => {
      const haystack =
        `${prompt.title} ${prompt.content} ${(prompt.tags || []).join(' ')}`.toLowerCase();
      return !normalizedQuery || haystack.includes(normalizedQuery);
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) ||
        (right.updatedAt || 0) - (left.updatedAt || 0),
    );

  list.textContent = '';
  if (!filtered.length) {
    list.append(
      createEl(
        'div',
        'cg-voyager-quick-module-empty',
        prompts.length ? '未找到匹配提示词。' : '暂无提示词。',
      ),
    );
    setStatus(`共 ${prompts.length} 条提示词。`);
    return;
  }

  for (const prompt of filtered) {
    const item = createEl('div', 'cg-voyager-quick-module-item');
    item.append(
      createEl(
        'div',
        'cg-voyager-quick-module-item-title',
        `${prompt.favorite ? '★ ' : ''}${prompt.title || '未命名提示词'}`,
      ),
      createEl('div', 'cg-voyager-quick-module-item-preview', shortText(prompt.content, 120)),
    );
    if (prompt.tags?.length) {
      item.append(createEl('div', 'cg-voyager-quick-module-item-meta', prompt.tags.join(' · ')));
    }
    const actions = createEl('div', 'cg-voyager-quick-module-item-actions');
    const insertButton = createEl('button', 'cg-voyager-quick-module-action', '插入');
    insertButton.addEventListener('click', () => {
      const result = insertPromptIntoChatGPTInput(prompt.content || '');
      setStatus(result.ok ? '已插入到 ChatGPT 输入框。' : result.error || '插入失败。');
      if (!result.ok) showTemporaryMessage(result.error || '插入失败。');
    });
    actions.append(insertButton);
    item.append(actions);
    list.append(item);
  }
  setStatus(`显示 ${filtered.length} / ${prompts.length} 条提示词。`);
}

async function renderFoldersPanel(): Promise<void> {
  resetPanelContent();
  if (!panelBodyEl) return;

  const [folders, conversations] = await Promise.all([
    readStorageArray<FolderItem>(FOLDERS_STORAGE_KEY),
    readStorageArray<ConversationItem>(CONVERSATIONS_STORAGE_KEY),
  ]);
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const section = createEl('div', 'cg-voyager-quick-module-section');
  panelBodyEl.append(section);

  if (!conversations.length) {
    appendEmpty('暂无已保存对话。请先在弹窗的对话文件夹中保存当前对话。');
    setStatus(`文件夹 ${folders.length} 个，对话 0 个。`);
    return;
  }

  const sorted = [...conversations].sort(
    (left, right) =>
      (right.lastOpenedAt || right.updatedAt || 0) - (left.lastOpenedAt || left.updatedAt || 0),
  );
  for (const conversation of sorted) {
    const folderName = conversation.folderId
      ? folderNameById.get(conversation.folderId) || '未知文件夹'
      : '未分类';
    const item = createEl('div', 'cg-voyager-quick-module-item');
    item.append(
      createEl('div', 'cg-voyager-quick-module-item-title', conversation.title || '未命名对话'),
      createEl(
        'div',
        'cg-voyager-quick-module-item-meta',
        `${folderName}${conversation.note ? ` · ${shortText(conversation.note, 48)}` : ''}`,
      ),
    );
    const actions = createEl('div', 'cg-voyager-quick-module-item-actions');
    const openButton = createEl('button', 'cg-voyager-quick-module-link', '打开对话');
    openButton.addEventListener('click', () => {
      if (conversation.url) {
        location.assign(conversation.url);
      } else {
        setStatus('该对话缺少 URL，无法打开。');
      }
    });
    const deleteButton = createEl('button', 'cg-voyager-quick-module-delete', '删除');
    deleteButton.addEventListener('click', async () => {
      const title = conversation.title || '未命名对话';
      if (
        !window.confirm(`从插件的对话索引中删除「${title}」？这不会删除 ChatGPT 中的原始对话。`)
      ) {
        return;
      }

      try {
        const nextConversations = conversations.filter(
          (item) => item.conversationId !== conversation.conversationId,
        );
        await chrome.storage?.local?.set({ [CONVERSATIONS_STORAGE_KEY]: nextConversations });
        setStatus('已从对话索引中删除。');
        await renderFoldersPanel();
      } catch {
        setStatus('删除已保存对话失败。');
      }
    });
    actions.append(openButton, deleteButton);
    item.append(actions);
    section.append(item);
  }
  setStatus(`文件夹 ${folders.length} 个，对话 ${conversations.length} 个。`);
}

async function locateStarredMessage(message: StarredItem): Promise<void> {
  if (getCurrentConversationId() !== message.conversationId) {
    if (message.url) {
      location.assign(message.url);
      return;
    }
    setStatus('该收藏缺少对话 URL，无法打开。');
    return;
  }

  const result = locateMessageTurn({
    role: 'user',
    turnId: message.turnId,
    messageId: message.messageId,
    anchor: message.messageAnchor,
    fingerprint: message.fingerprint,
    snippet: message.snippet,
  });
  if (!result.ok || !result.targetElement) {
    setStatus('未能自动定位收藏消息，请滚动到附近后再试。');
    return;
  }

  await scrollChatGPTMessageIntoView(result.targetElement);
  highlightChatGPTMessageElement(result.targetElement);
  setStatus('已定位收藏消息。');
}

async function renderStarredPanel(): Promise<void> {
  resetPanelContent();
  if (!panelBodyEl) return;

  const messages = await readStorageArray<StarredItem>(STARRED_STORAGE_KEY);
  const section = createEl('div', 'cg-voyager-quick-module-section');
  panelBodyEl.append(section);

  if (!messages.length) {
    appendEmpty('暂无收藏消息。可在右侧时间轴节点上收藏用户发言。');
    setStatus('收藏消息 0 条。');
    return;
  }

  for (const message of messages.sort(
    (left, right) => (right.createdAt || 0) - (left.createdAt || 0),
  )) {
    const item = createEl('div', 'cg-voyager-quick-module-item');
    item.append(
      createEl(
        'div',
        'cg-voyager-quick-module-item-title',
        message.conversationTitle || '未命名对话',
      ),
      createEl('div', 'cg-voyager-quick-module-item-preview', shortText(message.snippet, 100)),
      createEl('div', 'cg-voyager-quick-module-item-meta', formatTime(message.createdAt)),
    );
    const actions = createEl('div', 'cg-voyager-quick-module-item-actions');
    const openButton = createEl('button', 'cg-voyager-quick-module-link', '打开 / 定位');
    openButton.addEventListener('click', () => {
      setStatus('正在定位收藏消息…');
      void locateStarredMessage(message).catch(() => setStatus('定位失败，请稍后再试。'));
    });
    actions.append(openButton);
    item.append(actions);
    section.append(item);
  }
  setStatus(`收藏消息 ${messages.length} 条。`);
}

async function renderActivePanel(): Promise<void> {
  updateTabs();
  if (activePanel === 'promptVault') {
    await renderPromptVaultPanel();
    return;
  }
  if (activePanel === 'folders') {
    await renderFoldersPanel();
    return;
  }
  await renderStarredPanel();
}

function updateTabs(): void {
  panelEl?.querySelectorAll<HTMLButtonElement>('[data-cg-voyager-panel]').forEach((button) => {
    button.classList.toggle(
      'cg-voyager-quick-module-tab-active',
      button.dataset.cgVoyagerPanel === activePanel,
    );
  });
}

function switchPanel(target: QuickPanelTarget): void {
  activePanel = target;
  void renderActivePanel();
}

function createTab(label: string, target: QuickPanelTarget): HTMLButtonElement {
  const tab = createEl('button', 'cg-voyager-quick-module-tab', label);
  tab.type = 'button';
  tab.dataset.cgVoyagerPanel = target;
  tab.addEventListener('click', () => switchPanel(target));
  return tab;
}

function createPanel(): void {
  if (document.getElementById(PANEL_ID)) return;

  panelEl = createEl('div', 'cg-voyager-quick-module') as HTMLDivElement;
  panelEl.id = PANEL_ID;

  const header = createEl('div', 'cg-voyager-quick-module-header');
  const grip = createEl('button', 'cg-voyager-quick-module-grip', '⋮⋮');
  grip.type = 'button';
  grip.title = '拖动面板';
  const title = createEl('div', 'cg-voyager-quick-module-title', 'ChatGPT以太');
  const tabs = createEl('div', 'cg-voyager-quick-module-tabs');
  tabs.append(
    createTab('提示词库', 'promptVault'),
    createTab('对话文件夹', 'folders'),
    createTab('收藏消息', 'starred'),
  );
  const closeButton = createEl('button', 'cg-voyager-quick-module-close', '×');
  closeButton.type = 'button';
  closeButton.title = '关闭';
  closeButton.addEventListener('click', () => setPanelOpen(false));

  header.append(grip, title, tabs, closeButton);

  const quickToolbar = createEl('div', 'cg-voyager-quick-module-toolbar');
  const timelineButton = createEl('button', 'cg-voyager-quick-module-link', '显示/隐藏时间轴');
  timelineButton.addEventListener('click', () => void toggleTimelineVisibility());
  quickToolbar.append(timelineButton);

  panelBodyEl = createEl('div', 'cg-voyager-quick-module-body') as HTMLDivElement;
  panelStatusEl = createEl('div', 'cg-voyager-quick-module-status', '') as HTMLDivElement;
  panelEl.append(header, quickToolbar, panelBodyEl, panelStatusEl);
  document.documentElement.appendChild(panelEl);
  setupPanelDragging(grip);
}

function createRoot(): void {
  if (document.getElementById(ROOT_ID)) return;
  injectStyles();

  rootEl = document.createElement('div');
  rootEl.id = ROOT_ID;
  rootEl.className = 'cg-voyager-quick-access-root';

  buttonEl = document.createElement('button');
  buttonEl.type = 'button';
  buttonEl.className = 'cg-voyager-quick-access-button';
  buttonEl.title = 'ChatGPT以太';
  buttonEl.textContent = 'E';

  toastEl = document.createElement('div');
  toastEl.className = 'cg-voyager-quick-access-toast';

  rootEl.append(buttonEl, toastEl);
  document.documentElement.appendChild(rootEl);
  createPanel();
}

function setupDragging(): void {
  if (!buttonEl || !rootEl) return;

  let dragging = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    buttonEl?.classList.remove('cg-voyager-quick-access-dragging');
    if (position) void writePosition(position);
  };

  buttonEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    draggedDuringPointer = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = position?.left ?? rootEl?.getBoundingClientRect().left ?? 0;
    startTop = position?.top ?? rootEl?.getBoundingClientRect().top ?? 0;
    buttonEl?.setPointerCapture(event.pointerId);
  });

  buttonEl.addEventListener('pointermove', (event) => {
    if (!dragging || pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
      draggedDuringPointer = true;
    }
    position = clampPosition({
      left: startLeft + deltaX,
      top: startTop + deltaY,
    });
    applyPosition();
  });

  buttonEl.addEventListener('pointerup', (event) => {
    if (pointerId === event.pointerId) stopDragging();
  });

  buttonEl.addEventListener('pointercancel', (event) => {
    if (pointerId === event.pointerId) stopDragging();
  });

  buttonEl.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedDuringPointer) {
      draggedDuringPointer = false;
      return;
    }
    setPanelOpen(!panelOpen, activePanel || 'promptVault');
  });
}

function setupPanelDragging(handle: HTMLElement): void {
  let dragging = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    if (panelPosition) void writePanelPosition(panelPosition);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = panelPosition?.left ?? panelEl?.getBoundingClientRect().left ?? 0;
    startTop = panelPosition?.top ?? panelEl?.getBoundingClientRect().top ?? 0;
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging || pointerId !== event.pointerId) return;
    panelPosition = clampPanelPosition({
      left: startLeft + event.clientX - startX,
      top: startTop + event.clientY - startY,
    });
    applyPanelPosition();
  });

  handle.addEventListener('pointerup', (event) => {
    if (pointerId === event.pointerId) stopDragging();
  });

  handle.addEventListener('pointercancel', (event) => {
    if (pointerId === event.pointerId) stopDragging();
  });
}

function watchDarkModeChanges(): void {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[DARK_MODE_STORAGE_KEY]) return;
    applyDarkMode(changes[DARK_MODE_STORAGE_KEY].newValue === true);
  });
}

export function startChatGPTFloatingQuickAccess(): void {
  if (started || !isChatGPTPage()) return;
  started = true;
  createRoot();
  setupDragging();
  window.addEventListener('resize', () => applyPosition());
  window.addEventListener('resize', () => applyPanelPosition());
  readPosition().then((savedPosition) => {
    position = savedPosition;
    applyPosition();
  });
  readPanelPosition().then((savedPosition) => {
    panelPosition = savedPosition;
    applyPanelPosition();
  });
  readDarkMode().then(applyDarkMode);
  watchDarkModeChanges();
}
