import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image, LockKey, ShieldCheck } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

/**
 * One-screen onboarding: value prop + privacy promise.
 * The CTA triggers the photo library permission flow (wired later).
 */
export function OnboardingScreen({ navigation }: Props) {
  // MOCK — replace with expo-media-library permission request + persistence.
  const requestAccess = () => navigation.replace('Main');

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <View style={styles.logoWrap}>
          <Image size={34} color={colors.faceBox} weight="fill" />
        </View>
        <Text style={styles.brand}>Picly</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.headline}>
          Every face in your photos,{'\n'}automatically organized
        </Text>
        <Text style={styles.subhead}>
          Picly scans your library, detects every person, and groups them — all on
          your device.
        </Text>
      </View>

      <View style={styles.cards}>
        <View style={styles.card}>
          <LockKey size={22} color={colors.success} weight="regular" />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Your photos never leave</Text>
            <Text style={styles.cardBody}>
              Everything runs on-device. No uploads, no cloud, no accounts required.
            </Text>
          </View>
        </View>
        <View style={styles.card}>
          <ShieldCheck size={22} color={colors.success} weight="regular" />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Private by design</Text>
            <Text style={styles.cardBody}>
              Faces are indexed locally and stay under your control.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.bottom}>
        <Pressable style={styles.primaryBtn} onPress={requestAccess}>
          <Text style={styles.primaryLabel}>Access my photos</Text>
        </Pressable>
        <Pressable onPress={() => navigation.replace('Main')} hitSlop={8}>
          <Text style={styles.skipLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingTop: 76,
    paddingBottom: spacing.xxl,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headline: {
    color: colors.text,
    fontSize: typography.header,
    fontWeight: '800',
    lineHeight: 42,
  },
  subhead: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 340,
  },
  cards: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  bottom: {
    gap: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipLabel: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
