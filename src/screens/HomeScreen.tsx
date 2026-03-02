import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useAppSession } from '../contexts/AppSessionContext';
import { HistoryScreen } from './HistoryScreen';
import { LabelsScreen } from './LabelsScreen';
import { LotDetailScreen } from './LotDetailScreen';
import { LotsScreen } from './LotsScreen';

type TabKey = 'lots' | 'labels' | 'history' | 'profile';

const COLORS = {
  pageBg: '#E9EDF3',
  headerBg: '#F8FAFC',
  headerBorder: '#D8DFEA',
  title: '#0F172A',
  subtitle: '#334155',
  user: '#1D4ED8',
  cardBg: '#CFD8E3',
  cardBorder: '#B7C4D5',
  cardTitle: '#0F172A',
  cardSubtitle: '#334155',
  navBg: '#F8FAFC',
  navBorder: '#D8DFEA',
  tabActiveBg: '#DCEFE3',
  tabActiveBorder: '#9ED9B3',
  tabActiveIcon: '#0A8F5A',
  tabIcon: '#334155',
  syncOnline: '#0A8F5A',
  syncChecking: '#0EA5E9',
  syncDegraded: '#F59E0B',
  syncOffline: '#DC2626',
};

export function HomeScreen() {
  const {
    user,
    logout,
    syncStatus,
    syncReason,
    lastSyncAt,
    lastSyncCheckAt,
    refreshSyncStatus,
    stationId,
    stationLabel,
    apiBase,
    printerDirectUrl,
    labelFormat,
  } = useAppSession();
  const [tab, setTab] = useState<TabKey>('lots');
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [refreshingSync, setRefreshingSync] = useState(false);
  const inLotWorkspace = selectedLotId !== null;

  const syncMeta = getSyncMeta(syncStatus);
  const lastSyncText = lastSyncAt ? formatDateTime(lastSyncAt) : 'Sin sincronización confirmada';
  const lastCheckText = lastSyncCheckAt ? formatDateTime(lastSyncCheckAt) : 'Sin chequeo aún';

  async function handleRefreshSync() {
    setRefreshingSync(true);
    try {
      await refreshSyncStatus();
    } finally {
      setRefreshingSync(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          {inLotWorkspace ? (
            <Pressable
              style={styles.topBackButton}
              onPress={() => setSelectedLotId(null)}
              hitSlop={8}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M15 5L8.5 12L15 19"
                  stroke="#0A8F5A"
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ) : null}
          <Image source={require('../assets/logo-stock.png')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.brandName}>Metrik Stock</Text>
        </View>
        <View style={styles.rightHeaderWrap}>
          <Pressable style={styles.syncChip} onPress={() => setShowSyncModal(true)}>
            <View style={[styles.syncDot, { backgroundColor: syncMeta.color }]} />
          </Pressable>
          {!inLotWorkspace ? (
            <Text style={styles.topMeta} numberOfLines={1} ellipsizeMode="tail">
              {user?.name ?? 'Usuario'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.content, inLotWorkspace ? styles.contentNoNav : null]}>
        {tab === 'lots' ? (
          selectedLotId ? (
            <LotDetailScreen
              lotId={selectedLotId}
              onBack={() => setSelectedLotId(null)}
              showInlineHeader={false}
            />
          ) : (
            <LotsScreen onOpenLot={(id) => setSelectedLotId(id)} />
          )
        ) : null}

        {tab === 'labels' ? <LabelsScreen /> : null}

        {tab === 'history' ? <HistoryScreen /> : null}

        {tab === 'profile' ? (
          <ProfilePanel
            userName={user?.name ?? 'Usuario'}
            userEmail={user?.email ?? null}
            userRole={user?.role ?? null}
            stationId={stationId}
            stationLabel={stationLabel}
            apiBase={apiBase}
            printerDirectUrl={printerDirectUrl}
            labelFormat={labelFormat}
            syncLabel={syncMeta.label}
            syncColor={syncMeta.color}
            lastSyncText={lastSyncText}
            lastCheckText={lastCheckText}
            syncReason={syncReason}
            refreshingSync={refreshingSync}
            onRefreshSync={handleRefreshSync}
            onLogout={logout}
          />
        ) : null}
      </View>

      {!inLotWorkspace ? (
        <View style={styles.bottomNavWrap}>
          <View style={styles.bottomNav}>
            <BottomTabButton icon="home" active={tab === 'lots'} onPress={() => setTab('lots')} />
            <BottomTabButton icon="tag" active={tab === 'labels'} onPress={() => setTab('labels')} />
            <BottomTabButton icon="report" active={tab === 'history'} onPress={() => setTab('history')} />
            <BottomTabButton icon="profile" active={tab === 'profile'} onPress={() => setTab('profile')} />
          </View>
        </View>
      ) : null}

      <Modal visible={showSyncModal} transparent animationType="fade" onRequestClose={() => setShowSyncModal(false)}>
        <View style={styles.syncModalBackdrop}>
          <View style={styles.syncModalCard}>
            <Text style={styles.syncModalTitle}>Estado conexión</Text>
            <View style={styles.syncModalStatusRow}>
              <View style={[styles.syncDot, { backgroundColor: syncMeta.color }]} />
              <Text style={styles.syncModalStatusText}>{syncMeta.label}</Text>
            </View>
            <Text style={styles.syncModalLine}>Última sincronización: {lastSyncText}</Text>
            <Text style={styles.syncModalLine}>Último chequeo: {lastCheckText}</Text>
            {syncReason ? (
              <Text style={styles.syncModalLine} numberOfLines={2}>
                Detalle: {syncReason}
              </Text>
            ) : null}

            <View style={styles.syncModalActions}>
              <Pressable style={styles.syncModalCloseButton} onPress={() => setShowSyncModal(false)}>
                <Text style={styles.syncModalCloseText}>Cerrar</Text>
              </Pressable>
              <Pressable
                style={styles.syncModalRefreshButton}
                onPress={handleRefreshSync}
                disabled={refreshingSync}
              >
                {refreshingSync ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.syncModalRefreshText}>Revalidar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getSyncMeta(status: string) {
  if (status === 'online') return { label: 'Conectado y sincronizado', color: COLORS.syncOnline };
  if (status === 'degraded') return { label: 'Sesión o sync con advertencia', color: COLORS.syncDegraded };
  if (status === 'offline') return { label: 'Sin conexión con API', color: COLORS.syncOffline };
  return { label: 'Validando conexión', color: COLORS.syncChecking };
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function BottomTabButton({
  icon,
  active,
  onPress,
}: {
  icon: 'home' | 'tag' | 'report' | 'profile';
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? COLORS.tabActiveIcon : COLORS.tabIcon;
  return (
    <Pressable
      style={[styles.bottomTabButton, active ? styles.bottomTabButtonActive : null]}
      onPress={onPress}
    >
      <NavIcon name={icon} color={color} />
    </Pressable>
  );
}

function NavIcon({ name, color }: { name: 'home' | 'tag' | 'report' | 'profile'; color: string }) {
  const strokeWidth = 1.9;

  if (name === 'home') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4.6 11L12 4.7L19.4 11V19.3H4.6V11Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === 'tag') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M3 12l9-9h6l3 3v6l-9 9-9-9z"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Circle
          cx={16.5}
          cy={7.5}
          r={1.5}
          stroke={color}
          strokeWidth={1.6}
        />
      </Svg>
    );
  }

  if (name === 'report') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 19h16"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <Path
          d="M7 16V9m5 7V6m5 10v-4"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.35} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M5.4 19.4C6.2 16.6 8.7 14.8 12 14.8C15.3 14.8 17.8 16.6 18.6 19.4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ProfilePanel({
  userName,
  userEmail,
  userRole,
  stationId,
  stationLabel,
  apiBase,
  printerDirectUrl,
  labelFormat,
  syncLabel,
  syncColor,
  lastSyncText,
  lastCheckText,
  syncReason,
  refreshingSync,
  onRefreshSync,
  onLogout,
}: {
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  stationId: string;
  stationLabel: string;
  apiBase: string;
  printerDirectUrl: string;
  labelFormat: string;
  syncLabel: string;
  syncColor: string;
  lastSyncText: string;
  lastCheckText: string;
  syncReason: string | null;
  refreshingSync: boolean;
  onRefreshSync: () => Promise<void>;
  onLogout: () => void;
}) {
  function openSopGuide() {
    const base = apiBase.replace(/\/$/, '');
    const sopUrl = `${base}/receiving/sop/download`;
    Linking.openURL(sopUrl).catch(() => undefined);
  }

  return (
    <ScrollView
      style={styles.profileWrap}
      contentContainerStyle={styles.profileScrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>Perfil</Text>
        <Text style={styles.profileLine}>Usuario: {userName}</Text>
        {userEmail ? <Text style={styles.profileLine}>Correo: {userEmail}</Text> : null}
        {userRole ? <Text style={styles.profileLine}>Rol: {userRole}</Text> : null}
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>Estación</Text>
        <Text style={styles.profileLine}>ID: {stationId}</Text>
        <Text style={styles.profileLine}>Nombre: {stationLabel}</Text>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>Conectividad</Text>
        <View style={styles.profileSyncRow}>
          <View style={[styles.syncDot, { backgroundColor: syncColor }]} />
          <Text style={styles.profileLine}>{syncLabel}</Text>
        </View>
        <Text style={styles.profileLineSmall}>Última sync: {lastSyncText}</Text>
        <Text style={styles.profileLineSmall}>Último chequeo: {lastCheckText}</Text>
        {syncReason ? <Text style={styles.profileLineSmall}>Detalle: {syncReason}</Text> : null}
        <Pressable style={styles.profileSecondaryBtn} onPress={() => { onRefreshSync().catch(() => undefined); }}>
          {refreshingSync ? (
            <ActivityIndicator size="small" color="#0A8F5A" />
          ) : (
            <Text style={styles.profileSecondaryText}>Revalidar conexión</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>Impresión</Text>
        <Text style={styles.profileLineSmall} numberOfLines={1}>
          Impresora: {printerDirectUrl}
        </Text>
        <Text style={styles.profileLineSmall}>Formato: {labelFormat || 'Kensar'}</Text>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>API</Text>
        <Text style={styles.profileLineSmall} numberOfLines={1}>
          {apiBase}
        </Text>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>SOP operativo</Text>
        <Text style={styles.profileLineSmall}>
          Guía oficial de recepción en tablet (v1).
        </Text>
        <Pressable style={styles.profileSecondaryBtn} onPress={openSopGuide}>
          <Text style={styles.profileSecondaryText}>Descargar SOP</Text>
        </Pressable>
      </View>

      <Pressable style={styles.profileLogoutBtn} onPress={onLogout}>
        <Text style={styles.profileLogoutText}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBg,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomColor: COLORS.headerBorder,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.headerBg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  topBackButton: {
    width: 26,
    height: 26,
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: {
    width: 24,
    height: 24,
  },
  brandName: {
    color: COLORS.title,
    fontSize: 20,
    fontWeight: '700',
  },
  topMeta: {
    color: COLORS.user,
    fontSize: 15,
    fontWeight: '600',
    maxWidth: 220,
    minWidth: 140,
    textAlign: 'right',
  },
  rightHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  syncChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 96,
  },
  contentNoNav: {
    paddingBottom: 12,
  },
  profileWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 16,
  },
  profileScrollContent: {
    flexGrow: 1,
    gap: 10,
    paddingBottom: 172,
  },
  profileCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardBg,
    padding: 12,
    gap: 4,
  },
  profileTitle: {
    color: COLORS.cardTitle,
    fontSize: 16,
    fontWeight: '800',
  },
  profileLine: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  profileLineSmall: {
    color: '#334155',
    fontSize: 13,
  },
  profileSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileSecondaryBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    backgroundColor: '#DCEFE3',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 146,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSecondaryText: {
    color: '#0A8F5A',
    fontWeight: '700',
    fontSize: 13,
  },
  profileLogoutBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileLogoutText: {
    color: '#B91C1C',
    fontWeight: '800',
    fontSize: 15,
  },
  bottomNavWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  bottomNav: {
    backgroundColor: COLORS.navBg,
    borderRadius: 22,
    paddingVertical: 7,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navBorder,
  },
  bottomTabButton: {
    borderRadius: 14,
    flex: 1,
    marginHorizontal: 2,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomTabButtonActive: {
    backgroundColor: COLORS.tabActiveBg,
    borderWidth: 1,
    borderColor: COLORS.tabActiveBorder,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    elevation: 1,
  },
  syncModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  syncModalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 14,
    gap: 8,
  },
  syncModalTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  syncModalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncModalStatusText: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  syncModalLine: {
    color: '#334155',
    fontSize: 13,
  },
  syncModalActions: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  syncModalCloseButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  syncModalCloseText: {
    color: '#334155',
    fontWeight: '700',
  },
  syncModalRefreshButton: {
    minWidth: 104,
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A8F5A',
  },
  syncModalRefreshText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
});
