export type ChatGPTPromptVaultItem = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ChatGPTPromptVaultExport = {
  format: 'chatgpt-voyager.prompt-vault.v1';
  exportedAt: string;
  prompts: ChatGPTPromptVaultItem[];
};
