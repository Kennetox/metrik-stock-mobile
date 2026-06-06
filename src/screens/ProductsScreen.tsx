import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { ScreenContainer } from '../ui/ScreenContainer';
import {
  createProduct,
  deleteProduct,
  getProductCostSuggestion,
  getProductDuplicateCandidates,
  listProductGroups,
  listProducts,
  type Product,
  type ProductCostSuggestionResponse,
  type ProductDuplicateCandidate,
  type ProductGroup,
  type ProductUpsertPayload,
  updateProduct,
} from '../services/api/products';
import { getReceivingNextProductCodes } from '../services/api/receiving';

type ActiveFilter = 'all' | 'active' | 'inactive';
type SortOption = 'recent' | 'name' | 'sku' | 'price_asc' | 'price_desc';
type FormMode = 'create' | 'edit';
type CostMode = 'balanced' | 'conservative' | 'aggressive';
type ViewMode = 'table' | 'cards';
type PickerKind = 'group' | 'brand' | 'supplier';
type PickerContext = 'filter' | 'form';

const PAGE_SIZE = 12;

const PAGE_LIMIT = 5000;

const DEFAULT_FORM: ProductFormState = {
  sku: '',
  name: '',
  price: '',
  cost: '',
  barcode: '',
  label_format: 'Kensar1',
  unit: '',
  stock_min: '0',
  preferred_qty: '0',
  reorder_point: '0',
  active: true,
  service: false,
  includes_tax: false,
  is_investment: false,
  group_name: '',
  brand: '',
  supplier: '',
  low_stock_alert: false,
  allow_price_change: false,
};

type ProductFormState = {
  sku: string;
  name: string;
  price: string;
  cost: string;
  barcode: string;
  label_format: string;
  unit: string;
  stock_min: string;
  preferred_qty: string;
  reorder_point: string;
  active: boolean;
  service: boolean;
  includes_tax: boolean;
  is_investment: boolean;
  group_name: string;
  brand: string;
  supplier: string;
  low_stock_alert: boolean;
  allow_price_change: boolean;
};

function formatMoney(value?: number | null): string {
  return Number(value || 0).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function parseNumberInput(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyInput(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatIntegerInput(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function unformatNumericInput(value: string): string {
  return value.replace(/\./g, '').replace(',', '.').trim();
}

function formatNumericText(value: string, allowDecimals: boolean): string {
  const normalized = unformatNumericInput(value);
  if (!normalized) return '';
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: allowDecimals ? 2 : 0,
  }).format(parsed);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function displayGroup(product: Product): string {
  return product.group_meta?.display_name || product.group_name || 'Sin grupo';
}

function formatStatus(product: Product): { label: string; color: string; background: string } {
  if (product.active) {
    return { label: 'Activo', color: '#0A8F5A', background: '#DCEFE3' };
  }
  return { label: 'Inactivo', color: '#B91C1C', background: '#FEE2E2' };
}

function buildFormFromProduct(product: Product): ProductFormState {
  return {
    sku: product.sku ?? '',
    name: product.name ?? '',
    price: formatMoneyInput(product.price),
    cost: formatMoneyInput(product.cost),
    barcode: product.barcode ?? '',
    label_format: product.label_format || 'Kensar1',
    unit: product.unit ?? '',
    stock_min: formatIntegerInput(product.stock_min),
    preferred_qty: formatIntegerInput(product.preferred_qty),
    reorder_point: formatIntegerInput(product.reorder_point),
    active: Boolean(product.active),
    service: Boolean(product.service),
    includes_tax: Boolean(product.includes_tax),
    is_investment: Boolean(product.is_investment),
    group_name: product.group_name ?? '',
    brand: product.brand ?? '',
    supplier: product.supplier ?? '',
    low_stock_alert: Boolean(product.low_stock_alert),
    allow_price_change: Boolean(product.allow_price_change),
  };
}

function buildPayload(form: ProductFormState, options?: { autoGenerateCodes?: boolean }): ProductUpsertPayload {
  return {
    sku: options?.autoGenerateCodes ? null : form.sku.trim() || null,
    name: form.name.trim(),
    price: parseNumberInput(form.price),
    cost: parseNumberInput(form.cost),
    barcode: options?.autoGenerateCodes ? null : form.barcode.trim() || null,
    label_format: form.label_format.trim() || null,
    unit: form.unit.trim() || null,
    stock_min: Math.round(parseNumberInput(form.stock_min)),
    preferred_qty: Math.round(parseNumberInput(form.preferred_qty)),
    reorder_point: Math.round(parseNumberInput(form.reorder_point)),
    low_stock_alert: form.low_stock_alert,
    allow_price_change: form.allow_price_change,
    active: form.active,
    service: form.service,
    includes_tax: form.includes_tax,
    is_investment: form.is_investment,
    group_name: form.group_name.trim() || null,
    brand: form.brand.trim() || null,
    supplier: form.supplier.trim() || null,
    auto_generate_codes: Boolean(options?.autoGenerateCodes),
  };
}

export function ProductsScreen() {
  const { width } = useWindowDimensions();
  const { apiClient, syncStatus } = useAppSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [groupFilter, setGroupFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const [pickerContext, setPickerContext] = useState<PickerContext>('filter');
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ProductDuplicateCandidate[]>([]);
  const [hasHighDuplicateRisk, setHasHighDuplicateRisk] = useState(false);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [costMode, setCostMode] = useState<CostMode>('balanced');
  const [costSuggestion, setCostSuggestion] = useState<ProductCostSuggestionResponse | null>(null);
  const [costChecking, setCostChecking] = useState(false);
  const [nextProductCodes, setNextProductCodes] = useState<{ sku: string; barcode: string } | null>(null);
  const [loadingNextProductCodes, setLoadingNextProductCodes] = useState(false);

  const canMutate = syncStatus === 'online' || syncStatus === 'degraded';
  const isTableMode = viewMode === 'table';
  const isCompactHeader = width < 420;
  const isCompactLayout = width < 520;
  const hasAdvancedFilters =
    activeFilter !== 'all' ||
    Boolean(groupFilter.trim()) ||
    Boolean(brandFilter.trim()) ||
    Boolean(supplierFilter.trim()) ||
    sortBy !== 'recent';
  const groupFilterLabel = useMemo(() => {
    if (!groupFilter.trim()) return 'Todos los grupos';
    return groups.find((group) => group.path === groupFilter)?.display_name || groupFilter;
  }, [groupFilter, groups]);
  const brandFilterLabel = brandFilter.trim() || 'Todas las marcas';
  const supplierFilterLabel = supplierFilter.trim() || 'Todos los proveedores';
  const openPicker = useCallback((kind: PickerKind, context: PickerContext = 'filter') => {
    setPickerContext(context);
    setPickerKind(kind);
    setPickerQuery('');
  }, []);

  const loadNextProductCodes = useCallback(async (applyToForm: boolean) => {
    setLoadingNextProductCodes(true);
    try {
      const codes = await getReceivingNextProductCodes(apiClient);
      setNextProductCodes(codes);
      if (applyToForm) {
        setForm((prev) => ({
          ...prev,
          sku: codes.sku,
          barcode: codes.barcode,
        }));
      }
      return codes;
    } catch (err) {
      setFormMessage(err instanceof Error ? err.message : 'No se pudieron generar SKU y código de barras');
      return null;
    } finally {
      setLoadingNextProductCodes(false);
    }
  }, [apiClient]);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [productRows, groupRows] = await Promise.all([
        listProducts(apiClient, { skip: 0, limit: PAGE_LIMIT }),
        listProductGroups(apiClient, { skip: 0, limit: 5000 }),
      ]);
      setProducts(productRows);
      setGroups(groupRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar productos');
    }
  }, [apiClient]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadData().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const filteredProducts = useMemo(() => {
    const term = normalizeText(query);
    const groupTerm = normalizeText(groupFilter);
    const brandTerm = normalizeText(brandFilter);
    const supplierTerm = normalizeText(supplierFilter);

    const rows = products.filter((product) => {
      if (activeFilter === 'active' && !product.active) return false;
      if (activeFilter === 'inactive' && product.active) return false;

      if (groupTerm && !normalizeText(product.group_name || '').includes(groupTerm) && !normalizeText(displayGroup(product)).includes(groupTerm)) {
        return false;
      }
      if (brandTerm && !normalizeText(product.brand || '').includes(brandTerm)) return false;
      if (supplierTerm && !normalizeText(product.supplier || '').includes(supplierTerm)) return false;
      if (term) {
        const haystack = [
          product.sku,
          product.name,
          product.barcode,
          product.group_name,
          displayGroup(product),
          product.brand,
          product.supplier,
          product.unit,
          product.label_format,
        ]
          .filter(Boolean)
          .join(' ');
        if (!normalizeText(haystack).includes(term)) return false;
      }
      return true;
    });

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'sku') return (a.sku || '').localeCompare(b.sku || '');
      if (sortBy === 'price_asc') return Number(a.price || 0) - Number(b.price || 0);
      if (sortBy === 'price_desc') return Number(b.price || 0) - Number(a.price || 0);
      const aValue = a.id;
      const bValue = b.id;
      return bValue - aValue;
    });
    return sorted;
  }, [activeFilter, brandFilter, groupFilter, products, query, sortBy, supplierFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginatedProducts = filteredProducts.slice(pageStart, pageStart + PAGE_SIZE);
  const pageStartLabel = filteredProducts.length === 0 ? 0 : pageStart + 1;
  const pageEndLabel = Math.min(pageStart + PAGE_SIZE, filteredProducts.length);

  const groupSelectOptions = useMemo(() => {
    return [...groups]
      .sort((left, right) => left.display_name.localeCompare(right.display_name))
      .map((group) => ({
        value: group.path,
        label: group.display_name,
        subtitle: group.path,
      }));
  }, [groups]);

  const brandSelectOptions = useMemo(() => {
    const brands = new Map<string, string>();
    products.forEach((product) => {
      const value = (product.brand || '').trim();
      if (value) brands.set(value.toLowerCase(), value);
    });
    return Array.from(brands.values())
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ value, label: value, subtitle: '' }));
  }, [products]);

  const supplierSelectOptions = useMemo(() => {
    const suppliers = new Map<string, string>();
    products.forEach((product) => {
      const value = (product.supplier || '').trim();
      if (value) suppliers.set(value.toLowerCase(), value);
    });
    return Array.from(suppliers.values())
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ value, label: value, subtitle: '' }));
  }, [products]);

  const formGroupLabel = useMemo(() => {
    const value = form.group_name.trim();
    if (!value) return 'Seleccionar grupo';
    return groups.find((group) => group.path === value)?.display_name || value;
  }, [form.group_name, groups]);
  const formBrandLabel = useMemo(() => {
    const value = form.brand.trim();
    if (!value) return 'Seleccionar marca';
    return brandSelectOptions.find((option) => option.value === value)?.label || value;
  }, [brandSelectOptions, form.brand]);
  const formSupplierLabel = useMemo(() => {
    const value = form.supplier.trim();
    if (!value) return 'Seleccionar proveedor';
    return supplierSelectOptions.find((option) => option.value === value)?.label || value;
  }, [form.supplier, supplierSelectOptions]);

  const pickerOptions = useMemo(() => {
    if (pickerKind === 'group') return groupSelectOptions;
    if (pickerKind === 'brand') return brandSelectOptions;
    if (pickerKind === 'supplier') return supplierSelectOptions;
    return [];
  }, [brandSelectOptions, groupSelectOptions, pickerKind, supplierSelectOptions]);

  const filteredPickerOptions = useMemo(() => {
    const term = normalizeText(pickerQuery);
    if (!term) return pickerOptions;
    return pickerOptions.filter((item) => {
      const haystack = `${item.label} ${item.subtitle || ''} ${item.value}`;
      return normalizeText(haystack).includes(term);
    });
  }, [pickerOptions, pickerQuery]);

  function openCreateModal() {
    if (!canMutate) {
      setError('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }
    setFormMode('create');
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setFormMessage(null);
    setDuplicateCandidates([]);
    setHasHighDuplicateRisk(false);
    setCostSuggestion(null);
    setNextProductCodes(null);
    setShowFormModal(true);
    loadNextProductCodes(true).catch(() => undefined);
  }

  function openEditModal(product: Product) {
    if (!canMutate) {
      setError('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }
    setFormMode('edit');
    setEditingId(product.id);
    setForm(buildFormFromProduct(product));
    setFormMessage(null);
    setDuplicateCandidates([]);
    setHasHighDuplicateRisk(false);
    setCostSuggestion(null);
    setNextProductCodes(null);
    setShowDetailModal(false);
    setShowFormModal(true);
  }

  const checkDuplicates = useCallback(async (nextForm: ProductFormState): Promise<ProductDuplicateCandidate[]> => {
    const name = nextForm.name.trim();
    if (!name) {
      setDuplicateCandidates([]);
      setHasHighDuplicateRisk(false);
      return [];
    }
    setDuplicateChecking(true);
    try {
      const response = await getProductDuplicateCandidates(apiClient, {
        sku: nextForm.sku.trim() || null,
        barcode: nextForm.barcode.trim() || null,
        name,
        group_name: nextForm.group_name.trim() || null,
        brand: nextForm.brand.trim() || null,
        supplier: nextForm.supplier.trim() || null,
        limit: 6,
      });
      const rows = editingId != null
        ? response.candidates.filter((candidate) => candidate.product_id !== editingId)
        : response.candidates;
      setDuplicateCandidates(rows);
      setHasHighDuplicateRisk(response.has_high_risk && rows.length > 0);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron revisar duplicados');
      return [];
    } finally {
      setDuplicateChecking(false);
    }
  }, [apiClient, editingId]);

  async function suggestCost(nextForm = form) {
    const price = parseNumberInput(nextForm.price);
    if (price <= 0) {
      setFormMessage('Ingresa un precio válido para sugerir costo.');
      return;
    }
    setCostChecking(true);
    setFormMessage(null);
    try {
      const response = await getProductCostSuggestion(apiClient, {
        mode: costMode,
        price,
        group_name: nextForm.group_name.trim() || null,
        brand: nextForm.brand.trim() || null,
        supplier: nextForm.supplier.trim() || null,
        exclude_product_id: editingId ?? undefined,
      });
      setCostSuggestion(response);
      setForm((prev) => ({
        ...prev,
        cost: String(Math.round(response.suggested_cost * 100) / 100),
      }));
    } catch (err) {
      setFormMessage(err instanceof Error ? err.message : 'No se pudo sugerir costo');
    } finally {
      setCostChecking(false);
    }
  }

  async function submitForm() {
    if (!canMutate) {
      setFormMessage('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }
    if (formMode === 'create' && loadingNextProductCodes) {
      setFormMessage('Generando SKU y código de barras. Espera un momento.');
      return;
    }
    if (formMode === 'create' && (!form.sku.trim() || !form.barcode.trim())) {
      setFormMessage('No se pudieron generar los códigos automáticos. Intenta de nuevo.');
      return;
    }
    const name = form.name.trim();
    if (!name) {
      setFormMessage('Debes indicar un nombre.');
      return;
    }
    if (!form.group_name.trim()) {
      setFormMessage('Debes indicar un grupo de producto.');
      return;
    }

    setSaving(true);
    setFormMessage(null);
    try {
      const duplicatedRows = await checkDuplicates(form);
      if (duplicatedRows.length > 0) {
        const top = duplicatedRows[0];
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            hasHighDuplicateRisk ? 'Riesgo alto de duplicado' : 'Posible duplicado',
            `Detectamos coincidencias con "${top.name}"${top.sku ? ` (SKU ${top.sku})` : ''}.`,
            [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Guardar igual', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      const payload = buildPayload(form, { autoGenerateCodes: formMode === 'create' });
      if (formMode === 'create') {
        const created = await createProduct(apiClient, payload);
        setProducts((prev) => [created, ...prev]);
        setSelectedProduct(created);
        setShowDetailModal(true);
        setFormMessage('Producto creado correctamente.');
      } else if (editingId != null) {
        const updated = await updateProduct(apiClient, editingId, payload);
        setProducts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setSelectedProduct(updated);
        setShowDetailModal(true);
        setFormMessage('Producto actualizado correctamente.');
      }
      closeFormModal();
      await loadData();
    } catch (err) {
      setFormMessage(err instanceof Error ? err.message : 'No se pudo guardar el producto');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProduct(product: Product) {
    if (!canMutate) {
      setError('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Eliminar producto',
        `¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`,
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteProduct(apiClient, product.id);
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      setSelectedProduct(null);
      setShowDetailModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el producto');
    } finally {
      setDeleting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }

  function closeFormModal() {
    setShowFormModal(false);
    setNextProductCodes(null);
  }

  function updateForm<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const openProductDetail = useCallback((item: Product) => {
    setSelectedProduct(item);
    setShowDetailModal(true);
  }, []);

  const renderProductCard = useCallback(
    ({ item }: { item: Product }) => {
      const status = formatStatus(item);
      return (
        <Pressable
          style={styles.rowCard}
          onPress={() => openProductDetail(item)}
        >
          <View style={styles.rowTop}>
            <View style={styles.rowTitleWrap}>
              <Text style={styles.rowSku}>{item.sku || 'Sin SKU'}</Text>
              <Text style={styles.rowName} numberOfLines={2}>
                {item.name}
              </Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: status.background }]}>
              <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <View style={styles.rowMetaGrid}>
            <View style={styles.rowMetaItem}>
              <Text style={styles.rowMetaLabel}>Precio</Text>
              <Text style={styles.rowMetaValue}>${formatMoney(item.price)}</Text>
            </View>
            <View style={styles.rowMetaItem}>
              <Text style={styles.rowMetaLabel}>Costo</Text>
              <Text style={styles.rowMetaValue}>${formatMoney(item.cost)}</Text>
            </View>
            <View style={styles.rowMetaItem}>
              <Text style={styles.rowMetaLabel}>Grupo</Text>
              <Text style={styles.rowMetaValue} numberOfLines={1}>
                {displayGroup(item)}
              </Text>
            </View>
            <View style={styles.rowMetaItem}>
              <Text style={styles.rowMetaLabel}>Barras</Text>
              <Text style={styles.rowMetaValue} numberOfLines={1}>
                {item.barcode || '—'}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [openProductDetail],
  );

  const renderTableProduct = useCallback(
    ({ item }: { item: Product }) => {
      const status = formatStatus(item);
      return (
        <Pressable style={styles.tableRow} onPress={() => openProductDetail(item)}>
          <Text style={[styles.tableCell, styles.tableSkuCell]} numberOfLines={1}>
            {item.sku || '—'}
          </Text>
          <Text style={[styles.tableCell, styles.tableNameCell]} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={[styles.tableCell, styles.tableGroupCell]} numberOfLines={2}>
            {displayGroup(item)}
          </Text>
          <Text style={[styles.tableCell, styles.tableBrandCell]} numberOfLines={1}>
            {item.brand || '—'}
          </Text>
          <Text style={[styles.tableCell, styles.tablePriceCell]} numberOfLines={1}>
            ${formatMoney(item.price)}
          </Text>
          <Text style={[styles.tableCell, styles.tablePriceCell]} numberOfLines={1}>
            ${formatMoney(item.cost)}
          </Text>
          <Text style={[styles.tableCell, styles.tableBarcodeCell]} numberOfLines={1}>
            {item.barcode || '—'}
          </Text>
          <View style={[styles.tableCell, styles.tableStatusCell]}>
            <View style={[styles.statusPill, { backgroundColor: status.background }]}>
              <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [openProductDetail],
  );

  useEffect(() => {
    if (hasAdvancedFilters) {
      setShowAdvancedFilters(true);
    }
  }, [hasAdvancedFilters]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, brandFilter, filteredProducts.length, groupFilter, query, sortBy, supplierFilter, viewMode]);

  useEffect(() => {
    if (!showFormModal) return undefined;

    const name = form.name.trim();
    if (name.length < 2) {
      setDuplicateCandidates([]);
      setHasHighDuplicateRisk(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      checkDuplicates(form).catch(() => undefined);
    }, 450);

    return () => clearTimeout(timer);
  }, [
    checkDuplicates,
    form,
    showFormModal,
  ]);

  return (
    <ScreenContainer backgroundColor="#E9EDF3" scrollEnabled={isCompactLayout}>
      <View style={styles.page}>
        <View style={[styles.header, isCompactHeader ? styles.headerCompact : null]}>
          <View>
            <Text style={styles.title}>Productos</Text>
            <Text style={styles.subtitle}>
              Catálogo rápido para consulta, creación y edición.
            </Text>
          </View>
          <View style={[styles.headerActions, isCompactHeader ? styles.headerActionsCompact : null]}>
            <Pressable
              style={[
                styles.refreshButton,
                isCompactHeader ? styles.refreshButtonCompact : null,
                refreshing ? styles.buttonDisabled : null,
              ]}
              onPress={() => {
                handleRefresh().catch(() => undefined);
              }}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#0A8F5A" />
              ) : (
                <Text style={styles.refreshButtonText}>Refrescar</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.primaryButton, isCompactHeader ? styles.primaryButtonCompact : null]}
              onPress={openCreateModal}
            >
              <Text style={styles.primaryButtonText}>+ Nuevo</Text>
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.alertCard}>
            <Text style={styles.alertText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.filtersCard}>
            <TextInput
              value={query}
              onChangeText={setQuery}
            style={styles.searchInput}
            placeholder="Buscar por nombre, SKU, barra..."
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.actionRow}>
            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeChip, isTableMode ? styles.modeChipActive : null]}
                onPress={() => setViewMode('table')}
              >
                <Text style={[styles.modeChipText, isTableMode ? styles.modeChipTextActive : null]}>Tabla</Text>
              </Pressable>
              <Pressable
                style={[styles.modeChip, !isTableMode ? styles.modeChipActive : null]}
                onPress={() => setViewMode('cards')}
              >
                <Text style={[styles.modeChipText, !isTableMode ? styles.modeChipTextActive : null]}>Tarjetas</Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.advancedToggleButton, showAdvancedFilters ? styles.advancedToggleButtonActive : null]}
              onPress={() => setShowAdvancedFilters((prev) => !prev)}
            >
              <Text style={[styles.advancedToggleText, showAdvancedFilters ? styles.advancedToggleTextActive : null]}>
                {showAdvancedFilters ? 'Ocultar filtros avanzados' : 'Mostrar filtros avanzados'}
              </Text>
            </Pressable>
            {hasAdvancedFilters ? (
              <Pressable
                style={styles.advancedClearButton}
                onPress={() => {
                  setActiveFilter('all');
                  setGroupFilter('');
                  setBrandFilter('');
                  setSupplierFilter('');
                  setSortBy('recent');
                }}
              >
                <Text style={styles.advancedClearText}>Limpiar</Text>
              </Pressable>
            ) : null}
          </View>

          {showAdvancedFilters ? (
            <View style={styles.advancedPanel}>
              <View style={styles.segmentRow}>
                {([
                  ['all', 'Todos'],
                  ['active', 'Activos'],
                  ['inactive', 'Inactivos'],
                ] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    style={[styles.segmentButton, activeFilter === value ? styles.segmentButtonActive : null]}
                    onPress={() => setActiveFilter(value)}
                  >
                    <Text style={[styles.segmentButtonText, activeFilter === value ? styles.segmentButtonTextActive : null]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.selectGrid}>
                <Pressable style={styles.selectField} onPress={() => openPicker('group')}>
                  <Text style={styles.selectLabel}>Grupo</Text>
                  <Text style={[styles.selectValue, !groupFilter.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                    {groupFilterLabel}
                  </Text>
                </Pressable>
                <Pressable style={styles.selectField} onPress={() => openPicker('brand')}>
                  <Text style={styles.selectLabel}>Marca</Text>
                  <Text style={[styles.selectValue, !brandFilter.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                    {brandFilterLabel}
                  </Text>
                </Pressable>
                <Pressable style={styles.selectField} onPress={() => openPicker('supplier')}>
                  <Text style={styles.selectLabel}>Proveedor</Text>
                  <Text style={[styles.selectValue, !supplierFilter.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                    {supplierFilterLabel}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.sortRow}>
                <Text style={styles.sortLabel}>Ordenar:</Text>
                <View style={styles.sortChips}>
                  {([
                    ['recent', 'Recientes'],
                    ['name', 'Nombre'],
                    ['sku', 'SKU'],
                    ['price_asc', 'Precio +'],
                    ['price_desc', 'Precio -'],
                  ] as const).map(([value, label]) => (
                    <Pressable
                      key={value}
                      style={[styles.sortChip, sortBy === value ? styles.sortChipActive : null]}
                      onPress={() => setSortBy(value)}
                    >
                      <Text style={[styles.sortChipText, sortBy === value ? styles.sortChipTextActive : null]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

            </View>
          ) : null}
          </View>

          <View style={styles.paginationBar}>
            <Text style={styles.paginationText}>
              Página {currentPage} de {totalPages} · {pageStartLabel}-{pageEndLabel} de {filteredProducts.length}
            </Text>
            <View style={styles.paginationButtons}>
              <Pressable
                style={[styles.paginationButton, currentPage === 1 ? styles.paginationButtonDisabled : null]}
                onPress={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                <Text style={styles.paginationButtonText}>Primera</Text>
              </Pressable>
              <Pressable
                style={[styles.paginationButton, currentPage === 1 ? styles.paginationButtonDisabled : null]}
                onPress={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <Text style={styles.paginationButtonText}>Anterior</Text>
              </Pressable>
              <Pressable
                style={[styles.paginationButton, currentPage === totalPages ? styles.paginationButtonDisabled : null]}
                onPress={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                <Text style={styles.paginationButtonText}>Siguiente</Text>
              </Pressable>
              <Pressable
                style={[styles.paginationButton, currentPage === totalPages ? styles.paginationButtonDisabled : null]}
                onPress={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                <Text style={styles.paginationButtonText}>Última</Text>
              </Pressable>
            </View>
          </View>

        {isTableMode ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
            <View style={styles.tableShell}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.tableSkuCell]}>SKU</Text>
                <Text style={[styles.tableHeaderCell, styles.tableNameCell]}>Nombre</Text>
                <Text style={[styles.tableHeaderCell, styles.tableGroupCell]}>Grupo</Text>
                <Text style={[styles.tableHeaderCell, styles.tableBrandCell]}>Marca</Text>
                <Text style={[styles.tableHeaderCell, styles.tablePriceCell]}>Precio</Text>
                <Text style={[styles.tableHeaderCell, styles.tablePriceCell]}>Costo</Text>
                <Text style={[styles.tableHeaderCell, styles.tableBarcodeCell]}>Barras</Text>
                <Text style={[styles.tableHeaderCell, styles.tableStatusCell]}>Estado</Text>
              </View>
              {paginatedProducts.length > 0 ? (
                <View style={styles.tableBody}>
                  {paginatedProducts.map((item) => (
                    <View key={item.id}>{renderTableProduct({ item })}</View>
                  ))}
                </View>
              ) : loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color="#0A8F5A" />
                  <Text style={styles.emptyText}>Cargando productos...</Text>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No hay productos con esos filtros.</Text>
                </View>
              )}
            </View>
          </ScrollView>
        ) : paginatedProducts.length > 0 ? (
          <View style={styles.cardsBody}>
            {paginatedProducts.map((item) => (
              <View key={item.id}>{renderProductCard({ item })}</View>
            ))}
          </View>
        ) : loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#0A8F5A" />
            <Text style={styles.emptyText}>Cargando productos...</Text>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No hay productos con esos filtros.</Text>
          </View>
        )}
      </View>

      <Modal visible={pickerKind !== null} transparent animationType="fade" onRequestClose={() => setPickerKind(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.pickerModalCard}>
            <View style={styles.pickerModalHeader}>
              <Text style={styles.modalTitle}>
                {pickerKind === 'group' ? 'Seleccionar grupo' : pickerKind === 'brand' ? 'Seleccionar marca' : 'Seleccionar proveedor'}
              </Text>
              <Pressable
                style={styles.pickerCloseButton}
                onPress={() => {
                  setPickerKind(null);
                  setPickerContext('filter');
                  setPickerQuery('');
                }}
              >
                <Text style={styles.pickerCloseButtonText}>Cerrar</Text>
              </Pressable>
            </View>

            <TextInput
              value={pickerQuery}
              onChangeText={setPickerQuery}
              style={styles.searchInput}
              placeholder="Buscar opción..."
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FlatList
              data={filteredPickerOptions}
              keyExtractor={(item) => item.value}
              style={styles.pickerList}
              contentContainerStyle={styles.pickerListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerOption}
                  onPress={() => {
                    if (pickerContext === 'filter') {
                      if (pickerKind === 'group') {
                        setGroupFilter(item.value);
                      } else if (pickerKind === 'brand') {
                        setBrandFilter(item.value);
                      } else if (pickerKind === 'supplier') {
                        setSupplierFilter(item.value);
                      }
                    } else if (pickerContext === 'form') {
                      if (pickerKind === 'group') {
                        updateForm('group_name', item.value);
                      } else if (pickerKind === 'brand') {
                        updateForm('brand', item.value);
                      } else if (pickerKind === 'supplier') {
                        updateForm('supplier', item.value);
                      }
                    }
                    setPickerKind(null);
                    setPickerContext('filter');
                    setPickerQuery('');
                  }}
                >
                  <Text style={styles.pickerOptionLabel}>{item.label}</Text>
                  {item.subtitle ? <Text style={styles.pickerOptionSubtitle}>{item.subtitle}</Text> : null}
                </Pressable>
              )}
              ListHeaderComponent={
                <Pressable
                  style={styles.pickerOption}
                  onPress={() => {
                    if (pickerContext === 'filter') {
                      if (pickerKind === 'group') {
                        setGroupFilter('');
                      } else if (pickerKind === 'brand') {
                        setBrandFilter('');
                      } else if (pickerKind === 'supplier') {
                        setSupplierFilter('');
                      }
                    } else if (pickerContext === 'form') {
                      if (pickerKind === 'group') {
                        updateForm('group_name', '');
                      } else if (pickerKind === 'brand') {
                        updateForm('brand', '');
                      } else if (pickerKind === 'supplier') {
                        updateForm('supplier', '');
                      }
                    }
                    setPickerKind(null);
                    setPickerContext('filter');
                    setPickerQuery('');
                  }}
                >
                  <Text style={styles.pickerOptionLabel}>Todos</Text>
                  <Text style={styles.pickerOptionSubtitle}>Quita este filtro</Text>
                </Pressable>
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No hay coincidencias.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      <Modal visible={showDetailModal} transparent animationType="fade" onRequestClose={() => setShowDetailModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.detailModalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{selectedProduct?.name || 'Producto'}</Text>
              <Text style={styles.modalSubtitle}>{selectedProduct?.sku || 'Sin SKU'}</Text>

              {selectedProduct ? (
                <View style={styles.detailGrid}>
                  <DetailLine label="Precio" value={`$${formatMoney(selectedProduct.price)}`} />
                  <DetailLine label="Costo" value={`$${formatMoney(selectedProduct.cost)}`} />
                  <DetailLine label="Barras" value={selectedProduct.barcode || '—'} />
                  <DetailLine label="Grupo" value={displayGroup(selectedProduct)} />
                  <DetailLine label="Marca" value={selectedProduct.brand || '—'} />
                  <DetailLine label="Proveedor" value={selectedProduct.supplier || '—'} />
                  <DetailLine label="Unidad" value={selectedProduct.unit || '—'} />
                  <DetailLine label="Formato" value={selectedProduct.label_format || '—'} />
                  <DetailLine label="Stock mín." value={formatIntegerInput(selectedProduct.stock_min)} />
                  <DetailLine label="Preferida" value={formatIntegerInput(selectedProduct.preferred_qty)} />
                  <DetailLine label="Reorden" value={formatIntegerInput(selectedProduct.reorder_point)} />
                  <DetailLine label="Existencia" value={formatIntegerInput(selectedProduct.qty_on_hand) || '—'} />
                  <DetailLine label="Estado" value={selectedProduct.active ? 'Activo' : 'Inactivo'} />
                </View>
              ) : null}

              <View style={styles.modalActionsRow}>
                <Pressable style={styles.secondaryButton} onPress={() => setShowDetailModal(false)}>
                  <Text style={styles.secondaryButtonText}>Cerrar</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    if (selectedProduct) openEditModal(selectedProduct);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Editar</Text>
                </Pressable>
                <Pressable
                  style={[styles.dangerButton, deleting ? styles.buttonDisabled : null]}
                  onPress={() => {
                    if (selectedProduct) {
                      handleDeleteProduct(selectedProduct).catch(() => undefined);
                    }
                  }}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.dangerButtonText}>Eliminar</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showFormModal} transparent animationType="fade" onRequestClose={closeFormModal}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.formModalCard, isCompactLayout ? styles.formModalCardCompact : null]}>
            <ScrollView
              style={styles.formModalScroll}
              contentContainerStyle={styles.formModalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.formModalBody}>
                <Text style={styles.modalTitle}>{formMode === 'create' ? 'Nuevo producto' : 'Editar producto'}</Text>
                <Text style={styles.modalSubtitle}>
                  {formMode === 'create'
                    ? 'Usa campos cortos y esenciales. El resto se puede ajustar luego.'
                    : 'Modifica solo lo operativo para mantener el flujo rápido.'}
                </Text>

                {formMessage ? <Text style={styles.inlineMessage}>{formMessage}</Text> : null}

                <Text style={styles.fieldLabel}>Nombre</Text>
                <TextInput value={form.name} onChangeText={(value) => updateForm('name', value)} style={styles.fieldInput} />

                <View style={styles.twoColGrid}>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>SKU</Text>
                    <View style={styles.fieldDisplay}>
                      <Text style={[styles.fieldDisplayValue, !form.sku.trim() ? styles.fieldDisplayMuted : null]}>
                        {form.sku.trim() ||
                          nextProductCodes?.sku ||
                          (loadingNextProductCodes && formMode === 'create' ? 'Generando...' : 'Sin SKU')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>Código de barras</Text>
                    <View style={styles.fieldDisplay}>
                      <Text style={[styles.fieldDisplayValue, !form.barcode.trim() ? styles.fieldDisplayMuted : null]}>
                        {form.barcode.trim() ||
                          nextProductCodes?.barcode ||
                          (loadingNextProductCodes && formMode === 'create' ? 'Generando...' : 'Sin código')}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.twoColGrid}>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>Precio</Text>
                    <TextInput
                      value={form.price}
                      onChangeText={(value) => updateForm('price', value)}
                      onFocus={() => updateForm('price', unformatNumericInput(form.price))}
                      onBlur={() => updateForm('price', formatNumericText(form.price, true))}
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>Costo</Text>
                    <TextInput
                      value={form.cost}
                      onChangeText={(value) => updateForm('cost', value)}
                      onFocus={() => updateForm('cost', unformatNumericInput(form.cost))}
                      onBlur={() => updateForm('cost', formatNumericText(form.cost, true))}
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.secondaryButton, styles.flexButton]}
                    onPress={() => checkDuplicates(form).catch(() => undefined)}
                    disabled={duplicateChecking}
                  >
                    {duplicateChecking ? (
                      <ActivityIndicator size="small" color="#0A8F5A" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Buscar duplicados</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryButton, styles.flexButton]}
                    onPress={() => suggestCost(form).catch(() => undefined)}
                    disabled={costChecking}
                  >
                    {costChecking ? (
                      <ActivityIndicator size="small" color="#0A8F5A" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Sugerir costo</Text>
                    )}
                  </Pressable>
                </View>

                {duplicateCandidates.length > 0 ? (
                  <View style={styles.alertCard}>
                    <Text style={styles.alertTitle}>
                      {hasHighDuplicateRisk ? 'Posible duplicado de riesgo alto' : 'Posibles duplicados'}
                    </Text>
                    {duplicateCandidates.slice(0, 3).map((candidate) => (
                      <View key={candidate.product_id} style={styles.duplicateRow}>
                        <Text style={styles.duplicateName}>{candidate.name}</Text>
                        <Text style={styles.duplicateMeta}>
                          {candidate.sku ? `SKU ${candidate.sku}` : 'Sin SKU'} · {Math.round(candidate.similarity_score * 100)}%
                        </Text>
                        {candidate.match_reasons.length > 0 ? (
                          <Text style={styles.duplicateReasons}>{candidate.match_reasons.slice(0, 2).join(' · ')}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {costSuggestion ? (
                  <View style={styles.costCard}>
                    <Text style={styles.alertTitle}>Costo sugerido</Text>
                    <Text style={styles.costValue}>${formatMoney(costSuggestion.suggested_cost)}</Text>
                    <Text style={styles.costMeta}>
                      Confianza {costSuggestion.confidence_label} · {Math.round(costSuggestion.confidence_score * 100)}%
                    </Text>
                    <Text style={styles.costMeta}>
                      Rango ${formatMoney(costSuggestion.range_min_cost)} - ${formatMoney(costSuggestion.range_max_cost)}
                    </Text>
                    <Text style={styles.costMeta}>
                      Modo {costSuggestion.mode_label || costSuggestion.mode}
                    </Text>
                  </View>
                ) : null}

                <Pressable style={styles.selectField} onPress={() => openPicker('group', 'form')}>
                  <Text style={styles.selectLabel}>Grupo</Text>
                  <Text style={[styles.selectValue, !form.group_name.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                    {formGroupLabel}
                  </Text>
                </Pressable>

                <View style={styles.twoColGrid}>
                  <Pressable style={[styles.selectField, styles.colItem]} onPress={() => openPicker('brand', 'form')}>
                    <Text style={styles.selectLabel}>Marca</Text>
                    <Text style={[styles.selectValue, !form.brand.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                      {formBrandLabel}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.selectField, styles.colItem]} onPress={() => openPicker('supplier', 'form')}>
                    <Text style={styles.selectLabel}>Proveedor</Text>
                    <Text style={[styles.selectValue, !form.supplier.trim() ? styles.selectPlaceholder : null]} numberOfLines={1}>
                      {formSupplierLabel}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.fieldLabel}>Unidad</Text>
                <TextInput value={form.unit} onChangeText={(value) => updateForm('unit', value)} style={styles.fieldInput} />

                <Text style={styles.fieldLabel}>Formato de etiqueta</Text>
                <View style={styles.segmentRow}>
                  {(['Kensar1', 'Cables_1'] as const).map((value) => (
                    <Pressable
                      key={value}
                      style={[styles.segmentButton, form.label_format === value ? styles.segmentButtonActive : null]}
                      onPress={() => updateForm('label_format', value)}
                    >
                      <Text style={[styles.segmentButtonText, form.label_format === value ? styles.segmentButtonTextActive : null]}>
                        {value}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.twoColGrid}>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>Stock mínimo</Text>
                    <TextInput
                      value={form.stock_min}
                      onChangeText={(value) => updateForm('stock_min', value)}
                      onFocus={() => updateForm('stock_min', unformatNumericInput(form.stock_min))}
                      onBlur={() => updateForm('stock_min', formatNumericText(form.stock_min, false) || '0')}
                      style={styles.fieldInput}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.colItem}>
                    <Text style={styles.fieldLabel}>Cantidad preferida</Text>
                    <TextInput
                      value={form.preferred_qty}
                      onChangeText={(value) => updateForm('preferred_qty', value)}
                      onFocus={() => updateForm('preferred_qty', unformatNumericInput(form.preferred_qty))}
                      onBlur={() => updateForm('preferred_qty', formatNumericText(form.preferred_qty, false) || '0')}
                      style={styles.fieldInput}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Punto de reorden</Text>
                <TextInput
                  value={form.reorder_point}
                  onChangeText={(value) => updateForm('reorder_point', value)}
                  onFocus={() => updateForm('reorder_point', unformatNumericInput(form.reorder_point))}
                  onBlur={() => updateForm('reorder_point', formatNumericText(form.reorder_point, false) || '0')}
                  style={styles.fieldInput}
                  keyboardType="number-pad"
                />

                <View style={styles.segmentRow}>
                  <ToggleChip label="Activo" value={form.active} onPress={() => updateForm('active', !form.active)} />
                  <ToggleChip label="Servicio" value={form.service} onPress={() => updateForm('service', !form.service)} />
                  <ToggleChip label="IVA" value={form.includes_tax} onPress={() => updateForm('includes_tax', !form.includes_tax)} />
                  <ToggleChip
                    label="Permitir cambio"
                    value={form.allow_price_change}
                    onPress={() => updateForm('allow_price_change', !form.allow_price_change)}
                  />
                  <ToggleChip
                    label="Alertar stock"
                    value={form.low_stock_alert}
                    onPress={() => updateForm('low_stock_alert', !form.low_stock_alert)}
                  />
                </View>

                <View style={styles.segmentRow}>
                  {([
                    ['balanced', 'Balanceado'],
                    ['conservative', 'Conservador'],
                    ['aggressive', 'Agresivo'],
                  ] as const).map(([value, label]) => (
                    <Pressable
                      key={value}
                      style={[styles.segmentButton, costMode === value ? styles.segmentButtonActive : null]}
                      onPress={() => setCostMode(value)}
                    >
                      <Text style={[styles.segmentButtonText, costMode === value ? styles.segmentButtonTextActive : null]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>
            <View style={styles.formActionsBar}>
              <Pressable style={styles.secondaryButton} onPress={closeFormModal}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => submitForm().catch(() => undefined)}
                disabled={saving || (formMode === 'create' && loadingNextProductCodes)}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : formMode === 'create' && loadingNextProductCodes ? (
                  <Text style={styles.primaryButtonText}>Generando...</Text>
                ) : (
                  <Text style={styles.primaryButtonText}>{formMode === 'create' ? 'Crear' : 'Guardar'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ToggleChip({
  label,
  value,
  onPress,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.toggleChip, value ? styles.toggleChipActive : null]} onPress={onPress}>
      <Text style={[styles.toggleChipText, value ? styles.toggleChipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    gap: 10,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionsCompact: {
    width: '100%',
  },
  title: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: '#475569',
    fontSize: 13,
    marginTop: 2,
    maxWidth: 340,
  },
  primaryButton: {
    backgroundColor: '#0A8F5A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonCompact: {
    flex: 1,
    minWidth: 0,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  refreshButton: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonCompact: {
    flex: 1,
    minWidth: 0,
  },
  refreshButtonText: {
    color: '#0A8F5A',
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontWeight: '800',
  },
  dangerButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  alertCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: '#FFF7D6',
    padding: 12,
    gap: 6,
  },
  alertTitle: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 14,
  },
  alertText: {
    color: '#92400E',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 8,
    gap: 10,
  },
  cardsBody: {
    gap: 10,
  },
  paginationBar: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#DCE4EE',
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 6,
  },
  paginationText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  paginationButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paginationButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  paginationButtonDisabled: {
    opacity: 0.45,
  },
  paginationButtonText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  tableListContent: {
    paddingBottom: 8,
  },
  tableBody: {
    gap: 0,
  },
  tableShell: {
    width: 1320,
    alignSelf: 'flex-start',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#CFD8E3',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    overflow: 'hidden',
  },
  tableHeaderCell: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 12,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#B7C4D5',
    alignItems: 'center',
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    color: '#1E293B',
    fontSize: 13,
    fontWeight: '700',
  },
  tableSkuCell: {
    width: 86,
  },
  tableNameCell: {
    width: 310,
  },
  tableGroupCell: {
    width: 220,
  },
  tableBrandCell: {
    width: 140,
  },
  tablePriceCell: {
    width: 112,
  },
  tableBarcodeCell: {
    width: 150,
  },
  tableStatusCell: {
    width: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#CFD8E3',
    padding: 12,
    gap: 10,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#0F172A',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  modeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  modeChipActive: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  modeChipText: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 12,
  },
  modeChipTextActive: {
    color: '#0A8F5A',
  },
  advancedToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  advancedToggleButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  advancedToggleButtonActive: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  advancedToggleText: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 12,
  },
  advancedToggleTextActive: {
    color: '#0A8F5A',
  },
  advancedClearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F3D08A',
    backgroundColor: '#FFF7D6',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  advancedClearText: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 12,
  },
  selectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectField: {
    flexGrow: 1,
    flexBasis: 170,
    minWidth: 170,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 4,
    marginTop: 4,
  },
  selectLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  selectValue: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  selectPlaceholder: {
    color: '#64748B',
    fontWeight: '600',
  },
  advancedPanel: {
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#AFC0D4',
    backgroundColor: '#D6DFEA',
    padding: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  segmentButtonActive: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  segmentButtonText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 12,
  },
  segmentButtonTextActive: {
    color: '#0A8F5A',
  },
  inputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterInput: {
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 160,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#0F172A',
  },
  sortRow: {
    gap: 8,
  },
  sortLabel: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 12,
  },
  sortChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sortChip: {
    backgroundColor: '#F8FAFC',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortChipActive: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  sortChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  sortChipTextActive: {
    color: '#0A8F5A',
  },
  quickLists: {
    gap: 10,
  },
  quickListBlock: {
    gap: 6,
  },
  quickListTitle: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  quickListWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#D8DFEA',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickChipText: {
    color: '#1E293B',
    fontSize: 12,
    fontWeight: '600',
  },
  pickerModalCard: {
    maxHeight: '88%',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 14,
    gap: 10,
  },
  pickerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pickerCloseButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pickerCloseButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 12,
  },
  pickerList: {
    maxHeight: 420,
  },
  pickerListContent: {
    gap: 8,
    paddingBottom: 4,
  },
  pickerOption: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8DFEA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  pickerOptionLabel: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  pickerOptionSubtitle: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  rowCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    padding: 12,
    gap: 10,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitleWrap: {
    flex: 1,
    gap: 2,
  },
  rowSku: {
    color: '#0A8F5A',
    fontSize: 12,
    fontWeight: '800',
  },
  rowName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  rowMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rowMetaItem: {
    minWidth: 140,
    flexGrow: 1,
    gap: 2,
  },
  rowMetaLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  rowMetaValue: {
    color: '#1E293B',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#475569',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  detailModalCard: {
    maxHeight: '84%',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 14,
  },
  formModalCard: {
    height: '90%',
    width: '100%',
    maxWidth: 760,
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 14,
    paddingBottom: 86,
    overflow: 'hidden',
  },
  formModalCardCompact: {
    height: '100%',
    maxHeight: '100%',
    maxWidth: '100%',
    borderRadius: 0,
    paddingTop: 18,
    paddingBottom: 92,
  },
  formModalScroll: {
    flex: 1,
    minHeight: 0,
  },
  formModalScrollContent: {
    paddingBottom: 20,
  },
  formModalBody: {
    gap: 0,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#475569',
    fontSize: 13,
    marginTop: 3,
    marginBottom: 10,
  },
  detailGrid: {
    gap: 8,
    marginTop: 12,
  },
  detailLine: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8DFEA',
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 4,
  },
  detailLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailValue: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  modalActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  formActionsBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#D8DFEA',
    backgroundColor: '#F8FAFC',
    paddingTop: 12,
    marginTop: 0,
  },
  fieldLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
  },
  fieldInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#0F172A',
  },
  fieldDisplay: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D9E6',
    backgroundColor: '#EEF3F9',
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  fieldDisplayValue: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldDisplayMuted: {
    color: '#64748B',
    fontWeight: '600',
  },
  inlineMessage: {
    color: '#92400E',
    backgroundColor: '#FFF7D6',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 10,
    fontWeight: '700',
  },
  twoColGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  colItem: {
    flex: 1,
  },
  flexButton: {
    flex: 1,
  },
  helperWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  helperChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  helperChipText: {
    color: '#0A8F5A',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toggleChipActive: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  toggleChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleChipTextActive: {
    color: '#0A8F5A',
  },
  duplicateRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3D08A',
  },
  duplicateName: {
    color: '#92400E',
    fontWeight: '800',
  },
  duplicateMeta: {
    color: '#A16207',
    fontSize: 12,
  },
  duplicateReasons: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  costCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
    padding: 12,
    gap: 4,
  },
  costValue: {
    color: '#0A8F5A',
    fontSize: 24,
    fontWeight: '900',
  },
  costMeta: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '600',
  },
});
