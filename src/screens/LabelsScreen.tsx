import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { searchReceivingProducts } from '../services/api/receiving';
import {
  checkEndpointNative,
  discoverPrintersNative,
  hasNativePrintAgent,
  printNative,
} from '../services/printing/mobilePrintAgent';
import type { ReceivingProductLookup } from '../types/receiving';
import { ScreenContainer } from '../ui/ScreenContainer';

type PrinterStatus = 'checking' | 'online' | 'offline';

type PrintPayload = {
  CODIGO: string;
  BARRAS: string;
  NOMBRE: string;
  PRECIO: string;
  format: string;
  copies: number;
};
type LabelsStep = 'search' | 'print';

function normalizePrinterUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
}

function formatPriceText(value: number): string {
  return `$${Number(value || 0).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
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

function sortProductResults(items: ReceivingProductLookup[], rawQuery: string) {
  return [...items].sort((a, b) => {
    const rankA = rankProduct(a, rawQuery);
    const rankB = rankProduct(b, rawQuery);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, 'es');
  });
}

async function printDirect(printerUrl: string, payload: PrintPayload[]) {
  const normalizedUrl = normalizePrinterUrl(printerUrl);
  if (!normalizedUrl) {
    throw new Error('Configura la URL de impresora en Etiquetas.');
  }

  const parsed = new URL(normalizedUrl);
  const isRootPath = parsed.pathname === '/' || parsed.pathname === '';
  const targets = [normalizedUrl];
  if (isRootPath) {
    targets.push(`${normalizedUrl.replace(/\/+$/, '')}/print`);
  }

  let lastError: Error | null = null;

  for (const target of targets) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.ok) {
        return;
      }

      const detail = (await res.text().catch(() => '')).trim();
      const shortDetail = detail.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (shortDetail.toLowerCase().includes('cannot post /') && target === normalizedUrl && targets.length > 1) {
        continue;
      }
      if (shortDetail.toLowerCase().includes('cannot post')) {
        lastError = new Error(
          'La IP responde, pero esa ruta no es válida para imprimir. Revisa endpoint/puerto de la impresora.',
        );
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
  if (hasNativePrintAgent()) {
    try {
      await printNative(printerUrl, payload, 4500);
      return;
    } catch {
      // fallback JS if native fails
    }
  }
  await printDirect(printerUrl, payload);
}

export function LabelsScreen() {
  const {
    apiClient,
    apiBase,
    printerDirectUrl,
    setPrinterDirectUrl,
    labelFormat,
    setLabelFormat,
  } = useAppSession();

  const [query, setQuery] = useState('');
  const [rawResults, setRawResults] = useState<ReceivingProductLookup[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ReceivingProductLookup | null>(null);
  const [step, setStep] = useState<LabelsStep>('search');
  const [qtyInput, setQtyInput] = useState('1');
  const [searching, setSearching] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsUrl, setSettingsUrl] = useState(printerDirectUrl);
  const [settingsFormat, setSettingsFormat] = useState(labelFormat || 'Kensar');
  const [probePrinting, setProbePrinting] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>('checking');
  const [discoveringPrinters, setDiscoveringPrinters] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<string[]>([]);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);

  const sortedResults = useMemo(() => sortProductResults(rawResults, query), [rawResults, query]);

  const printerStatusMeta = useMemo(() => {
    if (printerStatus === 'online') {
      return { color: '#0A8F5A', label: 'Impresora conectada' };
    }
    if (printerStatus === 'offline') {
      return { color: '#DC2626', label: 'Impresora sin conexión' };
    }
    return { color: '#0EA5E9', label: 'Verificando impresora' };
  }, [printerStatus]);

  const checkPrinterConnection = useCallback(
    async (urlValue?: string) => {
      const target = normalizePrinterUrl(urlValue ?? printerDirectUrl);
      if (!target) {
        setPrinterStatus('offline');
        return;
      }
      setPrinterStatus('checking');
      try {
        if (hasNativePrintAgent()) {
          const nativeResult = await checkEndpointNative(target, 2000);
          setPrinterStatus(nativeResult.ok ? 'online' : 'offline');
          return;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        try {
          await fetch(target, { method: 'GET', signal: controller.signal });
          setPrinterStatus('online');
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        setPrinterStatus('offline');
      }
    },
    [printerDirectUrl],
  );

  const discoverPrinters = useCallback(async () => {
    setDiscoveryMessage('Buscando impresoras en la red...');
    setDiscoveredPrinters([]);
    setDiscoveringPrinters(true);

    const ipv4Pattern =
      /^(?:https?:\/\/)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?(?:\/.*)?$/;

    const candidateHosts = [settingsUrl, printerDirectUrl, apiBase];
    const prefixes = new Set<string>();
    for (const candidate of candidateHosts) {
      const match = candidate.trim().match(ipv4Pattern);
      if (!match) continue;
      const a = Number(match[1]);
      const b = Number(match[2]);
      const c = Number(match[3]);
      if ([a, b, c].some((value) => Number.isNaN(value) || value < 0 || value > 255)) continue;
      prefixes.add(`${a}.${b}.${c}`);
    }

    // En emulador Android (10.0.2.x) agregamos subredes LAN comunes para detectar
    // impresoras físicas en la red local sin depender solo del gateway virtual.
    if (prefixes.has('10.0.2')) {
      prefixes.add('192.168.0');
      prefixes.add('192.168.1');
    }

    if (prefixes.size === 0) {
      setDiscoveringPrinters(false);
      setDiscoveryMessage('No se pudo inferir subred. Escribe IP manualmente.');
      return;
    }

    try {
      const list = hasNativePrintAgent()
        ? await discoverPrintersNative(Array.from(prefixes), 8081, 260)
        : [];
      const ordered = Array.from(new Set(list)).sort((a, b) => a.localeCompare(b, 'es'));
      setDiscoveredPrinters(ordered);
      setDiscoveryMessage(
        ordered.length ? `Detectadas ${ordered.length} impresora(s).` : 'No se detectaron impresoras.',
      );
    } catch {
      setDiscoveryMessage('No se pudo completar autodetección. Puedes escribir IP manualmente.');
    } finally {
      setDiscoveringPrinters(false);
    }
  }, [apiBase, printerDirectUrl, settingsUrl]);

  useEffect(() => {
    let active = true;
    const term = query.trim();
    if (term.length < 2) {
      setRawResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      searchReceivingProducts(apiClient, term, 35)
        .then((items) => {
          if (!active) return;
          setRawResults(items);
        })
        .catch(() => {
          if (!active) return;
          setRawResults([]);
        })
        .finally(() => {
          if (!active) return;
          setSearching(false);
        });
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apiClient, query]);

  useEffect(() => {
    checkPrinterConnection().catch(() => undefined);
  }, [checkPrinterConnection]);

  function openSettings() {
    setSettingsUrl(printerDirectUrl);
    setSettingsFormat(labelFormat || 'Kensar');
    setShowSettings(true);
  }

  function saveSettings() {
    const normalizedUrl = normalizePrinterUrl(settingsUrl);
    setPrinterDirectUrl(normalizedUrl);
    setLabelFormat(settingsFormat.trim() || 'Kensar');
    setShowSettings(false);
    setInfo('Configuración guardada.');
    setError(null);
    checkPrinterConnection(normalizedUrl).catch(() => undefined);
  }

  async function handlePrint() {
    setError(null);
    setInfo(null);
    if (!selectedProduct) {
      setError('Selecciona un producto para imprimir.');
      return;
    }
    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La cantidad debe ser mayor a 0.');
      return;
    }

    const codigo = (selectedProduct.sku || '').trim() || String(selectedProduct.id);
    const barras = (selectedProduct.barcode || '').trim() || codigo;
    const payload: PrintPayload[] = [
      {
        CODIGO: codigo,
        BARRAS: barras,
        NOMBRE: selectedProduct.name,
        PRECIO: formatPriceText(selectedProduct.price),
        format: (labelFormat || 'Kensar').trim() || 'Kensar',
        copies: Math.max(1, Math.floor(qty)),
      },
    ];

    setPrinting(true);
    try {
      await printWithBestPath(printerDirectUrl, payload);
      setInfo('Etiqueta enviada a impresión.');
      setPrinterStatus('online');
      setStep('search');
      setSelectedProduct(null);
      setQtyInput('1');
      setQuery('');
      setRawResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo imprimir la etiqueta.');
      setPrinterStatus('offline');
    } finally {
      setPrinting(false);
    }
  }

  async function handleTestPrint() {
    setError(null);
    setInfo(null);
    const target = normalizePrinterUrl(settingsUrl);
    const formatValue = settingsFormat.trim() || 'Kensar';
    if (!target) {
      setError('Debes ingresar la URL de la impresora.');
      return;
    }
    setProbePrinting(true);
    try {
      await printWithBestPath(target, [
        {
          CODIGO: '3519',
          BARRAS: '3519',
          NOMBRE: 'Test Metrik Stock',
          PRECIO: '$22.000',
          format: formatValue,
          copies: 1,
        },
      ]);
      setInfo('Impresión de prueba enviada.');
      setPrinterStatus('online');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar prueba.');
      setPrinterStatus('offline');
    } finally {
      setProbePrinting(false);
    }
  }

  function handleSelectProduct(product: ReceivingProductLookup) {
    setSelectedProduct(product);
    setQtyInput('1');
    setStep('print');
    setError(null);
    setInfo(null);
  }

  function handleBackToSearch() {
    setStep('search');
    setError(null);
    setInfo(null);
  }

  return (
    <ScreenContainer backgroundColor="#E9EDF3">
      <View style={styles.topRow}>
        <View style={styles.printerStatusWrap}>
          <View style={[styles.statusDot, { backgroundColor: printerStatusMeta.color }]} />
          <Text style={styles.printerStatusText}>{printerStatusMeta.label}</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              checkPrinterConnection().catch(() => undefined);
            }}
            disabled={printing}
          >
            <Text style={styles.secondaryButtonText}>Verificar</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={openSettings}>
            <Text style={styles.secondaryButtonText}>Config</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {info ? <Text style={styles.infoText}>{info}</Text> : null}

      {step === 'search' ? (
        <View style={styles.searchPanel}>
          <Text style={styles.searchTitle}>Imprimir etiqueta</Text>
          <Text style={styles.searchHelp}>Busca un producto y selecciónalo.</Text>

          <Text style={styles.label}>Buscar producto (nombre / SKU / código de barras)</Text>
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setSelectedProduct(null);
            }}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Ej: speaker 12, SK-100..."
            placeholderTextColor="#64748b"
          />

          <View style={styles.helperRow}>
            <Text style={styles.helperText}>Mínimo 2 caracteres.</Text>
            <Text style={styles.helperText}>{sortedResults.length} resultados</Text>
          </View>

          {searching ? <ActivityIndicator color="#0A8F5A" /> : null}

          <View style={styles.resultsWrap}>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <View style={styles.resultsContent}>
                {sortedResults.length === 0 && query.trim().length >= 2 && !searching ? (
                  <Text style={styles.noResults}>Sin coincidencias.</Text>
                ) : null}
                {sortedResults.map((product) => (
                  <Pressable key={product.id} style={styles.resultItem} onPress={() => handleSelectProduct(product)}>
                    <Text style={styles.resultName} numberOfLines={3}>
                      {product.name}
                    </Text>
                    <Text style={styles.resultMeta}>
                      SKU: {product.sku || 'N/A'} · Código de barras: {product.barcode || 'N/A'}
                    </Text>
                    <Text style={styles.priceText}>Venta: {formatPriceText(product.price)}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      ) : (
        <View style={styles.searchPanel}>
          <View style={styles.printHeaderRow}>
            <Text style={styles.searchTitle}>Confirmar impresión</Text>
            <Pressable style={styles.secondaryButton} onPress={handleBackToSearch}>
              <Text style={styles.secondaryButtonText}>Volver</Text>
            </Pressable>
          </View>

          {selectedProduct ? (
            <View style={styles.selectedCard}>
              <Text style={styles.selectedName}>{selectedProduct.name}</Text>
              <Text style={styles.selectedMeta}>SKU: {selectedProduct.sku || 'N/A'}</Text>
              <Text style={styles.selectedMeta}>Código de barras: {selectedProduct.barcode || 'N/A'}</Text>
              <Text style={styles.selectedPrice}>Venta: {formatPriceText(selectedProduct.price)}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Cantidad</Text>
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
              style={[styles.input, styles.qtyInput]}
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
            style={[styles.printButtonLarge, printing ? styles.printButtonDisabled : null]}
            onPress={handlePrint}
            disabled={printing}
          >
            <Text style={styles.printButtonText}>{printing ? 'Imprimiendo...' : 'Imprimir etiqueta'}</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Configuración impresora</Text>
            <Text style={styles.label}>URL impresora SATO</Text>
            <TextInput
              value={settingsUrl}
              onChangeText={setSettingsUrl}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://10.10.20.19:8081"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.label}>Formato etiqueta</Text>
            <TextInput
              value={settingsFormat}
              onChangeText={setSettingsFormat}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Kensar"
              placeholderTextColor="#64748b"
            />

            <View style={styles.discoveryHeader}>
              <Text style={styles.label}>Autodetección (LAN)</Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  discoverPrinters().catch(() => undefined);
                }}
                disabled={discoveringPrinters}
              >
                <Text style={styles.secondaryButtonText}>
                  {discoveringPrinters ? 'Buscando...' : 'Detectar'}
                </Text>
              </Pressable>
            </View>
            {discoveryMessage ? <Text style={styles.discoveryMessage}>{discoveryMessage}</Text> : null}
            {discoveringPrinters ? <ActivityIndicator color="#0A8F5A" /> : null}
            {discoveredPrinters.length > 0 ? (
              <View style={styles.discoveryList}>
                <ScrollView nestedScrollEnabled style={styles.discoveryScroll}>
                  <View style={styles.discoveryContent}>
                    {discoveredPrinters.map((url) => (
                      <Pressable
                        key={url}
                        style={styles.discoveryItem}
                        onPress={() => {
                          setSettingsUrl(url);
                          setDiscoveryMessage(`Seleccionada: ${url}`);
                        }}
                      >
                        <Text style={styles.discoveryItemText}>{url}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={() => setShowSettings(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={handleTestPrint} disabled={probePrinting}>
                <Text style={styles.secondaryButtonText}>{probePrinting ? 'Probando...' : 'Enviar test'}</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={saveSettings}>
                <Text style={styles.saveButtonText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  printerStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  printerStatusText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  searchPanel: {
    marginTop: 8,
    backgroundColor: '#D8E1EC',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  searchTitle: {
    color: '#0F172A',
    fontSize: 21,
    fontWeight: '800',
  },
  searchHelp: {
    color: '#475569',
    fontSize: 13,
  },
  printHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectedCard: {
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  selectedName: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  selectedMeta: {
    color: '#334155',
    fontSize: 14,
  },
  selectedPrice: {
    marginTop: 2,
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
  },
  label: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
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
  resultsWrap: {
    maxHeight: 280,
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
  noResults: {
    color: '#64748B',
    fontSize: 13,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  resultItem: {
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  resultItemSelected: {
    borderColor: '#8AC9A6',
    backgroundColor: '#DCEFE3',
  },
  resultName: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  resultMeta: {
    color: '#334155',
    fontSize: 13,
  },
  priceText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 30,
    fontWeight: '700',
    paddingVertical: 8,
  },
  qtyStepBtn: {
    width: 62,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  qtyStepText: {
    color: '#334155',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 34,
  },
  printButton: {
    marginTop: 4,
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  printButtonLarge: {
    marginTop: 6,
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  printButtonDisabled: {
    opacity: 0.65,
  },
  printButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 17,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    marginTop: 2,
  },
  infoText: {
    color: '#0A8F5A',
    fontSize: 13,
    marginTop: 2,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#DCEFE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 14,
    gap: 8,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  discoveryHeader: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  discoveryMessage: {
    color: '#64748B',
    fontSize: 12,
  },
  discoveryList: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  discoveryScroll: {
    maxHeight: 180,
  },
  discoveryContent: {
    padding: 6,
    gap: 6,
  },
  discoveryItem: {
    borderWidth: 1,
    borderColor: '#B7C4D5',
    borderRadius: 8,
    backgroundColor: '#EEF3F9',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  discoveryItemText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },
  modalActions: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  saveButton: {
    minWidth: 88,
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A8F5A',
  },
  saveButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
});
