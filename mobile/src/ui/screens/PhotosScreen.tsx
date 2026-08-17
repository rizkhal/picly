import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FolderSimple, Plus } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { mockFolders, mockPhotos } from '../../data/mock';
import { colors, radius, spacing } from '../../theme';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';

type Nav = NavigationProp<RootStackParamList>;

const COLUMNS = 3;

export function PhotosScreen() {
  const navigation = useNavigation<Nav>();
  const [seg, setSeg] = useState<'all' | 'folders'>('all');
  // MOCK — replace with expo-media-library asset query + scan status.
  const [scanning, setScanning] = useState(false);

  const gridPhotos = useMemo(() => {
    if (seg === 'all') return mockPhotos;
    return mockPhotos.slice(0, 5);
  }, [seg]);

  return (
    <View style={styles.container}>
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

      {seg === 'all' ? (
        <FlatList
          data={gridPhotos}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item }) => (
            <Pressable style={styles.cell} onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
              {item.faces.length > 1 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countLabel}>{item.faces.length}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={mockFolders}
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
        <Pressable style={styles.fab} onPress={() => setScanning(true)}>
          <Plus size={22} color="#fff" weight="bold" />
        </Pressable>
      ) : (
        <Pressable style={styles.fabScanning} onPress={() => navigation.navigate('ScanProgress')}>
          <Spinner size="small" color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
  countBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
