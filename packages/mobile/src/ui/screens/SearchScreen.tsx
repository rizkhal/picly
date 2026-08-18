import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MagnifyingGlass, Users } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { usePersons } from '../../db/hooks';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';

type Nav = NavigationProp<RootStackParamList>;

const COLUMNS = 3;

export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const { persons, loading } = usePersons();
  const [query, setQuery] = useState('');

  // Filter people by name (case-insensitive). Empty query shows everyone.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return persons;
    return persons.filter((p) => p.name.toLowerCase().includes(q));
  }, [query, persons]);

  return (
    <ScreenSafeArea>
      <Text style={styles.headerTitle}>Search</Text>

      <View style={styles.searchBox}>
        <MagnifyingGlass size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Search people by name"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <Spinner size="small" color={colors.textMuted} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.content}
          columnWrapperStyle={styles.row}
          ListEmptyComponent={
            <EmptyState
              icon={query.trim() ? MagnifyingGlass : Users}
              title={query.trim() ? 'No people found' : 'No people yet'}
              subtitle={
                query.trim()
                  ? 'Try a different name.'
                  : 'Scan your photos and Picly will group every face it finds.'
              }
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
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    padding: 0,
  },
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
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
    gap: 6,
  },
  avatarWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '100%',
  },
});
