import { useEffect } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Users } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { usePersons } from '../../db/hooks';
import { ensureClustered } from '../../scanning/scanner';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';

type Nav = NavigationProp<RootStackParamList>;

export function PeopleScreen() {
  const navigation = useNavigation<Nav>();
  const { persons, loading, reload } = usePersons();

  // Faces scanned via photo detail (scanSinglePhoto) never ran clustering, so
  // the persons table can be empty despite faces being stored. Cluster once on
  // open whenever there are unassigned embeddable faces, then reload.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const created = await ensureClustered();
        if (mounted && created > 0) reload();
      } catch (err) {
        console.warn('[people] auto-cluster failed:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [reload]);

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
      <Text style={styles.headerTitle}>People</Text>
      <FlatList
        data={persons}
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
            onPress={() => navigation.navigate('PersonDetail', { personId: item.id })}
          >
            <View style={styles.avatarWrap}>
              {item.avatarUri ? (
                <Image source={{ uri: item.avatarUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Users size={28} color={colors.textFaint} />
                </View>
              )}
              <View style={styles.countBadge}>
                <Text style={styles.countLabel}>{item.faceCount}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
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
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
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
