import {
  isChatGPTTimelineFloatingPanelVisible,
  setChatGPTTimelineFloatingPanelVisible,
} from './timelineFloatingPanel';

const ROOT_ID = 'cg-voyager-quick-access-root';
const STYLE_ID = 'cg-voyager-quick-access-style';
const POSITION_STORAGE_KEY = 'chatgptVoyager.quickAccess.position';
const DARK_MODE_STORAGE_KEY = 'darkMode';
const DRAG_THRESHOLD = 4;

type FloatingPosition = {
  left: number;
  top: number;
};

let started = false;
let menuOpen = false;
let buttonEl: HTMLButtonElement | null = null;
let menuEl: HTMLDivElement | null = null;
let rootEl: HTMLDivElement | null = null;
let position: FloatingPosition | null = null;
let draggedDuringPointer = false;

function isChatGPTPage(): boolean {
  return location.hostname === 'chatgpt.com';
}

function getDefaultPosition(): FloatingPosition {
  return {
    left: Math.max(12, window.innerWidth - 72),
    top: Math.max(120, Math.round(window.innerHeight * 0.62)),
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

function applyPosition(): void {
  if (!rootEl || !position) return;
  const next = clampPosition(position);
  position = next;
  rootEl.style.left = `${next.left}px`;
  rootEl.style.top = `${next.top}px`;
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

async function writePosition(next: FloatingPosition): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [POSITION_STORAGE_KEY]: clampPosition(next) });
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
    .cg-voyager-quick-access-menu {
      position: absolute;
      right: 0;
      bottom: 52px;
      width: 168px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
      padding: 6px;
      display: none;
      backdrop-filter: blur(14px);
    }
    .cg-voyager-quick-access-root.cg-voyager-quick-access-menu-open .cg-voyager-quick-access-menu {
      display: block;
    }
    .cg-voyager-quick-access-menu-item {
      width: 100%;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #202124;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 9px;
      text-align: left;
      font-size: 12px;
      line-height: 1.35;
    }
    .cg-voyager-quick-access-menu-item:hover:not(:disabled) {
      background: rgba(5, 150, 105, 0.1);
      color: #047857;
    }
    .cg-voyager-quick-access-menu-item:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .cg-voyager-quick-access-menu-badge {
      color: #64748b;
      font-size: 10px;
      white-space: nowrap;
    }
    .cg-voyager-quick-access-dark {
      color: #f8fafc;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-button,
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-menu {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(20, 24, 31, 0.96);
      color: #7dd3fc;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-menu-item {
      color: #f8fafc;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-menu-item:hover:not(:disabled) {
      background: rgba(125, 211, 252, 0.12);
      color: #7dd3fc;
    }
    .cg-voyager-quick-access-dark .cg-voyager-quick-access-menu-badge {
      color: #94a3b8;
    }
  `;
  document.documentElement.appendChild(style);
}

function setMenuOpen(nextOpen: boolean): void {
  menuOpen = nextOpen;
  rootEl?.classList.toggle('cg-voyager-quick-access-menu-open', menuOpen);
}

async function toggleTimelineVisibility(): Promise<void> {
  const nextVisible = !isChatGPTTimelineFloatingPanelVisible();
  await setChatGPTTimelineFloatingPanelVisible(nextVisible);
  setMenuOpen(false);
}

function createMenuItem(label: string, onClick?: () => void | Promise<void>): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'cg-voyager-quick-access-menu-item';

  const text = document.createElement('span');
  text.textContent = label;
  item.appendChild(text);

  if (!onClick) {
    const badge = document.createElement('span');
    badge.className = 'cg-voyager-quick-access-menu-badge';
    badge.textContent = '弹窗中使用';
    item.appendChild(badge);
    item.disabled = true;
    return item;
  }

  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onClick();
  });
  return item;
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

  menuEl = document.createElement('div');
  menuEl.className = 'cg-voyager-quick-access-menu';
  menuEl.append(
    createMenuItem('显示/隐藏时间轴', toggleTimelineVisibility),
    createMenuItem('Prompt Vault'),
    createMenuItem('对话文件夹'),
    createMenuItem('收藏消息'),
  );

  rootEl.append(buttonEl, menuEl);
  document.documentElement.appendChild(rootEl);
}

function setupOutsideClick(): void {
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!menuOpen || !rootEl) return;
      if (event.target instanceof Node && rootEl.contains(event.target)) return;
      setMenuOpen(false);
    },
    true,
  );
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
      setMenuOpen(false);
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
    setMenuOpen(!menuOpen);
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
  setupOutsideClick();
  window.addEventListener('resize', () => applyPosition());
  readPosition().then((savedPosition) => {
    position = savedPosition;
    applyPosition();
  });
  readDarkMode().then(applyDarkMode);
  watchDarkModeChanges();
}
