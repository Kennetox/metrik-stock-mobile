import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function ScreenContainer({
  children,
  backgroundColor = '#0b1220',
  scrollEnabled = true,
}: {
  children: React.ReactNode;
  backgroundColor?: string;
  scrollEnabled?: boolean;
}) {
  if (!scrollEnabled) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
        <View style={styles.content}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 16,
    gap: 14,
  },
});
