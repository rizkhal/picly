import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Images, Scan } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { LibraryPhoto } from '../../types';
import { fetchMediaGroup } from '../../db/media';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../components/EmptyState';
import { ScreenSafeArea } from '../components/ScreenSafeArea';

type Props = NativeStackScreenProps<RootStackParamList, 'AlbumPhotos'>;

const COLUMNS = 3;

export function AlbumPhotosScreen({ route, navigation }: Props) {
  const { kind, albumId, title } = route.params;
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchMediaGroup(
          kind === 'album' ? { kind, albumId: albumId!, name: title } : { kind },
        );
        if (!cancelled) setPhotos(items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, albumId]);

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {kind === 'album' ? (
          <Pressable
            style={styles.scanBtn}
            onPress={() =>
              navigation.navigate('ScanProgress', {
                mode: 'folder',
                albumId: albumId!,
                title,
              })
            }
            hitSlop={6}
          >
            <Scan size={18} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={
            <EmptyState
              icon={Images}
              title="No photos here"
              subtitle="This group has no photos yet."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.cell}
              onPress={() =>
                navigation.navigate('PhotoDetail', {
                  photoId: item.id,
                  uri: item.uri,
                  width: item.width,
                  height: item.height,
                })
              }
            >
              <Image source={{ uri: item.uri }} style={styles.thumb} />
            </Pressable>
          )}
        />
      )}
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
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
  scanBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 36,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridContent: {
    padding: spacing.xs,
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
