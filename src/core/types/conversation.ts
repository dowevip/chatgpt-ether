export type ChatGPTFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatGPTConversationIndex = {
  conversationId: string;
  title: string;
  url: string;
  folderId: string | null;
  note: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};
