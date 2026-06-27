import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockedChrome = typeof chrome;

function createChromeMock(): MockedChrome {
  const localStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const syncStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };

  const runtime = {
    lastError: null as chrome.runtime.LastError | null,
    id: 'test-extension-id',
    getManifest: vi.fn(() => ({
      oauth2: {
        client_id: 'test-client-id',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    })),
  };

  const identity = {
    getAuthToken: vi.fn(),
    removeCachedAuthToken: vi.fn((_details: { token: string }, callback?: () => void) => {
      callback?.();
    }),
  };

  return {
    storage: {
      local: localStorageArea,
      sync: syncStorageArea,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime,
    identity,
  } as unknown as MockedChrome;
}

async function loadServiceClass() {
  vi.resetModules();
  const mod = await import('../GoogleDriveSyncService');
  return mod.GoogleDriveSyncService;
}

describe('GoogleDriveSyncService authentication', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses chrome.identity.getAuthToken with the requested interactivity', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const getAuthTokenMock = chromeMock.identity.getAuthToken as unknown as ReturnType<
      typeof vi.fn
    >;
    getAuthTokenMock.mockImplementation(
      (details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback(details.interactive ? 'interactive-token' : undefined);
      },
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();
    getAuthTokenMock.mockClear();

    const ok = await service.authenticate(true);

    expect(ok).toBe(true);
    expect(getAuthTokenMock).toHaveBeenCalledOnce();
    expect(getAuthTokenMock).toHaveBeenCalledWith({ interactive: true }, expect.any(Function));

    const state = await service.getState();
    expect(state.isAuthenticated).toBe(true);
  });

  it('loads saved sync state and attempts silent native authentication on startup', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const localGetMock = chromeMock.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    localGetMock.mockResolvedValue({
      gvSyncMode: 'auto',
      ceLastSyncTimeChatGPT: 111,
      ceLastUploadTimeChatGPT: 222,
    });

    const getAuthTokenMock = chromeMock.identity.getAuthToken as unknown as ReturnType<
      typeof vi.fn
    >;
    getAuthTokenMock.mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback('identity-token');
      },
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    const state = await service.getState();

    expect(getAuthTokenMock).toHaveBeenCalledWith({ interactive: false }, expect.any(Function));
    expect(state.mode).toBe('auto');
    expect(state.lastSyncTimeChatGPT).toBe(111);
    expect(state.lastUploadTimeChatGPT).toBe(222);
    expect(state.isAuthenticated).toBe(true);
  });

  it('reuses the in-memory token while it is still fresh', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const getAuthTokenMock = chromeMock.identity.getAuthToken as unknown as ReturnType<
      typeof vi.fn
    >;
    getAuthTokenMock.mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback('cached-token');
      },
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();
    const callsAfterStartup = getAuthTokenMock.mock.calls.length;

    const firstAuth = await service.authenticate(true);
    const secondAuth = await service.authenticate(true);

    expect(firstAuth).toBe(true);
    expect(secondAuth).toBe(true);
    expect(getAuthTokenMock).toHaveBeenCalledTimes(callsAfterStartup);
    expect(getAuthTokenMock).toHaveBeenCalledWith({ interactive: false }, expect.any(Function));
  });

  it('removes the cached identity token and revokes it during sign out', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const getAuthTokenMock = chromeMock.identity.getAuthToken as unknown as ReturnType<
      typeof vi.fn
    >;
    getAuthTokenMock.mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback('cached-token');
      },
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();

    await service.authenticate(true);
    await service.signOut();

    const removeCachedAuthTokenMock = chromeMock.identity
      .removeCachedAuthToken as unknown as ReturnType<typeof vi.fn>;
    expect(removeCachedAuthTokenMock).toHaveBeenCalledOnce();
    expect(removeCachedAuthTokenMock).toHaveBeenCalledWith(
      { token: 'cached-token' },
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/revoke?token=cached-token',
    );

    const state = await service.getState();
    expect(state.isAuthenticated).toBe(false);
  });

  it('returns false with a friendly error when native auth is unavailable', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = {
      ...chromeMock,
      identity: {
        ...chromeMock.identity,
        getAuthToken: undefined,
      },
    } as unknown as MockedChrome;

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();

    const ok = await service.authenticate(true);

    expect(ok).toBe(false);
    const state = await service.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toContain('Google 授权失败');
  });

  it('normalizes Chrome native auth connection failures', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const runtimeRef = chromeMock.runtime as { lastError: chrome.runtime.LastError | null };
    const getAuthTokenMock = chromeMock.identity.getAuthToken as unknown as ReturnType<
      typeof vi.fn
    >;
    getAuthTokenMock.mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        runtimeRef.lastError = {
          message: 'OAuth2 request failed: -100 Connection failed',
        } as chrome.runtime.LastError;
        callback(undefined);
        runtimeRef.lastError = null;
      },
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();

    const ok = await service.authenticate(true);

    expect(ok).toBe(false);
    const state = await service.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toContain('Chrome 原生授权失败');
  });
});
