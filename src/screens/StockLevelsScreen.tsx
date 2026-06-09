import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Modal,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { TableFocusSection } from '../ui/TableFocusSection';
import { SearchInput } from '../ui/SearchInput';
import {
  listInventoryProducts,
  type InventoryProductPage,
  type InventoryProductRow,
  type InventorySortOption,
} from '../services/api/inventory';

type StockStatus = 'healthy' | 'low' | 'critical' | 'negative';
type SortOption = InventorySortOption;
type ViewMode = 'cards' | 'table';
type SortMenuOption = {
  value: SortOption;
  label: string;
};
type PeekPreview = {
  label: string;
  value: string;
  x: number;
  y: number;
};

const SORT_OPTIONS: SortMenuOption[] = [
  { value: 'name_asc', label: 'Orden alfabético' },
  { value: 'stock_asc', label: 'Stock menor a mayor (más negativos primero)' },
  { value: 'stock_desc', label: 'Stock mayor a menor (más altos primero)' },
  { value: 'sku_asc', label: 'SKU menor a mayor' },
  { value: 'sku_desc', label: 'SKU mayor a menor' },
  { value: 'cost_stock_asc', label: 'Costo en stock menor a mayor' },
  { value: 'cost_stock_desc', label: 'Costo en stock mayor a menor' },
  { value: 'price_stock_asc', label: 'Precio en stock menor a mayor' },
  { value: 'price_stock_desc', label: 'Precio en stock mayor a menor' },
];

function formatQty(value?: number | null): string {
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function formatMoney(value?: number | null): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function displayGroup(product: InventoryProductRow): string {
  return product.group_name || 'Sin categoría';
}

function resolveStockStatus(product: InventoryProductRow): StockStatus {
  const qty = Number(product.qty_on_hand ?? 0);
  if (qty < 0) return 'negative';
  if (product.status === 'critical') return 'critical';
  if (product.status === 'low') return 'low';
  return 'healthy';
}

function statusMeta(status: StockStatus) {
  if (status === 'negative') {
    return {
      label: 'Negativo',
      color: '#BE123C',
      borderColor: '#FDA4AF',
      backgroundColor: '#FFF1F2',
      accentBackground: '#FFE4E6',
    };
  }
  if (status === 'critical') {
    return {
      label: 'Crítico',
      color: '#B45309',
      borderColor: '#FCD34D',
      backgroundColor: '#FFFBEB',
      accentBackground: '#FEF3C7',
    };
  }
  if (status === 'low') {
    return {
      label: 'Bajo stock',
      color: '#C2410C',
      borderColor: '#FBBF24',
      backgroundColor: '#FFF7ED',
      accentBackground: '#FFEDD5',
    };
  }
  return {
    label: 'Saludable',
    color: '#047857',
    borderColor: '#6EE7B7',
    backgroundColor: '#ECFDF5',
    accentBackground: '#D1FAE5',
  };
}

export function StockLevelsScreen() {
  const { width, height } = useWindowDimensions();
  const { apiClient, syncStatus } = useAppSession();
  const [inventoryPage, setInventoryPage] = useState<InventoryProductPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StockStatus>('all');
  const [sortBy, setSortBy] = useState<SortOption>('stock_desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [showTopPanel, setShowTopPanel] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(100);
  const [peekPreview, setPeekPreview] = useState<PeekPreview | null>(null);
  const requestIdRef = useRef(0);

  const canRetry = syncStatus === 'online' || syncStatus === 'degraded';

  const loadData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setError(null);
    try {
      const statusQuery =
        statusFilter === 'healthy'
          ? 'ok'
          : statusFilter === 'low'
            ? 'low'
            : statusFilter === 'critical'
              ? 'critical'
              : statusFilter === 'negative'
                ? 'negative'
                : 'all';

      const response = await listInventoryProducts(apiClient, {
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
        search: search.trim() || undefined,
        status: statusQuery,
        sort: sortBy,
      });
      if (requestId === requestIdRef.current) {
        setInventoryPage(response);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo cargar el inventario');
    }
  }, [apiClient, currentPage, pageSize, search, sortBy, statusFilter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      loadData().finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // apiClient is stable through context; if it changes, the effect should reload.
  }, [loadData]);

  const refreshStockData = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);
  const pageItems = inventoryPage?.items ?? [];
  const totalProducts = inventoryPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalProducts / pageSize));
  const pageStart = totalProducts === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, totalProducts);

  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || sortBy !== 'stock_desc';
  const isTableMode = viewMode === 'table';

  const showPeekPreview = useCallback((preview: PeekPreview) => {
    setPeekPreview(preview);
  }, []);

  const hidePeekPreview = useCallback(() => {
    setPeekPreview(null);
  }, []);

  useEffect(() => {
    if (!peekPreview) return undefined;
    const timer = setTimeout(() => {
      setPeekPreview(null);
    }, 1600);
    return () => clearTimeout(timer);
  }, [peekPreview]);

  useEffect(() => {
    setShowTopPanel(true);
  }, []);

  return (
    <View style={styles.container}>
      <TableFocusSection
        expanded={showTopPanel}
        onChangeExpanded={setShowTopPanel}
        expandedLabel="Desliza hacia arriba para ocultar el panel"
        collapsedLabel="Desliza hacia abajo para mostrar el panel"
        showLabels={!isTableMode}
      >
        <View style={styles.hero}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.title}>Niveles de stock</Text>
            <Text style={styles.subtitle}>
              Vista rápida del inventario con colores por nivel y búsqueda directa por producto.
            </Text>
          </View>
          <Pressable
            style={[styles.refreshButton, refreshing ? styles.refreshButtonDisabled : null]}
            onPress={() => {
              refreshStockData().catch(() => undefined);
            }}
            disabled={refreshing || !canRetry}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <Text style={styles.refreshText}>Actualizar</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <SearchInput
            placeholder="Buscar por nombre, SKU, código o categoría"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={(value) => {
              setCurrentPage(1);
              setSearch(value);
            }}
            onClear={() => {
              setCurrentPage(1);
              setSearch('');
            }}
            containerStyle={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {hasFilters ? (
            <Pressable
              style={styles.clearButton}
              onPress={() => {
                setCurrentPage(1);
                setSearch('');
                setStatusFilter('all');
                setSortBy('stock_desc');
              }}
            >
              <Text style={styles.clearButtonText}>Limpiar</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.controlsBar}>
          <View style={styles.paginationCompact}>
            <Text style={styles.paginationText}>
              Página {currentPage} de {totalPages} · {pageStart}-{pageEnd} de {totalProducts}
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

          <View style={styles.controlsRight}>
            <Pressable
              style={[styles.advancedToggleButton, showAdvancedFilters ? styles.advancedToggleButtonActive : null]}
              onPress={() => setShowAdvancedFilters((prev) => !prev)}
            >
              <Text
                style={[
                  styles.advancedToggleText,
                  showAdvancedFilters ? styles.advancedToggleTextActive : null,
                ]}
              >
                {showAdvancedFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
              </Text>
            </Pressable>

            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeButton, !isTableMode ? styles.modeButtonActive : null]}
                onPress={() => setViewMode('cards')}
              >
                <Text style={[styles.modeButtonText, !isTableMode ? styles.modeButtonTextActive : null]}>
                  Cards
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeButton, isTableMode ? styles.modeButtonActive : null]}
                onPress={() => setViewMode('table')}
              >
                <Text style={[styles.modeButtonText, isTableMode ? styles.modeButtonTextActive : null]}>
                  Tabla
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {showAdvancedFilters ? (
          <View style={styles.filtersCard}>
            <View style={styles.filterRow}>
              <FilterButton
                label="Todos"
                active={statusFilter === 'all'}
                onPress={() => {
                  setCurrentPage(1);
                  setStatusFilter('all');
                }}
              />
              <FilterButton
                label="Saludable"
                active={statusFilter === 'healthy'}
                onPress={() => {
                  setCurrentPage(1);
                  setStatusFilter('healthy');
                }}
              />
              <FilterButton
                label="Bajo"
                active={statusFilter === 'low'}
                onPress={() => {
                  setCurrentPage(1);
                  setStatusFilter('low');
                }}
              />
              <FilterButton
                label="Crítico"
                active={statusFilter === 'critical'}
                onPress={() => {
                  setCurrentPage(1);
                  setStatusFilter('critical');
                }}
              />
              <FilterButton
                label="Negativo"
                active={statusFilter === 'negative'}
                onPress={() => {
                  setCurrentPage(1);
                  setStatusFilter('negative');
                }}
              />
            </View>

            <View style={styles.sortSelectRow}>
              <Text style={styles.sortSelectLabel}>Ordenar</Text>
              <Pressable style={styles.sortSelectButton} onPress={() => setShowSortPicker(true)}>
                <Text style={styles.sortSelectValue}>
                  {SORT_OPTIONS.find((option) => option.value === sortBy)?.label || 'Seleccionar orden'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </TableFocusSection>

      {isTableMode ? (
        <StockTableCard
          loading={loading}
          error={error}
          canRetry={canRetry}
          refreshing={refreshing}
          filteredProducts={pageItems}
          onRefresh={refreshStockData}
          onPeekText={showPeekPreview}
          onDismissPeek={hidePeekPreview}
        />
      ) : (
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderTitle}>Producto</Text>
            <Text style={styles.listHeaderTitle}>Stock</Text>
          </View>

          {loading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator size="large" color="#0A8F5A" />
              <Text style={styles.stateText}>Cargando inventario...</Text>
            </View>
          ) : error ? (
            <View style={styles.stateWrap}>
              <Text style={styles.stateError}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => refreshStockData().catch(() => undefined)} disabled={!canRetry}>
                <Text style={styles.retryButtonText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : pageItems.length === 0 ? (
            <View style={styles.stateWrap}>
              <Text style={styles.stateText}>No hay productos para esos filtros.</Text>
            </View>
          ) : (
          <FlatList
            style={styles.cardsList}
            data={pageItems}
            keyExtractor={(item) => String(item.product_id)}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  refreshStockData().catch(() => undefined);
                }}
                tintColor="#0A8F5A"
              />
            }
            renderItem={({ item }) => <StockCardRow product={item} onPeekText={showPeekPreview} />}
            ItemSeparatorComponent={RowSeparator}
            contentContainerStyle={styles.listContent}
            nestedScrollEnabled
            onScrollBeginDrag={hidePeekPreview}
            />
          )}
        </View>
      )}

      {peekPreview ? (
        <View style={styles.peekOverlay} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={hidePeekPreview} />
          <View
            style={[
              styles.peekCard,
              {
                left: Math.max(16, Math.min(peekPreview.x - 168, width - 336)),
                top: Math.max(72, Math.min(peekPreview.y + 14, height - 132)),
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.peekLabel}>{peekPreview.label}</Text>
            <Text style={styles.peekValue}>{peekPreview.value}</Text>
            <Text style={styles.peekHint}>Toque fuera o deslice para cerrar</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={showSortPicker} transparent animationType="fade" onRequestClose={() => setShowSortPicker(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sortPickerCard}>
            <Text style={styles.sortPickerTitle}>Ordenar inventario</Text>
            <ScrollView style={styles.sortPickerList} contentContainerStyle={styles.sortPickerListContent}>
              {SORT_OPTIONS.map((option) => {
                const selected = sortBy === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.sortPickerOption, selected ? styles.sortPickerOptionSelected : null]}
                    onPress={() => {
                      setCurrentPage(1);
                      setSortBy(option.value);
                      setShowSortPicker(false);
                    }}
                  >
                    <Text style={[styles.sortPickerOptionText, selected ? styles.sortPickerOptionTextSelected : null]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.sortPickerCloseButton} onPress={() => setShowSortPicker(false)}>
              <Text style={styles.sortPickerCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StockCardRow({
  product,
  onPeekText,
}: {
  product: InventoryProductRow;
  onPeekText: (preview: PeekPreview) => void;
}) {
  const status = resolveStockStatus(product);
  const meta = statusMeta(status);
  const qty = Number(product.qty_on_hand ?? 0);
  const totalCost = Number(product.cost ?? 0) * qty;
  const totalPrice = Number(product.price ?? 0) * qty;

  return (
    <View
      style={[
        styles.rowCard,
        {
          backgroundColor: meta.backgroundColor,
          borderColor: meta.borderColor,
        },
      ]}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowMain}>
          <PeekableText
            label="Nombre"
            value={product.product_name}
            style={styles.productName}
            numberOfLines={2}
            onPeekText={onPeekText}
          />
          <Text style={styles.rowSubText} numberOfLines={1}>
            SKU: {product.sku || 'Sin SKU'} · {displayGroup(product)}
          </Text>
        </View>

        <View style={[styles.statusChip, { borderColor: meta.borderColor, backgroundColor: meta.accentBackground }]}>
          <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <Metric label="Stock" value={formatQty(qty)} valueColor={qty < 0 ? '#BE123C' : '#0F172A'} />
        <Metric label="Costo stock" value={formatMoney(totalCost)} valueColor={totalCost < 0 ? '#BE123C' : '#334155'} />
        <Metric label="Precio stock" value={formatMoney(totalPrice)} valueColor={totalPrice < 0 ? '#BE123C' : '#334155'} />
      </View>

      {product.last_movement_at ? (
        <Text style={styles.thresholdText}>Último mov.: {formatDate(product.last_movement_at)}</Text>
      ) : (
        <Text style={styles.thresholdText}>Sin último movimiento registrado</Text>
      )}
    </View>
  );
}

function StockTableCard({
  loading,
  error,
  canRetry,
  refreshing,
  filteredProducts,
  onRefresh,
  onPeekText,
  onDismissPeek,
}: {
  loading: boolean;
  error: string | null;
  canRetry: boolean;
  refreshing: boolean;
  filteredProducts: InventoryProductRow[];
  onRefresh: () => Promise<void>;
  onPeekText: (preview: PeekPreview) => void;
  onDismissPeek: () => void;
}) {
  return (
    <View style={styles.listCard}>
      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="large" color="#0A8F5A" />
          <Text style={styles.stateText}>Cargando inventario...</Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateError}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => onRefresh().catch(() => undefined)} disabled={!canRetry}>
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : filteredProducts.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>No hay productos para esos filtros.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.tableScroll}
          horizontal
          nestedScrollEnabled
          onScrollBeginDrag={onDismissPeek}
          contentContainerStyle={styles.tableScrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                onRefresh().catch(() => undefined);
              }}
              tintColor="#0A8F5A"
            />
          }
        >
          <View style={styles.tableInnerWrap}>
            <View style={styles.tableHeader}>
              <Text style={[styles.listHeaderTitle, styles.tableTitleCell]}>Producto</Text>
              <Text style={[styles.listHeaderTitle, styles.tableSkuCell]}>SKU</Text>
              <Text style={[styles.listHeaderTitle, styles.tableGroupCell]}>Grupo</Text>
              <Text style={[styles.listHeaderTitle, styles.tableStockCell]}>Stock</Text>
              <Text style={[styles.listHeaderTitle, styles.tableStateCell]}>Estado</Text>
              <Text style={[styles.listHeaderTitle, styles.tableUnitCell]}>Costo unit.</Text>
              <Text style={[styles.listHeaderTitle, styles.tableUnitCell]}>Precio unit.</Text>
              <Text style={[styles.listHeaderTitle, styles.tableTotalCell]}>Costo total</Text>
              <Text style={[styles.listHeaderTitle, styles.tableTotalCell]}>Precio total</Text>
              <Text style={[styles.listHeaderTitle, styles.tableLastCell]}>Último mov.</Text>
            </View>

            <FlatList
              style={styles.tableList}
              data={filteredProducts}
              keyExtractor={(item) => String(item.product_id)}
              renderItem={({ item }) => <StockTableRow product={item} onPeekText={onPeekText} />}
              ItemSeparatorComponent={RowSeparator}
              contentContainerStyle={styles.tableBodyWrap}
              nestedScrollEnabled
              onScrollBeginDrag={onDismissPeek}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function StockTableRow({
  product,
  onPeekText,
}: {
  product: InventoryProductRow;
  onPeekText: (preview: PeekPreview) => void;
}) {
  const status = resolveStockStatus(product);
  const meta = statusMeta(status);
  const qty = Number(product.qty_on_hand ?? 0);
  const totalCost = Number(product.cost ?? 0) * qty;
  const totalPrice = Number(product.price ?? 0) * qty;

  return (
    <View style={[styles.tableRow, { backgroundColor: meta.backgroundColor, borderColor: meta.borderColor }]}>
      <View style={styles.tableTitleCell}>
        <PeekableText label="Nombre" value={product.product_name} style={styles.tableProductName} onPeekText={onPeekText} />
      </View>
      <View style={styles.tableSkuCell}>
        <Text style={styles.tableCellText} numberOfLines={1}>
          {product.sku || '—'}
        </Text>
      </View>
      <View style={styles.tableGroupCell}>
        <PeekableText
          label="Grupo"
          value={displayGroup(product)}
          style={styles.tableCellText}
          numberOfLines={1}
          onPeekText={onPeekText}
        />
      </View>
      <View style={styles.tableStockCell}>
        <Text style={[styles.tableCellText, styles.tableStockValue, qty < 0 ? styles.negativeText : null]}>
          {formatQty(qty)}
        </Text>
      </View>
      <View style={styles.tableStateCell}>
        <View style={[styles.statusChip, styles.tableStatusChip, { borderColor: meta.borderColor, backgroundColor: meta.accentBackground }]}>
          <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
      <View style={styles.tableUnitCell}>
        <Text style={styles.tableCellText}>{formatMoney(product.cost)}</Text>
      </View>
      <View style={styles.tableUnitCell}>
        <Text style={styles.tableCellText}>{formatMoney(product.price)}</Text>
      </View>
      <View style={styles.tableTotalCell}>
        <Text style={[styles.tableCellText, totalCost < 0 ? styles.negativeText : null]}>
          {formatMoney(totalCost)}
        </Text>
      </View>
      <View style={styles.tableTotalCell}>
        <Text style={[styles.tableCellText, totalPrice < 0 ? styles.negativeText : null]}>
          {formatMoney(totalPrice)}
        </Text>
      </View>
      <View style={styles.tableLastCell}>
        <PeekableText
          label="Último movimiento"
          value={product.last_movement_at ? formatDate(product.last_movement_at) : '—'}
          style={styles.tableCellText}
          numberOfLines={1}
          onPeekText={onPeekText}
        />
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function FilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.filterButton, active ? styles.filterButtonActive : null]} onPress={onPress}>
      <Text style={[styles.filterButtonText, active ? styles.filterButtonTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function RowSeparator() {
  return <View style={styles.rowSeparator} />;
}

function PeekableText({
  label,
  value,
  style,
  numberOfLines,
  onPeekText,
}: {
  label: string;
  value: string;
  style: any;
  numberOfLines?: number;
  onPeekText: (preview: PeekPreview) => void;
}) {
  return (
    <Pressable
      style={styles.peekTextTouchTarget}
      delayLongPress={240}
      onLongPress={(event) => {
        onPeekText({
          label,
          value,
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        });
      }}
    >
      <Text style={style} numberOfLines={numberOfLines}>
        {value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  refreshButton: {
    minWidth: 104,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  refreshText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 13,
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  paginationCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  controlsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modeButtonActive: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  modeButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  modeButtonTextActive: {
    color: '#0A8F5A',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filtersCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D8DFEA',
    backgroundColor: '#F8FAFC',
    padding: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    paddingHorizontal: 14,
    fontSize: 15,
  },
  advancedToggleButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  advancedToggleButtonActive: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  advancedToggleText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  advancedToggleTextActive: {
    color: '#0A8F5A',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sortSelectRow: {
    gap: 6,
  },
  sortSelectLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sortSelectButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sortSelectValue: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  filterButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterButtonActive: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  filterButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  filterButtonTextActive: {
    color: '#0A8F5A',
  },
  clearButton: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  clearButtonText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 12,
  },
  listCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D8DFEA',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  listHeaderTitle: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateWrap: {
    paddingHorizontal: 16,
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateText: {
    color: '#475569',
    fontSize: 14,
    textAlign: 'center',
  },
  stateError: {
    color: '#BE123C',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#0A8F5A',
    fontWeight: '800',
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  cardsList: {
    flex: 1,
  },
  paginationText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  paginationButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  paginationButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paginationButtonDisabled: {
    opacity: 0.45,
  },
  paginationButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    minWidth: 1460,
  },
  tableScroll: {
    flex: 1,
  },
  tableScrollContent: {
    flexGrow: 1,
  },
  tableList: {
    flex: 1,
  },
  tableInnerWrap: {
    minWidth: 1460,
    flex: 1,
  },
  tableBodyWrap: {
    minWidth: 1460,
    padding: 12,
    gap: 8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 74,
  },
  tableTitleCell: {
    width: 260,
    paddingRight: 10,
  },
  tableSkuCell: {
    width: 104,
    paddingRight: 10,
  },
  tableGroupCell: {
    width: 180,
    paddingRight: 10,
  },
  tableStockCell: {
    width: 90,
    paddingRight: 10,
  },
  tableStateCell: {
    width: 120,
    paddingRight: 10,
  },
  tableUnitCell: {
    width: 130,
    paddingRight: 10,
  },
  tableTotalCell: {
    width: 138,
    paddingRight: 10,
  },
  tableLastCell: {
    width: 160,
    paddingRight: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sortPickerCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  sortPickerTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  sortPickerList: {
    maxHeight: 420,
  },
  sortPickerListContent: {
    gap: 8,
  },
  sortPickerOption: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D8DFEA',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sortPickerOptionSelected: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  sortPickerOptionText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  sortPickerOptionTextSelected: {
    color: '#0A8F5A',
  },
  sortPickerCloseButton: {
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sortPickerCloseText: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 12,
  },
  tableProductName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  peekTextTouchTarget: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  peekOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
  },
  peekCard: {
    position: 'absolute',
    width: 320,
    maxWidth: '88%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#9ED9B3',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  peekLabel: {
    color: '#9ED9B3',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  peekValue: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  peekHint: {
    color: '#CBD5E1',
    fontSize: 11,
    marginTop: 8,
  },
  tableCellText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  tableStockValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  tableStatusChip: {
    alignSelf: 'flex-start',
  },
  rowSeparator: {
    height: 0,
  },
  rowCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  productName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  rowSubText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricBox: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.66)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  thresholdText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  negativeText: {
    color: '#BE123C',
  },
});
