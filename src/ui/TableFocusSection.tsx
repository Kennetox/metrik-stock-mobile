import React, { useCallback, useMemo } from 'react';
import {
  LayoutAnimation,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  UIManager,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TableFocusSectionProps = {
  expanded: boolean;
  onChangeExpanded: (expanded: boolean) => void;
  children?: React.ReactNode;
  expandedLabel?: string;
  collapsedLabel?: string;
  showLabels?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function TableFocusSection({
  expanded,
  onChangeExpanded,
  children,
  expandedLabel = 'Desliza hacia arriba para ocultar el panel',
  collapsedLabel = 'Desliza hacia abajo para ver el panel',
  showLabels = true,
  style,
}: TableFocusSectionProps) {
  const triggerChange = useCallback((nextExpanded: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    onChangeExpanded(nextExpanded);
  }, [onChangeExpanded]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const isVertical = Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
          return isVertical && Math.abs(gestureState.dy) > 4;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          const isVertical = Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
          return isVertical && Math.abs(gestureState.dy) > 4;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < -18) {
            triggerChange(false);
            return;
          }
          if (gestureState.dy > 18) {
            triggerChange(true);
            return;
          }
          triggerChange(!expanded);
        },
      }),
    [expanded, triggerChange],
  );

  return (
    <View style={[styles.wrapper, style]}>
      <View
        accessibilityRole="button"
        accessibilityLabel={expanded ? expandedLabel : collapsedLabel}
        style={[
          styles.handle,
          expanded ? styles.handleExpanded : styles.handleCollapsed,
          !showLabels ? styles.handleCompact : null,
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.grip} />
        {showLabels ? <Text style={styles.handleText}>{expanded ? expandedLabel : collapsedLabel}</Text> : null}
      </View>

      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  handle: {
    alignSelf: 'stretch',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#B7C4D5',
    backgroundColor: '#F8FAFC',
    minHeight: 34,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  handleExpanded: {
    backgroundColor: '#DCEFE3',
    borderColor: '#9ED9B3',
  },
  handleCollapsed: {
    backgroundColor: '#FFFFFF',
  },
  handleCompact: {
    alignSelf: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  grip: {
    width: 26,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#94A3B8',
  },
  handleText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    gap: 10,
  },
});
