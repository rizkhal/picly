import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FolderSimple, Images, Plus } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../navigation/types';
import type { LibraryAlbum, LibraryPhoto } from '../../types';
import { colors, radius, spacing } from '../../theme';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { ensurePhotoPermission, fetchAlbums, fetchPhotoLibrary } from '../../db/media';

type Nav = NavigationProp<RootStackParamList>;

const COLUMNS = 3;
const PAGE_SIZE = 120;

export function PhotosScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<'all' | 'folders'>('all');
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // MOCK — replace with real scanner events from the pipeline.
  const [scanning, setScanning] = useState(false);

  const loadPage = useCallback(async (p: number, append: boolean) => {
    const { items, hasMore: more } = await fetchPhotoLibrary(p, PAGE_SIZE);
    setPhotos((prev) => (append ? [...prev, ...items] : items));
    setHasMore(more);
    setPage(p);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPage(0, false);
    } finally {
      setRefreshing(false);
    }
  }, [loadPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await ensurePhotoPermission();
      if (cancelled) return;
      setPermission(ok ? 'granted' : 'denied');
      if (ok) {
        await loadPage(0, false);
        const al = await fetchAlbums();
        if (!cancelled) setAlbums(al);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const gridPhotos = useMemo(() => {
    if (seg === 'all') return photos;
    // Folder mode currently shows all — folder drill-down wires in later.
    return photos;
  }, [seg, photos]);

  if (loading) {
    return (
      <ScreenSafeArea>
        <View style={styles.loadingWrap}>
          <Spinner size="large" color={colors.accent} />
          <Text style={styles.loadingLabel}>Loading your photos…</Text>
        </View>
      </ScreenSafeArea>
    );
  }

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <View style={styles.seg}>
          {(['all', 'folders'] as const).map((key) => (
            <Pressable
              key={key}
              style={[styles.segBtn, seg === key && styles.segBtnActive]}
              onPress={() => setSeg(key)}
            >
              <Text style={[styles.segLabel, seg === key && styles.segLabelActive]}>
                {key === 'all' ? 'All Photos' : 'Folders'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {permission === 'denied' ? (
        <EmptyState
          icon={Images}
          title="Photo access needed"
          subtitle="Allow photo access in system settings so Picly can find and scan your faces."
        />
      ) : seg === 'all' ? (
        <FlatList
          key="photos-grid"
          data={gridPhotos}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          onEndReached={() => {
            if (hasMore && !refreshing) loadPage(page + 1, true);
          }}
          onEndReachedThreshold={0.4}
          onRefresh={refresh}
          refreshing={refreshing}
          ListEmptyComponent={
            <EmptyState
              icon={Images}
              title="No photos yet"
              subtitle="Photos on your device will show up here."
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.cell} onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
            </Pressable>
          )}
          ListFooterComponent={
            loading || refreshing ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.textMuted} />
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          key="folders-list"
          data={albums}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.folderRow} onPress={() => setSeg('all')}>
              <View style={styles.folderIcon}>
                <FolderSimple size={20} color={colors.textMuted} />
              </View>
              <View style={styles.folderInfo}>
                <Text style={styles.folderName}>{item.name}</Text>
                <Text style={styles.folderPath}>{item.photoCount} photos</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* FAB — start scan (also shown as header action when idle). */}
      {!scanning ? (
        <Pressable style={[styles.fab, { bottom: insets.bottom + spacing.lg }]} onPress={() => setScanning(true)}>
          <Plus size={22} color="#fff" weight="bold" />
        </Pressable>
      ) : (
        <Pressable style={[styles.fabScanning, { bottom: insets.bottom + spacing.lg }]} onPress={() => navigation.navigate('ScanProgress')}>
          <Spinner size="small" color="#fff" />
        </Pressable>
      )}
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 3,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  segBtnActive: {
    backgroundColor: colors.surface2,
  },
  segLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  segLabelActive: {
    color: colors.text,
  },
  gridContent: {
    padding: spacing.xs,
    paddingBottom: 120,
  },
  gridRow: {
    gap: 2,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  folderPath: {
    color: colors.textMuted,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabScanning: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.faceBox,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
