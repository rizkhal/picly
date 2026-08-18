import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle, XCircle } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { ScanStage } from '../../types';
import { colors, radius, spacing } from '../../theme';
import { Spinner } from '../components/Spinner';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { scanFolder, scanPhotos, type ScanPhotoItem, type ScanProgressEvent, type ScanScope } from '../../scanning/scanner';
import { fetchPhotoLibrary } from '../../db/media';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanProgress'>;

const STAGES: Array<{ id: ScanStage; label: string }> = [
  { id: 'detecting', label: 'Detecting faces' },
  { id: 'embedding', label: 'Embedding' },
  { id: 'clustering', label: 'Grouping people' },
];

/**
 * Real end-to-end scan: pulls the device library (media-library), runs the
 * shared ML pipeline per photo (decode -> detect -> quality -> embed), writes
 * faces to sqlite, then clusters offline. Cancellable; the run is resumed
 * later (already-scanned photos are skipped on the next run).
 */
export function ScanProgressScreen({ navigation, route }: Props) {
  const params = route.params;
  const scope: ScanScope = params && 'mode' in params && params.mode === 'folder' ? 'folder' : 'all';
  const scopeTitle = params && 'title' in params ? params.title : 'All Photos';
  const [progress, setProgress] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [stage, setStage] = useState<ScanStage>('detecting');
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [facesTotal, setFacesTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        let photos: ScanPhotoItem[];
        if (scope === 'folder' && params && 'albumId' in params) {
          const { fetchAlbumPhotos } = await import('../../db/media');
          const items = await fetchAlbumPhotos(params.albumId);
          photos = items.map((p) => ({
            id: p.id,
            uri: p.uri,
            width: p.width,
            height: p.height,
            albumId: params.albumId,
          }));
        } else {
          const { items } = await fetchPhotoLibrary(0, 1000);
          photos = items.map((p) => ({
            id: p.id,
            uri: p.uri,
            width: p.width,
            height: p.height,
          }));
        }
        if (!mounted) return;
        setTotal(photos.length);
        // Let the first paint happen before the (synchronous-blocking) loop.
        await new Promise((r) => setTimeout(r, 50));
        const onProgress = (e: ScanProgressEvent) => {
          if (!mounted) return;
          setProgress(total > 0 ? (e.processed / total) * 100 : 0);
          setPhotoUri(e.currentFile);
          setCurrentFile(e.currentFile);
          setProcessed(e.processed);
          setStage(
            e.stage === 'clustering'
              ? 'clustering'
              : e.stage === 'embedding'
                ? 'embedding'
                : 'detecting',
          );
          setFacesTotal((prev) => (e.photoFaces > 0 ? prev + e.photoFaces : prev));
        };
        const result =
          scope === 'folder' && params && 'albumId' in params
            ? await scanFolder(params.albumId, {
                onProgress,
                shouldCancel: () => cancelRef.current,
              })
            : await scanPhotos(photos, {
                onProgress,
                shouldCancel: () => cancelRef.current,
              });
        if (!mounted) return;
        if (result.cancelled) {
          navigation.goBack();
          return;
        }
        setProgress(100);
        setDone(true);
        setFacesTotal(result.totalFaces);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    run();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageLabel = STAGES.find((s) => s.id === stage)?.label ?? 'Detecting faces';
  const pct = Math.round(progress);

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{done ? 'Scan complete' : scope === 'folder' ? `Scanning ${scopeTitle}…` : 'Scanning'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
        ) : (
          <View style={[styles.preview, styles.previewPlaceholder]}>
            {done ? (
              <CheckCircle size={40} color={colors.success} />
            ) : (
              <Spinner size="large" color={colors.accent} />
            )}
          </View>
        )}

        <Text style={styles.photoName} numberOfLines={1}>
          {error
            ? 'Scan failed'
            : done
              ? `Found ${facesTotal} faces`
              : currentFile
                ? currentFile.split('/').pop() ?? 'Scanning…'
                : 'Preparing your library…'}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{pct}%</Text>

        {!done && !error && (
          <View style={styles.stageBadge}>
            <Spinner size="small" color={colors.faceBox} />
            <Text style={styles.stageLabel}>{stageLabel}</Text>
          </View>
        )}
        <Text style={styles.detailLabel}>
          {processed} / {total} photos · {facesTotal} faces
        </Text>
      </View>

      <Pressable
        style={styles.cancelBtn}
        onPress={() => {
          cancelRef.current = true;
          if (done) navigation.goBack();
        }}
      >
        {error ? (
          <XCircle size={18} color={colors.danger} />
        ) : done ? (
          <CheckCircle size={18} color={colors.success} />
        ) : (
          <Text style={styles.cancelLabel}>Cancel scan</Text>
        )}
      </Pressable>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
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
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  cancelBtn: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
