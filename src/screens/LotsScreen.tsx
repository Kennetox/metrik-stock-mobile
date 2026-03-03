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

type SupportDraftFile = {
  uri: string;
  name: string;
  type: string;
};

export function LotsScreen({ onOpenLot }: { onOpenLot: (lotId: number) => void }) {
  const { apiClient, stationId, stationLabel } = useAppSession();
  const [lots, setLots] = useState<ReceivingLot[]>([]);
  const [latestClosedLot, setLatestClosedLot] = useState<ReceivingLot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<'cash' | 'invoice'>('cash');
  const [createOrigin, setCreateOrigin] = useState('');
  const [createSupplier, setCreateSupplier] = useState('');
  const [createReference, setCreateReference] = useState('');
  const [createNotes, setCreateNotes] = useState('');
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [openLots, closedLots] = await Promise.all([
        listLots(apiClient, { status: 'open', limit: 50, skip: 0 }),
        listLots(apiClient, { status: 'closed', limit: 1, skip: 0 }),
      ]);
      setLots(openLots.items);
      setLatestClosedLot(closedLots.items[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar lotes');
    }
  }, [apiClient]);

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

  async function handleCreateLot() {
    setCreateType('cash');
    setCreateOrigin(stationLabel?.trim() || stationId || 'Recepción');
    setCreateSupplier('');
    setCreateReference('');
    setCreateNotes('');
    setCreateSupportFile(null);
    setShowCreateModal(true);
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
    const origin = createOrigin.trim();
    if (!origin) {
      setError('Debes indicar el origen del lote.');
      return;
    }
    if (createType === 'invoice') {
      if (!createSupplier.trim()) {
        setError('Para factura, el proveedor es obligatorio.');
        return;
      }
      if (!createReference.trim()) {
        setError('Para factura, la referencia/número de factura es obligatorio.');
        return;
      }
    }
    setCreating(true);
    try {
      const created = await createLot(apiClient, {
        purchase_type: createType,
        origin_name: origin,
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
      onOpenLot(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el lote');
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
      <View style={styles.headerRow}>
        <Text style={styles.title}>Lotes abiertos</Text>
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={handleCreateLot}>
            <Text style={styles.buttonText}>Nuevo lote</Text>
          </Pressable>
        </View>
      </View>

      {loading ? <ActivityIndicator color="#93c5fd" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.list}>
        {lots.length === 0 && !loading ? <Text style={styles.empty}>Sin lotes abiertos</Text> : null}

        {lots.map((lot) => (
          <View key={lot.id} style={styles.lotCard}>
            <View style={styles.lotCardRow}>
              <Pressable style={styles.lotMainPressable} onPress={() => onOpenLot(lot.id)}>
                <Text style={styles.lotNumber}>{lot.lot_number}</Text>
                <Text style={styles.lotMeta}>{lot.origin_name}</Text>
                <Text style={styles.lotMeta}>Tipo: {formatPurchaseType(lot.purchase_type)}</Text>
                {lot.purchase_type === 'invoice' && lot.supplier_name ? (
                  <Text style={styles.lotMeta}>Proveedor: {lot.supplier_name}</Text>
                ) : null}
                {lot.purchase_type === 'invoice' && (lot.invoice_reference || lot.source_reference) ? (
                  <Text style={styles.lotMeta}>Ref: {lot.invoice_reference ?? lot.source_reference}</Text>
                ) : null}
                {lot.notes ? <Text style={styles.lotMeta}>Obs: {lot.notes}</Text> : null}
              </Pressable>
              <Pressable style={styles.moreButton} onPress={() => openLotActions(lot)}>
                <Text style={styles.moreButtonText}>⋮</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <View style={styles.lastClosedWrap}>
          <Text style={styles.lastClosedTitle}>Último lote cerrado</Text>
          {latestClosedLot ? (
            <View style={styles.closedCard}>
              <Text style={styles.lotNumber}>{latestClosedLot.lot_number}</Text>
              <Text style={styles.lotMeta}>{latestClosedLot.origin_name}</Text>
              <Text style={styles.lotMeta}>Tipo: {formatPurchaseType(latestClosedLot.purchase_type)}</Text>
              {latestClosedLot.purchase_type === 'invoice' && latestClosedLot.supplier_name ? (
                <Text style={styles.lotMeta}>Proveedor: {latestClosedLot.supplier_name}</Text>
              ) : null}
              {latestClosedLot.notes ? <Text style={styles.lotMeta}>Obs: {latestClosedLot.notes}</Text> : null}
            </View>
          ) : (
            <Text style={styles.empty}>Aún no hay lotes cerrados</Text>
          )}
        </View>
      </View>

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo lote</Text>

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
              disabled={creating}
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
                }}
                disabled={creating}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={submitCreateLot} disabled={creating}>
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
              <Pressable style={styles.actionPrimaryButton} onPress={openEditTypeModal}>
                <Text style={styles.actionPrimaryText}>Editar tipo (Contado / Factura)</Text>
              </Pressable>
              <Pressable style={styles.actionDangerButton} onPress={openCancelConfirm}>
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
              disabled={updatingLot}
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
              <Pressable style={styles.saveButton} onPress={submitEditType} disabled={updatingLot}>
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
              <Pressable style={styles.actionDangerButton} onPress={submitCancelLot} disabled={cancellingLot}>
                <Text style={styles.actionDangerText}>{cancellingLot ? 'Cancelando...' : 'Sí, cancelar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function formatPurchaseType(type: string) {
  if (type === 'cash') return 'Contado';
  if (type === 'invoice') return 'Factura';
  return type;
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
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
  list: {
    gap: 10,
  },
  lotCard: {
    backgroundColor: '#CFD8E3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    padding: 12,
    gap: 2,
  },
  lotCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  lotMainPressable: {
    flex: 1,
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
    fontSize: 16,
    fontWeight: '700',
  },
  lotMeta: {
    color: '#334155',
  },
  error: {
    color: '#fda4af',
  },
  empty: {
    color: '#475569',
  },
  lastClosedWrap: {
    marginTop: 10,
    gap: 8,
  },
  lastClosedTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  closedCard: {
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    gap: 2,
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
