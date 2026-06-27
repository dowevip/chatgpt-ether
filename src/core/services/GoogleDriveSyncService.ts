import type { ChatGPTSyncPayload, SyncMode, SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const CHATGPT_SYNC_FILE_NAME = 'chatgpt-ether-sync.json';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 800;
const IDENTITY_TOKEN_TTL_SECONDS = 55 * 60;

const GOOGLE_AUTH_FAILED_MESSAGE =
  'Google 授权失败。请确认 Chrome 已登录 Google 账号，并在 chrome://extensions 刷新插件后重试。';
const CHROME_NATIVE_AUTH_FAILED_100_MESSAGE =
  'Chrome 原生授权失败（-100）。请刷新插件、重新打开页面后重试。';
const CHATGPT_CLOUD_NEWER_UPLOAD_BLOCKED_MESSAGE =
  '云端数据可能比本机更新。请先从云端拉取并合并，确认无误后再上传。';

const SYNC_MODE_STORAGE_KEY = 'gvSyncMode';
const SYNC_ERROR_STORAGE_KEY = 'gvSyncError';
const CHATGPT_LAST_SYNC_TIME_STORAGE_KEY = 'ceLastSyncTimeChatGPT';
const CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY = 'ceLastUploadTimeChatGPT';

type AppDataFileMetadata = {
  id: string;
  name: string;
  modifiedTime?: string;
};

type UploadSafety = {
  allowed: boolean;
  fileId: string | null;
  cloudTime: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPayloadExportTime(payload: ChatGPTSyncPayload | null): number | null {
  if (!payload?.exportedAt) return null;
  const time = Date.parse(payload.exportedAt);
  return Number.isFinite(time) ? time : null;
}

function getMetadataModifiedTime(metadata: AppDataFileMetadata | null): number | null {
  if (!metadata?.modifiedTime) return null;
  const time = Date.parse(metadata.modifiedTime);
  return Number.isFinite(time) ? time : null;
}

export class GoogleDriveSyncService {
  private state: SyncState = { ...DEFAULT_SYNC_STATE };
  private stateChangeCallback: ((state: SyncState) => void) | null = null;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private stateLoadPromise: Promise<void> | null = null;
  private lastAuthError: string | null = null;

  constructor() {
    this.stateLoadPromise = this.loadState();
  }

  onStateChange(callback: (state: SyncState) => void): void {
    this.stateChangeCallback = callback;
  }

  async getState(): Promise<SyncState> {
    if (this.stateLoadPromise) {
      await this.stateLoadPromise;
    }
    return { ...this.state };
  }

  async refreshChatGPTCloudState(interactive = false): Promise<SyncState> {
    if (this.stateLoadPromise) {
      await this.stateLoadPromise;
    }

    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.getAuthToken(interactive);
      if (!token) {
        this.updateState({ isAuthenticated: false, isSyncing: false });
        await this.saveState();
        return { ...this.state };
      }

      const metadata = await this.findAppDataFileMetadata(token, CHATGPT_SYNC_FILE_NAME);
      const cloudTime = getMetadataModifiedTime(metadata);
      this.updateState({
        isAuthenticated: true,
        isSyncing: false,
        cloudUploadTimeChatGPT: cloudTime,
        error: null,
      });
      await this.saveState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive 状态刷新失败';
      console.warn('[GoogleDriveSyncService] Failed to refresh cloud state:', message);
      this.updateState({ isSyncing: false, error: message });
      await this.saveState();
    }

    return { ...this.state };
  }

  async setMode(mode: SyncMode): Promise<void> {
    this.updateState({ mode });
    await this.saveState();
  }

  async authenticate(interactive = true): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.getAuthToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isAuthenticated: false, isSyncing: false });
          return false;
        }
        throw new Error(this.getAuthFailureMessage());
      }
      this.updateState({ isAuthenticated: true, isSyncing: false, error: null });
      await this.saveState();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : GOOGLE_AUTH_FAILED_MESSAGE;
      console.error('[GoogleDriveSyncService] Authentication failed:', message);
      this.updateState({ isAuthenticated: false, isSyncing: false, error: message });
      await this.saveState();
      return false;
    }
  }

  async signOut(): Promise<void> {
    const token = this.accessToken;
    try {
      if (token) {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      }
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Sign out warning:', error);
    }

    await this.clearToken();
    this.updateState({ isAuthenticated: false, isSyncing: false, error: null });
    await this.saveState();
  }

  async hasChatGPTSyncData(interactive = false): Promise<boolean> {
    const token = await this.getAuthToken(interactive);
    if (!token) return false;
    return (await this.findAppDataFileMetadata(token, CHATGPT_SYNC_FILE_NAME)) !== null;
  }

  async uploadChatGPTPayload(
    payload: ChatGPTSyncPayload,
    interactive = true,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.getAuthToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error(this.getAuthFailureMessage());
      }

      const safety = await this.checkChatGPTUploadSafety(token);
      if (!safety.allowed) {
        throw new Error(CHATGPT_CLOUD_NEWER_UPLOAD_BLOCKED_MESSAGE);
      }

      const fileId =
        safety.fileId ?? (await this.createAppDataFile(token, CHATGPT_SYNC_FILE_NAME));
      await this.uploadJsonWithRetry(token, fileId, payload);

      const now = Date.now();
      this.updateState({
        isSyncing: false,
        isAuthenticated: true,
        lastUploadTimeChatGPT: now,
        cloudUploadTimeChatGPT: now,
        error: null,
      });
      await this.saveState();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ChatGPT 以太上传失败';
      console.error('[GoogleDriveSyncService] ChatGPT upload failed:', message);
      this.updateState({ isSyncing: false, error: message });
      await this.saveState();
      return false;
    }
  }

  async downloadChatGPTPayload(interactive = true): Promise<ChatGPTSyncPayload | null> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.getAuthToken(interactive);
      if (!token) {
        if (!interactive) {
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error(this.getAuthFailureMessage());
      }

      const metadata = await this.findAppDataFileMetadata(token, CHATGPT_SYNC_FILE_NAME);
      if (!metadata) {
        throw new Error('云端未找到 ChatGPT 以太同步数据');
      }

      const payload = await this.downloadJsonWithRetry<ChatGPTSyncPayload>(token, metadata.id);
      const cloudTime = getMetadataModifiedTime(metadata);
      const now = Date.now();
      this.updateState({
        isSyncing: false,
        isAuthenticated: true,
        lastSyncTimeChatGPT: now,
        cloudUploadTimeChatGPT: cloudTime,
        error: null,
      });
      await this.saveState();
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ChatGPT 以太下载失败';
      console.error('[GoogleDriveSyncService] ChatGPT download failed:', message);
      this.updateState({ isSyncing: false, error: message });
      await this.saveState();
      return null;
    }
  }

  private async checkChatGPTUploadSafety(token: string): Promise<UploadSafety> {
    const metadata = await this.findAppDataFileMetadata(token, CHATGPT_SYNC_FILE_NAME);
    if (!metadata) {
      return { allowed: true, fileId: null, cloudTime: null };
    }

    const cloudPayload = await this.safeDownloadCloudPayload(token, metadata.id);
    const modifiedTime = getMetadataModifiedTime(metadata);
    const cloudTime = Math.max(
      modifiedTime ?? 0,
      getPayloadExportTime(cloudPayload) ?? 0,
    );
    const normalizedCloudTime = cloudTime > 0 ? cloudTime : null;
    const lastKnownLocalCloudTime = Math.max(
      this.state.lastSyncTimeChatGPT ?? 0,
      this.state.lastUploadTimeChatGPT ?? 0,
    );

    if (lastKnownLocalCloudTime <= 0) {
      return { allowed: false, fileId: metadata.id, cloudTime: normalizedCloudTime };
    }

    if (normalizedCloudTime && normalizedCloudTime > lastKnownLocalCloudTime + 1000) {
      return { allowed: false, fileId: metadata.id, cloudTime: normalizedCloudTime };
    }

    return { allowed: true, fileId: metadata.id, cloudTime: normalizedCloudTime };
  }

  private async safeDownloadCloudPayload(
    token: string,
    fileId: string,
  ): Promise<ChatGPTSyncPayload | null> {
    try {
      return await this.downloadJsonWithRetry<ChatGPTSyncPayload>(token, fileId);
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Failed to inspect cloud payload:', error);
      return null;
    }
  }

  private async findAppDataFileMetadata(
    token: string,
    fileName: string,
  ): Promise<AppDataFileMetadata | null> {
    const escapedName = fileName.replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `name='${escapedName}' and trashed=false`,
      spaces: 'appDataFolder',
      fields: 'files(id,name,modifiedTime)',
      pageSize: '1',
    });
    const response = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Drive 文件查询失败: ${response.status}`);
    }

    const data = (await response.json()) as { files?: AppDataFileMetadata[] };
    return data.files?.[0] ?? null;
  }

  private async createAppDataFile(token: string, fileName: string): Promise<string> {
    const response = await fetch(`${DRIVE_API_BASE}/files?fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        parents: ['appDataFolder'],
      }),
    });

    if (!response.ok) {
      throw new Error(`Drive 文件创建失败: ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      throw new Error('Drive 文件创建失败：未返回文件 ID');
    }
    return data.id;
  }

  private async uploadJsonWithRetry<T>(token: string, fileId: string, data: T): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(
          `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data, null, 2),
          },
        );

        if (response.ok) return;
        throw new Error(`Drive 上传失败: ${response.status}`);
      } catch (error) {
        if (attempt === MAX_RETRIES - 1) throw error;
        await sleep(INITIAL_RETRY_DELAY_MS * 2 ** attempt);
      }
    }
  }

  private async downloadJsonWithRetry<T>(token: string, fileId: string): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          throw new Error(`Drive 下载失败: ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        if (attempt === MAX_RETRIES - 1) throw error;
        await sleep(INITIAL_RETRY_DELAY_MS * 2 ** attempt);
      }
    }

    throw new Error('Drive 下载失败');
  }

  private async getAuthToken(interactive: boolean): Promise<string | null> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiry > now) {
      return this.accessToken;
    }

    const token = await new Promise<string | null>((resolve, reject) => {
      if (!chrome.identity?.getAuthToken) {
        reject(new Error(GOOGLE_AUTH_FAILED_MESSAGE));
        return;
      }

      chrome.identity.getAuthToken({ interactive }, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          const message = error.message ?? GOOGLE_AUTH_FAILED_MESSAGE;
          this.lastAuthError = message;
          console.warn('[GoogleDriveSyncService] identity.getAuthToken failed:', message);
          reject(new Error(this.normalizeAuthError(message)));
          return;
        }

        if (typeof result === 'string') {
          resolve(result);
          return;
        }

        resolve(null);
      });
    });

    if (!token) return null;
    this.accessToken = token;
    this.tokenExpiry = now + IDENTITY_TOKEN_TTL_SECONDS * 1000;
    return token;
  }

  private normalizeAuthError(message: string): string {
    if (message.includes('-100') || message.includes('Connection failed')) {
      return CHROME_NATIVE_AUTH_FAILED_100_MESSAGE;
    }
    return GOOGLE_AUTH_FAILED_MESSAGE;
  }

  private getAuthFailureMessage(): string {
    if (this.lastAuthError?.includes('-100') || this.lastAuthError?.includes('Connection failed')) {
      return CHROME_NATIVE_AUTH_FAILED_100_MESSAGE;
    }
    return GOOGLE_AUTH_FAILED_MESSAGE;
  }

  private async removeCachedAuthToken(token: string): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!chrome.identity?.removeCachedAuthToken) {
        resolve();
        return;
      }
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  private async clearToken(): Promise<void> {
    if (this.accessToken) {
      await this.removeCachedAuthToken(this.accessToken);
    }
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.lastAuthError = null;
  }

  private async loadState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        SYNC_MODE_STORAGE_KEY,
        SYNC_ERROR_STORAGE_KEY,
        CHATGPT_LAST_SYNC_TIME_STORAGE_KEY,
        CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY,
      ]);

      this.state = {
        ...DEFAULT_SYNC_STATE,
        mode:
          result[SYNC_MODE_STORAGE_KEY] === 'manual' || result[SYNC_MODE_STORAGE_KEY] === 'auto'
            ? result[SYNC_MODE_STORAGE_KEY]
            : 'disabled',
        error: getStringValue(result[SYNC_ERROR_STORAGE_KEY]),
        lastSyncTimeChatGPT: getNumberValue(result[CHATGPT_LAST_SYNC_TIME_STORAGE_KEY]),
        lastUploadTimeChatGPT: getNumberValue(result[CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY]),
        isAuthenticated: false,
        isSyncing: false,
      };

      await this.authenticate(false);
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Failed to load state:', error);
      this.state = { ...DEFAULT_SYNC_STATE };
    }
  }

  private async saveState(): Promise<void> {
    await chrome.storage.local.set({
      [SYNC_MODE_STORAGE_KEY]: this.state.mode,
      [SYNC_ERROR_STORAGE_KEY]: this.state.error,
      [CHATGPT_LAST_SYNC_TIME_STORAGE_KEY]: this.state.lastSyncTimeChatGPT,
      [CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY]: this.state.lastUploadTimeChatGPT,
    });
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    this.stateChangeCallback?.({ ...this.state });
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
