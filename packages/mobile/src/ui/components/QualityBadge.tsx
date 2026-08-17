import { StyleSheet, Text, View } from 'react-native';
import type { QualityTier } from '../../types';
import { qualityTierColors, qualityTierLabels } from '../../theme';

interface Props {
  tier: QualityTier;
  /** Compact 16px variant for grids; default 20px for list rows. */
  size?: 'sm' | 'md';
}

/** Small colored badge H/M/L/VL — consistent with desktop quality tiers. */
export function QualityBadge({ tier, size = 'md' }: Props) {
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: qualityTierColors[tier] },
      ]}
    >
      <Text style={[styles.label, size === 'sm' ? styles.labelSm : styles.labelMd]}>
        {qualityTierLabels[tier]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sm: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
  },
  md: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
  },
  label: {
    color: '#0f0f0f',
    fontWeight: '700',
  },
  labelSm: {
    fontSize: 10,
    lineHeight: 14,
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 18,
  },
});
