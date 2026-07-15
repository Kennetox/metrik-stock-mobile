import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { launchCamera } from 'react-native-image-picker';

import { useAppSession } from '../contexts/AppSessionContext';
import {
  cancelReceivingLot,
  createLot,
  listLots,
  updateReceivingLot,
  uploadReceivingLotSupportFile,
} from '../services/api/receiving';
import type { ReceivingLot } from '../types/receiving';
import { ScreenContainer } from '../ui/ScreenContainer';
import { formatBogotaDateTime } from '../utils/dateTime';

type SupportDraftFile = {
  uri: string;
  name: string;
  type: string;
};

function belongsToStockDevice(stockDeviceId: string, candidate?: string | null): boolean {
  const current = stockDeviceId.trim();
  const lotDevice = (candidate || '').trim();
  if (!current || !lotDevice) return false;
  return current === lotDevice;
}

function formatPurchaseType(type: string) {
  if (type === 'cash') return 'Contado';
  if (type === 'invoice') return 'Factura';
  return type;
}

export function LotsScreen({ onOpenLot }: { onOpenLot: (lotId: number) => void }) {
  const { apiClient, stationId, stationLabel, stockDeviceId, syncStatus } = useAppSession();
  const [lots, setLots] = useState<ReceivingLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<'cash' | 'invoice'>('cash');
  const [createOrigin, setCreateOrigin] = useState('');
  const [createSupplier, setCreateSupplier] = useState('');
  const [createReference, setCreateReference] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedLot, setSelectedLot] = useState<ReceivingLot | null>(null);
  const [showLotActionsModal, setShowLotActionsModal] = useState(false);
  const [showEditTypeModal, setShowEditTypeModal] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [editType, setEditType] = useState<'cash' | 'invoice'>('cash');
  const [editSupplier, setEditSupplier] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [createSupportFile, setCreateSupportFile] = useState<SupportDraftFile | null>(null);
  const [editSupportFile, setEditSupportFile] = useState<SupportDraftFile | null>(null);
  const [updatingLot, setUpdatingLot] = useState(false);
  const [cancellingLot, setCancellingLot] = useState(false);
  const canMutate = syncStatus === 'online' || syncStatus === 'degraded';

  function ensureCanMutate(): boolean {
    if (canMutate) return true;
    setError('Sin conexión con API. Revalida la conexión para continuar.');
    return false;
  }

  const orderedLots = [...lots].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const primaryLot = orderedLots[0] ?? null;
  const hasOpenLots = orderedLots.length > 0;

  const load = useCallback(async () => {
    setError(null);
    try {
      const openLots = await listLots(apiClient, { status: 'open', limit: 50, skip: 0 });
      const filteredOpenLots = openLots.items.filter((lot) =>
        belongsToStockDevice(stockDeviceId, lot.stock_device_id),
      );
      setLots(filteredOpenLots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar lotes');
    }
  }, [apiClient, stockDeviceId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().finally(() => {
      if (active) {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [load]);

  function openCreateLotModal() {
    if (!ensureCanMutate()) return;
    setError(null);
    setCreateModalError(null);
    setCreateType('cash');
    setCreateOrigin(stationLabel?.trim() || stationId || 'Recepción');
    setCreateSupplier('');
    setCreateReference('');
    setCreateNotes('');
    setCreateSupportFile(null);
    setShowCreateModal(true);
  }

  async function handleCreateLot() {
    if (!ensureCanMutate()) return;
    if (!hasOpenLots || !primaryLot) {
      openCreateLotModal();
      return;
    }
    Alert.alert(
      'Ya hay lotes en curso',
      'Continúa un lote existente antes de abrir otro para evitar recepciones duplicadas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Continuar lote',
          onPress: () => onOpenLot(primaryLot.id),
        },
        {
          text: 'Crear otro',
          onPress: openCreateLotModal,
        },
      ],
    );
  }

  async function pickSupportFromFiles(): Promise<SupportDraftFile | null> {
    try {
      const picks = await pick({
        mode: 'open',
        allowMultiSelection: false,
        type: [types.images, types.pdf, types.doc, types.docx, types.plainText],
      });
      const selected = picks[0];
      if (!selected?.uri) return null;
      return {
        uri: selected.uri,
        name: selected.name || `soporte-${Date.now()}`,
        type: selected.type || 'application/octet-stream',
      };
    } catch (err: unknown) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        return null;
      }
      throw err;
    }
  }

  async function pickSupportFromCamera(): Promise<SupportDraftFile | null> {
    const result = await launchCamera({
      mediaType: 'photo',
      includeBase64: false,
      saveToPhotos: false,
      quality: 0.8,
    });
    if (result.didCancel) return null;
    const selected = result.assets?.[0];
    if (!selected?.uri) {
      throw new Error('No se pudo capturar la foto.');
    }
    return {
      uri: selected.uri,
      name: selected.fileName || `soporte-${Date.now()}.jpg`,
      type: selected.type || 'image/jpeg',
    };
  }

  function selectSupportFile(target: 'create' | 'edit') {
    if (!ensureCanMutate()) return;
    setError(null);
    Alert.alert('Adjuntar soporte', 'Elige el origen del archivo de soporte.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cámara',
        onPress: async () => {
          try {
            const file = await pickSupportFromCamera();
            if (!file) return;
            if (target === 'create') setCreateSupportFile(file);
            if (target === 'edit') setEditSupportFile(file);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo tomar la foto.');
          }
        },
      },
      {
        text: 'Archivos',
        onPress: async () => {
          try {
            const file = await pickSupportFromFiles();
            if (!file) return;
            if (target === 'create') setCreateSupportFile(file);
            if (target === 'edit') setEditSupportFile(file);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo seleccionar el archivo.');
          }
        },
      },
    ]);
  }

  async function submitCreateLot() {
    if (!ensureCanMutate()) return;
    setCreateModalError(null);
    const origin = createOrigin.trim();
    if (!origin) {
      setCreateModalError('Debes indicar el origen del lote.');
      return;
    }
    if (createType === 'invoice') {
      if (!createSupplier.trim()) {
        setCreateModalError('Para factura, el proveedor es obligatorio.');
        return;
      }
      if (!createReference.trim()) {
        setCreateModalError('Para factura, la referencia/número de factura es obligatorio.');
        return;
      }
    }
    setCreating(true);
    try {
      const created = await createLot(apiClient, {
        purchase_type: createType,
        origin_name: origin,
        stock_device_id: stockDeviceId || undefined,
        supplier_name: createType === 'invoice' ? createSupplier.trim() : undefined,
        invoice_reference: createType === 'invoice' ? createReference.trim() : undefined,
        source_reference: createType === 'invoice' ? createReference.trim() : undefined,
        notes: createNotes.trim() || undefined,
      });
      if (createSupportFile) {
        await uploadReceivingLotSupportFile(apiClient, created.id, createSupportFile);
      }
      setShowCreateModal(false);
      setCreateSupportFile(null);
      setCreateModalError(null);
      onOpenLot(created.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo crear el lote';
      setCreateModalError(message);
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  function openLotActions(lot: ReceivingLot) {
    setSelectedLot(lot);
    setShowLotActionsModal(true);
  }

  function closeLotActions() {
    setShowLotActionsModal(false);
  }

  function openEditTypeModal() {
    if (!selectedLot) return;
    setEditType(selectedLot.purchase_type);
    setEditSupplier(selectedLot.supplier_name ?? '');
    setEditReference(selectedLot.invoice_reference ?? selectedLot.source_reference ?? '');
    setEditNotes(selectedLot.notes ?? '');
    setEditSupportFile(null);
    setShowLotActionsModal(false);
    setShowEditTypeModal(true);
  }

  async function submitEditType() {
    if (!ensureCanMutate()) return;
    if (!selectedLot) return;
    if (editType === 'invoice') {
      if (!editSupplier.trim()) {
        setError('Para factura, el proveedor es obligatorio.');
        return;
      }
      if (!editReference.trim()) {
        setError('Para factura, la referencia/número de factura es obligatorio.');
        return;
      }
    }
    setUpdatingLot(true);
    setError(null);
    try {
      await updateReceivingLot(apiClient, selectedLot.id, {
        purchase_type: editType,
        supplier_name: editType === 'invoice' ? editSupplier.trim() : undefined,
        invoice_reference: editType === 'invoice' ? editReference.trim() : undefined,
        source_reference: editType === 'invoice' ? editReference.trim() : undefined,
        notes: editNotes.trim() || undefined,
      });
      if (editSupportFile) {
        await uploadReceivingLotSupportFile(apiClient, selectedLot.id, editSupportFile);
      }
      setShowEditTypeModal(false);
      setSelectedLot(null);
      setEditSupportFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el lote');
    } finally {
      setUpdatingLot(false);
    }
  }

  function openCancelConfirm() {
    setShowLotActionsModal(false);
    setShowCancelConfirmModal(true);
  }

  async function submitCancelLot() {
    if (!ensureCanMutate()) return;
    if (!selectedLot) return;
    setCancellingLot(true);
    setError(null);
    try {
      await cancelReceivingLot(apiClient, selectedLot.id);
      setShowCancelConfirmModal(false);
      setSelectedLot(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el lote');
    } finally {
      setCancellingLot(false);
    }
  }

  return (
    <ScreenContainer backgroundColor="#E9EDF3">
      <View style={[styles.statusHero, hasOpenLots ? styles.statusHeroActive : styles.statusHeroIdle]}>
        <View style={styles.statusHeaderRow}>
          <View style={[styles.statusBadge, hasOpenLots ? styles.statusBadgeActive : styles.statusBadgeIdle]}>
            <Text style={[styles.statusBadgeText, hasOpenLots ? styles.statusBadgeTextActive : styles.statusBadgeTextIdle]}>
              {hasOpenLots ? 'EN CURSO' : 'LISTO'}
            </Text>
          </View>
          <Pressable
            style={[
              hasOpenLots ? styles.secondaryButton : styles.primaryButton,
              !canMutate ? styles.buttonDisabled : null,
            ]}
            onPress={handleCreateLot}
            disabled={!canMutate}
          >
            <Text style={hasOpenLots ? styles.secondaryButtonText : styles.primaryButtonText}>
              {hasOpenLots ? 'Crear otro lote' : 'Nuevo lote'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.statusTitle}>
          {hasOpenLots
            ? orderedLots.length === 1
              ? 'Hay 1 lote en curso'
              : `Hay ${orderedLots.length} lotes en curso`
            : 'No hay lotes en curso'}
        </Text>
        <Text style={styles.statusDescription}>
          {hasOpenLots
            ? 'Continúa un lote existente antes de abrir otro para mantener la recepción clara y sin duplicados.'
            : 'La tablet está lista para iniciar una nueva recepción.'}
        </Text>

        {primaryLot ? (
          <View style={styles.statusRecommendation}>
            <Text style={styles.statusRecommendationLabel}>Recomendado ahora</Text>
            <Text style={styles.statusRecommendationTitle}>{primaryLot.lot_number}</Text>
            <Text style={styles.statusRecommendationMeta}>
              Abierto: {formatBogotaDateTime(primaryLot.created_at)}
              {primaryLot.created_by_user_name ? ` · ${primaryLot.created_by_user_name}` : ''}
            </Text>
            <View style={styles.statusActionRow}>
              <Pressable style={styles.primaryButton} onPress={() => onOpenLot(primaryLot.id)}>
                <Text style={styles.primaryButtonText}>Continuar lote</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color="#93c5fd" /> : null}
      {!canMutate ? <Text style={styles.warning}>Sin conexión: edición y cierre de documentos bloqueados.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.title}>Lotes en curso</Text>
          <Text style={styles.sectionSubtitle}>
            {hasOpenLots
              ? 'Abre uno existente para continuar la recepción.'
              : 'No hay lotes abiertos en esta tablet.'}
          </Text>
        </View>
        {hasOpenLots ? (
          <View style={styles.sectionCounter}>
            <Text style={styles.sectionCounterText}>{orderedLots.length}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.list}>
        {!hasOpenLots && !loading ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateTitle}>Sin lotes abiertos</Text>
            <Text style={styles.emptyStateText}>
              Cuando inicies una recepción, el lote activo aparecerá aquí con acceso rápido para continuar.
            </Text>
          </View>
        ) : null}

        {orderedLots.map((lot, index) => (
          <View
            key={lot.id}
            style={[styles.lotCard, index === 0 ? styles.lotCardPriority : null]}
          >
            <View style={styles.lotCardTopRow}>
              <View style={styles.lotIdentity}>
                <Text style={styles.lotNumber}>{lot.lot_number}</Text>
                <Text style={styles.lotMetaStrong}>{lot.origin_name}</Text>
              </View>
              <View style={styles.lotTopActions}>
                <View style={styles.lotStatusBadge}>
                  <Text style={styles.lotStatusBadgeText}>En curso</Text>
                </View>
                <Pressable style={styles.moreButton} onPress={() => openLotActions(lot)}>
                  <Text style={styles.moreButtonText}>⋮</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.lotDetails}>
              <Text style={styles.lotMeta}>Tipo: {formatPurchaseType(lot.purchase_type)}</Text>
              <Text style={styles.lotMeta}>Apertura: {formatBogotaDateTime(lot.created_at)}</Text>
              {lot.created_by_user_name ? <Text style={styles.lotMeta}>Abrió: {lot.created_by_user_name}</Text> : null}
              {lot.purchase_type === 'invoice' && lot.supplier_name ? (
                <Text style={styles.lotMeta}>Proveedor: {lot.supplier_name}</Text>
              ) : null}
              {lot.purchase_type === 'invoice' && (lot.invoice_reference || lot.source_reference) ? (
                <Text style={styles.lotMeta}>Ref: {lot.invoice_reference ?? lot.source_reference}</Text>
              ) : null}
              {lot.notes ? <Text style={styles.lotMeta}>Obs: {lot.notes}</Text> : null}
            </View>

            <View style={styles.lotCardActions}>
              <Pressable style={styles.primaryButton} onPress={() => onOpenLot(lot.id)}>
                <Text style={styles.primaryButtonText}>Abrir lote</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo lote</Text>

            {createModalError ? <Text style={styles.modalError}>{createModalError}</Text> : null}

            <Text style={styles.modalLabel}>Tipo de compra</Text>
            <View style={styles.typeRow}>
              <Pressable
                style={[styles.typeButton, createType === 'cash' ? styles.typeButtonActive : null]}
                onPress={() => setCreateType('cash')}
              >
                <Text style={[styles.typeButtonText, createType === 'cash' ? styles.typeButtonTextActive : null]}>
                  Contado
                </Text>
              </Pressable>
              <Pressable
                style={[styles.typeButton, createType === 'invoice' ? styles.typeButtonActive : null]}
                onPress={() => setCreateType('invoice')}
              >
                <Text style={[styles.typeButtonText, createType === 'invoice' ? styles.typeButtonTextActive : null]}>
                  Factura
                </Text>
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Origen</Text>
            <TextInput
              value={createOrigin}
              onChangeText={setCreateOrigin}
              style={styles.modalInput}
              autoCapitalize="sentences"
              autoCorrect={false}
            />

            {createType === 'invoice' ? (
              <>
                <Text style={styles.modalLabel}>Proveedor</Text>
                <TextInput
                  value={createSupplier}
                  onChangeText={setCreateSupplier}
                  style={styles.modalInput}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                />
                <Text style={styles.modalLabel}>Referencia / N. factura</Text>
                <TextInput
                  value={createReference}
                  onChangeText={setCreateReference}
                  style={styles.modalInput}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </>
            ) : null}
            <Text style={styles.modalLabel}>Observación (opcional)</Text>
            <TextInput
              value={createNotes}
              onChangeText={setCreateNotes}
              style={[styles.modalInput, styles.modalTextarea]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect={false}
              placeholder="Ej: Mercancía frágil, revisar 2 cajas..."
              placeholderTextColor="#64748b"
            />

            <Text style={styles.modalLabel}>Soporte (opcional)</Text>
              <Pressable
                style={styles.supportPickerButton}
                onPress={() => selectSupportFile('create')}
                disabled={creating || !canMutate}
              >
              <Text style={styles.supportPickerButtonText}>
                {createSupportFile ? 'Cambiar soporte' : 'Adjuntar soporte'}
              </Text>
            </Pressable>
            {createSupportFile ? (
              <Text style={styles.supportFileName}>Archivo: {createSupportFile.name}</Text>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => {
                  setShowCreateModal(false);
                  setCreateSupportFile(null);
                  setCreateModalError(null);
                }}
                disabled={creating}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitCreateLot} disabled={creating || !canMutate}>
                <Text style={styles.saveButtonText}>{creating ? 'Creando...' : 'Crear lote'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showLotActionsModal} transparent animationType="fade" onRequestClose={closeLotActions}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Opciones del lote</Text>
            <Text style={styles.modalLabel}>{selectedLot?.lot_number ?? ''}</Text>
            <View style={styles.modalActionsStack}>
              <Pressable
                style={[styles.actionPrimaryButton, !canMutate ? styles.buttonDisabled : null]}
                onPress={openEditTypeModal}
                disabled={!canMutate}
              >
                <Text style={styles.actionPrimaryText}>Editar tipo (Contado / Factura)</Text>
              </Pressable>
              <Pressable
                style={[styles.actionDangerButton, !canMutate ? styles.buttonDisabled : null]}
                onPress={openCancelConfirm}
                disabled={!canMutate}
              >
                <Text style={styles.actionDangerText}>Cancelar recepción</Text>
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={closeLotActions}>
                <Text style={styles.cancelButtonText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEditTypeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditTypeModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Editar tipo de compra</Text>
            <Text style={styles.modalLabel}>{selectedLot?.lot_number ?? ''}</Text>
            <View style={styles.typeRow}>
              <Pressable
                style={[styles.typeButton, editType === 'cash' ? styles.typeButtonActive : null]}
                onPress={() => setEditType('cash')}
              >
                <Text style={[styles.typeButtonText, editType === 'cash' ? styles.typeButtonTextActive : null]}>
                  Contado
                </Text>
              </Pressable>
              <Pressable
                style={[styles.typeButton, editType === 'invoice' ? styles.typeButtonActive : null]}
                onPress={() => setEditType('invoice')}
              >
                <Text style={[styles.typeButtonText, editType === 'invoice' ? styles.typeButtonTextActive : null]}>
                  Factura
                </Text>
              </Pressable>
            </View>
            {editType === 'invoice' ? (
              <>
                <Text style={styles.modalLabel}>Proveedor</Text>
                <TextInput
                  value={editSupplier}
                  onChangeText={setEditSupplier}
                  style={styles.modalInput}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                />
                <Text style={styles.modalLabel}>Referencia / N. factura</Text>
                <TextInput
                  value={editReference}
                  onChangeText={setEditReference}
                  style={styles.modalInput}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </>
            ) : null}
            <Text style={styles.modalLabel}>Observación (opcional)</Text>
            <TextInput
              value={editNotes}
              onChangeText={setEditNotes}
              style={[styles.modalInput, styles.modalTextarea]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect={false}
              placeholder="Ej: Mercancía frágil, revisar 2 cajas..."
              placeholderTextColor="#64748b"
            />
            <Text style={styles.modalLabel}>Soporte (opcional)</Text>
            <Pressable
              style={styles.supportPickerButton}
              onPress={() => selectSupportFile('edit')}
              disabled={updatingLot || !canMutate}
            >
              <Text style={styles.supportPickerButtonText}>
                {editSupportFile ? 'Cambiar soporte' : 'Adjuntar soporte'}
              </Text>
            </Pressable>
            {editSupportFile ? (
              <Text style={styles.supportFileName}>Archivo: {editSupportFile.name}</Text>
            ) : selectedLot?.support_file_name ? (
              <Text style={styles.supportFileName}>Actual: {selectedLot.support_file_name}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => {
                  setShowEditTypeModal(false);
                  setEditSupportFile(null);
                }}
                disabled={updatingLot}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitEditType} disabled={updatingLot || !canMutate}>
                <Text style={styles.saveButtonText}>{updatingLot ? 'Guardando...' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCancelConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCancelConfirmModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancelar recepción</Text>
            <Text style={styles.modalLabel}>
              ¿Seguro que deseas cancelar {selectedLot?.lot_number ?? 'este lote'}?
            </Text>
            <Text style={styles.confirmHint}>
              El lote pasará a estado cancelado y ya no saldrá como lote abierto.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={() => setShowCancelConfirmModal(false)} disabled={cancellingLot}>
                <Text style={styles.cancelButtonText}>Volver</Text>
              </Pressable>
              <Pressable style={styles.actionDangerButton} onPress={submitCancelLot} disabled={cancellingLot || !canMutate}>
                <Text style={styles.actionDangerText}>{cancellingLot ? 'Cancelando...' : 'Sí, cancelar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  },
  statusActionRow: {
    marginTop: 8,
    flexDirection: 'row',
  },
  sectionHeader: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
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
  primaryButton: {
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
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
  buttonDisabled: {
    opacity: 0.55,
  },
  list: {
    marginTop: 12,
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
  lotCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D3DEE8',
    padding: 14,
    gap: 12,
  },
  lotCardPriority: {
    borderColor: '#A7D6B6',
    backgroundColor: '#FCFEFD',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  lotCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  lotIdentity: {
    flex: 1,
  },
  lotTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lotStatusBadge: {
    backgroundColor: '#FFF4D6',
    borderWidth: 1,
    borderColor: '#EAC76A',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  lotStatusBadgeText: {
    color: '#946200',
    fontSize: 11,
    fontWeight: '800',
  },
  moreButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonText: {
    color: '#334155',
    fontSize: 20,
    lineHeight: 20,
    marginTop: -2,
    fontWeight: '700',
  },
  lotNumber: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
  },
  lotMetaStrong: {
    marginTop: 2,
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  lotDetails: {
    gap: 4,
  },
  lotMeta: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  lotCardActions: {
    flexDirection: 'row',
  },
  error: {
    color: '#fda4af',
  },
  modalError: {
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
  empty: {
    color: '#475569',
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
  modalLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    paddingVertical: 10,
    alignItems: 'center',
  },
  typeButtonActive: {
    borderColor: '#9ED9B3',
    backgroundColor: '#DCEFE3',
  },
  typeButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  typeButtonTextActive: {
    color: '#0A8F5A',
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
  modalTextarea: {
    minHeight: 74,
  },
  supportPickerButton: {
    backgroundColor: '#EAF7F0',
    borderWidth: 1,
    borderColor: '#9ED9B3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  supportPickerButtonText: {
    color: '#0A8F5A',
    fontWeight: '700',
  },
  supportFileName: {
    color: '#475569',
    fontSize: 12,
    marginTop: -4,
  },
  modalActions: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
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
  saveButton: {
    backgroundColor: '#0A8F5A',
    borderWidth: 1,
    borderColor: '#67C48D',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  modalActionsStack: {
    gap: 8,
    marginTop: 4,
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
  confirmHint: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
  },
});
