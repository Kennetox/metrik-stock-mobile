import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppSessionProvider, useAppSession } from '../contexts/AppSessionContext';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';

export function AppRoot() {
  return (
    <SafeAreaProvider>
      <AppSessionProvider>
        <AppGate />
      </AppSessionProvider>
    </SafeAreaProvider>
  );
}

function AppGate() {
  const { isAuthenticated, isHydrated } = useAppSession();
  if (!isHydrated) {
    return (
      <View style={styles.bootContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#E9EDF3" translucent={false} />
        <ActivityIndicator color="#93c5fd" size="large" />
      </View>
    );
  }
  if (isAuthenticated) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" translucent={false} />
        <HomeScreen />
      </>
    );
  }
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#E9EDF3" translucent={false} />
      <LoginScreen />
    </>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
