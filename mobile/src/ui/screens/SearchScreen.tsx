import { useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MagnifyingGlass, Sparkle } from 'phosphor-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { mockPhotos, mockSearchResults } from '../../data/mock';
import { colors, radius, spacing } from '../../theme';
import { FaceBoxOverlay } from '../components/FaceBoxOverlay';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';

type Nav = NavigationProp<RootStackParamList>;

export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [reference, setReference] = useState<string | null>(null);

  const results = reference
    ? mockSearchResults.map((r) => ({
        ...r,
        photo: mockPhotos.find((p) => p.id === r.photoId)!,
      }))
    : [];

  return (
    <ScreenSafeArea>
      <Text style={styles.headerTitle}>Search</Text>

      <View style={styles.searchBox}>
        <MagnifyingGlass size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Search people or photos"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {!reference ? (
        <View style={styles.referenceSection}>
          <Text style={styles.sectionLabel}>SEARCH BY IMAGE</Text>
          <Text style={styles.sectionHint}>
            Pick a face or photo to find similar faces across your library.
          </Text>
          <FlatList
            horizontal
            data={mockPhotos.slice(0, 8)}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.refRow}
            renderItem={({ item }) => (
              <Pressable style={styles.refCell} onPress={() => setReference(item.id)}>
                <Image source={{ uri: item.uri }} style={styles.refThumb} />
              </Pressable>
            )}
          />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.photoId}
          contentContainerStyle={styles.resultList}
          ListHeaderComponent={
            <Pressable style={styles.clearRow} onPress={() => setReference(null)}>
              <Sparkle size={16} color={colors.faceBox} />
              <Text style={styles.clearLabel}>Clear reference</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.resultRow}
              onPress={() => navigation.navigate('PhotoDetail', { photoId: item.photoId })}
            >
              <View style={styles.resultThumbWrap}>
                <Image source={{ uri: item.photo.uri }} style={styles.resultThumb} />
                <FaceBoxOverlay box={item.box} highlighted />
              </View>
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.photo.id}
                </Text>
                <Text style={styles.similarity}>
                  {(item.similarity * 100).toFixed(0)}% similar
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={MagnifyingGlass}
              title="No results"
              subtitle="Try a different reference face or photo."
            />
          }
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
  referenceSection: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  refRow: {
    gap: spacing.sm,
  },
  refCell: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  refThumb: {
    width: '100%',
    height: '100%',
  },
  resultList: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  clearLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  resultRow: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  resultThumbWrap: {
    width: 84,
    height: 84,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  resultThumb: {
    width: '100%',
    height: '100%',
  },
  resultInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  similarity: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
