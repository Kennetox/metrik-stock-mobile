import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSession } from '../contexts/AppSessionContext';
import { tabletEmailCheck } from '../services/api/auth';
import { ScreenContainer } from '../ui/ScreenContainer';

const COLORS = {
  pageBg: '#E9EDF3',
  title: '#0F172A',
  subtitle: '#334155',
  cardBg: '#CFD8E3',
  cardBorder: '#B7C4D5',
  dotOn: '#0A8F5A',
  dotOff: '#DCE3EE',
  dotOffBorder: '#B6C4D8',
  loading: '#0A8F5A',
  keyBg: '#F8FAFC',
  keyBorder: '#B7C4D5',
  keyText: '#0F172A',
  keySecondaryBg: '#E1E9F3',
  keySecondaryText: '#1D4ED8',
  gearBg: '#F8FAFC',
  gearBorder: '#B7C4D5',
  gearText: '#334155',
  modalCard: '#F8FAFC',
  modalBorder: '#B7C4D5',
  modalTitle: '#0F172A',
  label: '#334155',
  inputBg: '#FFFFFF',
  inputBorder: '#B7C4D5',
  inputText: '#0F172A',
  closeBg: '#DCEFE3',
  closeBorder: '#9ED9B3',
  closeText: '#0A8F5A',
  error: '#DC2626',
};

export function LoginScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const {
    apiClient,
    bindWithSetupCode,
    loginWithPin,
    stockDeviceId,
    tabletEmail,
    setTabletEmail,
    stationId,
    setStationId,
    stationLabel,
    setStationLabel,
    isInitialSetupComplete,
    completeInitialSetup,
    deviceBlockedReason,
    clearDeviceBlockedNotice,
  } = useAppSession();

  const [emailInput, setEmailInput] = useState(tabletEmail);
  const [emailStageDone, setEmailStageDone] = useState(Boolean(tabletEmail));
  const [preferLegacyLogin, setPreferLegacyLogin] = useState(false);
  const [setupCodeInput, setSetupCodeInput] = useState('');
  const [pin, setPin] = useState('');
  const [showSettings, setShowSettings] = useState(!isInitialSetupComplete);
  const [configError, setConfigError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [validatingEmail, setValidatingEmail] = useState(false);
  const [bindingDevice, setBindingDevice] = useState(false);
  const PIN_LENGTH = 4;

  useEffect(() => {
    if (!isInitialSetupComplete) {
      setShowSettings(true);
    }
  }, [isInitialSetupComplete]);

  useEffect(() => {
    if (!tabletEmail) {
      return;
    }
    setEmailInput(tabletEmail);
    setEmailStageDone(true);
  }, [tabletEmail]);

  const settingsMandatory = useMemo(() => !isInitialSetupComplete, [isInitialSetupComplete]);
  const hasBoundStockDevice = stockDeviceId.trim().length > 0;
  const requiresBinding = !hasBoundStockDevice && !emailStageDone && !preferLegacyLogin;

  function saveConfiguration() {
    if (!stationId.trim()) {
      setConfigError('Debes indicar ID local del dispositivo.');
      return;
    }
    if (!stationLabel.trim()) {
      setConfigError('Debes indicar nombre del dispositivo.');
      return;
    }
    setConfigError(null);
    if (settingsMandatory) {
      completeInitialSetup();
      setTabletEmail('');
      setEmailInput('');
      setEmailStageDone(false);
      setPreferLegacyLogin(false);
      setPin('');
    }
    setShowSettings(false);
  }

  async function validateEmailAndContinue() {
    if (settingsMandatory) {
      setShowSettings(true);
      ToastAndroid.show('Primero completa la configuración inicial.', ToastAndroid.SHORT);
      return;
    }

    const normalizedEmail = emailInput.trim().toLowerCase();
    if (!normalizedEmail) {
      ToastAndroid.show('Ingresa un correo válido', ToastAndroid.SHORT);
      return;
    }
    setValidatingEmail(true);
    try {
      const response = await tabletEmailCheck(apiClient, {
        station_id: stationId.trim() || undefined,
        email: normalizedEmail,
      });
      if (!response?.exists) {
        ToastAndroid.show('Correo no encontrado', ToastAndroid.SHORT);
        return;
      }
      setTabletEmail(normalizedEmail);
      setEmailInput(normalizedEmail);
      setEmailStageDone(true);
      setPreferLegacyLogin(false);
      setPin('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible validar correo';
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } finally {
      setValidatingEmail(false);
    }
  }

  async function handleBindDevice() {
    if (settingsMandatory) {
      setShowSettings(true);
      ToastAndroid.show('Primero completa la configuración inicial.', ToastAndroid.SHORT);
      return;
    }
    const normalizedCode = setupCodeInput.trim();
    if (!normalizedCode) {
      ToastAndroid.show('Ingresa el código de vinculación', ToastAndroid.SHORT);
      return;
    }
    setBindingDevice(true);
    try {
      await bindWithSetupCode(normalizedCode);
      setSetupCodeInput('');
      setPreferLegacyLogin(false);
      setPin('');
      ToastAndroid.show('Tablet vinculada correctamente', ToastAndroid.SHORT);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible vincular la tablet';
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } finally {
      setBindingDevice(false);
    }
  }

  async function attemptLogin(nextPin: string) {
    if (submitting || nextPin.length < PIN_LENGTH) {
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPin(nextPin, hasBoundStockDevice ? undefined : emailInput.trim().toLowerCase());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible iniciar sesión';
      const toastMessage = message.toLowerCase().includes('pin') ? 'Código incorrecto' : message;
      ToastAndroid.show(toastMessage, ToastAndroid.SHORT);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  function appendDigit(digit: string) {
    if (submitting || pin.length >= PIN_LENGTH) {
      return;
    }
    const nextPin = `${pin}${digit}`;
    setPin(nextPin);
    if (nextPin.length === PIN_LENGTH) {
      attemptLogin(nextPin).catch(() => undefined);
    }
  }

  function backspacePin() {
    if (submitting || pin.length === 0) {
      return;
    }
    setPin((prev) => prev.slice(0, -1));
  }

  function clearPin() {
    if (submitting) {
      return;
    }
    setPin('');
  }

  return (
    <ScreenContainer backgroundColor={COLORS.pageBg} scrollEnabled={false}>
      <View style={[styles.pageContent, { minHeight: Math.max(0, windowHeight - 32) }]}>
        <View style={styles.brandWrap}>
          <Image source={require('../assets/logo-stock.png')} style={styles.logoImage} resizeMode="contain" />
          <View style={styles.brandTextWrap}>
            <Text style={styles.title}>Metrik Stock</Text>
            <Text style={styles.subtitle}>Recepción de inventario</Text>
          </View>
        </View>

        <View style={styles.card}>
          {deviceBlockedReason ? (
            <View style={styles.blockedNotice}>
              <Text style={styles.blockedNoticeTitle}>Dispositivo bloqueado</Text>
              <Text style={styles.blockedNoticeText}>{deviceBlockedReason}</Text>
              <Pressable style={styles.blockedNoticeButton} onPress={clearDeviceBlockedNotice}>
                <Text style={styles.blockedNoticeButtonText}>Entendido</Text>
              </Pressable>
            </View>
          ) : null}
          {requiresBinding ? (
            <View style={styles.emailStageWrap}>
              <Text style={styles.emailStageLabel}>Código de vinculación</Text>
              <Text style={styles.bindingHelperText}>
                Genera el código desde Configuración en Metrik y úsalo una sola vez para autorizar esta tablet.
              </Text>
              <TextInput
                value={setupCodeInput}
                onChangeText={setSetupCodeInput}
                style={styles.emailInput}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor="#64748B"
                maxLength={12}
              />
              <Pressable
                style={styles.emailNextButton}
                onPress={() => {
                  handleBindDevice().catch(() => undefined);
                }}
                disabled={bindingDevice}
              >
                {bindingDevice ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.emailNextText}>Vincular tablet</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setPreferLegacyLogin(true)} disabled={bindingDevice}>
                <Text style={styles.pinChangeEmailText}>Usar correo legado</Text>
              </Pressable>
            </View>
          ) : !hasBoundStockDevice && !emailStageDone ? (
            <View style={styles.emailStageWrap}>
              <Text style={styles.emailStageLabel}>Correo de usuario</Text>
              <Text style={styles.bindingHelperText}>
                Modo legado. Solo úsalo si esta tablet todavía no ha sido vinculada con código.
              </Text>
              <View style={styles.emailInputWrap}>
                <TextInput
                  value={emailInput}
                  onChangeText={setEmailInput}
                  style={styles.emailInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="usuario@metrikpos.com"
                  placeholderTextColor="#64748B"
                />
                {emailInput.length > 0 ? (
                  <Pressable style={styles.emailClearBtn} onPress={() => setEmailInput('')} hitSlop={8}>
                    <Text style={styles.emailClearBtnText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                style={styles.emailNextButton}
                onPress={() => {
                  validateEmailAndContinue().catch(() => undefined);
                }}
                disabled={validatingEmail}
              >
                {validatingEmail ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.emailNextText}>Siguiente</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setPreferLegacyLogin(false)} disabled={validatingEmail}>
                <Text style={styles.pinChangeEmailText}>Usar código de vinculación</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.pinHeaderRow}>
                {hasBoundStockDevice ? (
                  <Text style={styles.pinEmailText} numberOfLines={2}>
                    {stationLabel || 'Tablet vinculada'}{'\n'}Ingresa tu PIN personal
                  </Text>
                ) : (
                  <>
                    <Text style={styles.pinEmailText} numberOfLines={1} ellipsizeMode="middle">
                      {emailInput}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setEmailStageDone(false);
                        setPin('');
                      }}
                    >
                      <Text style={styles.pinChangeEmailText}>Cambiar</Text>
                    </Pressable>
                  </>
                )}
              </View>

              <View style={styles.pinBoxesWrap}>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <View
                    key={index}
                    style={[styles.pinBox, index < pin.length ? styles.pinBoxFilled : styles.pinBoxEmpty]}
                  >
                    <Text style={[styles.pinBoxText, index < pin.length ? styles.pinBoxTextFilled : styles.pinBoxTextEmpty]}>
                      {pin[index] ?? ''}
                    </Text>
                  </View>
                ))}
              </View>

              {submitting ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color="#93c5fd" />
                  <Text style={styles.loadingText}>Validando código...</Text>
                </View>
              ) : null}

              <View style={styles.keypad}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <Pressable key={digit} style={styles.keyButton} onPress={() => appendDigit(digit)}>
                    <Text style={styles.keyText}>{digit}</Text>
                  </Pressable>
                ))}

                <Pressable style={[styles.keyButton, styles.secondaryKey]} onPress={clearPin}>
                  <Text style={styles.secondaryKeyText}>C</Text>
                </Pressable>
                <Pressable style={styles.keyButton} onPress={() => appendDigit('0')}>
                  <Text style={styles.keyText}>0</Text>
                </Pressable>
                <Pressable style={[styles.keyButton, styles.secondaryKey]} onPress={backspacePin}>
                  <Text style={styles.secondaryKeyText}>⌫</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={styles.loginSpacer} />
        <View style={[styles.footerRow, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Pressable style={styles.settingsButton} onPress={() => setShowSettings(true)}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={showSettings}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!settingsMandatory) {
            setShowSettings(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Configuración del dispositivo</Text>

            <Text style={styles.label}>ID local del dispositivo</Text>
            <TextInput
              value={stationId}
              onChangeText={setStationId}
              style={styles.configInput}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={settingsMandatory}
            />

            <Text style={styles.label}>Nombre del dispositivo de inventario</Text>
            <TextInput
              value={stationLabel}
              onChangeText={setStationLabel}
              style={styles.configInput}
              autoCapitalize="sentences"
              autoCorrect={false}
              editable={settingsMandatory}
            />

            {configError ? <Text style={styles.configError}>{configError}</Text> : null}

            {!settingsMandatory ? (
              <>
                <Text style={styles.label}>Re-vincular con código</Text>
                <TextInput
                  value={setupCodeInput}
                  onChangeText={setSetupCodeInput}
                  style={styles.configInput}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="Ingresa el código generado en Metrik"
                  placeholderTextColor="#64748B"
                />
                <Pressable style={styles.modalSaveButton} onPress={() => void handleBindDevice()} disabled={bindingDevice}>
                  {bindingDevice ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSaveText}>Vincular esta tablet</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            {settingsMandatory ? (
              <Pressable style={styles.modalSaveButton} onPress={saveConfiguration}>
                <Text style={styles.modalSaveText}>Guardar y continuar</Text>
              </Pressable>
            ) : null}

            {!settingsMandatory ? (
              <Pressable style={styles.modalCloseButton} onPress={() => setShowSettings(false)}>
                <Text style={styles.modalCloseText}>Cerrar</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    flex: 1,
  },
  brandWrap: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoImage: {
    width: 112,
    height: 112,
  },
  brandTextWrap: {
    gap: 4,
    alignItems: 'center',
    marginTop: 4,
  },
  title: {
    color: COLORS.title,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.subtitle,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  card: {
    marginTop: 8,
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    gap: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 3,
  },
  emailStageWrap: {
    gap: 10,
  },
  emailStageLabel: {
    color: '#1E293B',
    fontSize: 16,
    fontWeight: '700',
  },
  bindingHelperText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  emailInput: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderColor: COLORS.inputBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.inputText,
    fontSize: 18,
  },
  emailInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emailClearBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailClearBtnText: {
    color: '#334155',
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: -1,
  },
  emailNextButton: {
    marginTop: 4,
    backgroundColor: '#0A8F5A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#149B66',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailNextText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  pinHeaderRow: {
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pinEmailText: {
    flex: 1,
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  pinChangeEmailText: {
    color: '#1D4ED8',
    fontSize: 14,
    fontWeight: '700',
  },
  pinBoxesWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    marginTop: 6,
  },
  pinBox: {
    width: 60,
    height: 66,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  pinBoxFilled: {
    backgroundColor: '#F8FFFB',
    borderColor: '#69D3A0',
    shadowColor: '#0A8F5A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    elevation: 1,
  },
  pinBoxEmpty: {
    backgroundColor: '#F8FAFC',
    borderColor: '#B6C4D8',
  },
  pinBoxText: {
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  pinBoxTextFilled: {
    color: '#0A8F5A',
  },
  pinBoxTextEmpty: {
    color: '#94A3B8',
  },
  keypad: {
    gap: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  keyButton: {
    width: '31%',
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.keyBorder,
    backgroundColor: COLORS.keyBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    color: COLORS.keyText,
    fontSize: 28,
    fontWeight: '700',
  },
  secondaryKey: {
    backgroundColor: COLORS.keySecondaryBg,
  },
  secondaryKeyText: {
    color: COLORS.keySecondaryText,
    fontSize: 20,
    fontWeight: '800',
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  loadingText: {
    color: COLORS.loading,
    fontSize: 13,
  },
  blockedNotice: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  blockedNoticeTitle: {
    color: '#991B1B',
    fontWeight: '800',
    fontSize: 14,
  },
  blockedNoticeText: {
    color: '#7F1D1D',
    fontSize: 12,
    lineHeight: 18,
  },
  blockedNoticeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FECACA',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  blockedNoticeButtonText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '700',
  },
  loginSpacer: {
    flex: 1,
  },
  footerRow: {
    alignItems: 'flex-start',
  },
  settingsButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: COLORS.gearBorder,
    backgroundColor: COLORS.gearBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    color: COLORS.gearText,
    fontSize: 30,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.28)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: COLORS.modalCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.modalBorder,
    padding: 18,
    gap: 8,
  },
  modalTitle: {
    color: COLORS.modalTitle,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
  },
  label: {
    color: COLORS.label,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  configInput: {
    backgroundColor: COLORS.inputBg,
    borderColor: COLORS.inputBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: COLORS.inputText,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  configError: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  modalSaveButton: {
    marginTop: 10,
    backgroundColor: '#0A8F5A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#149B66',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  modalCloseButton: {
    marginTop: 8,
    backgroundColor: COLORS.closeBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.closeBorder,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: COLORS.closeText,
    fontSize: 18,
    fontWeight: '700',
  },
});
