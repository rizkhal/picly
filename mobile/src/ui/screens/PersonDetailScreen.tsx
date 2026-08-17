import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { mockPhotos } from '../../data/mock';
import { colors, radius, spacing } from '../../theme';
import { QualityBadge } from '../components/QualityBadge';

type Props = NativeStackScreenProps<RootStackParamList, 'PersonDetail'>;

const COLUMNS = 3;

export function PersonDetailScreen({ route, navigation }: Props) {
  const { person } = route.params;
  // MOCK — filter photos containing this person's face ids later.
  const photos = mockPhotos.slice(0, 6);

  return (
    <View style={styles.container}>
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
        data={mockPhotos.flatMap((p) => p.faces).slice(0, 12)}
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
        data={photos}
        keyExtractor={(p) => p.id}
        numColumns={COLUMNS}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => (
          <Pressable
            style={styles.cell}
            onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}
          >
            <Image source={{ uri: item.uri }} style={styles.thumb} />
          </Pressable>
        )}
      />
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
