import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { getRestockForecast, type KoraRestockForecastResponse } from '../services/api/kora';
import { getRecountDetail, listRecounts } from '../services/api/recounts';
import { getLotDetail, listReceivingCreatedProducts, listReceivingDocuments } from '../services/api/receiving';
import type { RecountDetail, RecountRecord } from '../types/recounts';
import type { ReceivingCreatedProduct, ReceivingDocument, ReceivingLotDetail } from '../types/receiving';
import { ScreenContainer } from '../ui/ScreenContainer';
import { SearchInput } from '../ui/SearchInput';
import { formatBogotaDateTime } from '../utils/dateTime';

function formatPurchaseType(type: string) {
  if (type === 'cash') return 'Contado';
  if (type === 'invoice') return 'Factura';
  return type;
}

function formatRecountStatus(status: RecountRecord['status']) {
  if (status === 'applied') return 'Aplicado';
  if (status === 'closed') return 'Cerrado';
  if (status === 'cancelled') return 'Cancelado';
  if (status === 'counting') return 'En conteo';
  return 'Borrador';
}

function formatQty(value?: number | null): string {
  return Number(value || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
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

function isImageSupportFile(filename?: string | null): boolean {
  if (!filename) return false;
  const normalized = filename.trim().toLowerCase();
  return (
    normalized.endsWith('.jpg') ||
    normalized.endsWith('.jpeg') ||
    normalized.endsWith('.png') ||
    normalized.endsWith('.webp')
  );
}

function belongsToStockDevice(stockDeviceId: string, candidate?: string | null): boolean {
  const current = stockDeviceId.trim();
  const docDevice = (candidate || '').trim();
  if (!current || !docDevice) return false;
  return current === docDevice;
}

function resolveReceivingDocumentSortDate(doc: ReceivingDocument): string {
  return doc.closed_at || doc.created_at || '';
}

function resolveRecountDocumentSortDate(doc: RecountRecord): string {
  return doc.applied_at || doc.closed_at || doc.created_at || '';
}

function resolveRecountFinishedBy(doc: RecountRecord): string | null {
  return doc.applied_by_user_name || doc.closed_by_user_name || null;
}

function formatRestockUrgency(value: 'high' | 'medium' | 'low') {
  if (value === 'high') return 'Alta';
  if (value === 'medium') return 'Media';
  return 'Baja';
}

function formatCoverageDays(value?: number | null): string {
  if (value == null) return '—';
  if (value < 1) return '< 1 día';
  return `${Math.round(value)} días`;
}

export function HistoryScreen() {
  const { apiBase, apiClient, stockDeviceId } = useAppSession();
  const [tab, setTab] = useState<'documents' | 'products'>('documents');
  const [docs, setDocs] = useState<ReceivingDocument[]>([]);
  const [recountDocs, setRecountDocs] = useState<RecountRecord[]>([]);
  const [createdProducts, setCreatedProducts] = useState<ReceivingCreatedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<'today' | '7d' | '30d'>('30d');
  const [selectedDoc, setSelectedDoc] = useState<ReceivingDocument | null>(null);
  const [selectedDocDetail, setSelectedDocDetail] = useState<ReceivingLotDetail | null>(null);
  const [loadingSelectedDocDetail, setLoadingSelectedDocDetail] = useState(false);
  const [selectedDocDetailError, setSelectedDocDetailError] = useState<string | null>(null);
  const [selectedRecount, setSelectedRecount] = useState<RecountRecord | null>(null);
  const [selectedRecountDetail, setSelectedRecountDetail] = useState<RecountDetail | null>(null);
  const [loadingSelectedRecountDetail, setLoadingSelectedRecountDetail] = useState(false);
  const [selectedRecountDetailError, setSelectedRecountDetailError] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [restockModalVisible, setRestockModalVisible] = useState(false);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [restockReport, setRestockReport] = useState<KoraRestockForecastResponse | null>(null);

  const computeDateRange = useCallback(() => {
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
      const [receivingPage, recountClosedPage, recountAppliedPage] = await Promise.all([
        listReceivingDocuments(apiClient, {
          skip: 0,
          limit: 200,
          date_from,
          date_to,
        }),
        listRecounts(apiClient, {
          status: 'closed',
          source: 'app',
          skip: 0,
          limit: 100,
        }),
        listRecounts(apiClient, {
          status: 'applied',
          source: 'app',
          skip: 0,
          limit: 100,
        }),
      ]);
      const recountById = new Map<number, RecountRecord>();
      [...recountClosedPage.items, ...recountAppliedPage.items].forEach((item) => {
        recountById.set(item.id, item);
      });
      setDocs(
        receivingPage.items.filter((doc) => belongsToStockDevice(stockDeviceId, doc.stock_device_id)),
      );
      setRecountDocs(
        Array.from(recountById.values()).filter((doc) => belongsToStockDevice(stockDeviceId, doc.stock_device_id)),
      );
      return;
    }
    const page = await listReceivingCreatedProducts(apiClient, {
      skip: 0,
      limit: 200,
    });
    setCreatedProducts(page.items);
    setRecountDocs([]);
  }, [apiClient, computeDateRange, stockDeviceId, tab]);

  const filteredDocs = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter((doc) => {
      const lot = (doc.lot_number || '').toLowerCase();
      const origin = (doc.origin_name || '').toLowerCase();
      const openedBy = (doc.created_by_user_name || '').toLowerCase();
      const closedBy = (doc.closed_by_user_name || '').toLowerCase();
      const supplier = (doc.supplier_name || '').toLowerCase();
      const notes = (doc.notes || '').toLowerCase();
      return (
        lot.includes(term) ||
        origin.includes(term) ||
        openedBy.includes(term) ||
        closedBy.includes(term) ||
        supplier.includes(term) ||
        notes.includes(term)
      );
    });
  }, [docs, query]);

  const filteredRecountDocs = useMemo(() => {
    const term = query.trim().toLowerCase();
    const { date_from, date_to } = computeDateRange();
    const fromMs = date_from ? Date.parse(date_from) : null;
    const toMs = date_to ? Date.parse(date_to) : null;
    const recountItems = !term
      ? recountDocs
      : recountDocs.filter((doc) => {
          const code = (doc.code || '').toLowerCase();
          const title = (doc.title || '').toLowerCase();
          const scope = (doc.scope_value || '').toLowerCase();
          const openedBy = (doc.created_by_user_name || '').toLowerCase();
          const finishedBy = (resolveRecountFinishedBy(doc) || '').toLowerCase();
          return (
            code.includes(term) ||
            title.includes(term) ||
            scope.includes(term) ||
            openedBy.includes(term) ||
            finishedBy.includes(term)
          );
        });
    const ranged = recountItems.filter((doc) => {
      const finishedAt = doc.applied_at || doc.closed_at || doc.created_at;
      const ts = Date.parse(finishedAt);
      if (!Number.isFinite(ts)) return true;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
    return [...ranged].sort((a, b) => {
      const aDate = a.applied_at || a.closed_at || a.created_at || '';
      const bDate = b.applied_at || b.closed_at || b.created_at || '';
      return bDate.localeCompare(aDate);
    });
  }, [computeDateRange, query, recountDocs]);

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

  const orderedDocumentItems = useMemo(() => {
    const receivingItems = filteredDocs.map((doc) => ({
      kind: 'receiving' as const,
      id: `rcv-${doc.id}`,
      sortDate: resolveReceivingDocumentSortDate(doc),
      doc,
    }));
    const recountItems = filteredRecountDocs.map((doc) => ({
      kind: 'recount' as const,
      id: `rec-${doc.id}`,
      sortDate: resolveRecountDocumentSortDate(doc),
      doc,
    }));
    return [...receivingItems, ...recountItems].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }, [filteredDocs, filteredRecountDocs]);

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

  useEffect(() => {
    let active = true;
    if (!selectedRecount) {
      setSelectedRecountDetail(null);
      setSelectedRecountDetailError(null);
      setLoadingSelectedRecountDetail(false);
      return () => {
        active = false;
      };
    }

    setSelectedRecountDetail(null);
    setSelectedRecountDetailError(null);
    setLoadingSelectedRecountDetail(true);

    getRecountDetail(apiClient, selectedRecount.id, {
      counted_only: true,
      skip: 0,
      limit: 600,
    })
      .then((detail) => {
        if (!active) return;
        setSelectedRecountDetail(detail);
      })
      .catch((err) => {
        if (!active) return;
        setSelectedRecountDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle del recuento');
      })
      .finally(() => {
        if (!active) return;
        setLoadingSelectedRecountDetail(false);
      });

    return () => {
      active = false;
    };
  }, [apiClient, selectedRecount]);

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
  const selectedSupportFileName =
    selectedDocDetail?.lot.support_file_name || selectedDoc?.support_file_name || null;
  const canPreviewSupportInApp = isImageSupportFile(selectedSupportFileName);

  const openSupportFile = useCallback(() => {
    if (!selectedSupportFileUrl) return;
    if (canPreviewSupportInApp) {
      setPreviewVisible(true);
      return;
    }
    Linking.openURL(selectedSupportFileUrl).catch(() => {
      Alert.alert('No se pudo abrir', 'No se pudo abrir el archivo adjunto.');
    });
  }, [selectedSupportFileUrl, canPreviewSupportInApp]);

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

  const openRestockReport = useCallback(async () => {
    setRestockModalVisible(true);
    setRestockLoading(true);
    setRestockError(null);
    try {
      const report = await getRestockForecast(apiClient, {
        mode: 'today',
        horizon_days: 2,
        lookback_days: 30,
      });
      setRestockReport(report);
    } catch (err) {
      setRestockReport(null);
      setRestockError(err instanceof Error ? err.message : 'No se pudo cargar el reporte');
    } finally {
      setRestockLoading(false);
    }
  }, [apiClient]);

  return (
    <ScreenContainer backgroundColor="#E9EDF3" scrollEnabled={false}>
      {selectedDoc || selectedRecount ? (
        <>
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.historyScrollContent}
            stickyHeaderIndices={[0]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.historySticky}>
              <View style={styles.headerRow}>
                <Text style={styles.title}>{selectedDoc ? 'Detalle recepción' : 'Detalle recuento'}</Text>
                <Pressable
                  style={styles.refreshButton}
                  onPress={() => {
                    setSelectedDoc(null);
                    setSelectedRecount(null);
                  }}
                >
                  <Text style={styles.refreshButtonText}>Volver</Text>
                </Pressable>
              </View>

              {selectedDoc ? (
                <View style={styles.detailHeaderCard}>
                  <Text style={styles.modalTitle}>{selectedDoc.lot_number}</Text>
                  <Text style={styles.modalMeta}>Estado: Cerrado</Text>
                  <Text style={styles.modalMeta}>Tipo: {formatPurchaseType(selectedDoc.purchase_type)}</Text>
                  <Text style={styles.modalMeta}>Origen: {selectedDoc.origin_name}</Text>
                  <Text style={styles.modalMeta}>Líneas: {selectedDoc.lines_count}</Text>
                  <Text style={styles.modalMeta}>Unidades: {selectedDoc.units_total}</Text>
                  <Text style={styles.modalMeta}>Apertura: {formatBogotaDateTime(selectedDoc.created_at)}</Text>
                  {selectedDoc.created_by_user_name ? (
                    <Text style={styles.modalMeta}>Abrió: {selectedDoc.created_by_user_name}</Text>
                  ) : null}
                  <Text style={styles.modalMeta}>Cerrado: {formatBogotaDateTime(selectedDoc.closed_at)}</Text>
                  {selectedDoc.closed_by_user_name ? (
                    <Text style={styles.modalMeta}>Cerró: {selectedDoc.closed_by_user_name}</Text>
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
              ) : selectedRecount ? (
                <View style={styles.detailHeaderCard}>
                  <Text style={styles.modalTitle}>{selectedRecount.code}</Text>
                  <Text style={styles.modalMeta}>Estado: {formatRecountStatus(selectedRecount.status)}</Text>
                  <Text style={styles.modalMeta}>Modo: {selectedRecount.count_mode === 'blind' ? 'Ciego' : 'Visible'}</Text>
                  <Text style={styles.modalMeta}>
                    Alcance:{' '}
                    {selectedRecount.scope_type === 'all'
                      ? 'Todo'
                      : selectedRecount.scope_type === 'group'
                        ? `Por categoría (${selectedRecount.scope_value || '—'})`
                        : 'Libre'}
                  </Text>
                  <Text style={styles.modalMeta}>
                    Líneas: {selectedRecount.summary.counted_lines}/{selectedRecount.summary.total_lines}
                  </Text>
                  <Text style={styles.modalMeta}>Dif: {selectedRecount.summary.difference_lines}</Text>
                  <Text style={styles.modalMeta}>Apertura: {formatBogotaDateTime(selectedRecount.created_at)}</Text>
                  {selectedRecount.created_by_user_name ? (
                    <Text style={styles.modalMeta}>Abrió: {selectedRecount.created_by_user_name}</Text>
                  ) : null}
                  {selectedRecount.closed_at ? (
                    <Text style={styles.modalMeta}>Cierre: {formatBogotaDateTime(selectedRecount.closed_at)}</Text>
                  ) : null}
                  {selectedRecount.closed_by_user_name ? (
                    <Text style={styles.modalMeta}>Cerró: {selectedRecount.closed_by_user_name}</Text>
                  ) : null}
                  {selectedRecount.applied_at ? (
                    <Text style={styles.modalMeta}>Aplicado: {formatBogotaDateTime(selectedRecount.applied_at)}</Text>
                  ) : null}
                  {selectedRecount.applied_by_user_name ? (
                    <Text style={styles.modalMeta}>Aplicó: {selectedRecount.applied_by_user_name}</Text>
                  ) : null}
                  <Text style={styles.modalMeta}>
                    Finalizado: {formatBogotaDateTime(resolveRecountDocumentSortDate(selectedRecount))}
                  </Text>
                </View>
              ) : null}
            </View>

            {selectedDoc?.support_file_name ? (
              <View style={styles.supportBox}>
                <Text style={styles.supportTitle}>Soporte adjunto</Text>
                <Text style={styles.supportMeta}>{selectedDoc.support_file_name}</Text>
                {selectedSupportFileUrl ? (
                  <Pressable
                    style={styles.downloadButton}
                    onPress={openSupportFile}
                  >
                    <Text style={styles.downloadButtonText}>
                      {canPreviewSupportInApp ? 'Ver soporte aquí' : 'Abrir soporte'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {selectedDoc ? (
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
            ) : (
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Líneas contadas</Text>
                {loadingSelectedRecountDetail ? <ActivityIndicator color="#0A8F5A" /> : null}
                {selectedRecountDetailError ? (
                  <Text style={styles.detailErrorText}>{selectedRecountDetailError}</Text>
                ) : null}
                {!loadingSelectedRecountDetail &&
                !selectedRecountDetailError &&
                (selectedRecountDetail?.lines.length ?? 0) === 0 ? (
                  <Text style={styles.detailEmptyText}>No hay líneas capturadas en este recuento.</Text>
                ) : null}
                {!loadingSelectedRecountDetail && !selectedRecountDetailError
                  ? selectedRecountDetail?.lines.map((line) => (
                      <View key={line.id} style={styles.detailItemCard}>
                        <Text style={styles.detailItemName}>{line.product_name}</Text>
                        <Text style={styles.detailItemMeta}>
                          SKU: {line.sku || 'N/A'} · Código: {line.barcode || 'N/A'}
                        </Text>
                        <Text style={styles.detailItemMeta}>Contada: {formatQty(line.counted_qty)}</Text>
                        {selectedRecountDetail.recount.count_mode !== 'blind' ? (
                          <Text style={styles.detailItemMeta}>Sistema: {formatQty(line.system_qty)}</Text>
                        ) : null}
                        <Text style={styles.detailItemMeta}>
                          Diferencia: {formatQty((line.counted_qty ?? 0) - (line.system_qty ?? 0))}
                        </Text>
                      </View>
                    ))
                  : null}
              </View>
            )}
          </ScrollView>

          <Modal
            visible={previewVisible && !!selectedSupportFileUrl}
            transparent
            animationType="fade"
            onRequestClose={() => setPreviewVisible(false)}
          >
            <View style={styles.previewBackdrop}>
              <View style={styles.previewCard}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {selectedSupportFileName || 'Soporte adjunto'}
                </Text>
                {selectedSupportFileUrl ? (
                  <Image
                    source={{ uri: selectedSupportFileUrl }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                ) : null}
                <View style={styles.previewActions}>
                  <Pressable
                    style={styles.previewSecondaryButton}
                    onPress={() => setPreviewVisible(false)}
                  >
                    <Text style={styles.previewSecondaryText}>Cerrar</Text>
                  </Pressable>
                  {selectedSupportFileUrl ? (
                    <Pressable
                      style={styles.previewPrimaryButton}
                      onPress={() => {
                        Linking.openURL(selectedSupportFileUrl).catch(() => undefined);
                      }}
                    >
                      <Text style={styles.previewPrimaryText}>Abrir externo</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <>
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.historyScrollContent}
            stickyHeaderIndices={[0]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.historySticky}>
              <View style={styles.historyMainHeader}>
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
                      Documentos
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
                <View style={styles.koraQuickCard}>
                  <View style={styles.koraQuickTextWrap}>
                    <Text style={styles.koraQuickEyebrow}>KORA rápida</Text>
                    <Text style={styles.koraQuickTitle}>Productos para mañana</Text>
                    <Text style={styles.koraQuickSubtitle}>
                      Revisa los productos vendidos hoy que ya conviene reponer mañana.
                    </Text>
                  </View>
                  <Pressable style={styles.koraQuickButton} onPress={() => void openRestockReport()}>
                    <Text style={styles.koraQuickButtonText}>Ver reporte</Text>
                  </Pressable>
                </View>
              </View>

              {loading ? <ActivityIndicator color="#0A8F5A" /> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.filtersCard}>
                <SearchInput
                  value={query}
                  onChangeText={setQuery}
                  onClear={() => setQuery('')}
                  containerStyle={styles.searchInput}
                  placeholder={
                    tab === 'documents'
                      ? 'Buscar por lote/recuento, origen, responsable o proveedor'
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
                  </View>
                ) : null}
              </View>
            </View>

            {!loading && tab === 'documents' && filteredDocs.length + filteredRecountDocs.length === 0 ? (
              <Text style={styles.empty}>Aún no hay documentos finalizados.</Text>
            ) : null}
            {!loading && tab === 'products' && filteredCreatedProducts.length === 0 ? (
              <Text style={styles.empty}>Aún no hay productos creados desde la app.</Text>
            ) : null}

        {tab === 'documents'
          ? orderedDocumentItems.map((item) => {
              if (item.kind === 'receiving') {
                const doc = item.doc;
                return (
                  <Pressable key={item.id} style={styles.card} onPress={() => setSelectedDoc(doc)}>
                    <View style={styles.cardHeadRow}>
                      <Text style={styles.cardTitle}>{doc.lot_number}</Text>
                      <Text style={styles.badgeClosed}>Recepción cerrada</Text>
                    </View>
                    <Text style={styles.cardMeta}>Origen: {doc.origin_name}</Text>
                    <Text style={styles.cardMeta}>Tipo: {formatPurchaseType(doc.purchase_type)}</Text>
                    <Text style={styles.cardMeta}>Líneas: {doc.lines_count} · Unidades: {doc.units_total}</Text>
                    <Text style={styles.cardMeta}>Apertura: {formatBogotaDateTime(doc.created_at)}</Text>
                    {doc.created_by_user_name ? (
                      <Text style={styles.cardMeta}>Abrió: {doc.created_by_user_name}</Text>
                    ) : null}
                    <Text style={styles.cardMeta}>Cerrado: {formatBogotaDateTime(doc.closed_at)}</Text>
                    {doc.closed_by_user_name ? (
                      <Text style={styles.cardMeta}>Cerró: {doc.closed_by_user_name}</Text>
                    ) : null}
                  </Pressable>
                );
              }
              const doc = item.doc;
              return (
                <Pressable key={item.id} style={styles.card} onPress={() => setSelectedRecount(doc)}>
                  <View style={styles.cardHeadRow}>
                    <Text style={styles.cardTitle}>{doc.code}</Text>
                    <Text style={styles.badgeCreated}>Recuento {formatRecountStatus(doc.status)}</Text>
                  </View>
                  <Text style={styles.cardMeta}>Modo: {doc.count_mode === 'blind' ? 'Ciego' : 'Visible'}</Text>
                  <Text style={styles.cardMeta}>
                    Líneas: {doc.summary.counted_lines}/{doc.summary.total_lines} · Dif: {doc.summary.difference_lines}
                  </Text>
                  <Text style={styles.cardMeta}>Apertura: {formatBogotaDateTime(doc.created_at)}</Text>
                  {doc.created_by_user_name ? (
                    <Text style={styles.cardMeta}>Abrió: {doc.created_by_user_name}</Text>
                  ) : null}
                  {doc.closed_at ? <Text style={styles.cardMeta}>Cierre: {formatBogotaDateTime(doc.closed_at)}</Text> : null}
                  {doc.closed_by_user_name ? (
                    <Text style={styles.cardMeta}>Cerró: {doc.closed_by_user_name}</Text>
                  ) : null}
                  {doc.applied_at ? <Text style={styles.cardMeta}>Aplicado: {formatBogotaDateTime(doc.applied_at)}</Text> : null}
                  {doc.applied_by_user_name ? (
                    <Text style={styles.cardMeta}>Aplicó: {doc.applied_by_user_name}</Text>
                  ) : null}
                  <Text style={styles.cardMeta}>
                    Finalizado: {formatBogotaDateTime(resolveRecountDocumentSortDate(doc))}
                  </Text>
                </Pressable>
              );
            })
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
                <Text style={styles.cardMeta}>Creado: {formatBogotaDateTime(item.created_at)}</Text>
                {item.created_by_user_name ? (
                  <Text style={styles.cardMeta}>Usuario: {item.created_by_user_name}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <Modal
            visible={restockModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setRestockModalVisible(false)}
          >
            <View style={styles.previewBackdrop}>
              <View style={styles.restockModalCard}>
                <View style={styles.restockModalHeader}>
                  <View style={styles.restockModalHeaderText}>
                    <Text style={styles.restockModalEyebrow}>KORA rápida</Text>
                    <Text style={styles.restockModalTitle}>
                      Productos vendidos hoy que conviene reponer mañana
                    </Text>
                  </View>
                  <View style={styles.restockModalActions}>
                    <Pressable
                      style={styles.restockSecondaryButton}
                      onPress={() => void openRestockReport()}
                      disabled={restockLoading}
                    >
                      <Text style={styles.restockSecondaryText}>
                        {restockLoading ? 'Cargando...' : 'Refrescar'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.restockPrimaryButton}
                      onPress={() => setRestockModalVisible(false)}
                    >
                      <Text style={styles.restockPrimaryText}>Cerrar</Text>
                    </Pressable>
                  </View>
                </View>

                {restockLoading ? (
                  <View style={styles.restockLoadingWrap}>
                    <ActivityIndicator color="#0A8F5A" size="large" />
                    <Text style={styles.restockLoadingText}>Cargando reporte...</Text>
                  </View>
                ) : restockError ? (
                  <View style={styles.restockErrorBox}>
                    <Text style={styles.restockErrorTitle}>No se pudo abrir el reporte.</Text>
                    <Text style={styles.restockErrorText}>{restockError}</Text>
                  </View>
                ) : restockReport ? (
                  <ScrollView style={styles.restockScroll} contentContainerStyle={styles.restockScrollContent}>
                    <View style={styles.restockHeroCard}>
                      <Text style={styles.restockHeroTitle}>Reporte operativo de reposición</Text>
                      <Text style={styles.restockHeroSummary}>
                        {restockReport.headline || 'Productos vendidos hoy que conviene reponer mañana.'}
                      </Text>
                      <Text style={styles.restockHeroMeta}>
                        Generado: {formatBogotaDateTime(restockReport.generated_at)}
                      </Text>
                      <Text style={styles.restockHeroMeta}>
                        Lista: {restockReport.items.length} producto{restockReport.items.length === 1 ? '' : 's'}
                      </Text>
                    </View>

                    {restockReport.summary_lines?.length ? (
                      <View style={styles.restockSummaryBox}>
                        {restockReport.summary_lines.slice(0, 3).map((line, index) => (
                          <Text key={`restock-line-${index}`} style={styles.restockSummaryLine}>
                            {line}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {restockReport.items.length === 0 ? (
                      <Text style={styles.empty}>Hoy no hay productos que ameriten reposición para mañana.</Text>
                    ) : (
                      restockReport.items.map((item) => (
                        <View key={item.product_id} style={styles.restockItemCard}>
                          <View style={styles.cardHeadRow}>
                            <Text style={styles.cardTitle} numberOfLines={2}>
                              {item.product_name}
                            </Text>
                            <Text
                              style={[
                                styles.restockUrgencyBadge,
                                item.urgency === 'high'
                                  ? styles.restockUrgencyHigh
                                  : item.urgency === 'medium'
                                    ? styles.restockUrgencyMedium
                                    : styles.restockUrgencyLow,
                              ]}
                            >
                              {formatRestockUrgency(item.urgency)}
                            </Text>
                          </View>
                          <Text style={styles.cardMeta}>SKU: {item.sku?.trim() || 'N/A'}</Text>
                          <Text style={styles.cardMeta}>
                            Stock: {formatQty(item.qty_on_hand)} · Hoy: {formatQty(item.units_today)} · Sugerido:{' '}
                            {formatQty(item.suggested_qty)}
                          </Text>
                          <Text style={styles.cardMeta}>
                            Cobertura: {formatCoverageDays(item.coverage_days)} · Precio: $
                            {Number(item.price || 0).toLocaleString('es-CO')}
                          </Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                ) : (
                  <Text style={styles.empty}>No hay reporte para mostrar.</Text>
                )}
              </View>
            </View>
          </Modal>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  historyScrollContent: {
    gap: 10,
    paddingBottom: 12,
  },
  historySticky: {
    backgroundColor: '#E9EDF3',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DFEA',
  },
  historyMainHeader: {
    gap: 12,
    paddingBottom: 2,
  },
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
  koraQuickCard: {
    backgroundColor: '#F7FBF8',
    borderWidth: 1,
    borderColor: '#BDE3CA',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  koraQuickTextWrap: {
    gap: 3,
  },
  koraQuickEyebrow: {
    color: '#0A8F5A',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  koraQuickTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
  },
  koraQuickSubtitle: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  koraQuickButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#149B66',
    backgroundColor: '#0A8F5A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  koraQuickButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  list: {
    gap: 10,
    paddingBottom: 12,
  },
  listScroll: {
    width: '100%',
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
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.82)',
    justifyContent: 'center',
    padding: 16,
  },
  previewCard: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  previewTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  previewImage: {
    width: '100%',
    height: 420,
    backgroundColor: '#020617',
    borderRadius: 8,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  previewSecondaryButton: {
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewSecondaryText: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 12,
  },
  previewPrimaryButton: {
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 8,
    backgroundColor: '#0A8F5A',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewPrimaryText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  restockModalCard: {
    flex: 1,
    marginVertical: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  restockModalHeader: {
    gap: 10,
  },
  restockModalHeaderText: {
    gap: 4,
  },
  restockModalEyebrow: {
    color: '#0A8F5A',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  restockModalTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  restockModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  restockSecondaryButton: {
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  restockSecondaryText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
  restockPrimaryButton: {
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  restockPrimaryText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  restockLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  restockLoadingText: {
    color: '#475569',
    fontSize: 13,
  },
  restockErrorBox: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  restockErrorTitle: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '800',
  },
  restockErrorText: {
    color: '#7F1D1D',
    fontSize: 13,
    lineHeight: 18,
  },
  restockScroll: {
    flex: 1,
  },
  restockScrollContent: {
    gap: 10,
    paddingBottom: 12,
  },
  restockHeroCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  restockHeroTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  restockHeroSummary: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  restockHeroMeta: {
    color: '#475569',
    fontSize: 12,
  },
  restockSummaryBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DFEA',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  restockSummaryLine: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  restockItemCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    gap: 3,
  },
  restockUrgencyBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  restockUrgencyHigh: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  restockUrgencyMedium: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  restockUrgencyLow: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
});
