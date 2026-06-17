/**
 * Google Drive Sync Service
 *
 * Enterprise-grade service for syncing extension data to Google Drive
 * Uses Chrome Identity API for OAuth2 and Drive REST API v3 for storage
 *
 * Stores folders, prompts, and other sync data as separate files:
 * - gemini-voyager-folders.json
 * - gemini-voyager-prompts.json
 * - gemini-voyager-starred.json
 */
import type { FolderData } from '@/core/types/folder';
import type {
  ChatGPTSyncPayload,
  FolderExportPayload,
  ForkExportPayload,
  ForkNodesDataSync,
  PromptExportPayload,
  PromptItem,
  SettingsExportPayload,
  StarredExportPayload,
  StarredMessagesDataSync,
  SyncAccountScope,
  SyncMode,
  SyncPlatform,
  SyncState,
  TimelineHierarchyDataSync,
  TimelineHierarchyExportPayload,
} from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { EXTENSION_VERSION } from '@/core/utils/version';

const FOLDERS_FILE_NAME = 'gemini-voyager-folders.json';
const AISTUDIO_FOLDERS_FILE_NAME = 'gemini-voyager-aistudio-folders.json';
const PROMPTS_FILE_NAME = 'gemini-voyager-prompts.json';
const SETTINGS_FILE_NAME = 'gemini-voyager-settings.json';
const STARRED_FILE_NAME = 'gemini-voyager-starred.json';
const FORKS_FILE_NAME = 'gemini-voyager-forks.json';
const TIMELINE_HIERARCHY_FILE_NAME = 'gemini-voyager-timeline-hierarchy.json';
const CHATGPT_SYNC_FILE_NAME = 'chatgpt-ether-sync.json';
const BACKUP_FOLDER_NAME = 'Gemini Voyager Data';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const IDENTITY_TOKEN_TTL_SECONDS = 55 * 60;
const LEGACY_WEB_AUTH_FLOW_ENABLED = false;
const GOOGLE_AUTH_FAILED_MESSAGE =
  'Google 授权失败。请确认 Chrome 已登录 Google 账号，并在 chrome://extensions 刷新插件后重试。';
const CHROME_NATIVE_AUTH_FAILED_100_MESSAGE =
  'Chrome 原生授权失败（-100）。请刷新插件、重新打开页面后重试。';
const CHATGPT_CLOUD_NEWER_UPLOAD_BLOCKED_MESSAGE =
  '云端数据可能比本机更新。请先从云端拉取并合并，确认无误后再上传。';
const CHATGPT_LAST_SYNC_TIME_STORAGE_KEY = 'ceLastSyncTimeChatGPT';
const CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY = 'ceLastUploadTimeChatGPT';
const CHATGPT_LAST_SYNC_TIME_LEGACY_STORAGE_KEY = 'gvLastSyncTimeChatGPT';
const CHATGPT_LAST_UPLOAD_TIME_LEGACY_STORAGE_KEY = 'gvLastUploadTimeChatGPT';

type AppDataFileMetadata = {
  id: string;
  name: string;
  modifiedTime?: string;
};

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Google Drive Sync Service
 * Handles authentication, upload, and download of sync data as separate files
 */
export class GoogleDriveSyncService {
  private state: SyncState = { ...DEFAULT_SYNC_STATE };
  private foldersFileId: string | null = null;
  private aistudioFoldersFileId: string | null = null;
  private promptsFileId: string | null = null;
  private settingsFileId: string | null = null;
  private starredFileId: string | null = null;
  private forksFileId: string | null = null;
  private timelineHierarchyFileId: string | null = null;
  private backupFolderId: string | null = null;
  private fileIdByName: Record<string, string> = {};
  private stateChangeCallback: ((state: SyncState) => void) | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private stateLoadPromise: Promise<void> | null = null;
  private lastAuthError: string | null = null;

  constructor() {
    this.stateLoadPromise = this.loadState();
  }

  onStateChange(callback: (state: SyncState) => void): void {
    this.stateChangeCallback = callback;
  }

  /**
   * Ensure state is loaded before returning
   */
  async getState(): Promise<SyncState> {
    if (this.stateLoadPromise) {
      await this.stateLoadPromise;
    }
    return { ...this.state };
  }

  async setMode(mode: SyncMode): Promise<void> {
    this.state.mode = mode;
    await this.saveState();
    this.notifyStateChange();
  }

  async authenticate(interactive: boolean = true): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });
      const token = await this.getAuthToken(interactive);
      if (!token) {
        // If not interactive and no token, just return false silently
        if (!interactive) {
          this.updateState({ isAuthenticated: false, isSyncing: false });
          return false;
        }
        throw new Error(this.getAuthFailureMessage());
      }
      this.updateState({ isAuthenticated: true, isSyncing: false });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      console.error('[GoogleDriveSyncService] Authentication failed:', error);
      this.updateState({ isAuthenticated: false, isSyncing: false, error: errorMessage });
      return false;
    }
  }

  async signOut(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.removeCachedAuthToken(this.accessToken);
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${this.accessToken}`);
      }
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Sign out warning:', error);
    }
    await this.clearToken();
    this.foldersFileId = null;
    this.aistudioFoldersFileId = null;
    this.promptsFileId = null;
    this.settingsFileId = null;
    this.starredFileId = null;
    this.forksFileId = null;
    this.timelineHierarchyFileId = null;
    this.backupFolderId = null;
    this.fileIdByName = {};
    this.updateState({
      isAuthenticated: false,
      lastSyncTime: null,
      lastSyncTimeChatGPT: null,
      error: null,
    });
    await this.saveState();
  }

  async uploadChatGPTPayload(
    payload: ChatGPTSyncPayload,
    interactive: boolean = true,
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
        safety.fileId || (await this.ensureAppDataFileId(token, CHATGPT_SYNC_FILE_NAME));
      await this.uploadFileWithRetry(token, fileId, payload);
      const syncTime = Date.now();
      this.updateState({
        isSyncing: false,
        isAuthenticated: true,
        lastUploadTimeChatGPT: syncTime,
        error: null,
      });
      await this.saveState();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'ChatGPT upload failed';
      console.error('[GoogleDriveSyncService] ChatGPT upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  async downloadChatGPTPayload(interactive: boolean = true): Promise<ChatGPTSyncPayload | null> {
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

      const fileId = await this.findAppDataFile(token, CHATGPT_SYNC_FILE_NAME);
      if (!fileId) {
        this.updateState({ isSyncing: false, isAuthenticated: true });
        return null;
      }

      const payload = await this.downloadFileWithRetry<ChatGPTSyncPayload>(token, fileId);
      const syncTime = Date.now();
      this.updateState({
        isSyncing: false,
        isAuthenticated: true,
        lastSyncTimeChatGPT: syncTime,
        error: null,
      });
      await this.saveState();
      return payload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'ChatGPT download failed';
      console.error('[GoogleDriveSyncService] ChatGPT download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  async hasChatGPTSyncData(interactive: boolean = false): Promise<boolean> {
    const token = await this.getAuthToken(interactive);
    if (!token) return false;
    return Boolean(await this.findAppDataFile(token, CHATGPT_SYNC_FILE_NAME));
  }

  async hasCloudSyncData(
    interactive: boolean = false,
    platform: SyncPlatform = 'gemini',
    accountScope: SyncAccountScope | null = null,
    timelineHierarchyAccountScope: SyncAccountScope | null = null,
  ): Promise<boolean> {
    const token = await this.getAuthToken(interactive);
    if (!token) return false;

    const foldersBaseFileName =
      platform === 'aistudio' ? AISTUDIO_FOLDERS_FILE_NAME : FOLDERS_FILE_NAME;
    if (await this.findFileForScope(token, foldersBaseFileName, accountScope)) {
      return true;
    }

    if (await this.findFile(token, SETTINGS_FILE_NAME)) {
      return true;
    }

    if (platform !== 'gemini') {
      return false;
    }

    const timelineHierarchyScope = timelineHierarchyAccountScope ?? accountScope;
    const geminiFileNames: Array<[string, SyncAccountScope | null]> = [
      [PROMPTS_FILE_NAME, accountScope],
      [STARRED_FILE_NAME, accountScope],
      [FORKS_FILE_NAME, accountScope],
      [TIMELINE_HIERARCHY_FILE_NAME, timelineHierarchyScope],
    ];

    for (const [fileName, scope] of geminiFileNames) {
      if (await this.findFileForScope(token, fileName, scope)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Upload folders, prompts, and timeline data as separate files to Google Drive
   * @param folders Folder data to upload
   * @param prompts Prompt items (only for Gemini platform)
   * @param starred Starred messages (only for Gemini platform)
   * @param interactive Whether to show auth prompt if needed
   * @param platform Platform to upload for ('gemini' | 'aistudio')
   */
  async upload(
    folders: FolderData,
    prompts: PromptItem[],
    starred: StarredMessagesDataSync | null = null,
    interactive: boolean = true,
    platform: SyncPlatform = 'gemini',
    forks: ForkNodesDataSync | null = null,
    timelineHierarchy: TimelineHierarchyDataSync | null = null,
    accountScope: SyncAccountScope | null = null,
    timelineHierarchyAccountScope: SyncAccountScope | null = null,
    settings: Record<string, unknown> | null = null,
  ): Promise<boolean> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.getAuthToken(interactive);
      if (!token) {
        if (!interactive) {
          console.log(
            '[GoogleDriveSyncService] Upload skipped: Not authenticated (non-interactive)',
          );
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return false;
        }
        throw new Error(this.getAuthFailureMessage());
      }

      const now = new Date();

      // Create folder payload
      const folderPayload: FolderExportPayload = {
        format: 'gemini-voyager.folders.v1',
        exportedAt: now.toISOString(),
        version: EXTENSION_VERSION,
        data: folders,
      };

      // Create prompt payload
      const promptPayload: PromptExportPayload = {
        format: 'gemini-voyager.prompts.v1',
        exportedAt: now.toISOString(),
        version: EXTENSION_VERSION,
        items: prompts,
      };

      const settingsPayload: SettingsExportPayload | null = settings
        ? {
            format: 'gemini-voyager.settings.v1',
            exportedAt: now.toISOString(),
            version: EXTENSION_VERSION,
            data: settings,
          }
        : null;

      // Upload folders file (platform-specific)
      const foldersBaseFileName =
        platform === 'aistudio' ? AISTUDIO_FOLDERS_FILE_NAME : FOLDERS_FILE_NAME;
      const foldersFileName = this.getFileNameForScope(foldersBaseFileName, accountScope);
      const foldersType = platform === 'aistudio' ? 'aistudio-folders' : 'folders';
      const foldersFileIdToUse = await this.ensureFileId(token, foldersFileName, foldersType);
      await this.uploadFileWithRetry(token, foldersFileIdToUse, folderPayload);
      console.log(`[GoogleDriveSyncService] ${platform} folders uploaded successfully`);

      // Upload prompts file (shared between Gemini and AI Studio)
      if (prompts.length > 0) {
        const promptsFileName = this.getFileNameForScope(PROMPTS_FILE_NAME, accountScope);
        const promptsFileId = await this.ensureFileId(token, promptsFileName, 'prompts');
        await this.uploadFileWithRetry(token, promptsFileId, promptPayload);
        console.log('[GoogleDriveSyncService] Prompts uploaded successfully');
      }

      if (settingsPayload) {
        const settingsFileId = await this.ensureFileId(token, SETTINGS_FILE_NAME, 'settings');
        await this.uploadFileWithRetry(token, settingsFileId, settingsPayload);
        console.log('[GoogleDriveSyncService] Settings uploaded successfully');
      }

      // Upload starred messages file (only for Gemini platform)
      if (platform === 'gemini' && starred) {
        // Truncate content in starred messages to save storage space
        const MAX_CONTENT_LENGTH = 60;
        const truncatedStarred: StarredMessagesDataSync = {
          messages: Object.fromEntries(
            Object.entries(starred.messages).map(([convId, messages]) => [
              convId,
              messages.map((msg) => ({
                ...msg,
                content:
                  msg.content.length > MAX_CONTENT_LENGTH
                    ? msg.content.slice(0, MAX_CONTENT_LENGTH) + '...'
                    : msg.content,
              })),
            ]),
          ),
        };

        const starredPayload: StarredExportPayload = {
          format: 'gemini-voyager.starred.v1',
          exportedAt: now.toISOString(),
          version: EXTENSION_VERSION,
          data: truncatedStarred,
        };
        const starredFileName = this.getFileNameForScope(STARRED_FILE_NAME, accountScope);
        const starredFileId = await this.ensureFileId(token, starredFileName, 'starred');
        await this.uploadFileWithRetry(token, starredFileId, starredPayload);
        console.log('[GoogleDriveSyncService] Starred messages uploaded successfully');
      }

      // Upload fork nodes file (only for Gemini platform)
      if (platform === 'gemini' && forks) {
        const forksPayload: ForkExportPayload = {
          format: 'gemini-voyager.forks.v1',
          exportedAt: now.toISOString(),
          version: EXTENSION_VERSION,
          data: forks,
        };
        const forksFileName = this.getFileNameForScope(FORKS_FILE_NAME, accountScope);
        const forksFileId = await this.ensureFileId(token, forksFileName, 'forks');
        await this.uploadFileWithRetry(token, forksFileId, forksPayload);
        console.log('[GoogleDriveSyncService] Fork nodes uploaded successfully');
      }

      // Upload timeline hierarchy file (only for Gemini platform)
      if (platform === 'gemini' && timelineHierarchy) {
        const timelineHierarchyScope = timelineHierarchyAccountScope ?? accountScope;
        const timelineHierarchyPayload: TimelineHierarchyExportPayload = {
          format: 'gemini-voyager.timeline-hierarchy.v1',
          exportedAt: now.toISOString(),
          version: EXTENSION_VERSION,
          data: timelineHierarchy,
        };
        const timelineHierarchyFileName = this.getFileNameForScope(
          TIMELINE_HIERARCHY_FILE_NAME,
          timelineHierarchyScope,
        );
        const timelineHierarchyFileId = await this.ensureFileId(
          token,
          timelineHierarchyFileName,
          'timeline-hierarchy',
        );
        await this.uploadFileWithRetry(token, timelineHierarchyFileId, timelineHierarchyPayload);
        console.log('[GoogleDriveSyncService] Timeline hierarchy uploaded successfully');
      }

      const uploadTime = Date.now();
      // Update platform-specific upload time
      if (platform === 'aistudio') {
        this.updateState({ isSyncing: false, lastUploadTimeAIStudio: uploadTime, error: null });
      } else {
        this.updateState({ isSyncing: false, lastUploadTime: uploadTime, error: null });
      }
      await this.saveState();

      const fileCount =
        1 +
        (prompts.length > 0 ? 1 : 0) +
        (settingsPayload ? 1 : 0) +
        (platform === 'gemini' && starred ? 1 : 0) +
        (platform === 'gemini' && forks ? 1 : 0) +
        (platform === 'gemini' && timelineHierarchy ? 1 : 0);
      console.log(
        `[GoogleDriveSyncService] Upload successful - ${fileCount} file(s) for ${platform}`,
      );
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('[GoogleDriveSyncService] Upload failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return false;
    }
  }

  /**
   * Download folders, prompts, and timeline data from separate files in Google Drive
   * Returns all available payloads or null if no files exist
   * @param interactive Whether to show auth prompt if needed
   * @param platform Platform to download for ('gemini' | 'aistudio')
   */
  async download(
    interactive: boolean = true,
    platform: SyncPlatform = 'gemini',
    accountScope: SyncAccountScope | null = null,
    timelineHierarchyAccountScope: SyncAccountScope | null = null,
  ): Promise<{
    folders: FolderExportPayload | null;
    prompts: PromptExportPayload | null;
    settings: SettingsExportPayload | null;
    starred: StarredExportPayload | null;
    forks: ForkExportPayload | null;
    timelineHierarchy: TimelineHierarchyExportPayload | null;
  } | null> {
    try {
      this.updateState({ isSyncing: true, error: null });

      const token = await this.getAuthToken(interactive);
      if (!token) {
        if (!interactive) {
          console.log(
            '[GoogleDriveSyncService] Download skipped: Not authenticated (non-interactive)',
          );
          this.updateState({ isSyncing: false, isAuthenticated: false });
          return null;
        }
        throw new Error(this.getAuthFailureMessage());
      }

      // Download folders file (platform-specific)
      const foldersBaseFileName =
        platform === 'aistudio' ? AISTUDIO_FOLDERS_FILE_NAME : FOLDERS_FILE_NAME;
      const foldersFileId = await this.findFileForScope(token, foldersBaseFileName, accountScope);
      let folders: FolderExportPayload | null = null;
      if (foldersFileId) {
        folders = await this.downloadFileWithRetry(token, foldersFileId);
        console.log(`[GoogleDriveSyncService] ${platform} folders downloaded`);
      }

      // Download prompts file (shared between Gemini and AI Studio)
      let prompts: PromptExportPayload | null = null;
      const promptsFileId = await this.findFileForScope(token, PROMPTS_FILE_NAME, accountScope);
      if (promptsFileId) {
        prompts = await this.downloadFileWithRetry(token, promptsFileId);
        console.log('[GoogleDriveSyncService] Prompts downloaded');
      }

      let settings: SettingsExportPayload | null = null;
      const settingsFileId = await this.findFile(token, SETTINGS_FILE_NAME);
      if (settingsFileId) {
        settings = await this.downloadFileWithRetry(token, settingsFileId);
        console.log('[GoogleDriveSyncService] Settings downloaded');
      }

      // Download starred messages file (only for Gemini platform)
      let starred: StarredExportPayload | null = null;
      if (platform === 'gemini') {
        const starredFileId = await this.findFileForScope(token, STARRED_FILE_NAME, accountScope);
        if (starredFileId) {
          starred = await this.downloadFileWithRetry(token, starredFileId);
          console.log('[GoogleDriveSyncService] Starred messages downloaded');
        }
      }

      // Download fork nodes file (only for Gemini platform)
      let forks: ForkExportPayload | null = null;
      if (platform === 'gemini') {
        const forksFileId = await this.findFileForScope(token, FORKS_FILE_NAME, accountScope);
        if (forksFileId) {
          forks = await this.downloadFileWithRetry(token, forksFileId);
          console.log('[GoogleDriveSyncService] Fork nodes downloaded');
        }
      }

      // Download timeline hierarchy file (only for Gemini platform)
      let timelineHierarchy: TimelineHierarchyExportPayload | null = null;
      if (platform === 'gemini') {
        const timelineHierarchyScope = timelineHierarchyAccountScope ?? accountScope;
        const timelineHierarchyFileId = await this.findFileForScope(
          token,
          TIMELINE_HIERARCHY_FILE_NAME,
          timelineHierarchyScope,
        );
        if (timelineHierarchyFileId) {
          timelineHierarchy = await this.downloadFileWithRetry(token, timelineHierarchyFileId);
          console.log('[GoogleDriveSyncService] Timeline hierarchy downloaded');
        }
      }

      if (!folders && !prompts && !settings && !starred && !forks && !timelineHierarchy) {
        console.log(`[GoogleDriveSyncService] No sync files found for ${platform}`);
        this.updateState({ isSyncing: false });
        return null;
      }

      const syncTime = Date.now();
      // Update platform-specific sync time
      if (platform === 'aistudio') {
        this.updateState({ isSyncing: false, lastSyncTimeAIStudio: syncTime, error: null });
      } else {
        this.updateState({ isSyncing: false, lastSyncTime: syncTime, error: null });
      }
      await this.saveState();

      return { folders, prompts, settings, starred, forks, timelineHierarchy };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('[GoogleDriveSyncService] Download failed:', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      return null;
    }
  }

  // ============== Private Methods ==============

  private async loadCachedToken(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['gvAccessToken', 'gvTokenExpiry']);
      const cachedAccessToken = getStringValue(result.gvAccessToken);
      const cachedTokenExpiry = getNumberValue(result.gvTokenExpiry);
      if (cachedAccessToken && cachedTokenExpiry && cachedTokenExpiry > Date.now()) {
        this.accessToken = cachedAccessToken;
        this.tokenExpiry = cachedTokenExpiry;
        console.log('[GoogleDriveSyncService] Loaded cached token');
      }
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to load cached token:', error);
    }
  }

  private async saveToken(token: string, expiresIn: number): Promise<void> {
    this.accessToken = token;
    this.tokenExpiry = Date.now() + expiresIn * 1000 - 60000;
    try {
      await chrome.storage.local.set({ gvAccessToken: token, gvTokenExpiry: this.tokenExpiry });
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to save token:', error);
    }
  }

  private async clearToken(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiry = 0;
    try {
      await chrome.storage.local.remove(['gvAccessToken', 'gvTokenExpiry']);
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to clear token:', error);
    }
  }

  private isUserDeniedAuthError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('did not approve access') ||
      normalized.includes('user denied') ||
      normalized.includes('access_denied')
    );
  }

  private normalizeAuthErrorMessage(message: string): string {
    if (message.includes('Connection failed (-100)') || message.includes('(-100)')) {
      return CHROME_NATIVE_AUTH_FAILED_100_MESSAGE;
    }
    return GOOGLE_AUTH_FAILED_MESSAGE;
  }

  private getAuthFailureMessage(): string {
    return this.lastAuthError || GOOGLE_AUTH_FAILED_MESSAGE;
  }

  private extractIdentityToken(result: unknown): string | null {
    if (typeof result === 'string' && result.trim()) {
      return result;
    }

    if (typeof result === 'object' && result !== null) {
      const token = (result as { token?: unknown }).token;
      if (typeof token === 'string' && token.trim()) {
        return token;
      }
    }

    return null;
  }

  private async requestIdentityAuthToken(
    interactive: boolean,
  ): Promise<{ token: string | null; userDenied: boolean }> {
    const identity = chrome.identity;
    if (!identity?.getAuthToken) {
      return { token: null, userDenied: false };
    }

    try {
      const tokenResult = await new Promise<unknown>((resolve, reject) => {
        identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      });

      const token = this.extractIdentityToken(tokenResult);
      if (!token) {
        return { token: null, userDenied: false };
      }

      // getAuthToken does not provide expiry; keep a short TTL and persist for worker restarts.
      await this.saveToken(token, IDENTITY_TOKEN_TTL_SECONDS);
      return { token, userDenied: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const userDenied = this.isUserDeniedAuthError(message);
      this.lastAuthError = this.normalizeAuthErrorMessage(message);
      if (!userDenied) {
        console.warn('[GoogleDriveSyncService] identity.getAuthToken failed:', error);
      }
      return { token: null, userDenied };
    }
  }

  private async getTokenFromIdentity(
    interactive: boolean,
  ): Promise<{ token: string | null; userDenied: boolean }> {
    if (!chrome.identity?.getAuthToken) {
      return { token: null, userDenied: false };
    }

    const nonInteractiveResult = await this.requestIdentityAuthToken(false);
    if (nonInteractiveResult.token) {
      return nonInteractiveResult;
    }

    if (!interactive) {
      return { token: null, userDenied: false };
    }

    return this.requestIdentityAuthToken(true);
  }

  private async removeCachedAuthToken(token: string): Promise<void> {
    const identity = chrome.identity;
    if (!identity?.removeCachedAuthToken) {
      return;
    }

    await new Promise<void>((resolve) => {
      identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  private async getTokenFromLegacyWebAuthFlow(): Promise<string | null> {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;
    const scopes = manifest.oauth2?.scopes?.join(' ');

    if (!clientId || !scopes) {
      console.error('[GoogleDriveSyncService] Missing oauth2 config');
      return null;
    }

    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('[GoogleDriveSyncService] Auth flow starting with redirectUrl:', redirectUrl);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', scopes);

    try {
      const responseUrl = await new Promise<string>((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl.toString(), interactive: true },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response) {
              resolve(response);
            } else {
              reject(new Error('No response from auth flow'));
            }
          },
        );
      });

      const url = new URL(responseUrl);
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

      if (accessToken) {
        await this.saveToken(accessToken, expiresIn);
        return accessToken;
      }
      return null;
    } catch (error) {
      console.error('[GoogleDriveSyncService] Auth flow failed:', error);
      return null;
    }
  }

  private async getAuthToken(interactive: boolean): Promise<string | null> {
    this.lastAuthError = null;

    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    if (this.accessToken && this.tokenExpiry <= Date.now()) {
      this.accessToken = null;
      this.tokenExpiry = 0;
    }

    await this.loadCachedToken();
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    const supportsIdentityApi = !!chrome.identity?.getAuthToken;
    if (supportsIdentityApi) {
      const identityResult = await this.getTokenFromIdentity(interactive);
      if (identityResult.token) {
        return identityResult.token;
      }

      if (!interactive) {
        return null;
      }

      console.warn(
        '[GoogleDriveSyncService] Native identity auth failed; legacy web auth fallback is disabled for Chrome-extension OAuth clients.',
      );
      return null;
    }

    if (!interactive) {
      return null;
    }

    this.lastAuthError = GOOGLE_AUTH_FAILED_MESSAGE;
    if (LEGACY_WEB_AUTH_FLOW_ENABLED) {
      return this.getTokenFromLegacyWebAuthFlow();
    }
    console.warn(
      '[GoogleDriveSyncService] chrome.identity.getAuthToken is unavailable; legacy web auth fallback is disabled.',
    );
    return null;
  }

  private async findFile(token: string, fileName: string): Promise<string | null> {
    const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
    const url = `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(`Failed to search files: ${response.status}`);
    }
    const result = await response.json();
    return result.files?.[0]?.id || null;
  }

  private async findAppDataFile(token: string, fileName: string): Promise<string | null> {
    const file = await this.findAppDataFileMetadata(token, fileName);
    return file?.id || null;
  }

  private async findAppDataFileMetadata(
    token: string,
    fileName: string,
  ): Promise<AppDataFileMetadata | null> {
    const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
    const url = `${DRIVE_API_BASE}/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(`Failed to search appDataFolder files: ${response.status}`);
    }
    const result = await response.json();
    return result.files?.[0] || null;
  }

  private getChatGPTLastKnownCloudTime(): number {
    return Math.max(this.state.lastSyncTimeChatGPT || 0, this.state.lastUploadTimeChatGPT || 0);
  }

  private async readChatGPTCloudExportedAt(
    token: string,
    fileId: string,
  ): Promise<number | null> {
    try {
      const payload = await this.downloadFileWithRetry<Partial<ChatGPTSyncPayload>>(token, fileId);
      const exportedAt = typeof payload?.exportedAt === 'string' ? Date.parse(payload.exportedAt) : 0;
      return Number.isFinite(exportedAt) && exportedAt > 0 ? exportedAt : null;
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Failed to read ChatGPT cloud exportedAt:', error);
      return null;
    }
  }

  private async checkChatGPTUploadSafety(
    token: string,
  ): Promise<{ allowed: boolean; fileId: string | null }> {
    const cloudFile = await this.findAppDataFileMetadata(token, CHATGPT_SYNC_FILE_NAME);
    if (!cloudFile?.id) {
      return { allowed: true, fileId: null };
    }

    const lastKnownCloudTime = this.getChatGPTLastKnownCloudTime();
    if (!lastKnownCloudTime) {
      console.warn(
        '[GoogleDriveSyncService] ChatGPT upload blocked: cloud file exists but this device has no prior sync/upload timestamp.',
      );
      return { allowed: false, fileId: cloudFile.id };
    }

    const modifiedTime = cloudFile.modifiedTime ? Date.parse(cloudFile.modifiedTime) : 0;
    const exportedAt = await this.readChatGPTCloudExportedAt(token, cloudFile.id);
    const cloudTime = Math.max(
      Number.isFinite(modifiedTime) ? modifiedTime : 0,
      exportedAt || 0,
    );

    if (cloudTime > lastKnownCloudTime) {
      console.warn('[GoogleDriveSyncService] ChatGPT upload blocked: cloud data is newer.', {
        cloudTime,
        lastKnownCloudTime,
      });
      return { allowed: false, fileId: cloudFile.id };
    }

    return { allowed: true, fileId: cloudFile.id };
  }

  private async ensureAppDataFileId(token: string, fileName: string): Promise<string> {
    const existingId = await this.findAppDataFile(token, fileName);
    if (existingId) return existingId;

    const response = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fileName,
        mimeType: 'application/json',
        parents: ['appDataFolder'],
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create appDataFolder file: ${response.status}`);
    }
    const result = await response.json();
    return result.id;
  }

  private getFileNameForScope(baseFileName: string, accountScope: SyncAccountScope | null): string {
    if (!accountScope) return baseFileName;

    const suffix = `acct-${hashString(accountScope.accountKey)}`;
    const dotIndex = baseFileName.lastIndexOf('.');
    if (dotIndex <= 0) {
      return `${baseFileName}.${suffix}`;
    }
    return `${baseFileName.slice(0, dotIndex)}.${suffix}${baseFileName.slice(dotIndex)}`;
  }

  private async findFileForScope(
    token: string,
    baseFileName: string,
    accountScope: SyncAccountScope | null,
  ): Promise<string | null> {
    if (!accountScope) {
      return this.findFile(token, baseFileName);
    }

    const scopedFileName = this.getFileNameForScope(baseFileName, accountScope);
    const scopedFileId = await this.findFile(token, scopedFileName);
    if (scopedFileId) return scopedFileId;

    // Backward compatibility: allow reading legacy shared file before user uploads scoped data.
    return this.findFile(token, baseFileName);
  }

  private async ensureFileId(
    token: string,
    fileName: string,
    type:
      | 'folders'
      | 'aistudio-folders'
      | 'prompts'
      | 'settings'
      | 'starred'
      | 'forks'
      | 'timeline-hierarchy',
  ): Promise<string> {
    // 1. Ensure backup folder exists
    const folderId = await this.ensureBackupFolder(token);

    // 2. Check if we have a valid cached file ID
    const currentId = this.fileIdByName[fileName] ?? null;

    if (currentId) {
      const parents = await this.getFileParents(token, currentId);
      if (parents) {
        // File exists
        if (!parents.includes(folderId)) {
          // File exists but not in the backup folder, move it
          console.log(`[GoogleDriveSyncService] Moving ${fileName} to backup folder`);
          await this.moveFile(token, currentId, folderId, parents);
        }
        return currentId;
      }
      // If checkFileParents returns null, the file doesn't exist (e.g. deleted externally), proceed to find/create
    }

    // 3. Search for the file globally (in case it was created before but we lost the ID reference)
    const existingId = await this.findFile(token, fileName);
    if (existingId) {
      // Found existing file
      this.setFileIdForType(type, existingId);
      this.fileIdByName[fileName] = existingId;

      // Check if it needs moving
      const parents = await this.getFileParents(token, existingId);
      if (parents && !parents.includes(folderId)) {
        console.log(`[GoogleDriveSyncService] Moving existing ${fileName} to backup folder`);
        await this.moveFile(token, existingId, folderId, parents);
      }
      return existingId;
    }

    // 4. Create new file in the backup folder
    console.log(`[GoogleDriveSyncService] Creating new file ${fileName} in backup folder`);
    const newId = await this.createFile(token, fileName, folderId);
    this.setFileIdForType(type, newId);
    this.fileIdByName[fileName] = newId;
    return newId;
  }

  private setFileIdForType(
    type:
      | 'folders'
      | 'aistudio-folders'
      | 'prompts'
      | 'settings'
      | 'starred'
      | 'forks'
      | 'timeline-hierarchy',
    fileId: string,
  ): void {
    switch (type) {
      case 'folders':
        this.foldersFileId = fileId;
        break;
      case 'aistudio-folders':
        this.aistudioFoldersFileId = fileId;
        break;
      case 'prompts':
        this.promptsFileId = fileId;
        break;
      case 'settings':
        this.settingsFileId = fileId;
        break;
      case 'starred':
        this.starredFileId = fileId;
        break;
      case 'forks':
        this.forksFileId = fileId;
        break;
      case 'timeline-hierarchy':
        this.timelineHierarchyFileId = fileId;
        break;
    }
  }

  private async ensureBackupFolder(token: string): Promise<string> {
    if (this.backupFolderId) {
      // Verify it still exists
      const exists = await this.checkFileExists(token, this.backupFolderId);
      if (exists) return this.backupFolderId;
    }

    // Search for folder
    const query = encodeURIComponent(
      `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const url = `${DRIVE_API_BASE}/files?q=${query}&fields=files(id)`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Failed to search for backup folder');

    const data = await response.json();
    const existingId = data.files?.[0]?.id;

    if (existingId) {
      this.backupFolderId = existingId;
      return existingId;
    }

    // Create folder
    const metadata = {
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    };
    const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!createResponse.ok) throw new Error('Failed to create backup folder');
    const folderData = await createResponse.json();
    this.backupFolderId = folderData.id;
    console.log('[GoogleDriveSyncService] Created backup folder:', this.backupFolderId);
    return folderData.id;
  }

  private async getFileParents(token: string, fileId: string): Promise<string[] | null> {
    try {
      // Also check if file is trashed - if so, treat as non-existent
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=parents,trashed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) return null;
      const data = await response.json();
      // If file is in trash, treat as non-existent so we create a new one
      if (data.trashed) {
        console.log(`[GoogleDriveSyncService] File ${fileId} is in trash, will create new one`);
        return null;
      }
      return data.parents || [];
    } catch {
      return null;
    }
  }

  private async moveFile(
    token: string,
    fileId: string,
    targetFolderId: string,
    currentParents: string[],
  ): Promise<void> {
    const previousParents = currentParents.join(',');
    const url = `${DRIVE_API_BASE}/files/${fileId}?addParents=${targetFolderId}&removeParents=${previousParents}&fields=id,parents`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.error('[GoogleDriveSyncService] Failed to move file:', await response.text());
      // Don't throw, just log. It's not critical if move fails, as long as we can access the file.
    }
  }

  private async checkFileExists(token: string, fileId: string): Promise<boolean> {
    try {
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async createFile(token: string, fileName: string, parentId?: string): Promise<string> {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
      name: fileName,
      mimeType: 'application/json',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    if (!response.ok) {
      throw new Error(`Failed to create file: ${response.status}`);
    }
    const result = await response.json();
    return result.id;
  }

  private async uploadFileWithRetry(token: string, fileId: string, data: unknown): Promise<void> {
    let delay = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`;
        const response = await fetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error;
        await this.sleep(delay);
        delay *= 2;
      }
    }
  }

  private async downloadFileWithRetry<T>(token: string, fileId: string): Promise<T | null> {
    let delay = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error(`Download failed: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error;
        await this.sleep(delay);
        delay *= 2;
      }
    }
    return null;
  }

  private async loadState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'gvSyncMode',
        'gvLastSyncTime',
        'gvLastUploadTime',
        'gvLastSyncTimeAIStudio',
        'gvLastUploadTimeAIStudio',
        CHATGPT_LAST_SYNC_TIME_STORAGE_KEY,
        CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY,
        CHATGPT_LAST_SYNC_TIME_LEGACY_STORAGE_KEY,
        CHATGPT_LAST_UPLOAD_TIME_LEGACY_STORAGE_KEY,
        'gvSyncError',
      ]);
      const chatGPTLastSyncTime =
        getNumberValue(result[CHATGPT_LAST_SYNC_TIME_STORAGE_KEY]) ??
        getNumberValue(result[CHATGPT_LAST_SYNC_TIME_LEGACY_STORAGE_KEY]);
      const chatGPTLastUploadTime =
        getNumberValue(result[CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY]) ??
        getNumberValue(result[CHATGPT_LAST_UPLOAD_TIME_LEGACY_STORAGE_KEY]);
      const migratedChatGPTSyncState: Record<string, number> = {};
      if (
        getNumberValue(result[CHATGPT_LAST_SYNC_TIME_STORAGE_KEY]) === null &&
        chatGPTLastSyncTime !== null
      ) {
        migratedChatGPTSyncState[CHATGPT_LAST_SYNC_TIME_STORAGE_KEY] = chatGPTLastSyncTime;
      }
      if (
        getNumberValue(result[CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY]) === null &&
        chatGPTLastUploadTime !== null
      ) {
        migratedChatGPTSyncState[CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY] = chatGPTLastUploadTime;
      }
      if (Object.keys(migratedChatGPTSyncState).length > 0) {
        await chrome.storage.local.set(migratedChatGPTSyncState);
        await chrome.storage.local.remove([
          CHATGPT_LAST_SYNC_TIME_LEGACY_STORAGE_KEY,
          CHATGPT_LAST_UPLOAD_TIME_LEGACY_STORAGE_KEY,
        ]);
      }
      this.state = {
        mode: (result.gvSyncMode as SyncMode) || 'disabled',
        lastSyncTime: getNumberValue(result.gvLastSyncTime),
        lastUploadTime: getNumberValue(result.gvLastUploadTime),
        lastSyncTimeAIStudio: getNumberValue(result.gvLastSyncTimeAIStudio),
        lastUploadTimeAIStudio: getNumberValue(result.gvLastUploadTimeAIStudio),
        lastSyncTimeChatGPT: chatGPTLastSyncTime,
        lastUploadTimeChatGPT: chatGPTLastUploadTime,
        error: getStringValue(result.gvSyncError),
        isSyncing: false,
        isAuthenticated: false,
      };
      if (this.state.mode !== 'disabled') {
        const token = await this.getAuthToken(false);
        this.state.isAuthenticated = !!token;
      }
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to load state:', error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      await chrome.storage.local.set({
        gvSyncMode: this.state.mode,
        gvLastSyncTime: this.state.lastSyncTime,
        gvLastUploadTime: this.state.lastUploadTime,
        gvLastSyncTimeAIStudio: this.state.lastSyncTimeAIStudio,
        gvLastUploadTimeAIStudio: this.state.lastUploadTimeAIStudio,
        [CHATGPT_LAST_SYNC_TIME_STORAGE_KEY]: this.state.lastSyncTimeChatGPT,
        [CHATGPT_LAST_UPLOAD_TIME_STORAGE_KEY]: this.state.lastUploadTimeChatGPT,
        gvSyncError: this.state.error,
      });
    } catch (error) {
      console.error('[GoogleDriveSyncService] Failed to save state:', error);
    }
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.stateChangeCallback) {
      this.stateChangeCallback({ ...this.state });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const googleDriveSyncService = new GoogleDriveSyncService();
