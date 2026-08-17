import { StyleSheet, Text, View } from 'react-native';
import type { Icon } from 'phosphor-react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  icon: Icon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

/** Brand-aware empty state — avoids copy-paste "nothing here" filler. */
export function EmptyState({ icon: IconComponent, title, subtitle, action }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <IconComponent size={28} color={colors.textMuted} weight="regular" />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 300,
  },
  action: {
    marginTop: spacing.md,
  },
});
