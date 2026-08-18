import { useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import BottomSheet, { BottomSheetTextInput, BottomSheetView } from '@expo/ui/community/bottom-sheet';
import { ArrowCounterClockwise, ArrowLeft, Camera, ImageSquare, PencilSimple, X } from 'phosphor-react-native';
import ImagePicker from 'react-native-image-crop-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { FaceBox } from '../../types';
import { usePersonDetail } from '../../db/hooks';
import { renamePerson, setPersonAvatar, setPersonAvatarImage } from '../../db/store';
import { colors, radius, spacing } from '../../theme';
import { QualityBadge } from '../components/QualityBadge';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';

type Props = NativeStackScreenProps<RootStackParamList, 'PersonDetail'>;

const COLUMNS = 3;

export function PersonDetailScreen({ route, navigation }: Props) {
  const { personId } = route.params;
  const { person, faces, loading, reload } = usePersonDetail(personId);

  const sheetRef = useRef<BottomSheet>(null);
  const avatarSheetRef = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  const openRename = () => {
    setDraft(person?.name ?? '');
    sheetRef.current?.snapToIndex(0);
    // Focus once the native sheet is presented.
    setTimeout(() => inputRef.current?.focus(), 250);
  };

  const saveRename = async () => {
    await renamePerson(personId, draft);
    sheetRef.current?.close();
    reload();
  };

  const pickAvatar = async (source: 'gallery' | 'camera') => {
    avatarSheetRef.current?.close();
    setAvatarBusy(true);
    try {
      const image =
        source === 'camera'
          ? await ImagePicker.openCamera({
              width: 512,
              height: 512,
              cropping: true,
              cropperCircleOverlay: true,
              compressImageQuality: 0.9,
            })
          : await ImagePicker.openPicker({
              width: 512,
              height: 512,
              cropping: true,
              cropperCircleOverlay: true,
              compressImageQuality: 0.9,
              mediaType: 'photo',
            });
      await setPersonAvatarImage(personId, image.path);
      reload();
    } catch (err: any) {
      // User cancelled the picker/crop — ignore silently.
      if (err?.code !== 'E_PICKER_CANCELLED' && !err?.message?.includes('cancelled')) {
        console.warn('[avatar] pick failed:', err);
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const resetAvatar = async () => {
    avatarSheetRef.current?.close();
    setAvatarBusy(true);
    try {
      await setPersonAvatar(personId, null);
      reload();
    } finally {
      setAvatarBusy(false);
    }
  };

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

  // Pixel boxes per photo uri (viewer normalizes against its container).
  const boxesByPhoto: Record<string, FaceBox[]> = {};
  for (const entry of photoEntries) {
    boxesByPhoto[entry.uri] = entry.faces.map((f) => ({
      x: f.box.x,
      y: f.box.y,
      w: f.box.w,
      h: f.box.h,
    }));
  }

  const openViewer = (uri: string, idx: number) => {
    navigation.navigate('PersonPhotoViewer', {
      personId: person.id,
      personName: person.name,
      photoUris: photoEntries.map((p) => p.uri),
      index: idx,
      facesByPhoto: boxesByPhoto,
    });
  };

  return (
    <ScreenSafeArea>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {person.name}
        </Text>
        <Pressable style={styles.iconBtn} onPress={openRename} hitSlop={8}>
          <PencilSimple size={18} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.summary}>
        <Pressable style={styles.avatarWrap} onPress={() => avatarSheetRef.current?.snapToIndex(0)} disabled={avatarBusy}>
          <Image source={{ uri: person.avatarUri }} style={styles.avatar} />
          <View style={styles.avatarEditBadge}>
            {avatarBusy ? <Spinner size="small" color={colors.text} /> : <Camera size={13} color={colors.text} />}
          </View>
        </Pressable>
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
          <View style={styles.faceCell}>
            <Image source={{ uri: item.thumbnailUri }} style={styles.faceThumb} />
            <QualityBadge tier={item.quality} size="sm" />
          </View>
        )}
      />

      <Text style={styles.sectionLabel}>PHOTOS</Text>
      <FlatList
        data={photoEntries}
        keyExtractor={(p) => p.uri}
        numColumns={COLUMNS}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item, index: idx }) => (
          <Pressable style={styles.cell} onPress={() => openViewer(item.uri, idx)}>
            <Image source={{ uri: item.uri }} style={styles.thumb} />
          </Pressable>
        )}
      />

      {/* Rename person bottom sheet */}
      <BottomSheet ref={sheetRef} index={-1} enablePanDownToClose backgroundStyle={styles.sheet}>
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Rename person</Text>
            <Pressable onPress={() => sheetRef.current?.close()} hitSlop={10}>
              <X size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <BottomSheetTextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Person name"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
          />
          <Pressable style={styles.saveBtn} onPress={saveRename}>
            <Text style={styles.saveBtnLabel}>Save</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheet>

      {/* Avatar source bottom sheet */}
      <BottomSheet ref={avatarSheetRef} index={-1} enablePanDownToClose backgroundStyle={styles.sheet}>
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Update avatar</Text>
            <Pressable onPress={() => avatarSheetRef.current?.close()} hitSlop={10}>
              <X size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <Pressable style={styles.optionRow} onPress={() => pickAvatar('gallery')} disabled={avatarBusy}>
            <ImageSquare size={20} color={colors.accent} />
            <Text style={styles.optionLabel}>Choose from gallery</Text>
          </Pressable>
          <Pressable style={styles.optionRow} onPress={() => pickAvatar('camera')} disabled={avatarBusy}>
            <Camera size={20} color={colors.accent} />
            <Text style={styles.optionLabel}>Take a photo</Text>
          </Pressable>
          {person.avatarFaceId === null && (
            <Pressable style={styles.optionRow} onPress={resetAvatar} disabled={avatarBusy}>
              <ArrowCounterClockwise size={20} color={colors.accent} />
              <Text style={styles.optionLabel}>Reset to best quality</Text>
            </Pressable>
          )}
        </BottomSheetView>
      </BottomSheet>
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
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
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
  sheet: {
    backgroundColor: colors.surface,
  },
  sheetContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
