import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  Database,
  HardDrives,
  Info,
  Palette,
  SignOut,
  User,
} from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme';
import type { Icon } from 'phosphor-react-native';
import { ScreenSafeArea } from '../components/ScreenSafeArea';

type Nav = NavigationProp<RootStackParamList>;

type ThemeMode = 'system' | 'dark' | 'light';

const MODELS = [
  { name: 'SCRFD 10GF', role: 'Face detection', size: '4.8 MB' },
  { name: 'Buffalo_L', role: 'Embedding (ArcFace)', size: '326 MB' },
  { name: 'EDiff-IQA', role: 'Quality gate', size: '9.7 MB' },
];

function Row({
  icon: IconComponent,
  label,
  value,
  onPress,
}: {
  icon: Icon;
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <IconComponent size={18} color={colors.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <ArrowRight size={16} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>('system');

  const handleSignOut = async () => {
    await logout();
  };

  return (
    <ScreenSafeArea>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>Settings</Text>

      <Section title="APPEARANCE">
        <Row icon={Palette} label="Theme" value={theme[0].toUpperCase() + theme.slice(1)} />
        <View style={styles.themeRow}>
          {(['system', 'dark', 'light'] as ThemeMode[]).map((mode) => (
            <Pressable
              key={mode}
              style={[styles.themeBtn, theme === mode && styles.themeBtnActive]}
              onPress={() => setTheme(mode)}
            >
              <Text style={[styles.themeLabel, theme === mode && styles.themeLabelActive]}>
                {mode[0].toUpperCase() + mode.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="ACCOUNT">
        <Row icon={User} label="Signed in" value={user?.email ?? 'local'} />
      </Section>

      <Section title="STORAGE">
        <Row icon={HardDrives} label="Library storage" value="2.4 GB" />
        <Row icon={Database} label="Face index" value="1.1 GB" />
      </Section>

      <Section title="MODELS">
        {MODELS.map((m) => (
          <Row key={m.name} icon={Info} label={m.name} value={`${m.role} · ${m.size}`} />
        ))}
      </Section>

      <Section title="ABOUT">
        <Row icon={Info} label="Version" value="0.1.0" />
        <Row icon={Info} label="Check for updates" onPress={() => {}} />
      </Section>

      <Pressable style={styles.signOut} onPress={handleSignOut}>
        <SignOut size={18} color={colors.danger} />
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
      </ScrollView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: 13,
  },
  themeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  themeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
  },
  themeBtnActive: {
    backgroundColor: colors.accent,
  },
  themeLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  themeLabelActive: {
    color: '#fff',
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  signOutLabel: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
