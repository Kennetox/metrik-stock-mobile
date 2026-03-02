import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppSession } from '../contexts/AppSessionContext';
import { ScreenContainer } from '../ui/ScreenContainer';

export function SettingsScreen() {
  const {
    apiBase,
    setApiBase,
    stationId,
    setStationId,
    printerDirectUrl,
    setPrinterDirectUrl,
    printerAgentUrl,
    setPrinterAgentUrl,
    labelFormat,
    setLabelFormat,
  } = useAppSession();

  return (
    <ScreenContainer backgroundColor="#E9EDF3">
      <Text style={styles.title}>Configuración</Text>
      <Text style={styles.subtitle}>Parámetros de API e impresión</Text>

      <View style={styles.card}>
        <Text style={styles.label}>API Base</Text>
        <TextInput
          value={apiBase}
          onChangeText={setApiBase}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>ID estación tablet</Text>
        <TextInput
          value={stationId}
          onChangeText={setStationId}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <Text style={styles.label}>Impresión directa SATO URL</Text>
        <TextInput
          value={printerDirectUrl}
          onChangeText={setPrinterDirectUrl}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Fallback agente URL</Text>
        <TextInput
          value={printerAgentUrl}
          onChangeText={setPrinterAgentUrl}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Formato etiqueta</Text>
        <TextInput
          value={labelFormat}
          onChangeText={setLabelFormat}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#475569',
  },
  card: {
    marginTop: 8,
    backgroundColor: '#CFD8E3',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  label: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#B7C4D5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
  },
});
