import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, FolderSimple, Images, Monitor, Plus, Scan, Users } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';
import { ensurePhotoPermission, fetchHomeSummary } from '../../db/media';
import type { LibraryAlbum } from '../../types';

type Nav = NavigationProp<RootStackParamList>;

interface HomeRow {
  key: string;
  title: string;
  count: number;
  icon: React.ElementType;
  tint: string;
  scanAlbumId?: string;
  onPress: () => void;
  onScan?: () => void;
}

export function PhotosScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [allCount, setAllCount] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
  const [screenshotsCount, setScreenshotsCount] = useState(0);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await ensurePhotoPermission();
      if (cancelled) return;
      setPermission(ok ? 'granted' : 'denied');
      if (ok) {
        try {
          const summary = await fetchHomeSummary();
          if (!cancelled) {
            setAllCount(summary.allCount);
            setCameraCount(summary.cameraCount);
            setScreenshotsCount(summary.screenshotsCount);
            setAlbums(summary.albums);
          }
        } catch (err) {
          console.warn('[home] failed to load library summary:', err);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: HomeRow[] = [
    {
      key: 'all',
      title: 'All Photos',
      count: allCount,
      icon: Images,
      tint: colors.accent,
      onPress: () => navigation.navigate('AlbumPhotos', { kind: 'all', title: 'All Photos' }),
    },
    {
      key: 'camera',
      title: 'Camera',
      count: cameraCount,
      icon: Camera,
      tint: colors.success,
      onPress: () => navigation.navigate('AlbumPhotos', { kind: 'camera', title: 'Camera' }),
    },
    {
      key: 'screenshots',
      title: 'Screenshots',
      count: screenshotsCount,
      icon: Monitor,
      tint: colors.warning,
      onPress: () => navigation.navigate('AlbumPhotos', { kind: 'screenshots', title: 'Screenshots' }),
    },
    ...albums.map<HomeRow>((album) => ({
      key: `album-${album.id}`,
      title: album.name,
      count: album.photoCount,
      icon: FolderSimple,
      tint: colors.faceBox,
      onPress: () =>
        navigation.navigate('AlbumPhotos', {
          kind: 'album',
          albumId: album.id,
          title: album.name,
        }),
      onScan: () =>
        navigation.navigate('ScanProgress', {
          mode: 'folder',
          albumId: album.id,
          title: album.name,
        }),
    })),
  ];

  const openScanner = useCallback(() => {
    navigation.navigate('ScanProgress');
  }, [navigation]);

  if (loading) {
    return (
      <ScreenSafeArea>
        <View style={styles.loadingWrap}>
          <Spinner size="large" color={colors.accent} />
        </View>
      </ScreenSafeArea>
    );
  }

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Home</Text>
        <Pressable style={styles.scanBtn} onPress={openScanner} hitSlop={6}>
          <Scan size={18} color={colors.text} />
        </Pressable>
      </View>

      {permission === 'denied' ? (
        <EmptyState
          icon={Images}
          title="Photo access needed"
          subtitle="Allow photo access in system settings so Picly can find and scan your faces."
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text style={styles.introTitle}>Your library</Text>
              <Text style={styles.introSub}>
                Browse photos, scan for faces, or open a folder below.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={Users}
              title="No photos yet"
              subtitle="Photos on your device will show up here — tap the scan button to find faces."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={item.onPress}
            >
              <View style={[styles.rowIcon, { backgroundColor: `${item.tint}1f` }]}>
                <item.icon size={20} color={item.tint} />
              </View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowCount}>{item.count}</Text>
              {item.onScan ? (
                <Pressable style={styles.rowScanBtn} onPress={item.onScan} hitSlop={8}>
                  <Scan size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </Pressable>
          )}
        />
      )}

      {/* FAB — real scan flow (ScanProgress). */}
      <Pressable
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={openScanner}
      >
        <Plus size={24} color="#fff" weight="bold" />
      </Pressable>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  scanBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  introTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  introSub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowCount: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  rowScanBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
});
