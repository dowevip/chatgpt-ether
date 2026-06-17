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
const POSITION_STORAGE_KEY = 'chatgptEther.quickAccess.position';
const PANEL_POSITION_STORAGE_KEY = 'chatgptEther.quickAccess.panelPosition';
const DARK_MODE_STORAGE_KEY = 'darkMode';
const PROMPTS_STORAGE_KEY = 'chatgptEther.prompts';
const FOLDERS_STORAGE_KEY = 'chatgptEther.folders';
const CONVERSATIONS_STORAGE_KEY = 'chatgptEther.conversations';
const STARRED_STORAGE_KEY = 'chatgptEther.starredMessages';
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
  createdAt?: number;
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
let editingPromptId: string | null = null;
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
  const width = rootRect?.width || 48;
  const height = rootRect?.height || 48;
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
    const result = await chrome.storage?.local?.get({
      [POSITION_STORAGE_KEY]: null,
    });
    const saved = result?.[POSITION_STORAGE_KEY] as Partial<FloatingPosition> | null;
    if (typeof saved?.left === 'number' && typeof saved?.top === 'number') {
      return clampPosition(saved as FloatingPosition);
    }
  } catch {}
  return getDefaultPosition();
}

async function readPanelPosition(): Promise<FloatingPosition> {
  try {
    const result = await chrome.storage?.local?.get({
      [PANEL_POSITION_STORAGE_KEY]: null,
    });
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
      --cg-surface: #ffffff;
      --cg-surface-subtle: #F7F6FC;
      --cg-border: #E7E4F8;
      --cg-text: #202332;
      --cg-muted: #667085;
      --cg-soft: #F4F2FF;
      --cg-soft-hover: #E7E4F8;
      --cg-accent: #7C6FF6;
      --cg-accent-hover: #6E61E8;
      position: fixed;
      z-index: 2147483000;
      width: 48px;
      height: 48px;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--cg-text);
    }
    .cg-voyager-quick-access-button {
      width: 48px;
      height: 48px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #fff;
      box-shadow: none;
      cursor: grab;
      display: grid;
      place-items: center;
      padding: 0;
      user-select: none;
      transition:
        transform 140ms ease,
        filter 140ms ease;
    }
    .cg-voyager-quick-access-button:focus-visible {
      outline: none;
      filter: drop-shadow(0 0 0 3px rgba(124, 111, 246, 0.2));
    }
    .cg-voyager-quick-access-button-icon {
      width: 48px;
      height: 48px;
      display: block;
      filter: drop-shadow(0 10px 28px rgba(32, 35, 50, 0.28));
      transition:
        transform 140ms ease,
        filter 140ms ease;
    }
    .cg-voyager-quick-access-button-icon-bg {
      fill: #6E61E8;
      transition: fill 140ms ease;
    }
    .cg-voyager-quick-access-button-icon-ring {
      stroke: rgba(255, 255, 255, 0.32);
      transition: stroke 140ms ease;
    }
    .cg-voyager-quick-access-button-icon-stroke {
      stroke: #fff;
    }
    .cg-voyager-quick-access-button-icon-accent {
      fill: #DCD7FF;
      stroke: #DCD7FF;
      transition:
        fill 140ms ease,
        stroke 140ms ease;
    }
    .cg-voyager-quick-access-button:hover {
      transform: translateY(-1px);
    }
    .cg-voyager-quick-access-button:hover .cg-voyager-quick-access-button-icon {
      filter: drop-shadow(0 14px 34px rgba(32, 35, 50, 0.34));
    }
    .cg-voyager-quick-access-button:hover .cg-voyager-quick-access-button-icon-bg {
      fill: #7C6FF6;
    }
    .cg-voyager-quick-access-button:active {
      cursor: grabbing;
      transform: translateY(0);
    }
    .cg-voyager-quick-access-button:active .cg-voyager-quick-access-button-icon {
      transform: scale(0.98);
      filter: drop-shadow(0 8px 18px rgba(32, 35, 50, 0.22));
    }
    .cg-voyager-quick-access-button:active .cg-voyager-quick-access-button-icon-bg {
      fill: #202332;
    }
    .cg-voyager-quick-module {
      --cg-surface: #ffffff;
      --cg-surface-subtle: #F7F6FC;
      --cg-border: #E7E4F8;
      --cg-text: #202332;
      --cg-muted: #667085;
      --cg-soft: #F4F2FF;
      --cg-soft-hover: #E7E4F8;
      --cg-accent: #7C6FF6;
      --cg-accent-hover: #6E61E8;
      position: fixed;
      z-index: 2147482999;
      width: ${PANEL_WIDTH}px;
      height: ${PANEL_HEIGHT}px;
      border: 1px solid var(--cg-border);
      border-radius: 12px;
      background: rgba(251, 250, 255, 0.98);
      box-shadow: 0 16px 36px rgba(32, 35, 50, 0.13);
      display: none;
      overflow: hidden;
      backdrop-filter: blur(14px);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--cg-text);
    }
    .cg-voyager-quick-module-open {
      display: flex;
      flex-direction: column;
    }
    .cg-voyager-quick-module-header {
      min-height: 44px;
      border-bottom: 1px solid var(--cg-border);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: rgba(251, 250, 255, 0.92);
    }
    .cg-voyager-quick-module-grip {
      width: 26px;
      height: 30px;
      border: 0;
      background: transparent;
      color: var(--cg-muted);
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
      font-weight: 650;
      color: #3D365C;
      margin-right: auto;
      white-space: nowrap;
    }
    .cg-voyager-quick-module-tabs {
      display: flex;
      gap: 8px;
    }
    .cg-voyager-quick-module-tab,
    .cg-voyager-quick-module-close,
    .cg-voyager-quick-module-action,
    .cg-voyager-quick-module-link,
    .cg-voyager-quick-module-secondary,
    .cg-voyager-quick-module-delete {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.3;
      box-sizing: border-box;
      user-select: none;
      box-shadow: 0 1px 0 rgba(32, 35, 50, 0.03);
    }
    .cg-voyager-quick-module-tab:focus-visible,
    .cg-voyager-quick-module-close:focus-visible,
    .cg-voyager-quick-module-action:focus-visible,
    .cg-voyager-quick-module-link:focus-visible,
    .cg-voyager-quick-module-secondary:focus-visible,
    .cg-voyager-quick-module-delete:focus-visible {
      outline: none;
      border-color: rgba(124, 111, 246, 0.58);
      box-shadow: 0 0 0 3px rgba(124, 111, 246, 0.13);
    }
    .cg-voyager-quick-module-tab:active,
    .cg-voyager-quick-module-close:active,
    .cg-voyager-quick-module-action:active,
    .cg-voyager-quick-module-link:active,
    .cg-voyager-quick-module-secondary:active,
    .cg-voyager-quick-module-delete:active {
      transform: translateY(1px);
    }
    .cg-voyager-quick-module-tab {
      min-height: 36px;
      border-color: rgba(231, 228, 248, 0.72);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.72);
      color: #667085;
      padding: 7px 14px;
      font-weight: 600;
      transition:
        background 140ms ease,
        border-color 140ms ease,
        color 140ms ease;
    }
    .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-tab:hover {
      border-color: rgba(124, 111, 246, 0.34);
      background: #fff;
      color: #7C6FF6;
      box-shadow: 0 0 0 1px rgba(124, 111, 246, 0.08), 0 3px 8px rgba(124, 111, 246, 0.08);
    }
    .cg-voyager-quick-module-close {
      width: 28px;
      height: 28px;
      border-color: transparent;
      background: transparent;
      color: #667085;
      font-size: 18px;
      box-shadow: none;
    }
    .cg-voyager-quick-module-close:hover {
      background: var(--cg-soft-hover);
      color: var(--cg-text);
    }
    .cg-voyager-quick-module-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 0 12px;
    }
    .cg-voyager-quick-module-search {
      flex: 1;
      height: 38px;
      border: 1px solid var(--cg-border);
      border-radius: 10px;
      background: #fff;
      color: var(--cg-text);
      outline: none;
      padding: 0 12px;
      font-size: 13px;
      box-shadow: 0 1px 0 rgba(32, 35, 50, 0.02);
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease,
        background 140ms ease;
    }
    .cg-voyager-quick-module-search::placeholder {
      color: #98A2B3;
    }
    .cg-voyager-quick-module-search:focus {
      border-color: rgba(124, 111, 246, 0.54);
      box-shadow: 0 0 0 3px rgba(124, 111, 246, 0.12);
    }
    .cg-voyager-quick-module-timeline-button {
      min-height: 38px;
      border-radius: 10px;
      padding: 0 12px;
      white-space: nowrap;
    }
    .cg-voyager-quick-module-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid var(--cg-border);
      border-radius: 12px;
      background: var(--cg-surface-subtle);
      padding: 12px;
      margin-bottom: 10px;
    }
    .cg-voyager-quick-module-field,
    .cg-voyager-quick-module-textarea {
      width: 100%;
      border: 1px solid var(--cg-border);
      border-radius: 10px;
      background: #fff;
      color: var(--cg-text);
      outline: none;
      padding: 9px 11px;
      font-size: 13px;
      box-sizing: border-box;
    }
    .cg-voyager-quick-module-field:focus,
    .cg-voyager-quick-module-textarea:focus {
      border-color: rgba(124, 111, 246, 0.54);
      box-shadow: 0 0 0 3px rgba(124, 111, 246, 0.1);
    }
    .cg-voyager-quick-module-textarea {
      min-height: 110px;
      resize: vertical;
      line-height: 1.45;
    }
    .cg-voyager-quick-module-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--cg-muted);
      font-size: 12px;
    }
    .cg-voyager-quick-module-body {
      flex: 1;
      overflow: auto;
      padding: 20px 22px 18px;
      background:
        linear-gradient(180deg, rgba(244, 242, 255, 0.52), rgba(251, 250, 255, 0) 88px),
        #FBFAFF;
    }
    .cg-voyager-quick-module-status {
      min-height: 24px;
      border-top: 1px solid var(--cg-border);
      padding: 7px 16px;
      color: var(--cg-muted);
      font-size: 12px;
      background: #F7F6FC;
    }
    .cg-voyager-quick-module-section {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .cg-voyager-quick-module-item {
      border: 1px solid var(--cg-border);
      border-radius: 12px;
      padding: 12px 13px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 1px 0 rgba(32, 35, 50, 0.03);
      transition:
        border-color 140ms ease,
        background 140ms ease,
        box-shadow 140ms ease;
    }
    .cg-voyager-quick-module-item:hover {
      border-color: rgba(124, 111, 246, 0.28);
      background: #fff;
      box-shadow: 0 8px 20px rgba(32, 35, 50, 0.06);
    }
    .cg-voyager-quick-module-item-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      font-weight: 650;
      color: var(--cg-text);
      margin-bottom: 5px;
      word-break: break-word;
    }
    .cg-voyager-quick-module-favorite {
      color: #7C6FF6;
      font-size: 12px;
      line-height: 1;
    }
    .cg-voyager-quick-module-item-meta,
    .cg-voyager-quick-module-item-preview {
      color: var(--cg-muted);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }
    .cg-voyager-quick-module-item-preview {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
    }
    .cg-voyager-quick-module-tags {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .cg-voyager-quick-module-tag {
      border-radius: 999px;
      background: var(--cg-soft);
      color: #3D365C;
      font-size: 11px;
      line-height: 1.35;
      padding: 2px 7px;
    }
    .cg-voyager-quick-module-item-actions {
      display: flex;
      gap: 6px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .cg-voyager-quick-module-action,
    .cg-voyager-quick-module-link,
    .cg-voyager-quick-module-secondary,
    .cg-voyager-quick-module-delete {
      min-height: 30px;
      padding: 6px 10px;
      font-weight: 600;
      border-radius: 9px;
      transition:
        background 140ms ease,
        border-color 140ms ease,
        color 140ms ease,
        box-shadow 140ms ease,
        transform 80ms ease;
    }
    .cg-voyager-quick-module-action {
      border-color: transparent;
      background: var(--cg-accent);
      color: #fff;
      box-shadow: 0 1px 2px rgba(124, 111, 246, 0.18);
    }
    .cg-voyager-quick-module-action:hover {
      background: var(--cg-accent-hover);
      box-shadow: 0 3px 8px rgba(124, 111, 246, 0.18);
    }
    .cg-voyager-quick-module-link {
      border: 1px solid var(--cg-border);
      background: #fff;
      color: #202332;
    }
    .cg-voyager-quick-module-link:hover {
      border-color: rgba(124, 111, 246, 0.22);
      background: var(--cg-soft);
    }
    .cg-voyager-quick-module-secondary {
      border: 1px solid var(--cg-border);
      background: #fff;
      color: #202332;
    }
    .cg-voyager-quick-module-secondary:hover {
      border-color: rgba(124, 111, 246, 0.22);
      background: var(--cg-soft);
    }
    .cg-voyager-quick-module-delete {
      border-color: #FFE0E4;
      background: rgba(255, 241, 242, 0.35);
      color: #E5484D;
    }
    .cg-voyager-quick-module-delete:hover {
      border-color: #FFC9D0;
      background: #FFF1F2;
    }
    .cg-voyager-quick-module-empty {
      border: 1px dashed var(--cg-border);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.72);
      padding: 24px 14px;
      color: var(--cg-muted);
      font-size: 12px;
      text-align: center;
    }
    .cg-voyager-quick-access-toast {
      position: absolute;
      right: 0;
      bottom: 52px;
      width: 220px;
      border: 1px solid var(--cg-border);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.98);
      color: var(--cg-text);
      box-shadow: 0 12px 30px rgba(32, 35, 50, 0.14);
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
      --cg-surface: #171821;
      --cg-surface-subtle: #20212B;
      --cg-border: rgba(220, 220, 230, 0.12);
      --cg-text: #F4F4F5;
      --cg-muted: #A1A1AA;
      --cg-soft: rgba(169, 155, 255, 0.14);
      --cg-soft-hover: rgba(169, 155, 255, 0.2);
      --cg-accent: #A99BFF;
      --cg-accent-hover: #B8ADFF;
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark {
      --cg-surface: #171821;
      --cg-surface-subtle: #20212B;
      --cg-border: rgba(220, 220, 230, 0.12);
      --cg-text: #F4F4F5;
      --cg-muted: #A1A1AA;
      --cg-soft: rgba(169, 155, 255, 0.14);
      --cg-soft-hover: rgba(169, 155, 255, 0.2);
      --cg-accent: #A99BFF;
      --cg-accent-hover: #B8ADFF;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button {
      color: #F4F4F5;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button-icon {
      filter: drop-shadow(0 12px 30px rgba(0, 0, 0, 0.45));
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button-icon-bg {
      fill: #171927;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button-icon-ring {
      stroke: #3B3F56;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button:hover .cg-voyager-quick-access-button-icon-bg {
      fill: #202332;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button:active .cg-voyager-quick-access-button-icon-bg {
      fill: #101014;
    }
    .cg-voyager-quick-module-dark {
      border-color: rgba(220, 220, 230, 0.12);
      background: rgba(23, 24, 33, 0.98);
      color: #F4F4F5;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.3);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-header,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-status {
      border-color: rgba(220, 220, 230, 0.12);
      background: rgba(16, 16, 20, 0.82);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-title,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab:hover {
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab {
      color: #A1A1AA;
      background: rgba(23, 24, 33, 0.72);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab-active,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tab:hover {
      border-color: rgba(169, 155, 255, 0.42);
      background: rgba(23, 24, 33, 0.92);
      color: #A99BFF;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-search {
      border-color: rgba(220, 220, 230, 0.16);
      background: rgba(16, 16, 20, 0.95);
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-search::placeholder {
      color: #71717A;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-form {
      border-color: var(--cg-border);
      background: rgba(16, 16, 20, 0.78);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-body {
      background:
        linear-gradient(180deg, rgba(169, 155, 255, 0.12), rgba(16, 16, 20, 0) 88px),
        #101014;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-status {
      background: #171821;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-field,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-textarea {
      border-color: rgba(220, 220, 230, 0.16);
      background: rgba(16, 16, 20, 0.95);
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-check {
      color: #A1A1AA;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item {
      border-color: rgba(220, 220, 230, 0.12);
      background: rgba(23, 24, 33, 0.82);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item:hover {
      border-color: rgba(169, 155, 255, 0.28);
      background: rgba(32, 33, 43, 0.94);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-title {
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-meta,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-item-preview,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-empty,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-status {
      color: #A1A1AA;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-link,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-secondary {
      background: rgba(23, 24, 33, 0.72);
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-link,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-secondary,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-close {
      border-color: rgba(220, 220, 230, 0.12);
      background: rgba(23, 24, 33, 0.72);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-close {
      border-color: transparent;
      background: transparent;
      box-shadow: none;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-link:hover,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-secondary:hover,
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-close:hover {
      background: rgba(169, 155, 255, 0.14);
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-tag {
      background: rgba(169, 155, 255, 0.14);
      color: #F4F4F5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-delete {
      border-color: rgba(229, 72, 77, 0.22);
      background: rgba(229, 72, 77, 0.08);
      color: #fca5a5;
    }
    .cg-voyager-quick-module-dark .cg-voyager-quick-module-delete:hover {
      background: rgba(229, 72, 77, 0.14);
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-toast {
      border-color: rgba(220, 220, 230, 0.12);
      background: rgba(23, 24, 33, 0.96);
      color: #F4F4F5;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
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

function normalizePromptTags(tagsText: string): string[] {
  return Array.from(
    new Set(
      tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40)),
    ),
  );
}

function sortPromptItems(prompts: PromptItem[]): PromptItem[] {
  return [...prompts].sort(
    (left, right) =>
      Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) ||
      (right.updatedAt || 0) - (left.updatedAt || 0),
  );
}

async function writePromptItems(prompts: PromptItem[]): Promise<PromptItem[]> {
  const nextPrompts = sortPromptItems(prompts);
  await chrome.storage?.local?.set({ [PROMPTS_STORAGE_KEY]: nextPrompts });
  return nextPrompts;
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

async function readPromptItems(): Promise<PromptItem[]> {
  try {
    const result = await chrome.storage?.local?.get({
      [PROMPTS_STORAGE_KEY]: [],
    });
    const current = result?.[PROMPTS_STORAGE_KEY];
    return Array.isArray(current) ? (current as PromptItem[]) : [];
  } catch {
    return [];
  }
}

async function readStoredArray<T>(key: string): Promise<T[]> {
  try {
    const result = await chrome.storage?.local?.get({
      [key]: [],
    });
    const current = result?.[key];
    return Array.isArray(current) ? (current as T[]) : [];
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

function createTags(tags: string[]): HTMLDivElement {
  const container = createEl('div', 'cg-voyager-quick-module-tags');
  for (const tag of tags.slice(0, 5)) {
    container.append(createEl('span', 'cg-voyager-quick-module-tag', tag));
  }
  return container;
}

function createTimelineButton(): HTMLButtonElement {
  const timelineButton = createEl(
    'button',
    'cg-voyager-quick-module-link cg-voyager-quick-module-timeline-button',
    '显示/隐藏时间轴',
  );
  timelineButton.type = 'button';
  timelineButton.addEventListener('click', () => void toggleTimelineVisibility());
  return timelineButton;
}

async function renderPromptVaultPanel(query = ''): Promise<void> {
  resetPanelContent();
  if (!panelBodyEl) return;

  const toolbar = createEl('div', 'cg-voyager-quick-module-toolbar');
  const form = createEl('div', 'cg-voyager-quick-module-form');
  const list = createEl('div', 'cg-voyager-quick-module-section');
  const searchInput = createSearchInput(
    '搜索提示词',
    (nextQuery) => void renderPromptVaultPanel(nextQuery),
  );
  searchInput.value = query;
  toolbar.append(searchInput, createTimelineButton());

  const prompts = await readPromptItems();
  const editingPrompt = prompts.find((prompt) => prompt.id === editingPromptId) || null;

  if (editingPrompt) {
    const titleInput = createEl('input', 'cg-voyager-quick-module-field') as HTMLInputElement;
    titleInput.value = editingPrompt.title || '';
    titleInput.placeholder = '标题';

    const contentInput = createEl(
      'textarea',
      'cg-voyager-quick-module-textarea',
    ) as HTMLTextAreaElement;
    contentInput.value = editingPrompt.content || '';
    contentInput.placeholder = '提示词内容';

    const tagsInput = createEl('input', 'cg-voyager-quick-module-field') as HTMLInputElement;
    tagsInput.value = (editingPrompt.tags || []).join(', ');
    tagsInput.placeholder = '标签，用英文逗号分隔';

    const favoriteLabel = createEl('label', 'cg-voyager-quick-module-check');
    const favoriteInput = createEl('input') as HTMLInputElement;
    favoriteInput.type = 'checkbox';
    favoriteInput.checked = Boolean(editingPrompt.favorite);
    favoriteLabel.append(favoriteInput, document.createTextNode('收藏 / 置顶'));

    const formActions = createEl('div', 'cg-voyager-quick-module-item-actions');
    const saveButton = createEl('button', 'cg-voyager-quick-module-action', '保存修改');
    saveButton.addEventListener('click', async () => {
      if (!contentInput.value.trim()) {
        setStatus('提示词内容不能为空。');
        return;
      }

      const timestamp = Date.now();
      await writePromptItems(
        prompts.map((prompt) =>
          prompt.id === editingPrompt.id
            ? {
                ...prompt,
                title: titleInput.value.trim().slice(0, 120) || '未命名提示词',
                content: contentInput.value,
                tags: normalizePromptTags(tagsInput.value),
                favorite: favoriteInput.checked,
                updatedAt: timestamp,
              }
            : prompt,
        ),
      );
      editingPromptId = null;
      setStatus('提示词已修改。');
      await renderPromptVaultPanel(query);
    });

    const cancelButton = createEl('button', 'cg-voyager-quick-module-secondary', '取消');
    cancelButton.addEventListener('click', () => {
      editingPromptId = null;
      void renderPromptVaultPanel(query);
    });

    formActions.append(saveButton, cancelButton);
    form.append(titleInput, contentInput, tagsInput, favoriteLabel, formActions);
  } else {
    form.style.display = 'none';
  }

  panelBodyEl.append(toolbar, form, list);
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
    const title = createEl('div', 'cg-voyager-quick-module-item-title');
    if (prompt.favorite) title.append(createEl('span', 'cg-voyager-quick-module-favorite', '★'));
    title.append(document.createTextNode(prompt.title || '未命名提示词'));
    item.append(title, createEl('div', 'cg-voyager-quick-module-item-preview', shortText(prompt.content, 140)));
    if (prompt.tags?.length) {
      item.append(createTags(prompt.tags));
    }
    const actions = createEl('div', 'cg-voyager-quick-module-item-actions');
    const insertButton = createEl('button', 'cg-voyager-quick-module-action', '插入');
    insertButton.addEventListener('click', () => {
      const result = insertPromptIntoChatGPTInput(prompt.content || '');
      setStatus(result.ok ? '已插入到 ChatGPT 输入框。' : result.error || '插入失败。');
      if (!result.ok) showTemporaryMessage(result.error || '插入失败。');
    });
    const editButton = createEl('button', 'cg-voyager-quick-module-secondary', '修改');
    editButton.addEventListener('click', () => {
      editingPromptId = prompt.id;
      void renderPromptVaultPanel(query);
    });
    const deleteButton = createEl('button', 'cg-voyager-quick-module-delete', '删除');
    deleteButton.addEventListener('click', async () => {
      const title = prompt.title || '未命名提示词';
      if (!window.confirm(`删除提示词「${title}」？`)) return;

      try {
        await writePromptItems(prompts.filter((item) => item.id !== prompt.id));
        if (editingPromptId === prompt.id) editingPromptId = null;
        setStatus('提示词已删除。');
        await renderPromptVaultPanel(query);
      } catch {
        setStatus('删除提示词失败。');
      }
    });
    actions.append(insertButton, editButton, deleteButton);
    item.append(actions);
    list.append(item);
  }
  setStatus(`显示 ${filtered.length} / ${prompts.length} 条提示词。`);
}

async function renderFoldersPanel(): Promise<void> {
  resetPanelContent();
  if (!panelBodyEl) return;

  const [folders, conversations] = await Promise.all([
    readStoredArray<FolderItem>(FOLDERS_STORAGE_KEY),
    readStoredArray<ConversationItem>(CONVERSATIONS_STORAGE_KEY),
  ]);
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const section = createEl('div', 'cg-voyager-quick-module-section');
  panelBodyEl.append(section);

  if (!conversations.length) {
    appendEmpty('暂无已保存对话。请先在弹窗的对话管理中保存当前对话。');
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
    const updatedText = formatTime(conversation.updatedAt || conversation.lastOpenedAt);
    const item = createEl('div', 'cg-voyager-quick-module-item');
    item.append(
      createEl('div', 'cg-voyager-quick-module-item-title', conversation.title || '未命名对话'),
      createEl(
        'div',
        'cg-voyager-quick-module-item-meta',
        `${folderName}${updatedText ? ` · ${updatedText}` : ''}${
          conversation.note ? ` · ${shortText(conversation.note, 48)}` : ''
        }`,
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

  const messages = await readStoredArray<StarredItem>(STARRED_STORAGE_KEY);
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
  panelEl?.querySelectorAll<HTMLButtonElement>('[data-cg-ether-panel]').forEach((button) => {
    button.classList.toggle(
      'cg-voyager-quick-module-tab-active',
      button.dataset.cgEtherPanel === activePanel,
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
  tab.dataset.cgEtherPanel = target;
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
    createTab('对话管理', 'folders'),
    createTab('收藏消息', 'starred'),
  );
  const closeButton = createEl('button', 'cg-voyager-quick-module-close', '×');
  closeButton.type = 'button';
  closeButton.title = '关闭';
  closeButton.addEventListener('click', () => setPanelOpen(false));

  header.append(grip, title, tabs, closeButton);

  panelBodyEl = createEl('div', 'cg-voyager-quick-module-body') as HTMLDivElement;
  panelStatusEl = createEl('div', 'cg-voyager-quick-module-status', '') as HTMLDivElement;
  panelEl.append(header, panelBodyEl, panelStatusEl);
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
  buttonEl.setAttribute('aria-label', '打开 ChatGPT以太');
  buttonEl.innerHTML = `
    <svg class="cg-voyager-quick-access-button-icon" viewBox="0 0 64 64" aria-hidden="true">
      <circle class="cg-voyager-quick-access-button-icon-bg" cx="32" cy="32" r="27" />
      <circle class="cg-voyager-quick-access-button-icon-ring" cx="32" cy="32" r="26" stroke-width="2" fill="none" />
      <path
        class="cg-voyager-quick-access-button-icon-stroke"
        d="M21.5 41L18.5 48L27 43.5H38C43.5 43.5 48 39 48 33.5C48 28 43.5 23.5 38 23.5H27C21.5 23.5 17 28 17 33.5C17 37 18.8 39.8 21.5 41Z"
        stroke-width="3.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        class="cg-voyager-quick-access-button-icon-accent"
        d="M27 31H38"
        stroke-width="2.6"
        stroke-linecap="round"
        fill="none"
      />
      <path
        class="cg-voyager-quick-access-button-icon-accent"
        d="M27 36H40"
        stroke-width="2.6"
        stroke-linecap="round"
        fill="none"
      />
      <path
        class="cg-voyager-quick-access-button-icon-accent"
        d="M45 14L47.5 20.5L54 23L47.5 25.5L45 32L42.5 25.5L36 23L42.5 20.5L45 14Z"
      />
    </svg>
  `;

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
