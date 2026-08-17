import { StyleSheet, View } from 'react-native';
import type { FaceBox } from '../../types';
import { colors } from '../../theme';

interface Props {
  box: FaceBox;
  /** Emphasized variant (e.g. selected / search match). */
  highlighted?: boolean;
}

/**
 * Orange face-box overlay, normalized to the container. Mirrors the desktop
 * rectangle (accent #fb923c) rendered over the full-resolution photo.
 */
export function FaceBoxOverlay({ box, highlighted = false }: Props) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.box,
          highlighted && styles.highlighted,
          {
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.faceBox,
    borderRadius: 4,
  },
  highlighted: {
    borderWidth: 3,
    borderColor: colors.accent,
  },
});
