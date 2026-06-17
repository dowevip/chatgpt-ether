type CapturedRole = 'user' | 'assistant';

type CapturedNode = {
  conversationId: string | null;
  turnId?: string;
  messageId?: string;
  parentId?: string | null;
  role: CapturedRole;
  summary: string;
  searchText: string;
  fingerprint: string;
  createdAt?: number | null;
  order: number;
};

const POST_MESSAGE_TYPE = 'cg-voyager-chatgpt-conversation-captured';
const FETCH_REQUEST_TYPE = 'cg-voyager-chatgpt-fetch-current-conversation';
const CHATGPT_CAPTURE_SOURCE = 'chatgpt-ether';
const MAX_SUMMARY_LENGTH = 60;
const PERFORMANCE_PREFIX = '[ChatGPT Ether Performance]';

function performanceLog(label: string, startedAt: number, extra: Record<string, unknown> = {}): void {
  console.debug(PERFORMANCE_PREFIX, {
    label,
    durationMs: Math.round(performance.now() - startedAt),
    ...extra,
  });
}

function scheduleIdleTask(callback: () => void, timeout = 1800): void {
  const idleCallback = (
    window as typeof window & {
      requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    }
  ).requestIdleCallback;

  if (idleCallback) {
    idleCallback(() => callback(), { timeout });
    return;
  }

  window.setTimeout(callback, Math.min(timeout, 600));
}

function currentConversationId(): string | null {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] || null;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(' ').trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.parts)) return normalizeText(record.parts);
    if (typeof record.text === 'string') return normalizeText(record.text);
    if (typeof record.content === 'string') return normalizeText(record.content);
  }
  return '';
}

function summarize(text: string): string {
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH - 3)}...` : text;
}

function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function roleFromMessage(message: Record<string, unknown>): CapturedRole | null {
  const author = message.author as Record<string, unknown> | undefined;
  const role = author?.role || message.role;
  return role === 'user' || role === 'assistant' ? role : null;
}

function textFromMessage(message: Record<string, unknown>): string {
  const content = message.content as Record<string, unknown> | undefined;
  return normalizeText(content || message);
}

function shouldSkipMessage(message: Record<string, unknown>, role: CapturedRole | null): boolean {
  if (!role) return true;
  if (role !== 'user' && role !== 'assistant') return true;

  const metadata = message.metadata as Record<string, unknown> | undefined;
  const content = message.content as Record<string, unknown> | undefined;
  const contentType = String(content?.content_type || message.content_type || '').toLowerCase();
  const recipient = String(message.recipient || '').toLowerCase();

  if (metadata?.is_visually_hidden_from_conversation === true) return true;
  if (metadata?.is_complete === false && role === 'assistant') return true;
  if (recipient && recipient !== 'all') return true;
  if (/system|tool|code|execution|thought|reasoning|tether/.test(contentType)) return true;

  return false;
}

function cleanAssistantText(text: string): string {
  return normalizeText(text)
    .replace(/^已思考\s*\d+\s*秒\s*/i, '')
    .replace(/^思考中[。.．…\s]*/i, '')
    .trim();
}

function nodeFromMessage(
  message: Record<string, unknown>,
  parentId: string | null | undefined,
  order: number,
): CapturedNode | null {
  const role = roleFromMessage(message);
  if (shouldSkipMessage(message, role)) return null;

  const text =
    role === 'assistant' ? cleanAssistantText(textFromMessage(message)) : textFromMessage(message);
  if (!text) return null;

  const messageId =
    typeof message.id === 'string'
      ? message.id
      : typeof message.message_id === 'string'
        ? message.message_id
        : undefined;

  const createdAt =
    typeof message.create_time === 'number'
      ? message.create_time
      : typeof message.createTime === 'number'
        ? message.createTime
        : null;

  return {
    conversationId: currentConversationId(),
    turnId: messageId,
    messageId,
    parentId: parentId || (typeof message.parent === 'string' ? message.parent : null),
    role,
    summary: summarize(text),
    searchText: text,
    fingerprint: fingerprint(text.slice(0, 160).toLowerCase()),
    createdAt,
    order,
  };
}

function extractFromMapping(data: Record<string, unknown>): CapturedNode[] {
  const mapping = data.mapping as Record<string, unknown> | undefined;
  if (!mapping || typeof mapping !== 'object') return [];

  const entries = Object.entries(mapping);
  const currentNode = typeof data.current_node === 'string' ? data.current_node : null;
  const orderedIds: string[] = [];

  if (currentNode) {
    const seen = new Set<string>();
    let cursor: string | null = currentNode;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      orderedIds.push(cursor);
      const rawNode = mapping[cursor];
      cursor =
        rawNode && typeof rawNode === 'object'
          ? ((rawNode as Record<string, unknown>).parent as string | null) || null
          : null;
    }
    orderedIds.reverse();
  } else {
    orderedIds.push(...entries.map(([nodeId]) => nodeId));
  }

  const nodes = orderedIds
    .map((nodeId, index) => {
      const rawNode = mapping[nodeId];
      if (!rawNode || typeof rawNode !== 'object') return null;
      const node = rawNode as Record<string, unknown>;
      const message = node.message as Record<string, unknown> | null | undefined;
      if (!message || typeof message !== 'object') return null;
      const captured = nodeFromMessage(
        { ...message, id: typeof message.id === 'string' ? message.id : nodeId },
        typeof node.parent === 'string' ? node.parent : null,
        index,
      );
      return captured;
    })
    .filter((node): node is CapturedNode => Boolean(node));

  return nodes;
}

function extractFromMessages(data: unknown, nodes: CapturedNode[] = []): CapturedNode[] {
  if (!data || typeof data !== 'object') return nodes;
  if (Array.isArray(data)) {
    for (const item of data) extractFromMessages(item, nodes);
    return nodes;
  }

  const record = data as Record<string, unknown>;
  if (Array.isArray(record.messages)) {
    for (const message of record.messages) {
      if (message && typeof message === 'object') {
        const node = nodeFromMessage(message as Record<string, unknown>, null, nodes.length);
        if (node) nodes.push(node);
      }
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') extractFromMessages(value, nodes);
  }

  return nodes;
}

function extractTimeline(data: unknown): CapturedNode[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const mapped = extractFromMapping(record);
  if (mapped.length > 0) return mapped;
  const direct = extractFromMessages(record);
  const combined = direct;
  const seen = new Set<string>();
  return combined.filter((node) => {
    const key = node.messageId || `${node.role}:${node.fingerprint}:${node.order}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function postCaptured(nodes: CapturedNode[], url: string): void {
  if (nodes.length === 0) return;
  const user = nodes.filter((node) => node.role === 'user').length;
  const assistant = nodes.filter((node) => node.role === 'assistant').length;
  console.debug('[ChatGPT Ether] 捕获到对话数据', {
    total: nodes.length,
    user,
    assistant,
    hasConversationData: true,
  });
  window.postMessage(
    {
      type: POST_MESSAGE_TYPE,
      source: CHATGPT_CAPTURE_SOURCE,
      payload: {
        conversationId: currentConversationId(),
        url,
        nodes,
      },
    },
    window.location.origin,
  );
}

function shouldInspect(url: string): boolean {
  try {
    const parsed = new URL(url, location.href);
    return (
      parsed.origin === location.origin &&
      /conversation|backend-api|mapping|message/i.test(parsed.href)
    );
  } catch {
    return false;
  }
}

function inspectJson(data: unknown, url: string): void {
  const startedAt = performance.now();
  const nodes = extractTimeline(data);
  performanceLog('conversation 捕获解析耗时', startedAt, {
    total: nodes.length,
    user: nodes.filter((node) => node.role === 'user').length,
    assistant: nodes.filter((node) => node.role === 'assistant').length,
  });
  postCaptured(nodes, url);
}

function scheduleInspectJson(data: unknown, url: string): void {
  scheduleIdleTask(() => inspectJson(data, url));
}

async function fetchCurrentConversation(): Promise<void> {
  const startedAt = performance.now();
  const conversationId = currentConversationId();
  if (!conversationId) return;

  const url = `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  try {
    const response = await originalFetch(url, { credentials: 'include' });
    const data = await response.clone().json();
    scheduleInspectJson(data, url);
    performanceLog('conversation 捕获请求耗时', startedAt, { conversationId });
  } catch {
    console.debug('[ChatGPT Ether] 当前对话主动读取失败', {
      conversationId,
      hasConversationData: false,
    });
  }
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch(...args);
  const input = args[0];
  const url =
    typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  if (shouldInspect(url)) {
    response
      .clone()
      .json()
      .then((data) => scheduleInspectJson(data, url))
      .catch(() => {});
  }
  return response;
};

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { type?: string; source?: string };
  if (
    data?.type === FETCH_REQUEST_TYPE &&
    data.source === CHATGPT_CAPTURE_SOURCE
  ) {
    scheduleIdleTask(() => void fetchCurrentConversation(), 800);
  }
});

let lastConversationId = currentConversationId();
window.setInterval(() => {
  const nextConversationId = currentConversationId();
  if (nextConversationId && nextConversationId !== lastConversationId) {
    lastConversationId = nextConversationId;
    scheduleIdleTask(() => void fetchCurrentConversation(), 1200);
  }
}, 1000);

setTimeout(() => scheduleIdleTask(() => void fetchCurrentConversation(), 1800), 2200);

const OriginalXHR = window.XMLHttpRequest;
const originalOpen = OriginalXHR.prototype.open;
const originalSend = OriginalXHR.prototype.send;

OriginalXHR.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
  this.__cgEtherUrl = String(url);
  return originalOpen.call(this, method, url, ...(rest as [boolean?, string?, string?]));
};

OriginalXHR.prototype.send = function send(...args: unknown[]) {
  this.addEventListener('load', () => {
    const url = String(this.__cgEtherUrl || '');
    if (!shouldInspect(url)) return;
    try {
      const data = JSON.parse(this.responseText);
      scheduleInspectJson(data, url);
    } catch {}
  });
  return originalSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
};

declare global {
  interface XMLHttpRequest {
    __cgEtherUrl?: string;
  }
}

export {};
