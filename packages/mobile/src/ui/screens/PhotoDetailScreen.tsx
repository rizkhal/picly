import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MagnifyingGlassPlus, MagnifyingGlassMinus } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { Face, Photo } from '../../types';
import { getPhotoByAssetId } from '../../db/store';
import { scanSinglePhoto, decodePhoto } from '../../scanning/scanner';
import { colors, radius, spacing } from '../../theme';
import { FaceBoxOverlay } from '../components/FaceBoxOverlay';
import { FaceSheet } from '../components/FaceSheet';
import { QualityBadge } from '../components/QualityBadge';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoDetail'>;

type AnalyzeState = 'checking' | 'analyzing' | 'done' | 'failed';

/**
 * Full-width photo with orange face boxes. Tap a box → bottom sheet with the
 * large crop, inline rename, assign/unassign.
 *
 * The grid passes a media-library ASSET id, so we look the photo up in the DB
 * by asset_id. When it hasn't been scanned yet we show it from the media
 * library immediately and kick off a single-photo analyze in the background —
 * face boxes appear as soon as it finishes (never a blocking spinner).
 */
export function PhotoDetailScreen({ route, navigation }: Props) {
  const { photoId } = route.params;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>('checking');
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [activeFace, setActiveFace] = useState<Face | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [localFaces, setLocalFaces] = useState<Face[]>([]);

  // 1) Look the photo up in the local DB (by asset id). If present, faces are
  //    already there and we're done. Otherwise show it from the media library
  //    (uri passed via navigation params — no native lookup needed) and
  //    analyze it in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAnalyzeState('checking');
      const found = await getPhotoByAssetId(photoId);
      if (cancelled) return;

      if (!found) {
        // Not scanned yet — the grid already passed uri/width/height, so the
        // photo renders immediately and we analyze in the background.
        let uri = route.params.uri ?? '';
        let width = route.params.width ?? 0;
        let height = route.params.height ?? 0;
        if (!uri) {
          // No uri in params (deep link) — try the media library lookup.
          try {
            const asset = await MediaLibrary.getAssetInfoAsync(photoId);
            if (cancelled) return;
            uri = asset.uri;
            width = asset.width || 0;
            height = asset.height || 0;
          } catch (err) {
            if (cancelled) return;
            setAnalyzeError(err instanceof Error ? err.message : String(err));
            setAnalyzeState('failed');
            return;
          }
        }
        setPhoto({
          id: photoId,
          uri,
          assetId: photoId,
          width,
          height,
          createdAt: 0,
          faces: [],
          exists: true,
        });
        setAnalyzeState('analyzing');
        // Let React paint the photo FIRST — analysis blocks the JS thread
        // (onnx is synchronous), so without this yield the screen stays black
        // until the (potentially slow) model load + detect finishes.
        await new Promise((r) => setTimeout(r, 120));
        const result = await scanSinglePhoto({
          id: photoId,
          uri,
          width,
          height,
        });
        if (cancelled) return;
        if (result.error) {
          setAnalyzeError(result.error);
          setAnalyzeState('failed');
        } else {
          const scanned = await getPhotoByAssetId(photoId);
          if (cancelled) return;
          setPhoto((prev) => (scanned ?? prev));
          setAnalyzeState('done');
        }
      } else {
        setPhoto(found);
        setAnalyzeState('done');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId, route.params.uri, route.params.width, route.params.height]);

  // PhotoDetail consumes normalized faces (store normalizes with the stored
  // EXIF-oriented dims). Local state only re-seeds when the photo reloads.
  const normalized = useMemo(() => (photo?.faces ?? []).map((f) => ({ ...f })), [photo]);

  useEffect(() => {
    if (photo) setLocalFaces(normalized);
  }, [normalized, photo]);

  // Fallback: when a scanned photo has no stored dims (old rows), derive them
  // from the decoder so the box overlay still aligns.
  useEffect(() => {
    if (!photo || photo.faces.length === 0 || (photo.width > 0 && photo.height > 0)) return;
    let cancelled = false;
    (async () => {
      try {
        const dims = await decodePhoto(photo.uri);
        if (cancelled) return;
        setPhoto((prev) => (prev ? { ...prev, width: dims.width, height: dims.height } : prev));
      } catch {
        // ignore — fallback failed, boxes render relative to 0 dims
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo]);

  if (!photo) {
    return (
      <ScreenSafeArea>
        <View style={styles.loadingWrap}>
          <Spinner size="large" color={colors.accent} />
          <Text style={styles.loadingLabel}>
            {analyzeState === 'failed' ? 'Could not open this photo.' : 'Loading photo…'}
          </Text>
        </View>
      </ScreenSafeArea>
    );
  }

  const displayHeight = (width / (photo.width || 1)) * (photo.height || 1);
  const hasDims = photo.width > 0 && photo.height > 0;
  const imageStyle = hasDims ? { width: width * scale, height: displayHeight * scale } : { width: width * scale, aspectRatio: 1 };

  const openFace = (face: Face) => {
    setActiveFace(face);
    setSheetVisible(true);
  };

  const handleRename = (name: string) => {
    if (!activeFace) return;
    const trimmed = name.trim();
    setLocalFaces((prev) =>
      prev.map((f) => (f.id === activeFace.id ? { ...f, name: trimmed || null } : f)),
    );
    setSheetVisible(false);
  };

  const handleUnassign = () => {
    if (!activeFace) return;
    setLocalFaces((prev) =>
      prev.map((f) =>
        f.id === activeFace.id ? { ...f, name: null, personId: null, status: 'unassigned' } : f,
      ),
    );
    setSheetVisible(false);
  };

  const handleAssign = (personName: string) => {
    if (!activeFace) return;
    setLocalFaces((prev) =>
      prev.map((f) =>
        f.id === activeFace.id ? { ...f, name: personName, status: 'recognized' } : f,
      ),
    );
    setSheetVisible(false);
  };

  const isAnalyzing = analyzeState === 'checking' || analyzeState === 'analyzing';

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {isAnalyzing ? 'Analyzing…' : `${localFaces.length} ${localFaces.length === 1 ? 'face' : 'faces'}`}
        </Text>
        <View style={styles.zoomRow}>
          <Pressable
            style={styles.zoomBtn}
            hitSlop={6}
            onPress={() => setScale((s) => Math.max(1, s - 0.25))}
          >
            <MagnifyingGlassMinus size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={styles.zoomBtn}
            hitSlop={6}
            onPress={() => setScale((s) => Math.min(4, s + 0.25))}
          >
            <MagnifyingGlassPlus size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        minimumZoomScale={1}
        maximumZoomScale={4}
        bouncesZoom
        pinchGestureEnabled
      >
        <View style={styles.scrollInner}>
          <View
            style={{
              width: imageStyle.width,
              height: imageStyle.height,
            }}
          >
            <Image
              source={{ uri: photo.uri }}
              style={[styles.photo, imageStyle]}
              resizeMode="cover"
            />
            {localFaces.map((face) => (
              <View key={face.id} style={StyleSheet.absoluteFill}>
                <Pressable
                  style={{
                    position: 'absolute',
                    left: `${face.box.x * 100}%`,
                    top: `${face.box.y * 100}%`,
                    width: `${face.box.w * 100}%`,
                    height: `${face.box.h * 100}%`,
                  }}
                  onPress={() => openFace(face)}
                >
                  <FaceBoxOverlay box={face.box} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Status banner: analyzing / no faces / failed */}
      {analyzeState === 'analyzing' && (
        <View style={[styles.banner, { paddingBottom: insets.bottom + spacing.md }]}>
          <Spinner size="small" color={colors.accent} />
          <Text style={styles.bannerLabel}>Analyzing faces…</Text>
        </View>
      )}
      {analyzeState === 'done' && localFaces.length === 0 && (
        <View style={[styles.banner, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.bannerLabel}>No faces found</Text>
        </View>
      )}
      {analyzeState === 'failed' && (
        <View style={[styles.banner, styles.bannerError, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={[styles.bannerLabel, { color: colors.danger }]}>
            Analysis failed{analyzeError ? `: ${analyzeError}` : ''}
          </Text>
        </View>
      )}

      {localFaces.length > 0 && (
        <View style={[styles.faceStrip, { paddingBottom: insets.bottom + spacing.md }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {localFaces.map((face) => (
              <Pressable key={face.id} style={styles.faceChip} onPress={() => openFace(face)}>
                <Image source={{ uri: face.thumbnailUri }} style={styles.faceChipThumb} />
                <QualityBadge tier={face.quality} size="sm" />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <FaceSheet
        face={activeFace}
        photoUri={photo.uri}
        peopleNames={[]}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onRename={handleRename}
        onUnassign={handleUnassign}
        onAssign={handleAssign}
      />
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: 13,
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
    fontSize: 16,
    fontWeight: '700',
  },
  zoomRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    borderRadius: 2,
    backgroundColor: colors.surface2,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bannerError: {
    borderTopColor: 'rgba(239,68,68,0.4)',
  },
  bannerLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  faceStrip: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  faceChip: {
    marginLeft: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  faceChipThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
});
