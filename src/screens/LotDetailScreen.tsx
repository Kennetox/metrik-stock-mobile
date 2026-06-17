import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Platform,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { hasNativePrintAgent, printNative } from '../services/printing/mobilePrintAgent';
import {
  addReceivingLotItem,
  closeReceivingLot,
  createReceivingProductQuick,
  deleteReceivingLotItem,
  getReceivingNextProductCodes,
  getLotDetail,
  listReceivingProductGroups,
  markReceivingLotItemLabelsPrinted,
  filterActiveReceivingProducts,
  searchReceivingProductsAll,
  updateReceivingLotItem,
} from '../services/api/receiving';
import {
  getProductCostSuggestion,
  getProductDuplicateCandidates,
  type ProductDuplicateCandidatesResponse,
  type ProductCostSuggestionResponse,
  type ProductDuplicateCandidate,
} from '../services/api/products';
import type { ReceivingLotDetail, ReceivingProductLookup } from '../types/receiving';
import { ScreenContainer } from '../ui/ScreenContainer';
import { SearchInput } from '../ui/SearchInput';

function formatPurchaseType(type: string) {
  if (type === 'cash') return 'Contado';
  if (type === 'invoice') return 'Factura';
  return type;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPriceLabelText(value: number): string {
  return `$${Number(value || 0).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function normalizePrinterUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
}

type PrintPayload = {
  CODIGO: string;
  BARRAS: string;
  NOMBRE: string;
  PRECIO: string;
  format: string;
  copies: number;
};

async function printDirect(printerUrl: string, payload: PrintPayload[]) {
  const normalizedUrl = normalizePrinterUrl(printerUrl);
  if (!normalizedUrl) {
    throw new Error('Configura la URL de impresora en Etiquetas.');
  }

  const parsed = new URL(normalizedUrl);
  const isRootPath = parsed.pathname === '/' || parsed.pathname === '';
  const targets = [normalizedUrl];
  if (isRootPath) {
    const noSlash = normalizedUrl.replace(/\/+$/, '');
    targets.push(`${noSlash}/print`);
    targets.push(`${noSlash}/api/print`);
    targets.push(`${noSlash}/labels/print`);
  }

  let lastError: Error | null = null;

  for (const target of targets) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.ok) return;

      const detail = (await res.text().catch(() => '')).trim();
      const shortDetail = detail.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (shortDetail.toLowerCase().includes('cannot post /') && target === normalizedUrl && targets.length > 1) {
        continue;
      }
      lastError = new Error(shortDetail || `Impresora respondió ${res.status}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Tiempo de espera agotado al contactar impresora.');
      } else if (err instanceof TypeError) {
        lastError = new Error('No se pudo conectar con la impresora. Revisa IP/red.');
      } else if (err instanceof Error) {
        lastError = err;
      } else {
        lastError = new Error('No se pudo imprimir.');
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('No se pudo imprimir.');
}

async function printWithBestPath(printerUrl: string, payload: PrintPayload[]) {
  let nativeError: Error | null = null;
  if (hasNativePrintAgent()) {
    try {
      await printNative(printerUrl, payload, 4500);
      return;
    } catch (err: unknown) {
      nativeError = err instanceof Error ? err : new Error('No se pudo imprimir usando el agente nativo.');
    }
  }
  try {
    await printDirect(printerUrl, payload);
  } catch (jsError: unknown) {
    if (nativeError) {
      throw new Error(nativeError.message || 'No se pudo imprimir con la impresora.');
    }
    throw jsError;
  }
}

function formatMoneyInput(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function parseMoneyInput(value: string): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return NaN;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function rankProduct(product: ReceivingProductLookup, rawQuery: string) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 100;

  const sku = (product.sku || '').toLowerCase();
  const barcode = (product.barcode || '').toLowerCase();
  const name = (product.name || '').toLowerCase();

  if (barcode && barcode === q) return 0;
  if (sku && sku === q) return 1;
  if (sku.startsWith(q)) return 2;
  if (barcode.startsWith(q)) return 3;
  if (name.startsWith(q)) return 4;
  if (name.includes(q)) return 5;
  return 10;
}

function normalizeSearchText(value: string) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAllQueryTokens(product: ReceivingProductLookup, rawQuery: string) {
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (!tokens.length) return true;

  const haystack = normalizeSearchText(
    `${product.name || ''} ${product.sku || ''} ${product.barcode || ''}`,
  );
  if (!haystack) return false;

  return tokens.every((token) => haystack.includes(token));
}

function sortProductResults(items: ReceivingProductLookup[], rawQuery: string) {
  return [...items]
    .filter((item) => matchesAllQueryTokens(item, rawQuery))
    .sort((a, b) => {
    const rankA = rankProduct(a, rawQuery);
    const rankB = rankProduct(b, rawQuery);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, 'es');
  });
}

type ProductGroupOption = {
  id: number;
  path: string;
  display_name: string;
  parent_path?: string | null;
};

const DEFAULT_LABEL_FORMAT = 'Kensar1';
const CABLES_LABEL_FORMAT = 'Cables_1';
const LEGACY_KENSAR_FORMAT = 'Kensar';
const LABEL_FORMAT_OPTIONS = [DEFAULT_LABEL_FORMAT, CABLES_LABEL_FORMAT] as const;

type LabelFormatOption = (typeof LABEL_FORMAT_OPTIONS)[number];

function resolveLabelFormatByGroup(groupPath: string): LabelFormatOption {
  const normalized = (groupPath || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalized.includes('cables') ? CABLES_LABEL_FORMAT : DEFAULT_LABEL_FORMAT;
}

function normalizeLabelFormat(value: string | null | undefined, groupPath: string): LabelFormatOption {
  const trimmed = (value || '').trim();
  if (trimmed === LEGACY_KENSAR_FORMAT) return DEFAULT_LABEL_FORMAT;
  if (trimmed === CABLES_LABEL_FORMAT) return CABLES_LABEL_FORMAT;
  if (trimmed === DEFAULT_LABEL_FORMAT) return DEFAULT_LABEL_FORMAT;
  return resolveLabelFormatByGroup(groupPath);
}

export function LotDetailScreen({
  lotId,
  onBack,
  showInlineHeader = true,
}: {
  lotId: number;
  onBack: () => void;
  showInlineHeader?: boolean;
}) {
  const { apiClient, printerDirectUrl, syncStatus } = useAppSession();
  const [detail, setDetail] = useState<ReceivingLotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addMode, setAddMode] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [rawResults, setRawResults] = useState<ReceivingProductLookup[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ReceivingProductLookup | null>(null);
  const [qtyInput, setQtyInput] = useState('1');
  const [submittingItem, setSubmittingItem] = useState(false);
  const [searching, setSearching] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editQtyInput, setEditQtyInput] = useState('1');
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [closingLot, setClosingLot] = useState(false);
  const [printingItemId, setPrintingItemId] = useState<number | null>(null);
  const [showCreateProductModal, setShowCreateProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [previewSku, setPreviewSku] = useState('');
  const [previewBarcode, setPreviewBarcode] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductCost, setNewProductCost] = useState('');
  const [newProductQty, setNewProductQty] = useState('1');
  const [newProductLabelFormat, setNewProductLabelFormat] = useState<LabelFormatOption>(DEFAULT_LABEL_FORMAT);
  const [newProductLabelFormatLocked, setNewProductLabelFormatLocked] = useState(true);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [loadingProductCodes, setLoadingProductCodes] = useState(false);
  const [productGroups, setProductGroups] = useState<ProductGroupOption[]>([]);
  const [loadingProductGroups, setLoadingProductGroups] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showLabelFormatPicker, setShowLabelFormatPicker] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupPath, setSelectedGroupPath] = useState('');
  const [selectedGroupLabel, setSelectedGroupLabel] = useState('');
  const [createProductError, setCreateProductError] = useState<string | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ProductDuplicateCandidate[]>([]);
  const [selectedDuplicateCandidate, setSelectedDuplicateCandidate] = useState<ProductDuplicateCandidate | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [hasHighDuplicateRisk, setHasHighDuplicateRisk] = useState(false);
  const [costSuggestion, setCostSuggestion] = useState<ProductCostSuggestionResponse | null>(null);
  const [costChecking, setCostChecking] = useState(false);
  const [costMode] = useState<'balanced' | 'conservative' | 'aggressive'>('balanced');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const canMutate = syncStatus === 'online' || syncStatus === 'degraded';
  const createProductScrollRef = useRef<ScrollView | null>(null);
  const workspaceScrollRef = useRef<ScrollView | null>(null);
  const duplicateCheckRequestRef = useRef(0);

  function ensureCanMutate(): boolean {
    if (canMutate) return true;
    setError('Sin conexión con API. Revalida la conexión para continuar.');
    return false;
  }

  const loadDetail = useCallback(async () => {
    setError(null);
    const data = await getLotDetail(apiClient, lotId);
    setDetail(data);
  }, [apiClient, lotId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadDetail()
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar el lote');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadDetail]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!showCreateProductModal) return;
    requestAnimationFrame(() => {
      createProductScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [showCreateProductModal]);

  const totalUnits = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce((sum, item) => sum + Number(item.qty_received || 0), 0);
  }, [detail]);

  const totalLabelsRequested = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce(
      (sum, item) => sum + Math.max(0, Math.ceil(Number(item.qty_received || 0))),
      0,
    );
  }, [detail]);

  const printedLabels = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce((sum, item) => {
      const maxForLine = Math.max(0, Math.ceil(Number(item.qty_received || 0)));
      const alreadyPrinted = Math.max(0, Math.min(maxForLine, Number(item.labels_printed_qty || 0)));
      return sum + alreadyPrinted;
    }, 0);
  }, [detail]);

  const pendingLabels = useMemo(() => Math.max(0, totalLabelsRequested - printedLabels), [printedLabels, totalLabelsRequested]);

  const localWarnings = useMemo(() => {
    if (!detail) return [];
    const filtered = detail.warnings.filter((warning) => warning.code !== 'labels_pending');
    if (pendingLabels > 0) {
      filtered.push({
        code: 'labels_pending',
        message: `Hay ${pendingLabels} etiqueta(s) pendientes por procesar.`,
      });
    }
    return filtered;
  }, [detail, pendingLabels]);

  const closeSummaryMessage = useMemo(() => {
    if (!detail) {
      return 'Al cerrar, el lote ya no se podrá editar. ¿Deseas continuar?';
    }
    const hasPendingLabels = pendingLabels > 0;
    const warningLines = localWarnings.map((warning) => `• ${warning.message}`);
    const warningBlock =
      warningLines.length > 0
        ? `\n\nRevisa antes de cerrar:\n${warningLines.join('\n')}`
        : '';
    const pendingNotice = hasPendingLabels
      ? '\n\nVas a cerrar este lote con etiquetas pendientes.'
      : '';
    return `Al cerrar, el lote ya no se podrá editar.${pendingNotice}${warningBlock}\n\n¿Deseas continuar?`;
  }, [detail, localWarnings, pendingLabels]);

  const checkDuplicates = useCallback(async (): Promise<ProductDuplicateCandidatesResponse> => {
    const name = newProductName.trim();
    const group = selectedGroupPath.trim();
    if (!name || name.length < 2) {
      setDuplicateCandidates([]);
      setHasHighDuplicateRisk(false);
      setDuplicateChecking(false);
      return { candidates: [], has_high_risk: false };
    }
    const requestId = ++duplicateCheckRequestRef.current;
    setDuplicateChecking(true);
    try {
      const response = await getProductDuplicateCandidates(apiClient, {
        name,
        sku: previewSku.trim() || null,
        barcode: previewBarcode.trim() || null,
        group_name: group || null,
        limit: 6,
      });
      if (requestId === duplicateCheckRequestRef.current) {
        setDuplicateCandidates(response.candidates);
        setHasHighDuplicateRisk(response.has_high_risk && response.candidates.length > 0);
        if (
          selectedDuplicateCandidate &&
          !response.candidates.some((candidate) => candidate.product_id === selectedDuplicateCandidate.product_id)
        ) {
          setSelectedDuplicateCandidate(null);
        }
      }
      return response;
    } catch (err) {
      if (requestId === duplicateCheckRequestRef.current) {
        setCreateProductError(err instanceof Error ? err.message : 'No se pudieron revisar duplicados');
      }
      return { candidates: [], has_high_risk: false };
    } finally {
      if (requestId === duplicateCheckRequestRef.current) {
        setDuplicateChecking(false);
      }
    }
  }, [apiClient, newProductName, previewBarcode, previewSku, selectedDuplicateCandidate, selectedGroupPath]);

  useEffect(() => {
    if (!showCreateProductModal) return;

    const name = newProductName.trim();

    if (loadingProductCodes || loadingProductGroups) return;
    if (name.length < 2) {
      duplicateCheckRequestRef.current += 1;
      setDuplicateCandidates([]);
      setHasHighDuplicateRisk(false);
      setDuplicateChecking(false);
      return;
    }

    const timer = setTimeout(() => {
      checkDuplicates().catch(() => undefined);
    }, 350);

    return () => clearTimeout(timer);
  }, [
    checkDuplicates,
    loadingProductCodes,
    loadingProductGroups,
    newProductName,
    selectedGroupPath,
    showCreateProductModal,
  ]);

  async function suggestCost() {
    const price = parseMoneyInput(newProductPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setCreateProductError('Ingresa un precio válido para sugerir costo.');
      return;
    }
    setCostChecking(true);
    setCreateProductError(null);
    try {
      const response = await getProductCostSuggestion(apiClient, {
        mode: costMode,
        price,
        group_name: selectedGroupPath.trim() || null,
        exclude_product_id: null,
      });
      setCostSuggestion(response);
      setNewProductCost(String(Math.round(response.suggested_cost)));
    } catch (err) {
      setCreateProductError(err instanceof Error ? err.message : 'No se pudo sugerir costo');
    } finally {
      setCostChecking(false);
    }
  }

  async function handleMockPrintLabel(
    itemId: number,
    qtyReceived: number,
    skuSnapshot: string | null | undefined,
    barcodeSnapshot: string | null | undefined,
    productNameSnapshot: string,
    unitPriceSnapshot: number,
    labelFormatSnapshot: string | null | undefined,
  ) {
    const maxForLine = Math.max(0, Math.ceil(Number(qtyReceived || 0)));

    const codigo = (skuSnapshot || '').trim() || String(itemId);
    const barras = (barcodeSnapshot || '').trim() || codigo;
    const payload: PrintPayload[] = [
      {
        CODIGO: codigo,
        BARRAS: barras,
        NOMBRE: productNameSnapshot || 'Producto',
        PRECIO: formatPriceLabelText(unitPriceSnapshot),
        format: normalizeLabelFormat(labelFormatSnapshot, ''),
        copies: maxForLine,
      },
    ];

    setPrintingItemId(itemId);
    try {
      await printWithBestPath(printerDirectUrl, payload);
      await markReceivingLotItemLabelsPrinted(apiClient, lotId, itemId, maxForLine);
      await loadDetail();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo imprimir la etiqueta');
    } finally {
      setPrintingItemId(null);
    }
  }

  const productResults = useMemo(() => {
    return sortProductResults(rawResults, productQuery);
  }, [rawResults, productQuery]);

  const orderedItems = useMemo(() => {
    return detail ? [...detail.items].reverse() : [];
  }, [detail]);

  const filteredProductGroups = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    const sorted = [...productGroups].sort((a, b) =>
      a.path.localeCompare(b.path, 'es', { sensitivity: 'base' }),
    );
    if (!term) return sorted;
    return sorted.filter(
      (group) =>
        group.display_name.toLowerCase().includes(term) ||
        group.path.toLowerCase().includes(term),
    );
  }, [groupSearch, productGroups]);

  useEffect(() => {
    if (!addMode) {
      setRawResults([]);
      return;
    }

    const term = productQuery.trim();
    if (term.length < 2) {
      setRawResults([]);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchReceivingProductsAll(apiClient, term, { includeInactive: true })
        .then(async (results) => {
          if (active) {
            const activeResults = filterActiveReceivingProducts(results);
            if (activeResults.length > 0) {
              setRawResults(activeResults);
              return;
            }

            const normalizedTerm = normalizeSearchText(term);
            const tokens = normalizedTerm.split(' ').filter(Boolean);
            if (tokens.length >= 2) {
              const fallbackSeed = tokens[0];
              if (fallbackSeed.length >= 2) {
                const fallbackResults = await searchReceivingProductsAll(apiClient, fallbackSeed, {
                  includeInactive: true,
                });
                if (active) {
                  setRawResults(filterActiveReceivingProducts(fallbackResults));
                  return;
                }
              }
            }

            setRawResults(activeResults);
          }
        })
        .catch(() => {
          if (active) {
            setRawResults([]);
          }
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [addMode, apiClient, productQuery]);

  function openAddMode() {
    if (!ensureCanMutate()) return;
    setError(null);
    setProductQuery('');
    setRawResults([]);
    setSelectedProduct(null);
    setQtyInput('1');
    setAddMode(true);
  }

  function closeAddMode() {
    setAddMode(false);
    setProductQuery('');
    setRawResults([]);
    setSelectedProduct(null);
    setQtyInput('1');
    setSubmittingItem(false);
  }

  function scrollItemsToTop() {
    requestAnimationFrame(() => {
      workspaceScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }

  async function openCreateProductModal() {
    if (!ensureCanMutate()) return;
    setError(null);
    setCreateProductError(null);
    setDuplicateCandidates([]);
    setSelectedDuplicateCandidate(null);
    setHasHighDuplicateRisk(false);
    setCostSuggestion(null);
    setNewProductName(productQuery.trim());
    setPreviewSku('');
    setPreviewBarcode('');
    setNewProductPrice('');
    setNewProductCost('');
    setNewProductQty(qtyInput || '1');
    setNewProductLabelFormat(DEFAULT_LABEL_FORMAT);
    setNewProductLabelFormatLocked(true);
    setShowLabelFormatPicker(false);
    setGroupSearch('');
    setSelectedGroupPath('');
    setSelectedGroupLabel('');
    setLoadingProductCodes(true);
    setLoadingProductGroups(true);
    setShowCreateProductModal(true);
    try {
      const [codes, groups] = await Promise.all([
        getReceivingNextProductCodes(apiClient),
        listReceivingProductGroups(apiClient, { limit: 5000, skip: 0 }),
      ]);
      setPreviewSku(codes.sku);
      setPreviewBarcode(codes.barcode);
      setProductGroups(groups);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'No se pudo validar conexión para generar SKU y código de barras';
      setError(message);
      setCreateProductError(message);
    } finally {
      setLoadingProductCodes(false);
      setLoadingProductGroups(false);
    }
  }

  function closeCreateProductModal() {
    setShowCreateProductModal(false);
    setCreatingProduct(false);
    setLoadingProductCodes(false);
    setShowLabelFormatPicker(false);
    setCreateProductError(null);
    setDuplicateCandidates([]);
    setSelectedDuplicateCandidate(null);
    setHasHighDuplicateRisk(false);
    setCostSuggestion(null);
    setDuplicateChecking(false);
    setCostChecking(false);
  }

  function toggleNewProductLabelFormatLock() {
    setNewProductLabelFormatLocked((prev) => {
      const nextLocked = !prev;
      if (nextLocked) {
        setNewProductLabelFormat(resolveLabelFormatByGroup(selectedGroupPath));
        setShowLabelFormatPicker(false);
      }
      return nextLocked;
    });
  }

  async function handleAddItem() {
    if (!ensureCanMutate()) return;
    if (!selectedProduct) {
      setError('Selecciona un producto para agregar.');
      return;
    }
    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La cantidad debe ser mayor a 0.');
      return;
    }

    setSubmittingItem(true);
    try {
      await addReceivingLotItem(apiClient, lotId, {
        product_id: selectedProduct.id,
        qty_received: qty,
      });
      await loadDetail();
      scrollItemsToTop();
      setError(null);
      closeAddMode();
      setSubmittingItem(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el ítem');
      setSubmittingItem(false);
    }
  }

  async function handleCreateAndAddProduct() {
    if (!ensureCanMutate()) return;
    const qty = Number(newProductQty);
    setCreateProductError(null);

    if (!Number.isFinite(qty) || qty <= 0) {
      setCreateProductError('La cantidad debe ser mayor a 0.');
      return;
    }

    if (selectedDuplicateCandidate) {
      setCreatingProduct(true);
      try {
        await addReceivingLotItem(apiClient, lotId, {
          product_id: selectedDuplicateCandidate.product_id,
          qty_received: qty,
        });
        await loadDetail();
        setError(null);
        closeCreateProductModal();
        closeAddMode();
      } catch (err) {
        setCreateProductError(err instanceof Error ? err.message : 'No se pudo agregar el producto existente al lote');
      } finally {
        setCreatingProduct(false);
      }
      return;
    }

    const name = newProductName.trim();
    const price = parseMoneyInput(newProductPrice);
    const hasCostInput = newProductCost.trim().length > 0;
    const cost = hasCostInput ? parseMoneyInput(newProductCost) : 0;

    if (!name) {
      setCreateProductError('El nombre del producto es obligatorio.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setCreateProductError('El precio de venta debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setCreateProductError('El costo debe ser 0 o mayor.');
      return;
    }
    if (cost > price) {
      setCreateProductError('El costo no puede ser mayor al precio de venta. Revisa los valores e intenta de nuevo.');
      return;
    }
    if (!selectedGroupPath.trim()) {
      setCreateProductError('Debes seleccionar un grupo existente.');
      setShowGroupPicker(true);
      return;
    }

    setCreatingProduct(true);
    try {
      if (duplicateCandidates.length === 0) {
        const duplicateResponse = await checkDuplicates();
        if (duplicateResponse.candidates.length > 0) {
          const top = duplicateResponse.candidates[0];
          const proceed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              duplicateResponse.has_high_risk ? 'Riesgo alto de duplicado' : 'Posible duplicado',
              `Detectamos coincidencias con "${top.name}"${top.sku ? ` (SKU ${top.sku})` : ''}.`,
              [
                { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Guardar igual', style: 'destructive', onPress: () => resolve(true) },
              ],
            );
          });
          if (!proceed) {
            setCreatingProduct(false);
            return;
          }
        }
      }
      const created = await createReceivingProductQuick(apiClient, {
        name,
        price,
        cost,
        group_name: selectedGroupPath,
        label_format: normalizeLabelFormat(newProductLabelFormat, selectedGroupPath),
      });
      await addReceivingLotItem(apiClient, lotId, {
        product_id: created.id,
        qty_received: qty,
      });
      await loadDetail();
      scrollItemsToTop();
      setError(null);
      closeCreateProductModal();
      closeAddMode();
    } catch (err) {
      setCreateProductError(err instanceof Error ? err.message : 'No se pudo crear/agregar el producto');
      setCreatingProduct(false);
    }
  }

  function startEditItem(itemId: number, currentQty: number) {
    setError(null);
    setEditingItemId(itemId);
    setEditQtyInput(String(currentQty));
  }

  function cancelEditItem() {
    setEditingItemId(null);
    setEditQtyInput('1');
  }

  async function saveEditItem(itemId: number) {
    if (!ensureCanMutate()) return;
    const qty = Number(editQtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La cantidad debe ser mayor a 0.');
      return;
    }
    setSavingItemId(itemId);
    try {
      await updateReceivingLotItem(apiClient, lotId, itemId, { qty_received: qty });
      await loadDetail();
      cancelEditItem();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el ítem');
    } finally {
      setSavingItemId(null);
    }
  }

  function confirmDeleteItem(itemId: number) {
    if (!ensureCanMutate()) return;
    Alert.alert(
      'Eliminar ítem',
      '¿Seguro que quieres eliminar esta línea del lote?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setDeletingItemId(itemId);
            try {
              await deleteReceivingLotItem(apiClient, lotId, itemId);
              await loadDetail();
              if (editingItemId === itemId) cancelEditItem();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo eliminar el ítem');
            } finally {
              setDeletingItemId(null);
            }
          },
        },
      ],
    );
  }

  function confirmCloseLot() {
    if (!ensureCanMutate()) return;
    Alert.alert(
      'Cerrar lote',
      closeSummaryMessage,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar lote',
          style: 'default',
          onPress: async () => {
            setClosingLot(true);
            try {
              await closeReceivingLot(apiClient, lotId);
              onBack();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo cerrar el lote');
            } finally {
              setClosingLot(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer backgroundColor="#E9EDF3" scrollEnabled={false}>
      {loading ? <ActivityIndicator color="#0A8F5A" /> : null}
      {!canMutate ? <Text style={styles.warning}>Sin conexión: creación, edición y cierre de lote bloqueados.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {detail ? (
      <ScrollView
        ref={workspaceScrollRef}
        style={styles.workspaceScroll}
        contentContainerStyle={styles.workspaceScrollContent}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.workspaceSticky}>
            {showInlineHeader ? (
              <View style={styles.headerRow}>
                <Text style={styles.title}>Detalle lote</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.lotNumber}>{detail.lot.lot_number}</Text>
              <Text style={styles.meta}>Origen: {detail.lot.origin_name}</Text>
              <Text style={styles.meta}>Tipo: {formatPurchaseType(detail.lot.purchase_type)}</Text>
              {detail.lot.notes ? <Text style={styles.meta}>Observación: {detail.lot.notes}</Text> : null}
              {detail.lot.purchase_type === 'invoice' ? (
                <>
                  <Text style={styles.meta}>Proveedor: {detail.lot.supplier_name || 'Sin definir'}</Text>
                  <Text style={styles.meta}>
                    Referencia: {detail.lot.invoice_reference || detail.lot.source_reference || 'Sin definir'}
                  </Text>
                </>
              ) : null}
              {detail.lot.support_file_name ? (
                <Text style={styles.meta}>Soporte adjunto: {detail.lot.support_file_name}</Text>
              ) : null}
              <Text style={styles.meta}>Líneas: {detail.items.length}</Text>
              <Text style={styles.meta}>Unidades totales: {totalUnits}</Text>
              <Text style={styles.meta}>Etiquetas pendientes: {pendingLabels}</Text>

              <View style={styles.lotActionRow}>
                <Pressable
                  style={[styles.addButton, !canMutate ? styles.actionDisabled : null]}
                  onPress={openAddMode}
                  disabled={!canMutate}
                >
                  <Text style={styles.addButtonText}>Agregar ítem</Text>
                </Pressable>
                <Pressable
                  style={[styles.createButton, !canMutate ? styles.actionDisabled : null]}
                  onPress={() => { openCreateProductModal(); }}
                  disabled={!canMutate}
                >
                  <Text style={styles.createButtonText}>Crear producto</Text>
                </Pressable>
              </View>
            </View>

            {!addMode && pendingLabels > 0 ? (
              <View style={styles.workflowCard}>
                {localWarnings.length > 0 ? (
                  <View style={styles.warningList}>
                    {localWarnings.map((warning, index) => (
                      <Text key={`${warning.code}-${warning.message}-${index}`} style={styles.warningItem}>
                        • {warning.message}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {addMode ? (
            <View style={styles.searchPanel}>
              <View style={styles.searchPanelHeader}>
                <Text style={styles.searchPanelTitle}>Agregar ítem manual</Text>
                <Pressable style={styles.inlineBackButton} onPress={closeAddMode}>
                  <Text style={styles.inlineBackText}>Cerrar</Text>
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>Buscar producto (nombre / SKU / código de barras)</Text>
              <SearchInput
                value={productQuery}
                onChangeText={(value) => {
                  setProductQuery(value);
                  setSelectedProduct(null);
                }}
                onClear={() => {
                  setProductQuery('');
                  setSelectedProduct(null);
                  setRawResults([]);
                }}
                containerStyle={styles.searchInputField}
                style={styles.searchInputText}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Ej: speaker 12, SK-100..."
                placeholderTextColor="#64748b"
              />

              <View style={styles.helperRow}>
                <Text style={styles.helperText}>Mínimo 2 caracteres.</Text>
                <Text style={styles.helperText}>{productResults.length} resultados</Text>
              </View>

              {searching ? <ActivityIndicator color="#0A8F5A" /> : null}

              {productQuery.trim().length >= 2 && !searching && productResults.length === 0 ? (
                <Text style={styles.noResults}>
                  Sin coincidencias. Puedes crear el producto desde aquí.
                </Text>
              ) : null}

              <View style={[styles.resultsWrap, keyboardOpen ? styles.resultsWrapKeyboard : null]}>
                <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                  <View style={styles.resultsContent}>
                    {productResults.map((product) => {
                      const isSelected = selectedProduct?.id === product.id;
                      return (
                        <Pressable
                          key={product.id}
                          style={[styles.resultItem, isSelected ? styles.resultItemSelected : null]}
                          onPress={() => {
                            setSelectedProduct(product);
                            Keyboard.dismiss();
                          }}
                        >
                          <Text style={styles.resultName} numberOfLines={3}>
                            {product.name}
                          </Text>
                          <Text style={styles.resultMeta}>
                            SKU: {product.sku || 'N/A'} · Código de barras: {product.barcode || 'N/A'}
                          </Text>
                          <View style={styles.priceRow}>
                            <Text style={styles.priceText}>Venta: {formatCurrency(product.price)}</Text>
                          </View>
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
                    const current = Number(qtyInput) || 1;
                    setQtyInput(String(Math.max(1, current - 1)));
                  }}
                >
                  <Text style={styles.qtyStepText}>-</Text>
                </Pressable>
                <TextInput
                  value={qtyInput}
                  onChangeText={setQtyInput}
                  style={[styles.modalInput, styles.qtyInput]}
                  keyboardType="numeric"
                />
                <Pressable
                  style={styles.qtyStepBtn}
                  onPress={() => {
                    const current = Number(qtyInput) || 1;
                    setQtyInput(String(current + 1));
                  }}
                >
                  <Text style={styles.qtyStepText}>+</Text>
                </Pressable>
              </View>

              <Pressable
                style={[
                  styles.saveButton,
                  !selectedProduct || !canMutate ? styles.saveButtonDisabled : null,
                ]}
                onPress={handleAddItem}
                disabled={submittingItem || !selectedProduct || !canMutate}
              >
                <Text style={styles.saveButtonText}>{submittingItem ? 'Guardando...' : 'Agregar al lote'}</Text>
              </Pressable>
            </View>
          ) : null}

          {!addMode ? (
            <View style={styles.itemsSection}>
              <Text style={styles.itemsTitle}>Ítems del lote</Text>
              {detail.items.length === 0 ? (
                <Text style={styles.emptyText}>Aún no hay ítems en este lote.</Text>
              ) : null}

              {orderedItems.map((item) => (
                <View key={item.id} style={styles.itemCard}>
                  <Text style={styles.itemName}>{item.product_name_snapshot}</Text>
                  <Text style={styles.itemMeta}>SKU: {item.sku_snapshot || 'N/A'}</Text>
                  <Text style={styles.itemMeta}>Código de barras: {item.barcode_snapshot || 'N/A'}</Text>
                  <Text style={styles.itemLabelProgress}>
                    Etiquetas impresas: {Math.max(0, Number(item.labels_printed_qty || 0))} / {Math.max(0, Math.ceil(Number(item.qty_received || 0)))}
                  </Text>
                  {editingItemId === item.id ? (
                    <>
                      <View style={styles.editQtyRow}>
                        <Text style={styles.editQtyLabel}>Cantidad</Text>
                        <View style={styles.qtyRow}>
                          <Pressable
                            style={styles.qtyStepBtn}
                            onPress={() => {
                              const current = Number(editQtyInput) || 1;
                              setEditQtyInput(String(Math.max(1, current - 1)));
                            }}
                          >
                            <Text style={styles.qtyStepText}>-</Text>
                          </Pressable>
                          <TextInput
                            value={editQtyInput}
                            onChangeText={setEditQtyInput}
                            style={[styles.modalInput, styles.qtyInput, styles.editQtyInput]}
                            keyboardType="numeric"
                          />
                          <Pressable
                            style={styles.qtyStepBtn}
                            onPress={() => {
                              const current = Number(editQtyInput) || 1;
                              setEditQtyInput(String(current + 1));
                            }}
                          >
                            <Text style={styles.qtyStepText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                      <View style={styles.itemActionsRow}>
                        <Pressable style={styles.itemActionSecondary} onPress={cancelEditItem}>
                          <Text style={styles.itemActionSecondaryText}>Cancelar</Text>
                        </Pressable>
                        <Pressable
                          style={styles.itemActionPrimary}
                          onPress={() => saveEditItem(item.id)}
                          disabled={savingItemId === item.id || !canMutate}
                        >
                          <Text style={styles.itemActionPrimaryText}>
                            {savingItemId === item.id ? 'Guardando...' : 'Guardar'}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.itemQty}>Cantidad: {item.qty_received}</Text>
                      <View style={styles.itemActionsRow}>
                        <Pressable
                          style={styles.itemActionPrint}
                          onPress={() =>
                            handleMockPrintLabel(
                              item.id,
                              Number(item.qty_received || 0),
                              item.sku_snapshot,
                              item.barcode_snapshot,
                              item.product_name_snapshot,
                              Number(item.unit_price_snapshot || 0),
                              item.label_format_snapshot,
                            )
                          }
                          disabled={printingItemId === item.id}
                        >
                          <Text style={styles.itemActionPrintText}>
                            {printingItemId === item.id
                              ? 'Imprimiendo...'
                              : Math.max(0, Number(item.labels_printed_qty || 0)) >= Math.max(0, Math.ceil(Number(item.qty_received || 0)))
                                ? 'Reimprimir'
                                : 'Imprimir'}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.itemActionSecondary}
                          onPress={() => startEditItem(item.id, Number(item.qty_received || 0))}
                          disabled={!canMutate}
                        >
                          <Text style={styles.itemActionSecondaryText}>Editar</Text>
                        </Pressable>
                        <Pressable
                          style={styles.itemActionDanger}
                          onPress={() => confirmDeleteItem(item.id)}
                          disabled={deletingItemId === item.id || !canMutate}
                        >
                          <Text style={styles.itemActionDangerText}>
                            {deletingItemId === item.id ? 'Eliminando...' : 'Eliminar'}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              ))}

              <Pressable
                style={[
                  styles.closeLotButton,
                  pendingLabels > 0 ? styles.closeLotButtonWarning : null,
                  closingLot || !canMutate ? styles.closeLotButtonDisabled : null,
                ]}
                onPress={confirmCloseLot}
                disabled={closingLot || !canMutate}
              >
                <Text style={styles.closeLotButtonText}>
                  {closingLot
                    ? 'Cerrando lote...'
                    : pendingLabels > 0
                      ? `Cerrar lote con pendientes (${pendingLabels})`
                      : 'Cerrar lote'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      <Modal
        visible={showCreateProductModal}
        transparent
        animationType="fade"
        onRequestClose={closeCreateProductModal}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardAvoiding}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={[styles.modalCard, styles.modalCardScrollable]}>
              <ScrollView
                ref={createProductScrollRef}
                style={styles.modalCardScroll}
                contentContainerStyle={styles.modalCardScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.modalTitle}>Crear producto nuevo</Text>

                <Text style={styles.modalLabel}>Nombre *</Text>
                <TextInput
                  value={newProductName}
                  onChangeText={setNewProductName}
                  style={styles.modalInput}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  placeholder="Ej: Cabina activa 12..."
                  placeholderTextColor="#64748b"
                />

              <Text style={styles.modalLabel}>Precio venta *</Text>
                <TextInput
                  value={newProductPrice}
                  onChangeText={(value) => setNewProductPrice(formatMoneyInput(value))}
                  style={styles.modalInput}
                  keyboardType="numeric"
                  placeholder="Ej: 630.000"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.modalLabel}>Costo (opcional)</Text>
                <TextInput
                  value={newProductCost}
                  onChangeText={(value) => setNewProductCost(formatMoneyInput(value))}
                  style={styles.modalInput}
                  keyboardType="numeric"
                  placeholder="Opcional"
                  placeholderTextColor="#64748b"
                />

                <View style={styles.createHelpersRow}>
                  <Pressable
                    style={[styles.createHelperButton, duplicateChecking ? styles.actionDisabled : null]}
                    onPress={() => {
                      checkDuplicates().catch(() => undefined);
                    }}
                    disabled={duplicateChecking}
                  >
                    {duplicateChecking ? (
                      <ActivityIndicator size="small" color="#0A8F5A" />
                    ) : (
                      <Text style={styles.createHelperButtonText}>Buscar duplicados</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.createHelperButton, costChecking ? styles.actionDisabled : null]}
                    onPress={() => {
                      suggestCost().catch(() => undefined);
                    }}
                    disabled={costChecking}
                  >
                    {costChecking ? (
                      <ActivityIndicator size="small" color="#0A8F5A" />
                    ) : (
                      <Text style={styles.createHelperButtonText}>Sugerir costo</Text>
                    )}
                  </Pressable>
                </View>

                {duplicateCandidates.length > 0 ? (
                  <View style={styles.duplicateCard}>
                    <Text style={styles.alertTitle}>
                      {hasHighDuplicateRisk ? 'Posible duplicado de riesgo alto' : 'Posibles duplicados'}
                    </Text>
                    {duplicateCandidates.slice(0, 3).map((candidate) => (
                      <Pressable
                        key={candidate.product_id}
                        style={[
                          styles.duplicateRow,
                          selectedDuplicateCandidate?.product_id === candidate.product_id
                            ? styles.duplicateRowSelected
                            : null,
                        ]}
                        onPress={() => {
                          setSelectedDuplicateCandidate(candidate);
                          setCreateProductError(null);
                        }}
                      >
                        <Text style={styles.duplicateName}>{candidate.name}</Text>
                        <Text style={styles.duplicateMeta}>
                          {candidate.sku ? `SKU ${candidate.sku}` : 'Sin SKU'} · {Math.round(candidate.similarity_score * 100)}%
                        </Text>
                        {candidate.match_reasons.length > 0 ? (
                          <Text style={styles.duplicateReasons}>{candidate.match_reasons.slice(0, 2).join(' · ')}</Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {selectedDuplicateCandidate ? (
                  <View style={styles.selectedProductCard}>
                    <View style={styles.selectedProductHeader}>
                      <View style={styles.selectedProductHeaderText}>
                        <Text style={styles.alertTitle}>Producto existente seleccionado</Text>
                        <Text style={styles.selectedProductName} numberOfLines={2}>
                          {selectedDuplicateCandidate.name}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.selectedProductClearButton}
                        onPress={() => setSelectedDuplicateCandidate(null)}
                      >
                        <Text style={styles.selectedProductClearText}>Cambiar</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.selectedProductMeta}>
                      {selectedDuplicateCandidate.sku ? `SKU ${selectedDuplicateCandidate.sku}` : 'Sin SKU'} ·{' '}
                      {selectedDuplicateCandidate.barcode ? `Barras ${selectedDuplicateCandidate.barcode}` : 'Sin barras'}
                    </Text>
                    <Text style={styles.selectedProductMeta}>
                      Precio {formatCurrency(selectedDuplicateCandidate.price)}
                    </Text>
                  </View>
                ) : null}

                {costSuggestion ? (
                  <View style={styles.costCard}>
                    <Text style={styles.alertTitle}>Costo sugerido</Text>
                    <Text style={styles.costValue}>{formatCurrency(costSuggestion.suggested_cost)}</Text>
                    <Text style={styles.costMeta}>
                      Confianza {costSuggestion.confidence_label} · {Math.round(costSuggestion.confidence_score * 100)}%
                    </Text>
                    <Text style={styles.costMeta}>
                      Rango {formatCurrency(costSuggestion.range_min_cost)} - {formatCurrency(costSuggestion.range_max_cost)}
                    </Text>
                  </View>
                ) : null}

                {selectedDuplicateCandidate ? null : (
                  <>
                    <Text style={styles.modalLabel}>SKU (autoasignado)</Text>
                    <TextInput value={previewSku} style={styles.modalInput} editable={false} />

                    <Text style={styles.modalLabel}>Código de barras (autoasignado)</Text>
                    <TextInput value={previewBarcode} style={styles.modalInput} editable={false} />

                    <Text style={styles.modalLabel}>Grupo *</Text>
                    <Pressable
                      style={[styles.groupSelectorButton, !canMutate ? styles.actionDisabled : null]}
                      onPress={() => setShowGroupPicker(true)}
                      disabled={!canMutate}
                    >
                      <Text style={styles.groupSelectorText}>
                        {selectedGroupPath || selectedGroupLabel || 'Seleccionar grupo o subgrupo existente'}
                      </Text>
                    </Pressable>

                    <Text style={styles.modalLabel}>Formato etiqueta</Text>
                    <View style={styles.lockedFieldRow}>
                      <Pressable
                        style={[
                          styles.groupSelectorButton,
                          styles.lockedFieldInput,
                          newProductLabelFormatLocked ? styles.inputReadonly : null,
                        ]}
                        onPress={() => {
                          if (!newProductLabelFormatLocked) {
                            setShowLabelFormatPicker(true);
                          }
                        }}
                        disabled={newProductLabelFormatLocked}
                      >
                        <Text style={styles.groupSelectorText}>
                          {normalizeLabelFormat(newProductLabelFormat, selectedGroupPath)}
                        </Text>
                      </Pressable>
                      <Pressable style={styles.lockButton} onPress={toggleNewProductLabelFormatLock}>
                        <Text style={styles.lockButtonText}>{newProductLabelFormatLocked ? '🔒' : '🔓'}</Text>
                      </Pressable>
                    </View>
                    {createProductError ? <Text style={styles.modalError}>{createProductError}</Text> : null}
                    {loadingProductGroups ? <ActivityIndicator color="#0A8F5A" /> : null}
                  </>
                )}

              </ScrollView>

            <View style={styles.createModalFooter}>
              <View style={styles.qtyFooterBlock}>
                <Text style={styles.modalLabel}>Cantidad para este lote</Text>
                <View style={styles.qtyRow}>
                  <Pressable
                    style={styles.qtyStepBtn}
                    onPress={() => {
                      const current = Number(newProductQty) || 1;
                      setNewProductQty(String(Math.max(1, current - 1)));
                    }}
                  >
                    <Text style={styles.qtyStepText}>-</Text>
                  </Pressable>
                  <TextInput
                    value={newProductQty}
                    onChangeText={setNewProductQty}
                    style={[styles.modalInput, styles.qtyInput]}
                    keyboardType="numeric"
                  />
                  <Pressable
                    style={styles.qtyStepBtn}
                    onPress={() => {
                      const current = Number(newProductQty) || 1;
                      setNewProductQty(String(current + 1));
                    }}
                  >
                    <Text style={styles.qtyStepText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable style={styles.cancelButton} onPress={closeCreateProductModal} disabled={creatingProduct}>
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={styles.saveButton}
                  onPress={handleCreateAndAddProduct}
                  disabled={creatingProduct || loadingProductCodes || loadingProductGroups || !canMutate}
                >
                  <Text style={styles.saveButtonText}>
                    {loadingProductCodes || loadingProductGroups
                      ? 'Validando conexión...'
                      : creatingProduct
                        ? selectedDuplicateCandidate
                          ? 'Agregando...'
                          : 'Creando...'
                        : selectedDuplicateCandidate
                          ? 'Agregar al lote'
                          : 'Crear y agregar'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showLabelFormatPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLabelFormatPicker(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Seleccionar formato</Text>
            {LABEL_FORMAT_OPTIONS.map((option) => {
              const selected = normalizeLabelFormat(newProductLabelFormat, selectedGroupPath) === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.labelFormatOption, selected ? styles.labelFormatOptionSelected : null]}
                  onPress={() => {
                    setNewProductLabelFormat(option);
                    setShowLabelFormatPicker(false);
                  }}
                >
                  <Text style={styles.labelFormatOptionText}>{option}</Text>
                </Pressable>
              );
            })}
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={() => setShowLabelFormatPicker(false)}>
                <Text style={styles.cancelButtonText}>Cerrar</Text>
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
            <Text style={styles.modalTitle}>Seleccionar grupo</Text>
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
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={styles.groupListContent}>
                  {filteredProductGroups.map((group) => (
                    <Pressable
                      key={group.path}
                      style={styles.groupItem}
                      onPress={() => {
                        setSelectedGroupPath(group.path);
                        setSelectedGroupLabel(group.display_name);
                        if (newProductLabelFormatLocked) {
                          setNewProductLabelFormat(resolveLabelFormatByGroup(group.path));
                        }
                        setCreateProductError(null);
                        setShowGroupPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.groupItemTitle,
                          styles.groupItemTitleIndented,
                          { marginLeft: Math.max(0, group.path.split('/').length - 1) * 10 },
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
                  ))}
                  {filteredProductGroups.length === 0 ? (
                    <Text style={styles.emptyText}>No hay grupos que coincidan.</Text>
                  ) : null}
                </View>
              </ScrollView>
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={() => setShowGroupPicker(false)}>
                <Text style={styles.cancelButtonText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  workspaceScroll: {
    width: '100%',
  },
  workspaceScrollContent: {
    paddingTop: 0,
    paddingBottom: 130,
    gap: 12,
  },
  workspaceSticky: {
    backgroundColor: '#E9EDF3',
    paddingTop: 0,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DFEA',
    gap: 12,
    position: 'relative',
    zIndex: 20,
    elevation: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#CFD8E3',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  lotNumber: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    color: '#334155',
  },
  lotActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  addButton: {
    flex: 1,
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  createButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
  },
  supportActionsRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  supportButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  supportButtonDisabled: {
    opacity: 0.7,
  },
  supportButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
  },
  supportLinkButton: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportLinkButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  closeLotButton: {
    marginTop: 8,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeLotButtonWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  closeLotButtonDisabled: {
    opacity: 0.7,
  },
  closeLotButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  searchPanel: {
    marginTop: 12,
    backgroundColor: '#D8E1EC',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  workflowCard: {
    marginTop: 12,
    backgroundColor: '#E2E8F0',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  warningList: {
    marginTop: 2,
    gap: 3,
  },
  warningItem: {
    color: '#9A3412',
    fontSize: 13,
    lineHeight: 18,
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
  searchInputField: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  searchInputText: {
    paddingVertical: 8,
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
  lockedFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedFieldInput: {
    flex: 1,
  },
  inputReadonly: {
    opacity: 0.7,
  },
  lockButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#EEF3F9',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockButtonText: {
    fontSize: 16,
  },
  modalError: {
    color: '#be123c',
    fontSize: 13,
    marginTop: -2,
  },
  alertTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  createHelpersRow: {
    flexDirection: 'row',
    gap: 8,
  },
  createHelperButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#F8FAFC',
    borderColor: '#9ED9B3',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createHelperButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
    textAlign: 'center',
  },
  duplicateCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: '#FFF7D6',
    padding: 12,
    gap: 6,
  },
  duplicateRow: {
    borderRadius: 10,
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  duplicateRowSelected: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  selectedProductCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#ECFDF3',
    padding: 12,
    gap: 6,
  },
  selectedProductHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectedProductHeaderText: {
    flex: 1,
    gap: 2,
  },
  selectedProductName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  selectedProductClearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedProductClearText: {
    color: '#0A8F5A',
    fontWeight: '700',
    fontSize: 12,
  },
  selectedProductMeta: {
    color: '#065F46',
    fontSize: 12,
  },
  duplicateName: {
    color: '#0F172A',
    fontWeight: '700',
  },
  duplicateMeta: {
    color: '#7C2D12',
    fontSize: 12,
  },
  duplicateReasons: {
    color: '#92400E',
    fontSize: 12,
  },
  costCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#ECFDF3',
    padding: 12,
    gap: 4,
  },
  costValue: {
    color: '#0A8F5A',
    fontSize: 20,
    fontWeight: '800',
  },
  costMeta: {
    color: '#065F46',
    fontSize: 12,
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
  createProductInlineButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  createProductInlineButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
    fontSize: 13,
  },
  resultsWrap: {
    maxHeight: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#EEF3F9',
    overflow: 'hidden',
  },
  resultsWrapKeyboard: {
    maxHeight: 150,
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
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
  qtyInput: {
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
  modalKeyboardAvoiding: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    padding: 16,
    gap: 10,
  },
  modalCardScrollable: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '92%',
    overflow: 'hidden',
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'column',
  },
  modalCardScroll: {
    flex: 1,
    minHeight: 0,
  },
  modalCardScrollContent: {
    flexGrow: 1,
    gap: 10,
    paddingBottom: 12,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  createModalFooter: {
    borderTopWidth: 1,
    borderTopColor: '#D8DFEA',
    paddingTop: 12,
    marginTop: 12,
    gap: 12,
  },
  qtyFooterBlock: {
    gap: 6,
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
  },
  groupListWrap: {
    maxHeight: 320,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  groupListContent: {
    padding: 6,
    gap: 6,
  },
  groupItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    padding: 10,
    gap: 2,
  },
  groupItemTitle: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  groupItemTitleIndented: {
    lineHeight: 18,
  },
  groupItemPath: {
    color: '#64748B',
    fontSize: 12,
  },
  groupItemMeta: {
    color: '#475569',
    fontSize: 11,
  },
  labelFormatOption: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  labelFormatOptionSelected: {
    borderColor: '#67C48D',
    backgroundColor: '#E7F5EC',
  },
  labelFormatOptionText: {
    color: '#0F172A',
    fontWeight: '700',
  },
  itemsSection: {
    marginTop: 12,
    gap: 8,
  },
  itemsTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
  },
  emptyText: {
    color: '#475569',
  },
  itemCard: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  itemName: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 15,
  },
  itemMeta: {
    color: '#334155',
    fontSize: 13,
  },
  itemQty: {
    color: '#0A8F5A',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  itemLabelProgress: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  editQtyRow: {
    marginTop: 6,
    gap: 6,
  },
  editQtyLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  editQtyInput: {
    paddingVertical: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  itemActionsRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  itemActionPrimary: {
    flex: 1,
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  itemActionPrimaryText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  itemActionSecondary: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  itemActionSecondaryText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  itemActionPrint: {
    flex: 1,
    backgroundColor: '#DCEFE3',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  itemActionPrintText: {
    color: '#0A8F5A',
    fontWeight: '700',
    fontSize: 13,
  },
  itemActionDanger: {
    flex: 1,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  itemActionDangerText: {
    color: '#B91C1C',
    fontWeight: '700',
    fontSize: 13,
  },
  actionDisabled: {
    opacity: 0.55,
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
    marginBottom: 6,
  },
  error: {
    color: '#be123c',
    fontSize: 13,
  },
});
