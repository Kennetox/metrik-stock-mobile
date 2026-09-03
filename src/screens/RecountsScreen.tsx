import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { Camera, type Code, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';

import { useAppSession } from '../contexts/AppSessionContext';
import {
  applyRecount,
  cancelRecount,
  clearRecountLine,
  closeRecount,
  createRecount,
  getRecountDetail,
  listRecounts,
  upsertRecountLine,
} from '../services/api/recounts';
import { convertKoraStockPlan, getCurrentKoraStockPlan, retrieveKoraStockPlan } from '../services/api/koraStockPlans';
import {
  filterActiveReceivingProducts,
  listReceivingProductGroups,
  resolveReceivingProductByBarcode,
  searchReceivingProducts,
} from '../services/api/receiving';
import type { RecountDetail, RecountLine, RecountRecord, RecountStatus } from '../types/recounts';
import type { KoraStockPlan } from '../types/koraStockPlans';
import { ScreenContainer } from '../ui/ScreenContainer';
import { formatBogotaDateTime } from '../utils/dateTime';

type ProductGroupOption = {
  id: number;
  path: string;
  display_name: string;
  parent_path?: string | null;
};

type ManualResultRow = {
  id: number;
  product_id: number;
  product_name: string;
  sku?: string | null;
  barcode?: string | null;
  group_name?: string | null;
  price?: number | null;
  last_movement_at?: string | null;
  counted_qty?: number | null;
};

const QTY_FORMATTER = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 2,
});
const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 0,
});

function formatQty(value: number) {
  return QTY_FORMATTER.format(Number(value || 0));
}

function formatCop(value: number) {
  return `$ ${COP_FORMATTER.format(Math.abs(value || 0))}`;
}

function statusLabel(status: RecountStatus) {
  if (status === 'draft') return 'Borrador';
  if (status === 'counting') return 'En conteo';
  if (status === 'closed') return 'Cerrado';
  if (status === 'applied') return 'Aplicado';
  return 'Cancelado';
}

function normalizeBarcode(value?: string | null): string {
  const compact = (value ?? '')
    .normalize('NFKC')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
  // AIM symbology identifier prefix, e.g. ]C1 / ]E0
  if (/^\][a-z0-9]{2}/.test(compact)) {
    return compact.slice(3);
  }
  return compact;
}

function belongsToStockDevice(stockDeviceId: string, candidate?: string | null): boolean {
  const current = stockDeviceId.trim();
  const recountDevice = (candidate || '').trim();
  if (!current || !recountDevice) return false;
  return current === recountDevice;
}

function findLineByCode(lines: RecountLine[], rawCode: string): RecountLine | null {
  const scannedRaw = normalizeBarcode(rawCode);
  if (!scannedRaw) return null;
  const scannedWithoutLeadingZeros = scannedRaw.replace(/^0+/, '');
  for (const line of lines) {
    const barcode = normalizeBarcode(line.barcode);
    const barcodeNoZeros = barcode.replace(/^0+/, '');
    if (barcode === scannedRaw || barcodeNoZeros === scannedWithoutLeadingZeros) {
      return line;
    }
  }
  return null;
}

export function RecountsScreen({
  isActive = true,
  onWorkspaceChange,
  backSignal = 0,
}: {
  isActive?: boolean;
  onWorkspaceChange?: (open: boolean) => void;
  backSignal?: number;
}) {
  const { apiClient, stockDeviceId, syncStatus } = useAppSession();
  const [docs, setDocs] = useState<RecountRecord[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RecountDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [lineDraft, setLineDraft] = useState<Record<number, string>>({});
  const [lineSavingId, setLineSavingId] = useState<number | null>(null);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [editingQty, setEditingQty] = useState('0');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newScopeType, setNewScopeType] = useState<'all' | 'group' | 'free'>('free');
  const [newScopeValue, setNewScopeValue] = useState('');
  const [groupLabel, setGroupLabel] = useState('');
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupOptions, setGroupOptions] = useState<ProductGroupOption[]>([]);
  const [loadingGroupOptions, setLoadingGroupOptions] = useState(false);
  const [newMode, setNewMode] = useState<'blind' | 'visible'>('visible');
  const [actionLoading, setActionLoading] = useState<'close' | 'apply' | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [bluetoothScanInput, setBluetoothScanInput] = useState('');
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualResults, setManualResults] = useState<ManualResultRow[]>([]);
  const [manualSelectedLine, setManualSelectedLine] = useState<ManualResultRow | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);

  const resolveCountedQty = useCallback(
    (productId: number, fallback?: number | null): number => {
      const draft = lineDraft[productId];
      if (draft != null && draft !== '') {
        const parsedDraft = Number(draft);
        if (Number.isFinite(parsedDraft)) {
          return parsedDraft;
        }
      }
      const parsedFallback = Number(fallback ?? 0);
      return Number.isFinite(parsedFallback) ? parsedFallback : 0;
    },
    [lineDraft],
  );
  const [autoFollowList, setAutoFollowList] = useState(true);
  const [selectedDocForActions, setSelectedDocForActions] = useState<RecountRecord | null>(null);
  const [showDocActionsModal, setShowDocActionsModal] = useState(false);
  const [listActionLoading, setListActionLoading] = useState<'close' | 'apply' | 'cancel' | null>(null);
  const [showCreateRecountModal, setShowCreateRecountModal] = useState(false);
  const [createRecountError, setCreateRecountError] = useState<string | null>(null);
  const [koraPlan, setKoraPlan] = useState<KoraStockPlan | null>(null);
  const [loadingKoraPlan, setLoadingKoraPlan] = useState(true);
  const [koraPlanError, setKoraPlanError] = useState<string | null>(null);
  const [koraPlanAction, setKoraPlanAction] = useState<'retrieve' | 'convert' | null>(null);
  const canMutate = syncStatus === 'online' || syncStatus === 'degraded';

  const scannerCooldownRef = useRef(0);
  const bluetoothInputRef = useRef<TextInput | null>(null);
  const manualQueryInputRef = useRef<TextInput | null>(null);
  const listScrollRef = useRef<FlatList<RecountLine> | null>(null);
  const prevCountedLinesRef = useRef(0);
  const autoFollowRef = useRef(true);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docsRefreshInFlightRef = useRef(false);
  const detailRefreshInFlightRef = useRef(false);
  const lastDocsRefreshAtRef = useRef(0);
  const lastDetailRefreshAtRef = useRef(0);
  const cameraDevice = useCameraDevice('back');
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();

  function ensureCanMutate(): boolean {
    if (canMutate) return true;
    setError('Sin conexión con API. Revalida la conexión para continuar.');
    return false;
  }

  const loadDocs = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (docsRefreshInFlightRef.current) {
        return;
      }
      if (silent && Date.now() - lastDocsRefreshAtRef.current < 20000) {
        return;
      }
      docsRefreshInFlightRef.current = true;
      if (!silent) {
        setError(null);
        setLoadingDocs(true);
      }
      try {
        const page = await listRecounts(apiClient, {
          source: 'app',
          skip: 0,
          limit: 50,
        });
        const filtered = page.items.filter((doc) => belongsToStockDevice(stockDeviceId, doc.stock_device_id));
        setDocs(filtered);
        setSelectedId((prev) => {
          if (filtered.length === 0) return null;
          if (prev != null && filtered.some((doc) => doc.id === prev)) return prev;
          return filtered[0].id;
        });
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'No se pudieron cargar recuentos');
          setDocs([]);
        }
      } finally {
        if (!silent) {
          setLoadingDocs(false);
        }
        lastDocsRefreshAtRef.current = Date.now();
        docsRefreshInFlightRef.current = false;
      }
    },
    [apiClient, stockDeviceId],
  );

  const loadKoraPlan = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoadingKoraPlan(true);
        setKoraPlanError(null);
      }
      try {
        const response = await getCurrentKoraStockPlan(apiClient);
        setKoraPlan(response.plan ?? null);
      } catch (err) {
        if (!silent) {
          setKoraPlanError(err instanceof Error ? err.message : 'No se pudo consultar el plan de Kora.');
        }
      } finally {
        if (!silent) {
          setLoadingKoraPlan(false);
        }
      }
    },
    [apiClient],
  );

  const loadDetail = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!selectedId) {
        setDetail(null);
        return;
      }
      if (detailRefreshInFlightRef.current) {
        return;
      }
      if (silent && Date.now() - lastDetailRefreshAtRef.current < 20000) {
        return;
      }
      detailRefreshInFlightRef.current = true;
      if (!silent) {
        setLoadingDetail(true);
        setError(null);
      }
      try {
        const selectedDoc = docs.find((doc) => doc.id === selectedId);
        const data = await getRecountDetail(apiClient, selectedId, {
          counted_only: selectedDoc?.scope_type !== 'free',
          skip: 0,
          limit: 600,
        });
        setDetail(data);
        setLineDraft((prev) => {
          const next = { ...prev };
          for (const line of data.lines) {
            if (!(line.product_id in next)) {
              next[line.product_id] = line.counted_qty != null ? String(line.counted_qty) : '';
            }
          }
          return next;
        });
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar detalle de recuento');
          setDetail(null);
        }
      } finally {
        if (!silent) {
          setLoadingDetail(false);
        }
        lastDetailRefreshAtRef.current = Date.now();
        detailRefreshInFlightRef.current = false;
      }
    },
    [apiClient, docs, selectedId],
  );

  useEffect(() => {
    if (!isActive) return;
    loadDocs().catch(() => undefined);
  }, [isActive, loadDocs]);

  useEffect(() => {
    if (!isActive) return;
    loadKoraPlan().catch(() => undefined);
  }, [isActive, loadKoraPlan]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      loadDocs({ silent: true }).catch(() => undefined);
      loadKoraPlan({ silent: true }).catch(() => undefined);
      if (workspaceOpen) {
        loadDetail({ silent: true }).catch(() => undefined);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [isActive, loadDocs, loadDetail, loadKoraPlan, workspaceOpen]);

  useEffect(() => {
    if (docs.length === 0) {
      setSelectedId(null);
      if (workspaceOpen) {
        setWorkspaceOpen(false);
      }
      return;
    }
    setSelectedId((prev) => {
      if (prev != null && docs.some((doc) => doc.id === prev)) return prev;
      return docs[0].id;
    });
  }, [docs, workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen) return;
    loadDetail().catch(() => undefined);
  }, [loadDetail, workspaceOpen]);

  useEffect(() => {
    if (!isActive || !workspaceOpen || scannerOpen || manualAddOpen) return;
    const timer = setTimeout(() => {
      bluetoothInputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [isActive, workspaceOpen, scannerOpen, manualAddOpen, selectedId]);

  useEffect(() => {
    if (!isActive || !workspaceOpen || !manualAddOpen) return;
    const timer = setTimeout(() => {
      manualQueryInputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [isActive, workspaceOpen, manualAddOpen]);

  useEffect(() => {
    if (workspaceOpen) {
      setAutoFollowList(true);
      autoFollowRef.current = true;
      prevCountedLinesRef.current = 0;
    }
  }, [workspaceOpen]);

  useEffect(() => {
    return () => {
      if (autoScrollTimerRef.current) {
        clearTimeout(autoScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onWorkspaceChange?.(workspaceOpen);
  }, [onWorkspaceChange, workspaceOpen]);

  useEffect(() => {
    setWorkspaceOpen((prev) => (prev ? false : prev));
  }, [backSignal]);

  useEffect(() => {
    if (!workspaceOpen || !manualAddOpen || !selectedId) {
      setManualResults([]);
      return;
    }
    const term = manualQuery.trim();
    if (term.length < 2) {
      setManualResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setManualLoading(true);
      const scopeType = detail?.recount.scope_type;
      const isKoraGuided = detail?.recount.title?.startsWith('Kora ·') ?? false;
      const requestPromise =
        scopeType === 'free' && !isKoraGuided
          ? searchReceivingProducts(apiClient, term, 25).then((products) => {
              const activeProducts = filterActiveReceivingProducts(products);
              const countedByProductId = new Map<number, number>();
              (detail?.lines ?? []).forEach((line) => {
                if (line.counted_qty != null) {
                  countedByProductId.set(line.product_id, Number(line.counted_qty));
                }
              });
              return activeProducts.map<ManualResultRow>((product) => ({
                id: product.id,
                product_id: product.id,
                product_name: product.name,
                sku: product.sku,
                barcode: product.barcode,
                counted_qty: countedByProductId.get(product.id) ?? null,
                group_name: null,
                price: product.price,
                last_movement_at: product.last_movement_at,
              }));
            })
          : getRecountDetail(apiClient, selectedId, {
              q: term,
              skip: 0,
              limit: 25,
            }).then((data) =>
              data.lines.map<ManualResultRow>((line) => ({
                id: line.id,
                product_id: line.product_id,
                product_name: line.product_name,
                sku: line.sku,
                barcode: line.barcode,
                group_name: line.group_name,
                price: line.price,
                last_movement_at: line.last_movement_at,
                counted_qty: line.counted_qty,
              })),
            );

      requestPromise
        .then((rows) => {
          if (active) setManualResults(rows);
        })
        .catch(() => {
          if (active) setManualResults([]);
        })
        .finally(() => {
          if (active) setManualLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    apiClient,
    detail?.lines,
    detail?.recount.scope_type,
    detail?.recount.title,
    manualAddOpen,
    manualQuery,
    selectedId,
    workspaceOpen,
  ]);

  const handleOpenScanner = useCallback(async () => {
    if (!cameraDevice) {
      setError('No encontramos cámara disponible en este equipo.');
      return;
    }
    if (!hasCameraPermission) {
      const granted = await requestCameraPermission();
      if (!granted) {
        setError('Debes permitir el acceso a cámara para escanear códigos.');
        return;
      }
    }
    scannerCooldownRef.current = 0;
    setScannerOpen(true);
  }, [cameraDevice, hasCameraPermission, requestCameraPermission]);

  const incrementLineByOne = useCallback(
    async (line: RecountLine) => {
      if (!canMutate) return;
      if (!selectedId) return;
      const currentCount = resolveCountedQty(line.product_id, line.counted_qty);
      const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
      await upsertRecountLine(apiClient, selectedId, {
        product_id: line.product_id,
        counted_qty: nextCount,
      });
      setLineDraft((prev) => ({ ...prev, [line.product_id]: String(nextCount) }));
    },
    [apiClient, canMutate, resolveCountedQty, selectedId],
  );

  const handleScannedCode = useCallback(
    async (rawCode: string) => {
      if (!canMutate) {
        setError('Sin conexión con API. Revalida la conexión para continuar.');
        return;
      }
      if (!selectedId) return;
      const scanned = normalizeBarcode(rawCode);
      if (!scanned) return;
      setError(null);
      try {
        let match = findLineByCode(detail?.lines ?? [], scanned);
        if (!match) {
          const searchResult = await getRecountDetail(apiClient, selectedId, {
            q: scanned,
            skip: 0,
            limit: 20,
          });
          match = findLineByCode(searchResult.lines, scanned);
        }
        if (match) {
          await incrementLineByOne(match);
        } else {
          if (detail?.recount.title?.startsWith('Kora ·')) {
            ToastAndroid.show('Ese producto no pertenece a este plan de Kora.', ToastAndroid.SHORT);
            setError('El producto escaneado no pertenece a la lista priorizada por Kora.');
            return;
          }
          const picked = await resolveReceivingProductByBarcode(apiClient, scanned);

          if (!picked) {
            const message = `No se encontró producto para el código de barras ${rawCode}.`;
            ToastAndroid.show('No se encontró producto para ese código de barras.', ToastAndroid.SHORT);
            setError(message);
            return;
          }

          const currentCount = resolveCountedQty(picked.id);
          const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
          await upsertRecountLine(apiClient, selectedId, {
            product_id: picked.id,
            counted_qty: nextCount,
          });
          setLineDraft((prev) => ({ ...prev, [picked.id]: String(nextCount) }));
        }
        await loadDetail();
        loadDocs({ silent: true }).catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo procesar el escaneo');
      }
    },
    [
      apiClient,
      canMutate,
      detail?.lines,
      detail?.recount.title,
      incrementLineByOne,
      loadDetail,
      loadDocs,
      resolveCountedQty,
      selectedId,
    ],
  );

  const handleCodeScanned = useCallback(
    (codes: Code[]) => {
      if (!scannerOpen || !codes.length) return;
      const firstReadable = codes.find((item) => typeof item.value === 'string' && item.value.trim().length > 0);
      if (!firstReadable?.value) return;
      const now = Date.now();
      if (now - scannerCooldownRef.current < 900) return;
      scannerCooldownRef.current = now;
      setScannerOpen(false);
      handleScannedCode(firstReadable.value).catch(() => undefined);
    },
    [handleScannedCode, scannerOpen],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'code-128', 'code-39', 'upc-a', 'upc-e', 'qr'],
    onCodeScanned: handleCodeScanned,
  });

  const countedLines = useMemo(() => detail?.lines ?? [], [detail?.lines]);
  const filteredCountedLines = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return countedLines;
    return countedLines.filter((line) => {
      const haystack = `${line.product_name} ${line.sku || ''} ${line.barcode || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [countedLines, search]);
  const filteredGroupOptions = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    const sorted = [...groupOptions].sort((a, b) => a.path.localeCompare(b.path, 'es', { sensitivity: 'base' }));
    if (!term) return sorted;
    return sorted.filter(
      (group) => group.display_name.toLowerCase().includes(term) || group.path.toLowerCase().includes(term),
    );
  }, [groupOptions, groupSearch]);
  const activeDocs = useMemo(
    () => docs.filter((doc) => doc.status !== 'cancelled' && doc.status !== 'applied'),
    [docs],
  );
  const primaryDoc = activeDocs[0] ?? null;
  const convertedPlanDoc = koraPlan?.converted_recount_id
    ? activeDocs.find((doc) => doc.id === koraPlan.converted_recount_id) ?? null
    : null;

  useEffect(() => {
    if (!workspaceOpen || manualAddOpen || !autoFollowList) return;
    const counted = detail?.recount.summary.counted_lines ?? 0;
    const prev = prevCountedLinesRef.current;
    prevCountedLinesRef.current = counted;
    if (counted <= prev || counted <= 0) return;
    if (autoScrollTimerRef.current) {
      clearTimeout(autoScrollTimerRef.current);
    }
    autoScrollTimerRef.current = setTimeout(() => {
      listScrollRef.current?.scrollToEnd({ animated: true });
    }, 120);
    return () => {
      if (autoScrollTimerRef.current) {
        clearTimeout(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
    };
  }, [workspaceOpen, manualAddOpen, autoFollowList, detail?.recount.summary.counted_lines]);

  async function handleCreateRecount() {
    if (!ensureCanMutate()) return;
    if (newScopeType === 'group' && !newScopeValue.trim()) {
      setCreateRecountError('Debes seleccionar una categoría existente.');
      setShowGroupPicker(true);
      return;
    }
    setCreating(true);
    setError(null);
    setCreateRecountError(null);
    try {
      const created = await createRecount(apiClient, {
        source: 'app',
        stock_device_id: stockDeviceId || undefined,
        title: newTitle.trim() || undefined,
        scope_type: newScopeType,
        scope_value: newScopeType === 'group' ? newScopeValue.trim() : undefined,
        count_mode: newMode,
      });
      setNewTitle('');
      setNewScopeType('free');
      setNewScopeValue('');
      setGroupLabel('');
      setGroupSearch('');
      setNewMode('visible');
      setShowCreateRecountModal(false);
      await loadDocs();
      setSelectedId(created.id);
      setWorkspaceOpen(true);
    } catch (err) {
      setCreateRecountError(err instanceof Error ? err.message : 'No se pudo crear el recuento');
    } finally {
      setCreating(false);
    }
  }

  async function handleRetrieveKoraPlan() {
    if (!ensureCanMutate()) return;
    setKoraPlanAction('retrieve');
    setKoraPlanError(null);
    try {
      const response = await retrieveKoraStockPlan(apiClient, 15);
      setKoraPlan(response.plan ?? null);
      if (!response.plan) {
        setKoraPlanError(response.message || 'Kora no encontró productos disponibles para este plan.');
      }
    } catch (err) {
      setKoraPlanError(err instanceof Error ? err.message : 'No se pudo obtener el plan de Kora.');
    } finally {
      setKoraPlanAction(null);
    }
  }

  async function handleConvertKoraPlan() {
    if (!ensureCanMutate()) return;
    if (!koraPlan) return;
    if (!stockDeviceId.trim()) {
      setKoraPlanError('Esta tablet no tiene un dispositivo de inventario configurado.');
      return;
    }
    setKoraPlanAction('convert');
    setKoraPlanError(null);
    try {
      const conversion = await convertKoraStockPlan(apiClient, koraPlan.id, stockDeviceId.trim());
      setKoraPlan(conversion.plan);
      await loadDocs();
      setSelectedId(conversion.recount.id);
      setWorkspaceOpen(true);
    } catch (err) {
      setKoraPlanError(err instanceof Error ? err.message : 'No se pudo iniciar el recuento guiado.');
    } finally {
      setKoraPlanAction(null);
    }
  }

  function openRecount(doc: RecountRecord) {
    setSelectedId(doc.id);
    setWorkspaceOpen(true);
  }

  async function handleSaveLine(productId: number, countedOverride?: string | number): Promise<boolean> {
    if (!ensureCanMutate()) return false;
    if (!selectedId) return false;
    const raw = countedOverride ?? lineDraft[productId];
    const counted = Number(raw);
    if (!Number.isFinite(counted) || counted < 0) {
      setError('La cantidad contada debe ser 0 o mayor.');
      return false;
    }
    setLineSavingId(productId);
    setError(null);
    try {
      await upsertRecountLine(apiClient, selectedId, {
        product_id: productId,
        counted_qty: counted,
      });
      await loadDetail();
      await loadDocs();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar línea');
      return false;
    } finally {
      setLineSavingId(null);
    }
  }

  function startEditLine(line: RecountLine) {
    const current = lineDraft[line.product_id] ?? String(line.counted_qty ?? 0);
    const parsed = Number(current);
    setEditingQty(String(Number.isFinite(parsed) ? Math.max(0, parsed) : 0));
    setEditingLineId(line.product_id);
  }

  function cancelEditLine() {
    setEditingLineId(null);
    setEditingQty('0');
  }

  async function saveEditedLine(productId: number) {
    const nextValue = editingQty;
    setLineDraft((prev) => ({ ...prev, [productId]: nextValue }));
    const ok = await handleSaveLine(productId, nextValue);
    if (ok) {
      cancelEditLine();
    }
  }

  async function handleDeleteLine(productId: number) {
    if (!ensureCanMutate()) return;
    if (!selectedId) return;
    setLineSavingId(productId);
    setError(null);
    try {
      await clearRecountLine(apiClient, selectedId, productId);
      setLineDraft((prev) => ({ ...prev, [productId]: '' }));
      await loadDetail();
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar línea');
    } finally {
      setLineSavingId(null);
    }
  }

  function handleCloseRecount() {
    if (!ensureCanMutate()) return;
    if (!selectedId) return;
    Alert.alert(
      'Cerrar recuento',
      'Vas a cerrar este recuento y ya no podrás editar líneas ni cantidades.\n\nSiguiente paso: después del cierre podrás aplicar el recuento para generar los ajustes de inventario.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cerrar recuento',
          style: 'destructive',
          onPress: async () => {
            setActionLoading('close');
            setError(null);
            try {
              await closeRecount(apiClient, selectedId);
              await loadDetail();
              await loadDocs();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo cerrar recuento');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ],
    );
  }

  function isTerminalRecountStatus(status: RecountStatus) {
    return status === 'closed' || status === 'applied' || status === 'cancelled';
  }

  function canCloseRecount(status: RecountStatus) {
    return status !== 'closed' && status !== 'applied' && status !== 'cancelled';
  }

  function canApplyRecount(status: RecountStatus) {
    return status === 'closed';
  }

  function canCancelRecount(status: RecountStatus) {
    return status !== 'applied' && status !== 'cancelled';
  }

  function openDocActions(doc: RecountRecord) {
    setSelectedDocForActions(doc);
    setShowDocActionsModal(true);
  }

  function closeDocActions() {
    if (listActionLoading) return;
    setShowDocActionsModal(false);
    setSelectedDocForActions(null);
  }

  function forceCloseDocActions() {
    setShowDocActionsModal(false);
    setSelectedDocForActions(null);
  }

  function hideFinishedKoraPlan(recountId: number) {
    setKoraPlan((current) => (current?.converted_recount_id === recountId ? null : current));
  }

  async function handleCloseRecountFromList() {
    if (!ensureCanMutate()) return;
    if (!selectedDocForActions) return;
    if (!canCloseRecount(selectedDocForActions.status)) return;
    setListActionLoading('close');
    setError(null);
    try {
      await closeRecount(apiClient, selectedDocForActions.id);
      forceCloseDocActions();
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar recuento');
    } finally {
      setListActionLoading(null);
    }
  }

  function handleApplyRecountFromList() {
    if (!ensureCanMutate()) return;
    if (!selectedDocForActions) return;
    if (!canApplyRecount(selectedDocForActions.status)) return;
    Alert.alert('Aplicar recuento', 'Se generarán ajustes de inventario por diferencia. ¿Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aplicar',
        style: 'destructive',
        onPress: async () => {
          if (!selectedDocForActions) return;
          const recountId = selectedDocForActions.id;
          setListActionLoading('apply');
          setError(null);
          try {
            await applyRecount(apiClient, recountId);
            hideFinishedKoraPlan(recountId);
            forceCloseDocActions();
            await Promise.all([loadDocs(), loadKoraPlan({ silent: true })]);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo aplicar recuento');
          } finally {
            setListActionLoading(null);
          }
        },
      },
    ]);
  }

  function handleCancelRecountFromList() {
    if (!ensureCanMutate()) return;
    if (!selectedDocForActions) return;
    if (!canCancelRecount(selectedDocForActions.status)) return;
    Alert.alert('Cancelar recuento', 'Este recuento quedará cancelado y ya no aceptará cambios. ¿Continuar?', [
      { text: 'Volver', style: 'cancel' },
      {
        text: 'Cancelar recuento',
        style: 'destructive',
        onPress: async () => {
          if (!selectedDocForActions) return;
          const recountId = selectedDocForActions.id;
          setListActionLoading('cancel');
          setError(null);
          try {
            await cancelRecount(apiClient, recountId);
            hideFinishedKoraPlan(recountId);
            forceCloseDocActions();
            await Promise.all([loadDocs(), loadKoraPlan({ silent: true })]);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo cancelar recuento');
          } finally {
            setListActionLoading(null);
          }
        },
      },
    ]);
  }

  async function handleApplyRecount() {
    if (!ensureCanMutate()) return;
    if (!selectedId) return;
    Alert.alert(
      'Aplicar recuento',
      'Se generarán ajustes de inventario por diferencia y el documento quedará aplicado.\n\nEste movimiento quedará trazado y podrás revisarlo también en Metrik Web (Historial/Movimientos). ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aplicar',
          style: 'destructive',
          onPress: async () => {
            const recountId = selectedId;
            setActionLoading('apply');
            setError(null);
            try {
              await applyRecount(apiClient, recountId);
              hideFinishedKoraPlan(recountId);
              await Promise.all([loadDetail(), loadDocs(), loadKoraPlan({ silent: true })]);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo aplicar recuento');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ],
    );
  }

  function openManualAddMode() {
    if (!ensureCanMutate()) return;
    setError(null);
    bluetoothInputRef.current?.blur();
    setManualQuery('');
    setManualResults([]);
    setManualSelectedLine(null);
    setManualQty('1');
    setManualSubmitting(false);
    setManualAddOpen(true);
  }

  function openCreateRecountModal() {
    if (!ensureCanMutate()) return;
    setError(null);
    setCreateRecountError(null);
    setNewTitle('');
    setNewScopeType('free');
    setNewScopeValue('');
    setGroupLabel('');
    setGroupSearch('');
    setNewMode('visible');
    setShowCreateRecountModal(true);
    if (groupOptions.length > 0) {
      setLoadingGroupOptions(false);
      return;
    }
    setLoadingGroupOptions(true);
    listReceivingProductGroups(apiClient, { limit: 5000, skip: 0 })
      .then((groups) => {
        setGroupOptions(groups);
      })
      .catch((err) => {
        setCreateRecountError(err instanceof Error ? err.message : 'No se pudieron cargar las categorías.');
      })
      .finally(() => {
        setLoadingGroupOptions(false);
      });
  }

  function closeManualAddMode() {
    setManualAddOpen(false);
    setManualQuery('');
    setManualResults([]);
    setManualSelectedLine(null);
    setManualQty('1');
    setManualSubmitting(false);
  }

  async function handleAddManualLine() {
    if (!ensureCanMutate()) return;
    if (!selectedId) return;
    if (!manualSelectedLine) {
      setError('Selecciona un producto para agregar.');
      return;
    }
    const qty = Number(manualQty);
    if (!Number.isFinite(qty) || qty < 0) {
      setError('La cantidad manual debe ser 0 o mayor.');
      return;
    }
    setManualSubmitting(true);
    try {
      const currentCount = resolveCountedQty(manualSelectedLine.product_id, manualSelectedLine.counted_qty);
      const next = (Number.isFinite(currentCount) ? currentCount : 0) + qty;
      await upsertRecountLine(apiClient, selectedId, {
        product_id: manualSelectedLine.product_id,
        counted_qty: next,
      });
      setLineDraft((prev) => ({
        ...prev,
        [manualSelectedLine.product_id]: String(next),
      }));
      closeManualAddMode();
      await loadDetail();
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar línea manual');
    } finally {
      setManualSubmitting(false);
    }
  }

  if (!workspaceOpen) {
    return (
      <ScreenContainer backgroundColor="#E9EDF3">
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.statusHero, activeDocs.length ? styles.statusHeroActive : styles.statusHeroIdle]}>
            <View style={styles.statusHeaderRow}>
              <View style={[styles.statusBadge, activeDocs.length ? styles.statusBadgeActive : styles.statusBadgeIdle]}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    activeDocs.length ? styles.statusBadgeTextActive : styles.statusBadgeTextIdle,
                  ]}
                >
                  {activeDocs.length ? 'EN CURSO' : 'LISTO'}
                </Text>
              </View>
              <Pressable
                style={[
                  activeDocs.length ? styles.secondaryButton : styles.primaryButton,
                  !canMutate ? styles.actionDisabled : null,
                ]}
                onPress={openCreateRecountModal}
                disabled={!canMutate}
              >
                <Text style={activeDocs.length ? styles.secondaryButtonText : styles.primaryButtonText}>
                  {activeDocs.length ? 'Crear otro' : 'Nuevo recuento'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.statusTitle}>
              {activeDocs.length === 0
                ? 'No hay recuentos en curso'
                : activeDocs.length === 1
                ? 'Hay 1 recuento en curso'
                : `Hay ${activeDocs.length} recuentos en curso`}
            </Text>
            <Text style={styles.statusDescription}>
              {activeDocs.length
                ? 'Continúa el documento prioritario para terminar el conteo y aplicar sus diferencias.'
                : 'La tablet está lista para iniciar un conteo manual o trabajar una propuesta de Kora.'}
            </Text>

            {primaryDoc ? (
              <View style={styles.statusRecommendation}>
                <Text style={styles.statusRecommendationLabel}>Recomendado ahora</Text>
                <Text style={styles.statusRecommendationTitle}>{primaryDoc.code}</Text>
                <Text style={styles.statusRecommendationMeta}>
                  {statusLabel(primaryDoc.status)} · {primaryDoc.summary.counted_lines}/{primaryDoc.summary.total_lines}{' '}
                  productos contados
                </Text>
                <Text style={styles.statusRecommendationMeta}>
                  Abierto: {formatBogotaDateTime(primaryDoc.created_at)}
                  {primaryDoc.created_by_user_name ? ` · ${primaryDoc.created_by_user_name}` : ''}
                </Text>
                <View style={styles.statusActionRow}>
                  <Pressable style={styles.primaryButton} onPress={() => openRecount(primaryDoc)}>
                    <Text style={styles.primaryButtonText}>
                      {primaryDoc.status === 'closed' ? 'Revisar y aplicar' : 'Continuar recuento'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>

          {!canMutate ? (
            <Text style={styles.warning}>Sin conexión: creación, edición y cierre de recuentos bloqueados.</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.title}>Recuentos en curso</Text>
              <Text style={styles.sectionSubtitle}>
                {activeDocs.length
                  ? 'Abre un documento para continuar el conteo físico.'
                  : 'Los documentos activos aparecerán aquí.'}
              </Text>
            </View>
            {activeDocs.length ? (
              <View style={styles.sectionCounter}>
                <Text style={styles.sectionCounterText}>{activeDocs.length}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.recountList}>
            {loadingDocs ? <ActivityIndicator color="#0A8F5A" /> : null}
            {!loadingDocs && activeDocs.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <Text style={styles.emptyStateTitle}>Sin recuentos abiertos</Text>
                <Text style={styles.emptyStateText}>
                  Inicia uno manualmente o pídele a Kora una lista priorizada para sanear inventario negativo.
                </Text>
              </View>
            ) : null}
            {activeDocs.map((doc) => (
              <View
                key={doc.id}
                style={[styles.recountCard, doc.id === primaryDoc?.id ? styles.recountCardPriority : null]}
              >
                <View style={styles.recountCardTopRow}>
                  <View style={styles.recountIdentity}>
                    <Text style={styles.recountCode}>{doc.code}</Text>
                    <Text style={styles.recountTitle}>{doc.title || 'Conteo físico de inventario'}</Text>
                  </View>
                  <View style={styles.recountTopActions}>
                    <View style={styles.recountStatusBadge}>
                      <Text style={styles.recountStatusBadgeText}>{statusLabel(doc.status)}</Text>
                    </View>
                    <Pressable style={styles.docMoreButton} onPress={() => openDocActions(doc)}>
                      <Text style={styles.docMoreButtonText}>⋮</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.recountDetails}>
                  <Text style={styles.docMeta}>
                    Progreso: {doc.summary.counted_lines}/{doc.summary.total_lines} productos
                  </Text>
                  <Text style={styles.docMeta}>Apertura: {formatBogotaDateTime(doc.created_at)}</Text>
                  {doc.created_by_user_name ? (
                    <Text style={styles.docMeta}>Abrió: {doc.created_by_user_name}</Text>
                  ) : null}
                </View>
                <View style={styles.recountCardActions}>
                  <Pressable style={styles.primaryButton} onPress={() => openRecount(doc)}>
                    <Text style={styles.primaryButtonText}>Abrir recuento</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.koraSectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.title}>Plan de saneamiento</Text>
              <Text style={styles.sectionSubtitle}>
                Una lista corta y priorizada para convertir tiempo libre en inventario confiable.
              </Text>
            </View>
          </View>

          <View style={styles.koraCard}>
            <View style={styles.koraBrandRow}>
              <View style={styles.koraBadge}>
                <Text style={styles.koraBadgeText}>KORA</Text>
              </View>
              {koraPlan ? <Text style={styles.koraPlanCode}>{koraPlan.code}</Text> : null}
            </View>
            {loadingKoraPlan ? <ActivityIndicator color="#0A8F5A" /> : null}
            {!loadingKoraPlan && !koraPlan ? (
              <>
                <Text style={styles.koraTitle}>Obtén una ruta concreta para sanear stock</Text>
                <Text style={styles.koraDescription}>
                  Kora seleccionará productos negativos por prioridad y cercanía de categoría. El plan no modifica
                  existencias hasta que termines y apliques el recuento.
                </Text>
                <View style={styles.koraActionRow}>
                  <Pressable
                    style={[styles.primaryButton, !canMutate ? styles.actionDisabled : null]}
                    onPress={() => {
                      handleRetrieveKoraPlan().catch(() => undefined);
                    }}
                    disabled={!canMutate || koraPlanAction !== null}
                  >
                    <Text style={styles.primaryButtonText}>
                      {koraPlanAction === 'retrieve' ? 'Preparando...' : 'Obtener plan de Kora'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {koraPlan ? (
              <>
                <Text style={styles.koraTitle}>{koraPlan.group_name || 'Saneamiento de varias categorías'}</Text>
                <Text style={styles.koraDescription}>
                  {koraPlan.selected_count} productos priorizados de {koraPlan.negative_sku_count} SKU negativos
                  detectados.
                </Text>
                <View style={styles.koraMetricsRow}>
                  <View style={styles.koraMetric}>
                    <Text style={styles.koraMetricValue}>{formatQty(koraPlan.total_negative_units)}</Text>
                    <Text style={styles.koraMetricLabel}>unidades negativas</Text>
                  </View>
                  <View style={styles.koraMetric}>
                    <Text style={styles.koraMetricValue}>{formatCop(koraPlan.total_cost_impact)}</Text>
                    <Text style={styles.koraMetricLabel}>impacto al costo</Text>
                  </View>
                </View>
                <Text style={styles.koraContext}>
                  {koraPlan.context.available_people == null
                    ? 'Capacidad del turno no disponible.'
                    : `${koraPlan.context.available_people} persona${
                        koraPlan.context.available_people === 1 ? '' : 's'
                      } disponible${koraPlan.context.available_people === 1 ? '' : 's'} según horario.`}
                  {koraPlan.context.open_receiving_count > 0
                    ? ` Hay ${koraPlan.context.open_receiving_count} recepción en curso y Kora ya reservó dos personas.`
                    : ''}
                </Text>
                <View style={styles.koraPreviewList}>
                  {koraPlan.items.slice(0, 4).map((item) => (
                    <View key={item.id} style={styles.koraPreviewItem}>
                      <View style={styles.koraPriorityCircle}>
                        <Text style={styles.koraPriorityText}>{item.priority_rank}</Text>
                      </View>
                      <View style={styles.koraPreviewCopy}>
                        <Text style={styles.koraPreviewName} numberOfLines={1}>
                          {item.product_name}
                        </Text>
                        <Text style={styles.koraPreviewMeta} numberOfLines={1}>
                          {item.sku ? `SKU ${item.sku}` : item.group_name || 'Producto pendiente de conteo'}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {koraPlan.items.length > 4 ? (
                    <Text style={styles.koraMoreItems}>+ {koraPlan.items.length - 4} productos más en el recuento</Text>
                  ) : null}
                </View>
                <View style={styles.koraActionRow}>
                  {koraPlan.status === 'ready' ? (
                    <Pressable
                      style={[styles.primaryButton, !canMutate ? styles.actionDisabled : null]}
                      onPress={() => {
                        handleConvertKoraPlan().catch(() => undefined);
                      }}
                      disabled={!canMutate || koraPlanAction !== null}
                    >
                      <Text style={styles.primaryButtonText}>
                        {koraPlanAction === 'convert' ? 'Creando recuento...' : 'Iniciar recuento guiado'}
                      </Text>
                    </Pressable>
                  ) : convertedPlanDoc ? (
                    <Pressable style={styles.primaryButton} onPress={() => openRecount(convertedPlanDoc)}>
                      <Text style={styles.primaryButtonText}>Continuar plan de Kora</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.koraConvertedText}>Este plan ya fue convertido en un recuento.</Text>
                  )}
                </View>
              </>
            ) : null}
            {koraPlanError ? <Text style={styles.koraError}>{koraPlanError}</Text> : null}
          </View>

          <Modal visible={showDocActionsModal} transparent animationType="fade" onRequestClose={closeDocActions}>
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Opciones del recuento</Text>
                <Text style={styles.modalLabel}>{selectedDocForActions?.code ?? ''}</Text>
                <View style={styles.modalActionsStack}>
                  <Pressable
                    style={styles.actionPrimaryButton}
                    onPress={() => {
                      if (!selectedDocForActions) return;
                      setSelectedId(selectedDocForActions.id);
                      setWorkspaceOpen(true);
                      closeDocActions();
                    }}
                    disabled={listActionLoading !== null}
                  >
                    <Text style={styles.actionPrimaryText}>Abrir documento</Text>
                  </Pressable>
                  {selectedDocForActions && canCloseRecount(selectedDocForActions.status) ? (
                    <Pressable
                      style={[styles.actionSecondaryButton, !canMutate ? styles.actionDisabled : null]}
                      onPress={() => {
                        handleCloseRecountFromList().catch(() => undefined);
                      }}
                      disabled={listActionLoading !== null || !canMutate}
                    >
                      <Text style={styles.actionSecondaryText}>
                        {listActionLoading === 'close' ? 'Cerrando...' : 'Cerrar recuento'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {selectedDocForActions && canApplyRecount(selectedDocForActions.status) ? (
                    <Pressable
                      style={[styles.actionPrimaryButton, !canMutate ? styles.actionDisabled : null]}
                      onPress={handleApplyRecountFromList}
                      disabled={listActionLoading !== null || !canMutate}
                    >
                      <Text style={styles.actionPrimaryText}>
                        {listActionLoading === 'apply' ? 'Aplicando...' : 'Aplicar recuento'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {selectedDocForActions && canCancelRecount(selectedDocForActions.status) ? (
                    <Pressable
                      style={[styles.actionDangerButton, !canMutate ? styles.actionDisabled : null]}
                      onPress={handleCancelRecountFromList}
                      disabled={listActionLoading !== null || !canMutate}
                    >
                      <Text style={styles.actionDangerText}>
                        {listActionLoading === 'cancel' ? 'Cancelando...' : 'Cancelar recuento'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.cancelButton}
                    onPress={closeDocActions}
                    disabled={listActionLoading !== null}
                  >
                    <Text style={styles.cancelButtonText}>Cerrar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={showCreateRecountModal}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (creating) return;
              setCreateRecountError(null);
              setShowCreateRecountModal(false);
            }}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Nuevo recuento</Text>
                {createRecountError ? <Text style={styles.modalError}>{createRecountError}</Text> : null}

                <Text style={styles.modalLabel}>Título (opcional)</Text>
                <TextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Ej: Inventario bodega principal"
                  placeholderTextColor="#64748B"
                  style={styles.modalInput}
                />

                <Text style={styles.modalLabel}>Alcance</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.pill, newScopeType === 'all' ? styles.pillActive : null]}
                    onPress={() => {
                      setNewScopeType('all');
                      setNewScopeValue('');
                      setGroupLabel('');
                    }}
                  >
                    <Text style={[styles.pillText, newScopeType === 'all' ? styles.pillTextActive : null]}>Todo</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pill, newScopeType === 'free' ? styles.pillActive : null]}
                    onPress={() => {
                      setNewScopeType('free');
                      setNewScopeValue('');
                      setGroupLabel('');
                    }}
                  >
                    <Text style={[styles.pillText, newScopeType === 'free' ? styles.pillTextActive : null]}>Libre</Text>
                  </Pressable>
                </View>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.pill, newScopeType === 'group' ? styles.pillActive : null]}
                    onPress={() => setNewScopeType('group')}
                  >
                    <Text style={[styles.pillText, newScopeType === 'group' ? styles.pillTextActive : null]}>
                      Por categoría
                    </Text>
                  </Pressable>
                </View>
                {newScopeType === 'group' ? (
                  <>
                    <Pressable style={styles.groupSelectorButton} onPress={() => setShowGroupPicker(true)}>
                      <Text style={styles.groupSelectorText}>
                        {newScopeValue || groupLabel || 'Seleccionar categoría existente'}
                      </Text>
                    </Pressable>
                    {loadingGroupOptions ? <ActivityIndicator color="#0A8F5A" /> : null}
                  </>
                ) : null}

                <Text style={styles.modalLabel}>Modo de conteo</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.pill, newMode === 'blind' ? styles.pillActive : null]}
                    onPress={() => setNewMode('blind')}
                  >
                    <Text style={[styles.pillText, newMode === 'blind' ? styles.pillTextActive : null]}>Ciego</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pill, newMode === 'visible' ? styles.pillActive : null]}
                    onPress={() => setNewMode('visible')}
                  >
                    <Text style={[styles.pillText, newMode === 'visible' ? styles.pillTextActive : null]}>Visible</Text>
                  </Pressable>
                </View>

                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.cancelButton}
                    onPress={() => {
                      setCreateRecountError(null);
                      setShowCreateRecountModal(false);
                    }}
                    disabled={creating}
                  >
                    <Text style={styles.cancelButtonText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={styles.saveButton}
                    onPress={() => {
                      handleCreateRecount().catch(() => undefined);
                    }}
                    disabled={creating || !canMutate}
                  >
                    <Text style={styles.saveButtonText}>{creating ? 'Creando...' : 'Crear recuento'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={showGroupPicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowGroupPicker(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Seleccionar categoría</Text>
                <TextInput
                  value={groupSearch}
                  onChangeText={setGroupSearch}
                  style={styles.modalInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Buscar grupo..."
                  placeholderTextColor="#64748b"
                />
                <View style={styles.groupListWrap}>
                  <FlatList
                    data={filteredGroupOptions}
                    keyExtractor={(group) => group.path}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.groupListContent}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={7}
                    removeClippedSubviews
                    renderItem={({ item: group }) => (
                      <Pressable
                        style={styles.groupItem}
                        onPress={() => {
                          setNewScopeValue(group.path);
                          setGroupLabel(group.display_name);
                          setCreateRecountError(null);
                          setShowGroupPicker(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.groupItemTitle,
                            {
                              marginLeft: Math.max(0, group.path.split('/').length - 1) * 10,
                            },
                          ]}
                        >
                          {group.display_name}
                        </Text>
                        <Text style={styles.groupItemPath}>{group.path}</Text>
                        {group.parent_path ? (
                          <Text style={styles.groupItemMeta}>Subgrupo de: {group.parent_path}</Text>
                        ) : (
                          <Text style={styles.groupItemMeta}>Grupo principal</Text>
                        )}
                      </Pressable>
                    )}
                    ListEmptyComponent={<Text style={styles.emptyText}>No hay grupos que coincidan.</Text>}
                  />
                </View>
                <View style={styles.modalActions}>
                  <Pressable style={styles.cancelButton} onPress={() => setShowGroupPicker(false)}>
                    <Text style={styles.cancelButtonText}>Cerrar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </ScreenContainer>
    );
  }

  const manualAddPanel = manualAddOpen ? (
    <View style={styles.searchPanel}>
      <View style={styles.searchPanelHeader}>
        <Text style={styles.searchPanelTitle}>Agregar ítem manual</Text>
        <Pressable style={styles.inlineBackButton} onPress={closeManualAddMode}>
          <Text style={styles.inlineBackText}>Cerrar</Text>
        </Pressable>
      </View>

      <Text style={styles.modalLabel}>Buscar producto (nombre / SKU / código de barras)</Text>
      <TextInput
        ref={manualQueryInputRef}
        value={manualQuery}
        onChangeText={(value) => {
          setManualQuery(value);
          setManualSelectedLine(null);
        }}
        placeholder="Ej: speaker 12, SK-100..."
        placeholderTextColor="#7282a3"
        style={styles.modalInput}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.helperRow}>
        <Text style={styles.helperText}>Mínimo 2 caracteres.</Text>
        <Text style={styles.helperText}>{manualResults.length} resultados</Text>
      </View>

      {manualLoading ? <ActivityIndicator color="#0A8F5A" /> : null}

      {manualQuery.trim().length >= 2 && !manualLoading && manualResults.length === 0 ? (
        <Text style={styles.noResults}>Sin coincidencias para esa búsqueda.</Text>
      ) : null}

      <View style={styles.resultsWrap}>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.resultsContent}>
            {manualResults.map((line) => {
              const isSelected = manualSelectedLine?.id === line.id;
              return (
                <Pressable
                  key={line.id}
                  style={[styles.resultItem, isSelected ? styles.resultItemSelected : null]}
                  onPress={() => {
                    setManualSelectedLine(line);
                    Keyboard.dismiss();
                  }}
                >
                  <Text style={styles.resultName} numberOfLines={3}>
                    {line.product_name}
                  </Text>
                  <Text style={styles.resultMeta}>
                    SKU: {line.sku || 'N/A'} · Código de barras: {line.barcode || 'N/A'} · Precio:{' '}
                    {line.price == null ? 'N/A' : formatCop(line.price)} · Último mov.:{' '}
                    {line.last_movement_at ? formatBogotaDateTime(line.last_movement_at) : 'Sin movimientos'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <Text style={styles.modalLabel}>Cantidad</Text>
      <View style={styles.qtyRow}>
        <Pressable
          style={styles.qtyStepBtn}
          onPress={() => {
            const current = Number(manualQty);
            const safeCurrent = Number.isFinite(current) ? current : 1;
            setManualQty(String(Math.max(0, safeCurrent - 1)));
          }}
        >
          <Text style={styles.qtyStepText}>-</Text>
        </Pressable>
        <TextInput
          value={manualQty}
          onChangeText={(value) => {
            const normalized = value.replace(/[^\d]/g, '');
            setManualQty(normalized);
          }}
          style={[styles.modalInput, styles.manualQtyInput]}
          keyboardType="numeric"
        />
        <Pressable
          style={styles.qtyStepBtn}
          onPress={() => {
            const current = Number(manualQty);
            const safeCurrent = Number.isFinite(current) ? current : 0;
            setManualQty(String(safeCurrent + 1));
          }}
        >
          <Text style={styles.qtyStepText}>+</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.saveButton, !manualSelectedLine || !canMutate ? styles.saveButtonDisabled : null]}
        onPress={() => {
          handleAddManualLine().catch(() => undefined);
        }}
        disabled={manualSubmitting || !manualSelectedLine || !canMutate}
      >
        <Text style={styles.saveButtonText}>{manualSubmitting ? 'Guardando...' : 'Agregar al recuento'}</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <ScreenContainer backgroundColor="#E9EDF3" scrollEnabled={false}>
      {loadingDetail ? <ActivityIndicator color="#0A8F5A" /> : null}
      {!canMutate ? (
        <Text style={styles.warning}>Sin conexión: recuento en modo lectura. Revalida para continuar.</Text>
      ) : null}
      {detail ? (
        <View style={styles.workspaceScroll}>
          <View style={styles.workspaceSticky}>
            <View style={styles.workspaceHeaderBlock}>
              <Text style={styles.workspaceTitle}>{detail.recount.code || 'Recuento'}</Text>
              <Text style={styles.meta}>
                {statusLabel(detail.recount.status)} · {detail.recount.count_mode === 'blind' ? 'Ciego' : 'Visible'}
              </Text>
              <View style={styles.metricsRow}>
                <Text style={styles.metricText}>Contadas: {detail.recount.summary.counted_lines}</Text>
                <Text style={styles.metricText}>Dif: {detail.recount.summary.difference_lines}</Text>
              </View>
            </View>

            <View style={[styles.searchRow, styles.workspaceScanRow]}>
              <View style={styles.searchInputWrap}>
                <TextInput
                  ref={bluetoothInputRef}
                  value={bluetoothScanInput}
                  onChangeText={setBluetoothScanInput}
                  onSubmitEditing={() => {
                    const raw = bluetoothScanInput;
                    setBluetoothScanInput('');
                    handleScannedCode(raw).catch(() => undefined);
                    requestAnimationFrame(() => {
                      if (!manualAddOpen) {
                        bluetoothInputRef.current?.focus();
                      }
                    });
                  }}
                  placeholder="Escanear con lector bluetooth y Enter"
                  placeholderTextColor="#7282a3"
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  showSoftInputOnFocus={false}
                />
              </View>
              <Pressable
                style={styles.searchScannerButton}
                onPress={() => {
                  handleOpenScanner().catch(() => undefined);
                }}
                disabled={!canMutate}
              >
                <View style={styles.searchScannerIconFrame}>
                  <View style={[styles.searchScannerCorner, styles.searchScannerCornerTopLeft]} />
                  <View style={[styles.searchScannerCorner, styles.searchScannerCornerTopRight]} />
                  <View style={[styles.searchScannerCorner, styles.searchScannerCornerBottomLeft]} />
                  <View style={[styles.searchScannerCorner, styles.searchScannerCornerBottomRight]} />
                  <View style={styles.searchScannerBarsWrap}>
                    <View style={[styles.searchScannerBar, styles.searchScannerBarNarrow]} />
                    <View style={styles.searchScannerBar} />
                    <View style={[styles.searchScannerBar, styles.searchScannerBarNarrow]} />
                  </View>
                </View>
              </Pressable>
            </View>

            <Pressable
              style={[styles.toggleBtn, styles.workspaceManualToggle]}
              onPress={() => (manualAddOpen ? closeManualAddMode() : openManualAddMode())}
              disabled={!canMutate}
            >
              <Text style={styles.toggleBtnText}>
                {manualAddOpen ? 'Ocultar agregado manual' : 'Mostrar agregado manual'}
              </Text>
            </Pressable>

            {!manualAddOpen ? (
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Filtrar líneas capturadas"
                placeholderTextColor="#7282a3"
                style={[styles.input, styles.workspaceFilterInput]}
              />
            ) : null}
          </View>
          <FlatList
            ref={listScrollRef}
            style={styles.workspaceList}
            contentContainerStyle={styles.workspaceScrollContent}
            data={manualAddOpen ? [] : filteredCountedLines}
            keyExtractor={(line) => String(line.id)}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={32}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            scrollEventThrottle={32}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
              const shouldEnableAutoFollow = remaining < 24;
              const shouldDisableAutoFollow = remaining > 96;

              if (!autoFollowRef.current && shouldEnableAutoFollow) {
                autoFollowRef.current = true;
                setAutoFollowList(true);
                return;
              }
              if (autoFollowRef.current && shouldDisableAutoFollow) {
                autoFollowRef.current = false;
                setAutoFollowList(false);
              }
            }}
            ListHeaderComponent={manualAddPanel}
            renderItem={({ item: line }) => {
              const draft = lineDraft[line.product_id] ?? '';
              const hasCount = line.counted_qty != null || draft !== '';
              const draftNumber = draft === '' ? null : Number(draft);
              const diff = draftNumber == null || Number.isNaN(draftNumber) ? null : draftNumber - line.system_qty;
              const isEditing = editingLineId === line.product_id;
              const readonlyCount = Number(lineDraft[line.product_id] ?? line.counted_qty ?? 0);
              return (
                <View style={styles.lineCard}>
                  <Text style={styles.lineName}>{line.product_name}</Text>
                  <Text style={styles.lineMeta}>
                    SKU: {line.sku || 'N/A'} · Código de barras: {line.barcode || 'N/A'} · Precio:{' '}
                    {line.price == null ? 'N/A' : formatCop(line.price)} · Último mov.:{' '}
                    {line.last_movement_at ? formatBogotaDateTime(line.last_movement_at) : 'Sin movimientos'}
                  </Text>
                  <View style={styles.lineRow}>
                    {detail.recount.count_mode !== 'blind' ? (
                      <Text style={styles.lineMeta}>Sistema: {formatQty(line.system_qty)}</Text>
                    ) : (
                      <View />
                    )}
                    <Text
                      style={[
                        styles.lineMeta,
                        diff == null ? null : diff < 0 ? styles.negative : diff > 0 ? styles.positive : null,
                      ]}
                    >
                      Dif: {diff == null ? '—' : formatQty(diff)}
                    </Text>
                  </View>
                  {!isEditing ? (
                    <View style={styles.lineInputRow}>
                      <View style={styles.readonlyQtyBox}>
                        <Text style={styles.readonlyQtyText}>
                          {hasCount && Number.isFinite(readonlyCount)
                            ? `Cantidad: ${formatQty(readonlyCount)}`
                            : 'Pendiente de conteo'}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => startEditLine(line)}
                        disabled={lineSavingId === line.product_id || !canMutate}
                      >
                        <Text style={styles.secondaryBtnText}>{hasCount ? 'Editar' : 'Registrar'}</Text>
                      </Pressable>
                      {hasCount ? (
                        <Pressable
                          style={styles.deleteBtn}
                          onPress={() => {
                            handleDeleteLine(line.product_id).catch(() => undefined);
                          }}
                          disabled={lineSavingId === line.product_id || !canMutate}
                        >
                          <Text style={styles.deleteBtnText}>Eliminar</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <View style={styles.qtyRow}>
                        <Pressable
                          style={styles.qtyStepBtn}
                          onPress={() => {
                            const current = Number(editingQty) || 0;
                            setEditingQty(String(Math.max(0, current - 1)));
                          }}
                        >
                          <Text style={styles.qtyStepText}>-</Text>
                        </Pressable>
                        <View style={styles.readonlyQtyBox}>
                          <Text style={styles.readonlyQtyText}>{formatQty(Number(editingQty) || 0)}</Text>
                        </View>
                        <Pressable
                          style={styles.qtyStepBtn}
                          onPress={() => {
                            const current = Number(editingQty) || 0;
                            setEditingQty(String(current + 1));
                          }}
                        >
                          <Text style={styles.qtyStepText}>+</Text>
                        </Pressable>
                      </View>
                      <View style={styles.lineInputRow}>
                        <Pressable style={styles.secondaryBtn} onPress={cancelEditLine}>
                          <Text style={styles.secondaryBtnText}>Cancelar</Text>
                        </Pressable>
                        <Pressable
                          style={styles.primaryBtn}
                          onPress={() => {
                            saveEditedLine(line.product_id).catch(() => undefined);
                          }}
                          disabled={lineSavingId === line.product_id || !canMutate}
                        >
                          <Text style={styles.primaryBtnText}>
                            {lineSavingId === line.product_id ? '...' : 'Guardar'}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              manualAddOpen ? null : (
                <Text style={styles.muted}>
                  {countedLines.length === 0
                    ? 'Aún no hay líneas en el documento. Escanea para empezar.'
                    : 'No hay líneas que coincidan con la búsqueda.'}
                </Text>
              )
            }
            ListFooterComponent={
              <View style={styles.workspaceListFooter}>
                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.secondaryBtn, detail.recount.status === 'closed' ? null : styles.secondaryBtnFull]}
                    onPress={() => {
                      if (isTerminalRecountStatus(detail.recount.status)) {
                        setWorkspaceOpen(false);
                        return;
                      }
                      handleCloseRecount();
                    }}
                    disabled={actionLoading !== null || (!isTerminalRecountStatus(detail.recount.status) && !canMutate)}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {isTerminalRecountStatus(detail.recount.status)
                        ? 'Volver'
                        : actionLoading === 'close'
                        ? 'Cerrando...'
                        : 'Cerrar'}
                    </Text>
                  </Pressable>
                  {detail.recount.status === 'closed' ? (
                    <Pressable
                      style={styles.primaryBtn}
                      onPress={() => {
                        handleApplyRecount().catch(() => undefined);
                      }}
                      disabled={actionLoading !== null || !canMutate}
                    >
                      <Text style={styles.primaryBtnText}>
                        {actionLoading === 'apply' ? 'Aplicando...' : 'Aplicar'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            }
          />
        </View>
      ) : (
        <View style={styles.workspaceFallback}>
          <Text style={styles.workspaceFallbackTitle}>No pudimos cargar este recuento</Text>
          <Text style={styles.workspaceFallbackText}>
            {error || 'Intenta nuevamente para recuperar la información del documento.'}
          </Text>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => {
              loadDetail().catch(() => undefined);
            }}
          >
            <Text style={styles.secondaryBtnText}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {scannerOpen ? (
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerCard}>
            <View style={styles.scannerHeader}>
              <Text style={styles.scannerTitle}>Escanear código de barras</Text>
              <Pressable style={styles.scannerCloseButton} onPress={() => setScannerOpen(false)}>
                <Text style={styles.scannerCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={styles.scannerHint}>Apunta la cámara al código de barras de la etiqueta.</Text>
            <View style={styles.scannerCameraWrap}>
              {cameraDevice && hasCameraPermission ? (
                <>
                  <Camera
                    style={StyleSheet.absoluteFill}
                    device={cameraDevice}
                    isActive={scannerOpen}
                    codeScanner={codeScanner}
                  />
                  <View style={styles.scannerFrame} pointerEvents="none" />
                </>
              ) : (
                <View style={styles.scannerUnavailable}>
                  <Text style={styles.scannerUnavailableText}>No se pudo activar la cámara.</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 0,
    paddingBottom: 130,
    gap: 12,
  },
  statusHero: {
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
  },
  statusHeroActive: {
    backgroundColor: '#F7FCEB',
    borderColor: '#C8DEA1',
  },
  statusHeroIdle: {
    backgroundColor: '#F3FAF7',
    borderColor: '#B7DEC9',
  },
  statusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusBadgeActive: {
    backgroundColor: '#FFF7D6',
    borderColor: '#E7C76A',
  },
  statusBadgeIdle: {
    backgroundColor: '#DFF4E8',
    borderColor: '#8AC7A5',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusBadgeTextActive: {
    color: '#9A6700',
  },
  statusBadgeTextIdle: {
    color: '#0B6B45',
  },
  statusTitle: {
    color: '#0F172A',
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
  },
  statusDescription: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  statusRecommendation: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D7E7BA',
    padding: 14,
    gap: 6,
  },
  statusRecommendationLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusRecommendationTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  statusRecommendationMeta: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  statusActionRow: {
    marginTop: 8,
    flexDirection: 'row',
  },
  primaryButton: {
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D2E0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  secondaryButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  sectionHeader: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionSubtitle: {
    marginTop: 4,
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  sectionCounter: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DFF4E8',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  sectionCounterText: {
    color: '#0A8F5A',
    fontWeight: '800',
    fontSize: 15,
  },
  recountList: {
    gap: 12,
  },
  emptyStateCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D5DEE9',
    padding: 18,
    gap: 6,
  },
  emptyStateTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  emptyStateText: {
    color: '#475569',
    lineHeight: 20,
  },
  recountCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D3DEE8',
    padding: 14,
    gap: 12,
  },
  recountCardPriority: {
    borderColor: '#A7D6B6',
    backgroundColor: '#FCFEFD',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  recountCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  recountIdentity: {
    flex: 1,
  },
  recountTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recountCode: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
  },
  recountTitle: {
    marginTop: 2,
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  recountStatusBadge: {
    backgroundColor: '#FFF4D6',
    borderWidth: 1,
    borderColor: '#EAC76A',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  recountStatusBadgeText: {
    color: '#946200',
    fontSize: 11,
    fontWeight: '800',
  },
  recountDetails: {
    gap: 4,
  },
  recountCardActions: {
    flexDirection: 'row',
  },
  koraSectionHeader: {
    marginTop: 20,
    flexDirection: 'row',
  },
  koraCard: {
    backgroundColor: '#F0FBF6',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#A7D6B6',
    padding: 18,
    gap: 12,
  },
  koraBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  koraBadge: {
    backgroundColor: '#0A8F5A',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  koraBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  koraPlanCode: {
    color: '#0B6B45',
    fontSize: 12,
    fontWeight: '800',
  },
  koraTitle: {
    color: '#0F172A',
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
  },
  koraDescription: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  koraMetricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  koraMetric: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBE7D5',
    borderRadius: 14,
    padding: 12,
    gap: 3,
  },
  koraMetricValue: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  koraMetricLabel: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 15,
  },
  koraContext: {
    color: '#35584A',
    backgroundColor: '#DFF4E8',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  koraPreviewList: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBE7D5',
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  koraPreviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  koraPriorityCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DFF4E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  koraPriorityText: {
    color: '#0A8F5A',
    fontSize: 12,
    fontWeight: '800',
  },
  koraPreviewCopy: {
    flex: 1,
  },
  koraPreviewName: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  koraPreviewMeta: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 11,
  },
  koraMoreItems: {
    color: '#0A8F5A',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  koraActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  koraConvertedText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  koraError: {
    color: '#B42318',
    backgroundColor: '#FEF3F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  workspaceScroll: {
    flex: 1,
    width: '100%',
  },
  workspaceList: {
    flex: 1,
    width: '100%',
  },
  workspaceScrollContent: {
    paddingTop: 16,
    gap: 12,
    paddingBottom: 130,
  },
  workspaceListFooter: {
    gap: 12,
  },
  workspaceSticky: {
    backgroundColor: '#E9EDF3',
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DFEA',
    gap: 12,
  },
  workspaceHeaderBlock: {
    gap: 6,
    marginBottom: 2,
  },
  workspaceFallback: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  workspaceFallbackTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  workspaceFallbackText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  workspaceTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 24,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  subtitle: {
    color: '#334155',
    fontSize: 13,
  },
  listCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  pillText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextActive: {
    color: '#0A8F5A',
  },
  primaryBtn: {
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 76,
  },
  secondaryBtnFull: {
    flex: 1,
  },
  secondaryBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  deleteBtnText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
  },
  docItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  docItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  docMainPressable: {
    flex: 1,
  },
  docMoreButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docMoreButtonText: {
    color: '#334155',
    fontSize: 20,
    lineHeight: 20,
    marginTop: -2,
    fontWeight: '700',
  },
  docTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
  docMeta: {
    color: '#334155',
    fontSize: 12,
    marginTop: 2,
  },
  meta: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  metricText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  lineCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 6,
  },
  lineName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  lineMeta: {
    color: '#475569',
    fontSize: 12,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  lineInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  readonlyQtyBox: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  readonlyQtyText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  qtyInput: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  positive: {
    color: '#0A8F5A',
  },
  negative: {
    color: '#BE123C',
  },
  muted: {
    color: '#64748B',
    fontSize: 13,
  },
  warning: {
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.55,
  },
  error: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  workspaceScanRow: {
    marginTop: 8,
    marginBottom: 12,
  },
  workspaceManualToggle: {
    marginBottom: 12,
  },
  workspaceFilterInput: {
    marginBottom: 14,
  },
  searchInputWrap: {
    flex: 1,
  },
  searchInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CAD6EA',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchScannerButton: {
    width: 46,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CAD6EA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchScannerIconFrame: {
    width: 22,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: '#0F172A',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchScannerCorner: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderColor: '#0F172A',
    borderWidth: 1.4,
  },
  searchScannerCornerTopLeft: {
    top: -2,
    left: -2,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 3,
  },
  searchScannerCornerTopRight: {
    top: -2,
    right: -2,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 3,
  },
  searchScannerCornerBottomLeft: {
    bottom: -2,
    left: -2,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
  },
  searchScannerCornerBottomRight: {
    bottom: -2,
    right: -2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 3,
  },
  searchScannerBarsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  searchScannerBar: {
    width: 2,
    height: 9,
    borderRadius: 1,
    backgroundColor: '#0F172A',
  },
  searchScannerBarNarrow: {
    height: 6,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 15, 28, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  scannerCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#29406a',
    backgroundColor: '#0f172a',
    padding: 14,
    gap: 10,
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '700',
  },
  scannerCloseButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  scannerCloseText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  scannerHint: {
    color: '#94a3b8',
    fontSize: 13,
  },
  scannerCameraWrap: {
    height: 280,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
  },
  scannerFrame: {
    position: 'absolute',
    top: '18%',
    left: '12%',
    right: '12%',
    bottom: '18%',
    borderWidth: 2,
    borderColor: '#22c55e',
    borderRadius: 16,
  },
  scannerUnavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerUnavailableText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  toggleBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingVertical: 8,
    alignItems: 'center',
  },
  toggleBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  searchPanel: {
    marginTop: 2,
    backgroundColor: '#D8E1EC',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  searchPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  searchPanelTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  inlineBackButton: {
    backgroundColor: '#E2E8F0',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlineBackText: {
    color: '#334155',
    fontWeight: '700',
  },
  modalLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  modalInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
  },
  groupSelectorButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  groupSelectorText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  groupListWrap: {
    maxHeight: 300,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    overflow: 'hidden',
  },
  groupListContent: {
    padding: 6,
    gap: 6,
  },
  groupItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    padding: 10,
    gap: 2,
  },
  groupItemTitle: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  groupItemPath: {
    color: '#334155',
    fontSize: 12,
  },
  groupItemMeta: {
    color: '#64748B',
    fontSize: 11,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  helperText: {
    color: '#64748B',
    fontSize: 12,
  },
  noResults: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
  resultsWrap: {
    maxHeight: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    overflow: 'hidden',
  },
  resultsContent: {
    padding: 6,
    gap: 6,
  },
  resultItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    padding: 10,
    gap: 4,
  },
  resultItemSelected: {
    borderColor: '#67C48D',
    backgroundColor: '#DCEFE3',
  },
  resultName: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  resultMeta: {
    color: '#334155',
    fontSize: 12,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyStepBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyStepText: {
    color: '#334155',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
  },
  manualQtyInput: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
  },
  saveButton: {
    marginTop: 6,
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '700',
  },
  modalError: {
    color: '#BE123C',
    fontSize: 13,
    fontWeight: '600',
  },
  modalActionsStack: {
    gap: 8,
    marginTop: 4,
  },
  modalActions: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionPrimaryButton: {
    backgroundColor: '#DCEFE3',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionPrimaryText: {
    color: '#0A8F5A',
    fontWeight: '700',
    textAlign: 'center',
  },
  actionSecondaryButton: {
    backgroundColor: '#EAF7F0',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionSecondaryText: {
    color: '#0A8F5A',
    fontWeight: '700',
    textAlign: 'center',
  },
  actionDangerButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionDangerText: {
    color: '#B91C1C',
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '700',
    textAlign: 'center',
  },
});
