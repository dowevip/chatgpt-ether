import {
  exportChatGPTSyncPayload,
  importChatGPTSyncPayload,
  validateChatGPTSyncPayload,
} from '@/core/services/ChatGPTSyncPayloadService';
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import type { ChatGPTSyncImportMode, SyncMessage, SyncResponse } from '@/core/types/sync';

type RuntimeMessage = SyncMessage | { type?: string; payload?: Record<string, unknown> };

const HANDLED_MESSAGES = new Set([
  'gv.sync.authenticate',
  'gv.sync.signOut',
  'gv.sync.getState',
  'gv.sync.setMode',
  'gv.chatgpt.sync.upload',
  'gv.chatgpt.sync.download',
  'gv.chatgpt.sync.getState',
  'gv.openPopup',
]);

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (!message?.type || !HANDLED_MESSAGES.has(message.type)) {
    return false;
  }

  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch(async (error) => {
      const state = await googleDriveSyncService.getState().catch(() => undefined);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : '操作失败',
        state,
      } satisfies SyncResponse);
    });

  return true;
});

async function handleMessage(message: RuntimeMessage): Promise<SyncResponse | { ok: boolean }> {
  switch (message.type) {
    case 'gv.sync.authenticate': {
      const interactive = message.payload?.interactive !== false;
      const ok = await googleDriveSyncService.authenticate(interactive);
      return {
        ok,
        state: await googleDriveSyncService.getState(),
      };
    }

    case 'gv.sync.signOut': {
      await googleDriveSyncService.signOut();
      return {
        ok: true,
        state: await googleDriveSyncService.getState(),
      };
    }

    case 'gv.sync.getState':
    case 'gv.chatgpt.sync.getState': {
      return {
        ok: true,
        state: await googleDriveSyncService.getState(),
      };
    }

    case 'gv.sync.setMode': {
      const mode = message.payload?.mode;
      if (mode !== 'disabled' && mode !== 'manual' && mode !== 'auto') {
        return {
          ok: false,
          error: '无效的同步模式',
          state: await googleDriveSyncService.getState(),
        };
      }
      await googleDriveSyncService.setMode(mode);
      return {
        ok: true,
        state: await googleDriveSyncService.getState(),
      };
    }

    case 'gv.chatgpt.sync.upload': {
      const payload = await exportChatGPTSyncPayload();
      const validation = validateChatGPTSyncPayload(payload);
      if (!validation) {
        return {
          ok: false,
          error: '本地同步数据格式校验失败',
          state: await googleDriveSyncService.getState(),
        };
      }

      const ok = await googleDriveSyncService.uploadChatGPTPayload(payload, true);
      const state = await googleDriveSyncService.getState();
      return {
        ok,
        error: ok ? undefined : (state.error ?? '上传失败'),
        state,
      };
    }

    case 'gv.chatgpt.sync.download': {
      const payload = await googleDriveSyncService.downloadChatGPTPayload(true);
      if (!payload) {
        const state = await googleDriveSyncService.getState();
        return {
          ok: false,
          error: state.error ?? '从云端拉取失败',
          state,
        };
      }

      const validation = validateChatGPTSyncPayload(payload);
      if (!validation) {
        return {
          ok: false,
          error: '云端同步数据格式校验失败',
          state: await googleDriveSyncService.getState(),
        };
      }

      const overwrite = message.payload?.overwrite === true;
      const mode: ChatGPTSyncImportMode = overwrite ? 'overwrite' : 'merge';
      await importChatGPTSyncPayload(payload, { mode });
      return {
        ok: true,
        data: payload,
        state: await googleDriveSyncService.getState(),
      };
    }

    case 'gv.openPopup': {
      try {
        if (chrome.action?.openPopup) {
          await chrome.action.openPopup();
          return { ok: true };
        }
        return { ok: false };
      } catch {
        return { ok: false };
      }
    }

    default:
      return { ok: false, error: '未知消息类型' };
  }
}
