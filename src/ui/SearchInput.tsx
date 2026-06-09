import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

type SearchInputProps = TextInputProps & {
  containerStyle?: StyleProp<ViewStyle>;
  onClear?: () => void;
  clearLabel?: string;
};

export function SearchInput({ containerStyle, onClear, clearLabel = 'Limpiar búsqueda', style, value, ...props }: SearchInputProps) {
  const hasValue = typeof value === 'string' ? value.trim().length > 0 : Boolean(value);

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        {...props}
        value={value}
        style={[styles.input, style]}
      />
      {hasValue ? (
        <Pressable
          style={styles.clearButton}
          onPress={() => {
            onClear?.();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
        >
          <Text style={styles.clearButtonText}>x</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: '#0F172A',
    backgroundColor: 'transparent',
    fontSize: 15,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  clearButtonText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
});
