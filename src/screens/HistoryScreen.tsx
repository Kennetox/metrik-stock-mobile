import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { getLotDetail, listReceivingCreatedProducts, listReceivingDocuments } from '../services/api/receiving';
import type { ReceivingCreatedProduct, ReceivingDocument, ReceivingLotDetail } from '../types/receiving';
import { ScreenContainer } from '../ui/ScreenContainer';

function formatPurchaseType(type: string) {
  if (type === 'cash') return 'Contado';
  if (type === 'invoice') return 'Factura';
  return type;
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getBogotaYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function shiftBogotaYmd(ymd: string, deltaDays: number): string {
  const pivot = new Date(`${ymd}T12:00:00-05:00`);
  pivot.setUTCDate(pivot.getUTCDate() + deltaDays);
  return getBogotaYmd(pivot);
}

function bogotaBoundaryIso(ymd: string, time: 'start' | 'end'): string {
  const hhmmss = time === 'start' ? '00:00:00.000' : '23:59:59.999';
  return new Date(`${ymd}T${hhmmss}-05:00`).toISOString();
}

function resolveReceivingSupportUrl(
  rawUrl: string | null | undefined,
  apiBase: string,
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const normalizedApiBase = apiBase.replace(/\/$/, '');

  if (trimmed.startsWith('/')) {
    return `${normalizedApiBase}${trimmed}`;
  }

  const absoluteMatch = trimmed.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (absoluteMatch) {
    const path = absoluteMatch[1] ?? '/';
    const normalizedPath = path
      .replace(/^\/upload\//, '/uploads/')
      .replace(/^\/receiving-support\//, '/uploads/receiving-support/');
    if (normalizedPath.includes('/receiving-support/')) {
      return `${normalizedApiBase}${normalizedPath}`;
    }
    return trimmed;
  }

  const normalizedRelative = trimmed
    .replace(/^upload\//, 'uploads/')
    .replace(/^receiving-support\//, 'uploads/receiving-support/');
  return `${normalizedApiBase}/${normalizedRelative.replace(/^\/+/, '')}`;
}

export function HistoryScreen() {
  const { apiBase, apiClient } = useAppSession();
  const [tab, setTab] = useState<'documents' | 'products'>('documents');
  const [docs, setDocs] = useState<ReceivingDocument[]>([]);
  const [createdProducts, setCreatedProducts] = useState<ReceivingCreatedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>('30d');
  const [selectedDoc, setSelectedDoc] = useState<ReceivingDocument | null>(null);
  const [selectedDocDetail, setSelectedDocDetail] = useState<ReceivingLotDetail | null>(null);
  const [loadingSelectedDocDetail, setLoadingSelectedDocDetail] = useState(false);
  const [selectedDocDetailError, setSelectedDocDetailError] = useState<string | null>(null);

  const computeDateRange = useCallback(() => {
    if (range === 'all') return {};
    const endYmd = getBogotaYmd(new Date());
    const startYmd =
      range === 'today' ? endYmd : shiftBogotaYmd(endYmd, range === '7d' ? -6 : -29);
    return {
      date_from: bogotaBoundaryIso(startYmd, 'start'),
      date_to: bogotaBoundaryIso(endYmd, 'end'),
    };
  }, [range]);

  const load = useCallback(async () => {
    setError(null);
    if (tab === 'documents') {
      const { date_from, date_to } = computeDateRange();
      const page = await listReceivingDocuments(apiClient, {
        skip: 0,
        limit: 200,
        date_from,
        date_to,
      });
      setDocs(page.items);
      return;
    }
    const page = await listReceivingCreatedProducts(apiClient, {
      skip: 0,
      limit: 200,
    });
    setCreatedProducts(page.items);
  }, [apiClient, computeDateRange, tab]);

  const filteredDocs = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter((doc) => {
      const lot = (doc.lot_number || '').toLowerCase();
      const origin = (doc.origin_name || '').toLowerCase();
      const user = (doc.closed_by_user_name || '').toLowerCase();
      const supplier = (doc.supplier_name || '').toLowerCase();
      const notes = (doc.notes || '').toLowerCase();
      return (
        lot.includes(term) ||
        origin.includes(term) ||
        user.includes(term) ||
        supplier.includes(term) ||
        notes.includes(term)
      );
    });
  }, [docs, query]);

  const filteredCreatedProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return createdProducts;
    return createdProducts.filter((item) => {
      const name = (item.name || '').toLowerCase();
      const sku = (item.sku || '').toLowerCase();
      const barcode = (item.barcode || '').toLowerCase();
      const group = (item.group_name || '').toLowerCase();
      const user = (item.created_by_user_name || '').toLowerCase();
      return (
        name.includes(term) ||
        sku.includes(term) ||
        barcode.includes(term) ||
        group.includes(term) ||
        user.includes(term)
      );
    });
  }, [createdProducts, query]);

  useEffect(() => {
    let active = true;
    if (!selectedDoc) {
      setSelectedDocDetail(null);
      setSelectedDocDetailError(null);
      setLoadingSelectedDocDetail(false);
      return () => {
        active = false;
      };
    }

    setSelectedDocDetail(null);
    setSelectedDocDetailError(null);
    setLoadingSelectedDocDetail(true);

    getLotDetail(apiClient, selectedDoc.id)
      .then((detail) => {
        if (!active) return;
        setSelectedDocDetail(detail);
      })
      .catch((err) => {
        if (!active) return;
        setSelectedDocDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle de recepción');
      })
      .finally(() => {
        if (!active) return;
        setLoadingSelectedDocDetail(false);
      });

    return () => {
      active = false;
    };
  }, [apiClient, selectedDoc]);

  const selectedSupportFileUrl = useMemo(() => {
    const lotId = selectedDoc?.id;
    const hasSupport = Boolean(
      selectedDocDetail?.lot.support_file_name ||
      selectedDocDetail?.lot.support_file_url ||
      selectedDoc?.support_file_name ||
      selectedDoc?.support_file_url
    );
    if (lotId && hasSupport) {
      return `${apiBase.replace(/\/$/, '')}/receiving/lots/${lotId}/support-file`;
    }
    const supportUrl =
      selectedDocDetail?.lot.support_file_url ?? selectedDoc?.support_file_url;
    return resolveReceivingSupportUrl(supportUrl, apiBase);
  }, [
    selectedDoc?.id,
    selectedDoc?.support_file_name,
    selectedDoc?.support_file_url,
    selectedDocDetail?.lot.support_file_name,
    selectedDocDetail?.lot.support_file_url,
    apiBase,
  ]);
  const selectedDocNotes =
    selectedDocDetail?.lot.notes?.trim() || selectedDoc?.notes?.trim() || '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar historial');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <ScreenContainer backgroundColor="#E9EDF3">
      {selectedDoc ? (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Detalle recepción</Text>
            <Pressable style={styles.refreshButton} onPress={() => setSelectedDoc(null)}>
              <Text style={styles.refreshButtonText}>Volver</Text>
            </Pressable>
          </View>

          <View style={styles.detailHeaderCard}>
            <Text style={styles.modalTitle}>{selectedDoc.lot_number}</Text>
            <Text style={styles.modalMeta}>Estado: Cerrado</Text>
            <Text style={styles.modalMeta}>Tipo: {formatPurchaseType(selectedDoc.purchase_type)}</Text>
            <Text style={styles.modalMeta}>Origen: {selectedDoc.origin_name}</Text>
            <Text style={styles.modalMeta}>Líneas: {selectedDoc.lines_count}</Text>
            <Text style={styles.modalMeta}>Unidades: {selectedDoc.units_total}</Text>
            <Text style={styles.modalMeta}>Cerrado: {formatDateTime(selectedDoc.closed_at)}</Text>
            {selectedDoc.closed_by_user_name ? (
              <Text style={styles.modalMeta}>Responsable: {selectedDoc.closed_by_user_name}</Text>
            ) : null}
            {selectedDoc.supplier_name ? (
              <Text style={styles.modalMeta}>Proveedor: {selectedDoc.supplier_name}</Text>
            ) : null}
            {selectedDoc.invoice_reference ? (
              <Text style={styles.modalMeta}>Referencia factura: {selectedDoc.invoice_reference}</Text>
            ) : null}
            {selectedDocNotes ? (
              <Text style={styles.modalMeta}>Observación: {selectedDocNotes}</Text>
            ) : null}
          </View>

          <ScrollView style={styles.listScroll} contentContainerStyle={styles.detailScreenContent}>
            {selectedDoc.support_file_name ? (
              <View style={styles.supportBox}>
                <Text style={styles.supportTitle}>Soporte adjunto</Text>
                <Text style={styles.supportMeta}>{selectedDoc.support_file_name}</Text>
                {selectedSupportFileUrl ? (
                  <Pressable
                    style={styles.downloadButton}
                    onPress={() => {
                      Linking.openURL(selectedSupportFileUrl).catch(() => undefined);
                    }}
                  >
                    <Text style={styles.downloadButtonText}>Abrir soporte</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Productos recibidos</Text>
              {loadingSelectedDocDetail ? <ActivityIndicator color="#0A8F5A" /> : null}
              {selectedDocDetailError ? (
                <Text style={styles.detailErrorText}>{selectedDocDetailError}</Text>
              ) : null}
              {!loadingSelectedDocDetail && !selectedDocDetailError && selectedDocDetail?.items.length === 0 ? (
                <Text style={styles.detailEmptyText}>No hay ítems registrados en este lote.</Text>
              ) : null}
              {!loadingSelectedDocDetail && !selectedDocDetailError
                ? selectedDocDetail?.items.map((item) => (
                    <View key={item.id} style={styles.detailItemCard}>
                      <Text style={styles.detailItemName}>{item.product_name_snapshot}</Text>
                      <Text style={styles.detailItemMeta}>Cantidad: {item.qty_received}</Text>
                      <Text style={styles.detailItemMeta}>
                        SKU: {item.sku_snapshot || 'N/A'} · Código: {item.barcode_snapshot || 'N/A'}
                      </Text>
                      <Text style={styles.detailItemMeta}>
                        Venta: ${Number(item.unit_price_snapshot || 0).toLocaleString('es-CO')} · Costo: $
                        {Number(item.unit_cost_snapshot || 0).toLocaleString('es-CO')}
                      </Text>
                      {item.notes ? <Text style={styles.detailItemMeta}>Nota: {item.notes}</Text> : null}
                    </View>
                  ))
                : null}
            </View>
          </ScrollView>
        </>
      ) : (
        <>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Historial</Text>
        <Pressable style={styles.refreshButton} onPress={load}>
          <Text style={styles.refreshButtonText}>Refrescar</Text>
        </Pressable>
      </View>
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabBtn, tab === 'documents' ? styles.tabBtnActive : null]}
          onPress={() => setTab('documents')}
        >
          <Text style={[styles.tabBtnText, tab === 'documents' ? styles.tabBtnTextActive : null]}>
            Recepciones
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'products' ? styles.tabBtnActive : null]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabBtnText, tab === 'products' ? styles.tabBtnTextActive : null]}>
            Productos creados
          </Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color="#0A8F5A" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.filtersCard}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          placeholder={
            tab === 'documents'
              ? 'Buscar por lote, origen, responsable o proveedor'
              : 'Buscar por nombre, SKU, código, grupo o usuario'
          }
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {tab === 'documents' ? (
          <View style={styles.rangeRow}>
            <Pressable
              style={[styles.rangeBtn, range === 'today' ? styles.rangeBtnActive : null]}
              onPress={() => setRange('today')}
            >
              <Text style={[styles.rangeBtnText, range === 'today' ? styles.rangeBtnTextActive : null]}>
                Hoy
              </Text>
            </Pressable>
            <Pressable
              style={[styles.rangeBtn, range === '7d' ? styles.rangeBtnActive : null]}
              onPress={() => setRange('7d')}
            >
              <Text style={[styles.rangeBtnText, range === '7d' ? styles.rangeBtnTextActive : null]}>
                7 días
              </Text>
            </Pressable>
            <Pressable
              style={[styles.rangeBtn, range === '30d' ? styles.rangeBtnActive : null]}
              onPress={() => setRange('30d')}
            >
              <Text style={[styles.rangeBtnText, range === '30d' ? styles.rangeBtnTextActive : null]}>
                30 días
              </Text>
            </Pressable>
            <Pressable
              style={[styles.rangeBtn, range === 'all' ? styles.rangeBtnActive : null]}
              onPress={() => setRange('all')}
            >
              <Text style={[styles.rangeBtnText, range === 'all' ? styles.rangeBtnTextActive : null]}>
                Todo
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {!loading && tab === 'documents' && filteredDocs.length === 0 ? (
        <Text style={styles.empty}>Aún no hay documentos de recepción cerrados.</Text>
      ) : null}
      {!loading && tab === 'products' && filteredCreatedProducts.length === 0 ? (
        <Text style={styles.empty}>Aún no hay productos creados desde la app.</Text>
      ) : null}

      <ScrollView style={styles.listScroll} contentContainerStyle={styles.list}>
        {tab === 'documents'
          ? filteredDocs.map((doc) => (
              <Pressable key={doc.id} style={styles.card} onPress={() => setSelectedDoc(doc)}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle}>{doc.lot_number}</Text>
                  <Text style={styles.badgeClosed}>Cerrado</Text>
                </View>
                <Text style={styles.cardMeta}>Origen: {doc.origin_name}</Text>
                <Text style={styles.cardMeta}>Tipo: {formatPurchaseType(doc.purchase_type)}</Text>
                <Text style={styles.cardMeta}>Líneas: {doc.lines_count} · Unidades: {doc.units_total}</Text>
                <Text style={styles.cardMeta}>Cerrado: {formatDateTime(doc.closed_at)}</Text>
                {doc.closed_by_user_name ? (
                  <Text style={styles.cardMeta}>Responsable: {doc.closed_by_user_name}</Text>
                ) : null}
              </Pressable>
            ))
          : filteredCreatedProducts.map((item) => (
              <View key={item.audit_id} style={styles.card}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.badgeCreated}>Creado</Text>
                </View>
                <Text style={styles.cardMeta}>
                  SKU: {item.sku || 'N/A'} · Código: {item.barcode || 'N/A'}
                </Text>
                <Text style={styles.cardMeta}>Grupo: {item.group_name || 'Sin grupo'}</Text>
                <Text style={styles.cardMeta}>
                  Precio: ${Number(item.price || 0).toLocaleString('es-CO')} · Costo: $
                  {Number(item.cost || 0).toLocaleString('es-CO')}
                </Text>
                <Text style={styles.cardMeta}>Creado: {formatDateTime(item.created_at)}</Text>
                {item.created_by_user_name ? (
                  <Text style={styles.cardMeta}>Usuario: {item.created_by_user_name}</Text>
                ) : null}
              </View>
            ))}
      </ScrollView>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
  },
  refreshButton: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    borderColor: '#67C48D',
    backgroundColor: '#DCEFE3',
  },
  tabBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: '#0A8F5A',
  },
  list: {
    gap: 10,
    paddingBottom: 12,
  },
  listScroll: {
    flex: 1,
  },
  detailScreenContent: {
    gap: 8,
    paddingBottom: 12,
  },
  card: {
    backgroundColor: '#CFD8E3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    padding: 12,
    gap: 2,
  },
  cardHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badgeClosed: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  badgeCreated: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: '#334155',
    fontSize: 13,
  },
  error: {
    color: '#be123c',
    fontSize: 13,
  },
  empty: {
    color: '#475569',
  },
  filtersCard: {
    backgroundColor: '#D8E1EC',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#0F172A',
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rangeBtn: {
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  rangeBtnActive: {
    borderColor: '#67C48D',
    backgroundColor: '#DCEFE3',
  },
  rangeBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  rangeBtnTextActive: {
    color: '#0A8F5A',
  },
  detailHeaderCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    gap: 4,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
  },
  modalMeta: {
    color: '#334155',
    fontSize: 14,
  },
  supportBox: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  supportTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  supportMeta: {
    color: '#334155',
    fontSize: 13,
  },
  downloadButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#67C48D',
    backgroundColor: '#DCEFE3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  downloadButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
    fontSize: 13,
  },
  detailSection: {
    gap: 8,
  },
  detailSectionTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  detailErrorText: {
    color: '#be123c',
    fontSize: 13,
  },
  detailEmptyText: {
    color: '#475569',
    fontSize: 13,
  },
  detailItemCard: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  detailItemName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  detailItemMeta: {
    color: '#334155',
    fontSize: 12,
  },
});
