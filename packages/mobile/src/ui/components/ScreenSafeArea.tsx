import { StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';
import { colors } from '../../theme';

const EDGES: Edge[] = ['top', 'left', 'right'];

interface Props extends PropsWithChildren {
  backgroundColor?: string;
}

/**
 * Wraps a screen in the safe area (status bar / notch / landscape).
 * Bottom is intentionally excluded — tab bar handles its own inset, and
 * stack screens add bottom padding via insets for floating buttons.
 */
export function ScreenSafeArea({ children, backgroundColor = colors.bg }: Props) {
  return (
    <SafeAreaView edges={EDGES} style={[styles.container, { backgroundColor }]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
