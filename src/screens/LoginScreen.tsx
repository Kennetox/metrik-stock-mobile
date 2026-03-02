import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';

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
};

export function LoginScreen() {
  const {
    apiClient,
    loginWithPin,
    tabletEmail,
    setTabletEmail,
    stationId,
    setStationId,
    stationLabel,
    setStationLabel,
    apiBase,
    setApiBase,
  } = useAppSession();
  const [emailInput, setEmailInput] = useState(tabletEmail);
  const [emailStageDone, setEmailStageDone] = useState(Boolean(tabletEmail));
  const [pin, setPin] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validatingEmail, setValidatingEmail] = useState(false);
  const PIN_LENGTH = 4;

  async function validateEmailAndContinue() {
    const normalizedEmail = emailInput.trim().toLowerCase();
    if (!normalizedEmail) {
      ToastAndroid.show('Ingresa un correo válido', ToastAndroid.SHORT);
      return;
    }
    setValidatingEmail(true);
    try {
      const response = await tabletEmailCheck(apiClient, { email: normalizedEmail });
      if (!response?.exists) {
        ToastAndroid.show('Correo no encontrado', ToastAndroid.SHORT);
        return;
      }
      setTabletEmail(normalizedEmail);
      setEmailInput(normalizedEmail);
      setEmailStageDone(true);
      setPin('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible validar correo';
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } finally {
      setValidatingEmail(false);
    }
  }

  async function attemptLogin(nextPin: string) {
    if (submitting || nextPin.length < PIN_LENGTH) {
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPin(nextPin, emailInput.trim().toLowerCase());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible iniciar sesión';
      const toastMessage = message.toLowerCase().includes('pin')
        ? 'Código incorrecto'
        : message;
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
      attemptLogin(nextPin);
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
    <ScreenContainer backgroundColor={COLORS.pageBg}>
      <View style={styles.brandWrap}>
        <Image source={require('../assets/logo-stock.png')} style={styles.logoImage} resizeMode="contain" />
        <View style={styles.brandTextWrap}>
          <Text style={styles.title}>Metrik Stock</Text>
          <Text style={styles.subtitle}>Recepción de inventario</Text>
        </View>
      </View>

      <View style={styles.card}>
        {!emailStageDone ? (
          <View style={styles.emailStageWrap}>
            <Text style={styles.emailStageLabel}>Correo de usuario</Text>
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
          </View>
        ) : (
          <>
            <View style={styles.pinHeaderRow}>
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
            </View>
            <View style={styles.pinDotsWrap}>
              {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.pinDot,
                    index < pin.length ? styles.pinDotFilled : styles.pinDotEmpty,
                  ]}
                />
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

      <Pressable style={styles.settingsButton} onPress={() => setShowSettings(true)}>
        <Text style={styles.settingsIcon}>⚙</Text>
      </Pressable>

      <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Configuración técnica</Text>

            <Text style={styles.label}>API Base</Text>
            <TextInput
              value={apiBase}
              onChangeText={setApiBase}
              style={styles.configInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>ID estación tablet</Text>
            <TextInput
              value={stationId}
              onChangeText={setStationId}
              style={styles.configInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Text style={styles.label}>Nombre estación tablet</Text>
            <TextInput
              value={stationLabel}
              onChangeText={setStationLabel}
              style={styles.configInput}
              autoCapitalize="sentences"
              autoCorrect={false}
            />

            <Pressable style={styles.modalCloseButton} onPress={() => setShowSettings(false)}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  emailInput: {
    backgroundColor: COLORS.inputBg,
    borderColor: COLORS.inputBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.inputText,
    fontSize: 18,
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
  pinDotsWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
    marginTop: 4,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  pinDotFilled: {
    backgroundColor: COLORS.dotOn,
  },
  pinDotEmpty: {
    backgroundColor: COLORS.dotOff,
    borderWidth: 1,
    borderColor: COLORS.dotOffBorder,
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
  keypad: {
    gap: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  keyButton: {
    width: '31%',
    backgroundColor: COLORS.keyBg,
    borderColor: COLORS.keyBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 18,
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
    fontWeight: '800',
    fontSize: 20,
  },
  settingsButton: {
    position: 'absolute',
    left: 20,
    bottom: 24,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.gearBg,
    borderWidth: 1,
    borderColor: COLORS.gearBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    color: COLORS.gearText,
    fontSize: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: COLORS.modalCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.modalBorder,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    color: COLORS.modalTitle,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  label: {
    color: COLORS.label,
    fontSize: 13,
    fontWeight: '600',
  },
  configInput: {
    backgroundColor: COLORS.inputBg,
    borderColor: COLORS.inputBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.inputText,
    fontSize: 15,
  },
  modalCloseButton: {
    marginTop: 6,
    backgroundColor: COLORS.closeBg,
    borderWidth: 1,
    borderColor: COLORS.closeBorder,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  modalCloseText: {
    color: COLORS.closeText,
    fontSize: 16,
    fontWeight: '700',
  },
});
