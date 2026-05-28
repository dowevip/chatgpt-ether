export type ChatGPTStarredMessageRole = 'user';

export type ChatGPTStarredMessage = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  url: string;
  turnId?: string;
  messageId?: string;
  messageAnchor: string;
  role: ChatGPTStarredMessageRole;
  snippet: string;
  fingerprint?: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatGPTStarredMessageInput = {
  conversationId: string;
  conversationTitle: string;
  url: string;
  turnId?: string;
  messageId?: string;
  messageAnchor: string;
  role: ChatGPTStarredMessageRole;
  snippet: string;
  fingerprint?: string;
};
