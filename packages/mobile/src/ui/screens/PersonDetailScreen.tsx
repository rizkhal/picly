import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { usePersonDetail } from '../../db/hooks';
import { colors, radius, spacing } from '../../theme';
import { QualityBadge } from '../components/QualityBadge';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';

type Props = NativeStackScreenProps<RootStackParamList, 'PersonDetail'>;

const COLUMNS = 3;

export function PersonDetailScreen({ route, navigation }: Props) {
  const { personId } = route.params;
  const { person, faces, loading } = usePersonDetail(personId);

  if (loading || !person) {
    return (
      <ScreenSafeArea>
        <View style={styles.loadingWrap}>
          <Spinner size="large" color={colors.accent} />
        </View>
      </ScreenSafeArea>
    );
  }

  // Group faces by photo for the grid.
  const byPhoto = new Map<string, { uri: string; faces: typeof faces }>();
  for (const f of faces) {
    const entry = byPhoto.get(f.thumbnailUri) ?? { uri: f.thumbnailUri, faces: [] };
    entry.faces.push(f);
    byPhoto.set(f.thumbnailUri, entry);
  }
  const photoEntries = Array.from(byPhoto.values());

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {person.name}
        </Text>
        <View style={styles.headerRight}>
          <QualityBadge tier={person.quality} />
        </View>
      </View>

      <View style={styles.summary}>
        <Image source={{ uri: person.avatarUri }} style={styles.avatar} />
        <View style={styles.summaryInfo}>
          <Text style={styles.faceCount}>{person.faceCount} faces</Text>
          <Text style={styles.photoCount}>
            in {person.photoCount} {person.photoCount === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>FACES</Text>
      <FlatList
        horizontal
        data={faces}
        keyExtractor={(f) => f.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.faceRow}
        renderItem={({ item }) => (
          <Pressable style={styles.faceCell}>
            <Image source={{ uri: item.thumbnailUri }} style={styles.faceThumb} />
            <QualityBadge tier={item.quality} size="sm" />
          </Pressable>
        )}
      />

      <Text style={styles.sectionLabel}>PHOTOS</Text>
      <FlatList
        data={photoEntries}
        keyExtractor={(p) => p.uri}
        numColumns={COLUMNS}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => (
          <Pressable style={styles.cell}>
            <Image source={{ uri: item.uri }} style={styles.thumb} />
          </Pressable>
        )}
      />
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
  },
  summaryInfo: {
    gap: 2,
  },
  faceCount: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  photoCount: {
    color: colors.textMuted,
    fontSize: 14,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  faceRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  faceCell: {
    gap: 2,
    alignItems: 'center',
  },
  faceThumb: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  gridContent: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xxl,
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
});
