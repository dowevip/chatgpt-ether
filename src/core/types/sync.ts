import type { ChatGPTConversationIndex, ChatGPTFolder } from './conversation';
import type { ChatGPTPromptVaultItem } from './prompt';
import type { ChatGPTStarredMessage } from './starred';

export type SyncMode = 'disabled' | 'manual' | 'auto';

export interface SyncState {
  mode: SyncMode;
  lastSyncTime: number | null;
  lastUploadTime: number | null;
  lastSyncTimeAIStudio: number | null;
  lastUploadTimeAIStudio: number | null;
  lastSyncTimeChatGPT: number | null;
  lastUploadTimeChatGPT: number | null;
  isSyncing: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

export const SyncStorageKeys = {
  MODE: 'gvSyncMode',
  LAST_SYNC_TIME: 'gvLastSyncTime',
  SYNC_ERROR: 'gvSyncError',
} as const;

export const DEFAULT_SYNC_STATE: SyncState = {
  mode: 'disabled',
  lastSyncTime: null,
  lastUploadTime: null,
  lastSyncTimeAIStudio: null,
  lastUploadTimeAIStudio: null,
  lastSyncTimeChatGPT: null,
  lastUploadTimeChatGPT: null,
  isSyncing: false,
  error: null,
  isAuthenticated: false,
};

export type SyncMessageType =
  | 'gv.sync.authenticate'
  | 'gv.sync.signOut'
  | 'gv.sync.getState'
  | 'gv.sync.setMode'
  | 'gv.chatgpt.sync.upload'
  | 'gv.chatgpt.sync.download'
  | 'gv.chatgpt.sync.getState';

export interface SyncMessage {
  type: SyncMessageType;
  payload?: {
    mode?: SyncMode;
    interactive?: boolean;
    overwrite?: boolean;
  };
}

export interface SyncResponse {
  ok: boolean;
  error?: string;
  state?: SyncState;
  data?: ChatGPTSyncPayload;
}

export type ChatGPTSyncSource = 'chatgpt-ether';

export type ChatGPTSyncSettings = {
  timelineVisible?: boolean;
  timelineWidth?: number;
  timelineHeight?: number;
  collapsedFolderIds?: string[];
};

export type ChatGPTSyncTimeMetadata = Record<string, never>;

export interface ChatGPTSyncPayload {
  schemaVersion: number;
  exportedAt: string;
  source: ChatGPTSyncSource;
  data: {
    prompts: ChatGPTPromptVaultItem[];
    folders: ChatGPTFolder[];
    conversations: ChatGPTConversationIndex[];
    starredMessages: ChatGPTStarredMessage[];
    settings: ChatGPTSyncSettings;
    timeMetadata: ChatGPTSyncTimeMetadata;
  };
}

export type ChatGPTSyncImportMode = 'merge' | 'overwrite';

export interface ChatGPTSyncImportOptions {
  mode: ChatGPTSyncImportMode;
}

export interface ChatGPTSyncImportResult {
  ok: boolean;
  mode: ChatGPTSyncImportMode;
  backupKey?: string;
  restoredCounts: {
    prompts: number;
    folders: number;
    conversations: number;
    starredMessages: number;
  };
}
