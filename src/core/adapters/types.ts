export type SupportedPlatform = 'gemini' | 'aistudio' | 'chatgpt';

export type MessageRole = 'user' | 'assistant';

export interface MessageNodeRef {
  element: HTMLElement;
  role: MessageRole;
  anchor: string;
  snippet: string;
}

export interface ConversationInfo {
  platform: SupportedPlatform;
  conversationId: string | null;
  title: string | null;
  url: string;
}

export interface PageAdapter {
  platform: SupportedPlatform;
  isSupportedPage(): boolean;
  getConversationId(): string | null;
  getConversationTitle(): string | null;
  getConversationInfo(): ConversationInfo;
  getUserMessageNodes(): HTMLElement[];
  getAssistantMessageNodes(): HTMLElement[];
  getMessageNodes(): MessageNodeRef[];
  getInputElement(): HTMLElement | null;
  getAssistantActionArea(messageElement: HTMLElement): HTMLElement | null;
  scrollToMessage(anchor: string): boolean;
  buildMessageAnchor(messageElement: HTMLElement, index: number, role: MessageRole): string;
}
