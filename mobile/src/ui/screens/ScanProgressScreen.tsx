import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { ScanStage } from '../../types';
import { colors, radius, spacing } from '../../theme';
import { Spinner } from '../components/Spinner';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanProgress'>;

const STAGES: ScanStage[] = [
  { id: 'detecting', label: 'Detecting faces' },
  { id: 'quality', label: 'Checking quality' },
  { id: 'embedding', label: 'Embedding' },
];

/**
 * Per-photo scan progress. Shows the current photo, a progress bar, and the
 * active pipeline stage. Can be cancelled; the run is resumed later.
 */
export function ScanProgressScreen({ navigation }: Props) {
  // MOCK — replace with real scanner events from the pipeline.
  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 4;
        if (next >= 100) {
          clearInterval(t);
          setStageIdx(2);
          return 100;
        }
        setStageIdx((s) => (s < 2 && next > 40 + s * 20 ? s + 1 : s));
        return next;
      });
    }, 400);
    return () => clearInterval(t);
  }, []);

  const stage = STAGES[stageIdx];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Scanning</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
        ) : (
          <View style={[styles.preview, styles.previewPlaceholder]}>
            <Spinner size="large" color={colors.accent} />
          </View>
        )}

        <Text style={styles.photoName} numberOfLines={1}>
          {photoUri ? photoUri.split('/').pop() : 'Analyzing your library…'}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{Math.round(progress)}%</Text>

        <View style={styles.stageBadge}>
          <Spinner size="small" color={colors.faceBox} />
          <Text style={styles.stageLabel}>{stage.label}</Text>
        </View>
      </View>

      <Pressable style={styles.cancelBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelLabel}>Cancel scan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 22,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    gap: spacing.md,
  },
  preview: {
    width: '100%',
    height: 300,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  previewPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  stageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  stageLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  cancelBtn: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
