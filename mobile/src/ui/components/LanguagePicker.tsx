import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretDown, Check } from 'phosphor-react-native';
import { useLanguage, type Language } from '../../i18n/LanguageContext';
import { colors, radius, spacing } from '../../theme';

const OPTIONS: Array<{ value: Language; flag: string; label: string }> = [
  { value: 'id', flag: '🇮🇩', label: 'Indonesia' },
  { value: 'en', flag: '🇬🇧', label: 'English' },
];

/**
 * Compact language picker — flag + code. Opens a small menu with the full
 * options. Persists via LanguageContext.
 */
export function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);

  const current = OPTIONS.find((o) => o.value === language) ?? OPTIONS[0];

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={styles.flag}>{current.flag}</Text>
        <Text style={styles.code}>{current.value.toUpperCase()}</Text>
        <CaretDown size={12} color={colors.textMuted} weight="bold" />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {OPTIONS.map((opt, i) => {
              const active = opt.value === language;
              return (
                <Pressable
                  key={opt.value}
                  style={[styles.menuItem, i > 0 && styles.menuItemBorder]}
                  onPress={() => {
                    setLanguage(opt.value);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.menuFlag}>{opt.flag}</Text>
                  <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>{opt.label}</Text>
                  {active ? <Check size={16} color={colors.accent} weight="bold" /> : <View style={styles.menuCheckSpacer} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  flag: {
    fontSize: 15,
  },
  code: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'flex-end',
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
  },
  menu: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    minWidth: 180,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  menuItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  menuFlag: {
    fontSize: 16,
  },
  menuLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  menuLabelActive: {
    color: colors.accent,
  },
  menuCheckSpacer: {
    width: 16,
  },
});
