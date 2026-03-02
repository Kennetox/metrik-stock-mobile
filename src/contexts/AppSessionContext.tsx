import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { createApiClient, ApiError } from '../services/api/client';
import { tabletLogin } from '../services/api/auth';

export type AuthUser = {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
};

export type SyncStatus = 'checking' | 'online' | 'degraded' | 'offline';

type AppSessionValue = {
  isHydrated: boolean;
  apiBase: string;
  setApiBase: (value: string) => void;
  stationId: string;
  setStationId: (value: string) => void;
  stationLabel: string;
  setStationLabel: (value: string) => void;
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
  lastSyncAt: number | null;
  lastSyncCheckAt: number | null;
  refreshSyncStatus: () => Promise<void>;
  loginWithPin: (pin: string, email?: string) => Promise<void>;
  logout: () => void;
  apiClient: ReturnType<typeof createApiClient>;
};

const AppSessionContext = createContext<AppSessionValue | null>(null);

const DEFAULT_API_BASE = 'https://api.metrikpos.com';
const DEFAULT_STATION_ID = 'RECEPCION-01';
const DEFAULT_STATION_LABEL = 'Recepción mostrador';
const DEFAULT_PRINTER_DIRECT_URL = 'http://10.10.20.19:8081';
const DEFAULT_PRINTER_AGENT_URL = 'http://10.10.20.10:5177/print';
const APP_SESSION_STORAGE_KEY = '@metrik_stock/session_v1';

type PersistedAppSession = {
  apiBase?: string;
  stationId?: string;
  stationLabel?: string;
  printerDirectUrl?: string;
  printerAgentUrl?: string;
  labelFormat?: string;
  tabletEmail?: string;
  token?: string | null;
  user?: AuthUser | null;
};

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [stationId, setStationId] = useState(DEFAULT_STATION_ID);
  const [stationLabel, setStationLabel] = useState(DEFAULT_STATION_LABEL);
  const [printerDirectUrl, setPrinterDirectUrl] = useState(DEFAULT_PRINTER_DIRECT_URL);
  const [printerAgentUrl, setPrinterAgentUrl] = useState(DEFAULT_PRINTER_AGENT_URL);
  const [labelFormat, setLabelFormat] = useState('Kensar');
  const [tabletEmail, setTabletEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking');
  const [syncReason, setSyncReason] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncCheckAt, setLastSyncCheckAt] = useState<number | null>(null);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const persistedRaw = await AsyncStorage.getItem(APP_SESSION_STORAGE_KEY);
        if (!persistedRaw || !active) {
          return;
        }

        const persisted = JSON.parse(persistedRaw) as PersistedAppSession;
        if (persisted.apiBase) {
          setApiBase(persisted.apiBase);
        }
        if (persisted.stationId) {
          setStationId(persisted.stationId);
        }
        if (persisted.stationLabel) {
          setStationLabel(persisted.stationLabel);
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
      apiBase,
      stationId,
      stationLabel,
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
    labelFormat,
    tabletEmail,
    printerAgentUrl,
    printerDirectUrl,
    stationId,
    stationLabel,
    token,
    user,
  ]);

  const apiClient = useMemo(
    () =>
      createApiClient({
        getBaseUrl: () => apiBase,
        getToken: () => token,
        onUnauthorized: clearSession,
      }),
    [apiBase, clearSession, token],
  );

  const loginWithPin = useCallback(async (pin: string, email?: string): Promise<void> => {
    const cleanedStation = stationId.trim();
    if (!cleanedStation) {
      throw new ApiError('Configura una estación válida.', 400);
    }
    const normalizedEmail = (email ?? tabletEmail).trim().toLowerCase();
    const payload = await tabletLogin(apiClient, {
      station_id: cleanedStation,
      pin,
      email: normalizedEmail || undefined,
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
    if (normalizedEmail) {
      setTabletEmail(normalizedEmail);
    }
  }, [apiClient, stationId, tabletEmail]);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

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
    if (!isHydrated || !token) {
      setSyncStatus('checking');
      setSyncReason(null);
      return;
    }

    // In development we keep sync checks manual to reduce background activity.
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
      apiBase,
      setApiBase,
      stationId,
      setStationId,
      stationLabel,
      setStationLabel,
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
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
      loginWithPin,
      logout,
      apiClient,
    }),
    [
      apiBase,
      apiClient,
      isHydrated,
      labelFormat,
      tabletEmail,
      stationId,
      stationLabel,
      printerAgentUrl,
      printerDirectUrl,
      token,
      user,
      syncStatus,
      syncReason,
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
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
