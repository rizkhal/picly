import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { FaceBox } from '../../types';
import { FaceBoxOverlay } from '../components/FaceBoxOverlay';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PersonPhotoViewer'>;

/**
 * PersonPhotoViewer receives boxes ALREADY normalized (store normalizes against
 * the EXIF-oriented photo dims). `Image.getSize` is only used to normalize
 * legacy pixel-boxes that slipped through — normalized boxes pass through.
 */
function normalizeBoxes(boxes: FaceBox[], w: number, h: number): FaceBox[] {
  if (w <= 0 || h <= 0) return boxes;
  return boxes.map((b) =>
    b.x > 1 || b.y > 1 || b.w > 1 || b.h > 1
      ? { x: b.x / w, y: b.y / h, w: b.w / w, h: b.h / h }
      : b,
  );
}

/**
 * Fullscreen paging viewer for a person's photos — swipe left/right like a
 * gallery. Each page shows the full photo with the person's face(s) highlighted
 * via the shared orange FaceBoxOverlay (pixel boxes normalized by image size).
 */
export function PersonPhotoViewerScreen({ route, navigation }: Props) {
  const { personName, photoUris, index, facesByPhoto } = route.params;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const [page, setPage] = useState(index);
  // Image sizes per uri, for normalizing pixel boxes.
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});

  useEffect(() => {
    let mounted = true;
    for (const uri of photoUris) {
      if (sizes[uri]) continue;
      Image.getSize(
        uri,
        (w, h) => mounted && setSizes((prev) => ({ ...prev, [uri]: { w, h } })),
        () => {}, // ignore failures — overlay falls back to raw boxes
      );
    }
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUris.join('|')]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems.find((v) => v.isViewable);
      if (first && typeof first.index === 'number') {
        setPage(first.index);
      }
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / (e.nativeEvent.layoutMeasurement.width || 1));
      setPage(next);
    },
    [],
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={photoUris}
        keyExtractor={(uri) => uri}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => {
          const size = sizes[item];
          const boxes = size ? normalizeBoxes(facesByPhoto[item] ?? [], size.w, size.h) : facesByPhoto[item] ?? [];
          return (
            <View style={[styles.page, { width }]}>
              <Image source={{ uri: item }} style={styles.image} resizeMode="contain" />
              {boxes.map((box, i) => (
                <FaceBoxOverlay key={i} box={box} highlighted />
              ))}
            </View>
          );
        }}
      />

      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBtn}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {personName}
        </Text>
        <Text style={styles.counter}>
          {page + 1}/{photoUris.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerBtn: {
    padding: 4,
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  counter: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
  },
});
