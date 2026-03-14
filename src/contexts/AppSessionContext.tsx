import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { tabletLogin } from '../services/api/auth';
import { createApiClient, ApiError } from '../services/api/client';
import { ensureStockDevice } from '../services/api/stockDevices';

export type AuthUser = {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
};

export type SyncStatus = 'checking' | 'online' | 'degraded' | 'offline';

type AppSessionValue = {
  isHydrated: boolean;
  isInitialSetupComplete: boolean;
  completeInitialSetup: () => void;
  apiBase: string;
  setApiBase: (value: string) => void;
  stationId: string;
  setStationId: (value: string) => void;
  stationLabel: string;
  setStationLabel: (value: string) => void;
  stockDeviceId: string;
  setStockDeviceId: (value: string) => void;
  printerDirectUrl: string;
  setPrinterDirectUrl: (value: string) => void;
  printerAgentUrl: string;
  setPrinterAgentUrl: (value: string) => void;
  labelFormat: string;
  setLabelFormat: (value: string) => void;
  tabletEmail: string;
  setTabletEmail: (value: string) => void;
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  syncStatus: SyncStatus;
  syncReason: string | null;
  deviceBlockedReason: string | null;
  lastSyncAt: number | null;
  lastSyncCheckAt: number | null;
  refreshSyncStatus: () => Promise<void>;
  clearDeviceBlockedNotice: () => void;
  loginWithPin: (pin: string, email?: string) => Promise<void>;
  logout: () => void;
  apiClient: ReturnType<typeof createApiClient>;
};

const AppSessionContext = createContext<AppSessionValue | null>(null);

const PROD_API_BASE = 'https://api.metrikpos.com';
const DEV_API_BASE = 'http://10.0.2.2:8000';
const DEFAULT_API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;
const DEFAULT_STATION_ID = 'STK-TABLET';
const LEGACY_STATION_ID = 'RECEPCION-01';
const LEGACY_STATION_LABEL = 'Recepción mostrador';
const SETUP_VERSION = 1;
const DEFAULT_PRINTER_DIRECT_URL = 'http://10.10.20.19:8081';
const DEFAULT_PRINTER_AGENT_URL = 'http://10.10.20.10:5177/print';
const APP_SESSION_STORAGE_KEY = '@metrik_stock/session_v1';

function buildSuggestedDeviceName(): string {
  const constants = (Platform.constants ?? {}) as Record<string, unknown>;
  const modelRaw = String(constants.Model ?? constants.model ?? '').trim();
  const brandRaw = String(constants.Brand ?? constants.brand ?? '').trim();
  const model = modelRaw || 'Tablet';
  const brand = brandRaw && !model.toLowerCase().includes(brandRaw.toLowerCase()) ? `${brandRaw} ` : '';
  return `Tablet recepción ${brand}${model}`.replace(/\s+/g, ' ').trim();
}

function buildSuggestedStationId(): string {
  const constants = (Platform.constants ?? {}) as Record<string, unknown>;
  const modelRaw = String(constants.Model ?? constants.model ?? 'tablet').toUpperCase();
  const normalizedModel = modelRaw.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  const modelPart = normalizedModel ? normalizedModel.slice(0, 10) : 'TABLET';
  return `STK-${modelPart}-${suffix}`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const DEFAULT_STATION_LABEL = buildSuggestedDeviceName();

type PersistedAppSession = {
  setupVersion?: number;
  apiBase?: string;
  stationId?: string;
  stationLabel?: string;
  stockDeviceId?: string;
  printerDirectUrl?: string;
  printerAgentUrl?: string;
  labelFormat?: string;
  tabletEmail?: string;
  token?: string | null;
  user?: AuthUser | null;
};

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isInitialSetupComplete, setIsInitialSetupComplete] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [stationId, setStationId] = useState<string>(() => buildSuggestedStationId());
  const [stationLabel, setStationLabel] = useState(DEFAULT_STATION_LABEL);
  const [stockDeviceId, setStockDeviceId] = useState('');
  const [printerDirectUrl, setPrinterDirectUrl] = useState(DEFAULT_PRINTER_DIRECT_URL);
  const [printerAgentUrl, setPrinterAgentUrl] = useState(DEFAULT_PRINTER_AGENT_URL);
  const [labelFormat, setLabelFormat] = useState('Kensar');
  const [tabletEmail, setTabletEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking');
  const [syncReason, setSyncReason] = useState<string | null>(null);
  const [deviceBlockedReason, setDeviceBlockedReason] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncCheckAt, setLastSyncCheckAt] = useState<number | null>(null);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const clearDeviceBlockedNotice = useCallback(() => {
    setDeviceBlockedReason(null);
  }, []);

  const handleDeviceBlocked = useCallback((reason?: string) => {
    setDeviceBlockedReason(
      reason?.trim() ||
        'Este dispositivo fue bloqueado desde el panel de Metrik. Contacta a un administrador.',
    );
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const persistedRaw = await AsyncStorage.getItem(APP_SESSION_STORAGE_KEY);
        if (!persistedRaw || !active) {
          return;
        }

        const persisted = JSON.parse(persistedRaw) as PersistedAppSession;
        if ((persisted.setupVersion ?? 0) >= SETUP_VERSION) {
          setIsInitialSetupComplete(true);
        }
        if (persisted.apiBase) {
          const normalizedApiBase = persisted.apiBase.trim();
          if (__DEV__ && normalizedApiBase === PROD_API_BASE) {
            setApiBase(DEV_API_BASE);
          } else {
            setApiBase(normalizedApiBase);
          }
        }
        const persistedStationId = (persisted.stationId || '').trim();
        const persistedStationLabel = (persisted.stationLabel || '').trim();

        if (persistedStationId) {
          setStationId(persistedStationId);
        }
        if (persistedStationLabel) {
          setStationLabel(persistedStationLabel);
        }

        // If setup is still pending and values are legacy/default placeholders,
        // suggest unique per-device values to avoid collisions between tablets.
        if ((persisted.setupVersion ?? 0) < SETUP_VERSION) {
          const stationIdLooksLegacy =
            !persistedStationId ||
            persistedStationId.toUpperCase() === LEGACY_STATION_ID ||
            persistedStationId.toUpperCase() === DEFAULT_STATION_ID;
          const stationLabelLooksLegacy =
            !persistedStationLabel ||
            normalizeText(persistedStationLabel) === normalizeText(LEGACY_STATION_LABEL);

          if (stationIdLooksLegacy) {
            setStationId(buildSuggestedStationId());
          }
          if (stationLabelLooksLegacy) {
            setStationLabel(DEFAULT_STATION_LABEL);
          }
        }
        if (persisted.stockDeviceId) {
          setStockDeviceId(persisted.stockDeviceId);
        }
        if (persisted.printerDirectUrl) {
          setPrinterDirectUrl(persisted.printerDirectUrl);
        }
        if (persisted.printerAgentUrl) {
          setPrinterAgentUrl(persisted.printerAgentUrl);
        }
        if (persisted.labelFormat) {
          setLabelFormat(persisted.labelFormat);
        }
        if (persisted.tabletEmail) {
          setTabletEmail(persisted.tabletEmail);
        }
        if (persisted.token) {
          setToken(persisted.token);
        }
        if (persisted.user) {
          setUser(persisted.user);
        }
      } catch {
        // If local state is corrupt, app falls back to defaults.
      } finally {
        if (active) {
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const payload: PersistedAppSession = {
      setupVersion: isInitialSetupComplete ? SETUP_VERSION : 0,
      apiBase,
      stationId,
      stationLabel,
      stockDeviceId,
      printerDirectUrl,
      printerAgentUrl,
      labelFormat,
      tabletEmail,
      token,
      user,
    };
    AsyncStorage.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
  }, [
    apiBase,
    isHydrated,
    isInitialSetupComplete,
    labelFormat,
    tabletEmail,
    printerAgentUrl,
    printerDirectUrl,
    stationId,
    stationLabel,
    stockDeviceId,
    token,
    user,
  ]);

  const apiClient = useMemo(
    () =>
      createApiClient({
        getBaseUrl: () => apiBase,
        getToken: () => token,
        onUnauthorized: clearSession,
        onDeviceBlocked: handleDeviceBlocked,
      }),
    [apiBase, clearSession, handleDeviceBlocked, token],
  );

  const loginWithPin = useCallback(async (pin: string, email?: string): Promise<void> => {
    const cleanedStation = stationId.trim();
    const normalizedEmail = (email ?? tabletEmail).trim().toLowerCase();
    if (!normalizedEmail) {
      throw new ApiError('Primero valida un correo de usuario.', 400);
    }
    const payload = await tabletLogin(apiClient, {
      station_id: cleanedStation || DEFAULT_STATION_ID,
      pin,
      email: normalizedEmail,
    });
    const authToken = payload.access_token ?? payload.token;
    if (!authToken) {
      throw new ApiError('La API no devolvio token de autenticacion', 500);
    }
    setToken(authToken);
    setUser(
      payload.user ?? {
        id: 0,
        name: 'Usuario tablet',
      },
    );
    setDeviceBlockedReason(null);
    setTabletEmail(normalizedEmail);
  }, [apiClient, stationId, tabletEmail]);

  const logout = useCallback(() => {
    clearSession();
    setDeviceBlockedReason(null);
    setTabletEmail('');
  }, [clearSession]);

  const completeInitialSetup = useCallback(() => {
    setIsInitialSetupComplete(true);
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    if (!token) {
      setSyncStatus('checking');
      setSyncReason(null);
      setLastSyncCheckAt(Date.now());
      return;
    }

    try {
      const response = await apiClient.get<{ status?: string; reason?: string }>('/auth/session-status');
      const remoteStatus = (response?.status || '').toLowerCase();
      const remoteReason = response?.reason || null;
      const now = Date.now();
      setLastSyncCheckAt(now);

      if (remoteStatus === 'active') {
        setSyncStatus('online');
        setSyncReason(null);
        setLastSyncAt(now);
        return;
      }

      setSyncStatus('degraded');
      setSyncReason(remoteReason || remoteStatus || 'unknown');
    } catch (err) {
      setLastSyncCheckAt(Date.now());
      setSyncStatus('offline');
      setSyncReason(err instanceof Error ? err.message : 'network_error');
    }
  }, [apiClient, token]);

  useEffect(() => {
    if (!isHydrated || !token || !isInitialSetupComplete) {
      return;
    }
    let active = true;

    const syncStockDevice = async () => {
      const nextName = stationLabel.trim() || DEFAULT_STATION_LABEL;
      try {
        const device = await ensureStockDevice(apiClient, {
          stock_device_id: stockDeviceId || undefined,
          name: nextName,
          bound_device_id: stationId.trim() || undefined,
          bound_device_label: stationLabel.trim() || undefined,
        });
        if (!active) return;
        if (device.id && device.id !== stockDeviceId) {
          setStockDeviceId(device.id);
        }
        if (device.name && device.name !== stationLabel) {
          setStationLabel(device.name);
        }
      } catch {
        // Non-blocking: the app can continue operating and retry on next session.
      }
    };

    syncStockDevice().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiClient, isHydrated, isInitialSetupComplete, stationId, stationLabel, stockDeviceId, token]);

  useEffect(() => {
    if (!isHydrated || !token) {
      setSyncStatus('checking');
      setSyncReason(null);
      return;
    }

    if (__DEV__) {
      return;
    }

    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runCheck = async () => {
      if (!active) return;
      await refreshSyncStatus();
    };

    runCheck();
    intervalId = setInterval(runCheck, 30000);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runCheck();
      }
    });

    return () => {
      active = false;
      subscription.remove();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isHydrated, refreshSyncStatus, token]);

  const value = useMemo<AppSessionValue>(
    () => ({
      isHydrated,
      isInitialSetupComplete,
      completeInitialSetup,
      apiBase,
      setApiBase,
      stationId,
      setStationId,
      stationLabel,
      setStationLabel,
      stockDeviceId,
      setStockDeviceId,
      printerDirectUrl,
      setPrinterDirectUrl,
      printerAgentUrl,
      setPrinterAgentUrl,
      labelFormat,
      setLabelFormat,
      tabletEmail,
      setTabletEmail,
      token,
      user,
      isAuthenticated: Boolean(token),
      syncStatus,
      syncReason,
      deviceBlockedReason,
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
      clearDeviceBlockedNotice,
      loginWithPin,
      logout,
      apiClient,
    }),
    [
      apiBase,
      apiClient,
      isHydrated,
      isInitialSetupComplete,
      completeInitialSetup,
      labelFormat,
      tabletEmail,
      stationId,
      stationLabel,
      stockDeviceId,
      printerAgentUrl,
      printerDirectUrl,
      token,
      user,
      syncStatus,
      syncReason,
      deviceBlockedReason,
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
      clearDeviceBlockedNotice,
      loginWithPin,
      logout,
    ],
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const ctx = useContext(AppSessionContext);
  if (!ctx) {
    throw new Error('useAppSession must be used inside AppSessionProvider');
  }
  return ctx;
}
