import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Users } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { mockPeople } from '../../data/mock';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../components/EmptyState';
import { QualityBadge } from '../components/QualityBadge';

type Nav = NavigationProp<RootStackParamList>;

export function PeopleScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>People</Text>
      <FlatList
        data={mockPeople}
        keyExtractor={(p) => p.id}
        numColumns={3}
        contentContainerStyle={styles.content}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <EmptyState
            icon={Users}
            title="No people yet"
            subtitle="Scan your photos and Picly will group every face it finds — automatically."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.cell}
            onPress={() => navigation.navigate('PersonDetail', { person: item })}
          >
            <View style={styles.avatarWrap}>
              <Image source={{ uri: item.avatarUri }} style={styles.avatar} />
              <View style={styles.countBadge}>
                <Text style={styles.countLabel}>{item.faceCount}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <QualityBadge tier={item.quality} size="sm" />
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
  headerTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  row: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  avatarWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  countBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '100%',
  },
});
