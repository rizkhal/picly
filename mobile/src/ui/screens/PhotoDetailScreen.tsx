import { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { ArrowLeft, MagnifyingGlassPlus, MagnifyingGlassMinus } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { Face } from '../../types';
import { mockPeople, mockPhotos } from '../../data/mock';
import { colors, radius, spacing } from '../../theme';
import { FaceBoxOverlay } from '../components/FaceBoxOverlay';
import { FaceSheet } from '../components/FaceSheet';
import { QualityBadge } from '../components/QualityBadge';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoDetail'>;

/**
 * Full-width photo with orange face boxes. Tap a box → bottom sheet with the
 * large crop, inline rename, assign/unassign. Pinch zoom via buttons for now
 * (native gesture handlers come with the pipeline port).
 */
export function PhotoDetailScreen({ route, navigation }: Props) {
  const { photoId } = route.params;
  const { width } = useWindowDimensions();

  const photo = mockPhotos.find((p) => p.id === photoId) ?? mockPhotos[0];
  const [scale, setScale] = useState(1);
  const [activeFace, setActiveFace] = useState<Face | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [faces, setFaces] = useState(photo.faces);

  // MOCK — real pipeline returns rendered face positions; here the photo is
  // uniformly scaled so normalized boxes map directly onto the displayed image.
  const displayHeight = (width / photo.width) * photo.height;

  const openFace = (face: Face) => {
    setActiveFace(face);
    setSheetVisible(true);
  };

  const handleRename = (name: string) => {
    if (!activeFace) return;
    const trimmed = name.trim();
    setFaces((prev) =>
      prev.map((f) => (f.id === activeFace.id ? { ...f, name: trimmed || null } : f)),
    );
    setSheetVisible(false);
  };

  const handleUnassign = () => {
    if (!activeFace) return;
    setFaces((prev) =>
      prev.map((f) => (f.id === activeFace.id ? { ...f, name: null, personId: null, status: 'unassigned' } : f)),
    );
    setSheetVisible(false);
  };

  const handleAssign = (personName: string) => {
    if (!activeFace) return;
    const person = mockPeople.find((p) => p.name === personName);
    setFaces((prev) =>
      prev.map((f) =>
        f.id === activeFace.id
          ? { ...f, name: personName, personId: person?.id ?? null, status: 'recognized' }
          : f,
      ),
    );
    setSheetVisible(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {faces.length} {faces.length === 1 ? 'face' : 'faces'}
        </Text>
        <View style={styles.zoomRow}>
          <Pressable
            style={styles.zoomBtn}
            hitSlop={6}
            onPress={() => setScale((s) => Math.max(1, s - 0.25))}
          >
            <MagnifyingGlassMinus size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={styles.zoomBtn}
            hitSlop={6}
            onPress={() => setScale((s) => Math.min(4, s + 0.25))}
          >
            <MagnifyingGlassPlus size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        minimumZoomScale={1}
        maximumZoomScale={4}
        bouncesZoom
        pinchGestureEnabled
      >
        <View
          style={{
            width: width * scale,
            height: displayHeight * scale,
          }}
        >
          <Image
            source={{ uri: photo.uri }}
            style={[styles.photo, { width: width * scale, height: displayHeight * scale }]}
            resizeMode="cover"
          />
          {faces.map((face) => (
            <View key={face.id} style={StyleSheet.absoluteFill}>
              <Pressable
                style={{
                  position: 'absolute',
                  left: `${face.box.x * 100}%`,
                  top: `${face.box.y * 100}%`,
                  width: `${face.box.w * 100}%`,
                  height: `${face.box.h * 100}%`,
                }}
                onPress={() => openFace(face)}
              >
                <FaceBoxOverlay box={face.box} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.faceStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {faces.map((face) => (
            <Pressable key={face.id} style={styles.faceChip} onPress={() => openFace(face)}>
              <Image source={{ uri: face.thumbnailUri }} style={styles.faceChipThumb} />
              <QualityBadge tier={face.quality} size="sm" />
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FaceSheet
        face={activeFace}
        photoUri={photo.uri}
        peopleNames={mockPeople.map((p) => p.name)}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onRename={handleRename}
        onUnassign={handleUnassign}
        onAssign={handleAssign}
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  zoomRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    borderRadius: 2,
    backgroundColor: colors.surface2,
  },
  faceStrip: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  faceChip: {
    marginLeft: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  faceChipThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
});
